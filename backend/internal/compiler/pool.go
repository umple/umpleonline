package compiler

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

const (
	dialTimeout       = 5 * time.Second
	restartDelay      = 2 * time.Second
	startupMaxRetries = 20
	startupPollDelay  = 250 * time.Millisecond

	compilerVersionFilename      = "versionRunning.txt"
	compilerCommandCountFilename = "commandcount.txt"
	compilerTXLDir               = "txl"
)

// Pool manages a long-running umplesync.jar server process and provides
// TCP socket connections to it. If the JVM crashes, the pool auto-restarts it.
type Pool struct {
	jarPath string
	port    int
	workDir string

	mu      sync.Mutex
	process *exec.Cmd
	alive   bool

	// Per-model mutex prevents concurrent writes to the same model directory.
	modelMu sync.Map // map[string]*sync.Mutex
}

type StatusSnapshot struct {
	JarPath string `json:"jarPath"`
	Port    int    `json:"port"`
	WorkDir string `json:"workDir"`
	Alive   bool   `json:"alive"`
	PID     int    `json:"pid,omitempty"`
}

func NewPool(jarPath string, port int) (*Pool, error) {
	return NewPoolWithWorkDir(jarPath, port, "")
}

// NewPoolWithWorkDir starts the compiler pool and pins the long-running
// umplesync server to a dedicated working directory so helper artifacts stay
// out of the caller's current directory.
func NewPoolWithWorkDir(jarPath string, port int, workDir string) (*Pool, error) {
	if workDir == "" {
		workDir = defaultCompilerWorkDir(port)
	}

	p := &Pool{
		jarPath: jarPath,
		port:    port,
		workDir: workDir,
	}
	if err := p.startServer(); err != nil {
		log.Printf("warning: failed to start umplesync server: %v (will retry on first request)", err)
	}
	return p, nil
}

func defaultCompilerWorkDir(port int) string {
	return filepath.Join(os.TempDir(), fmt.Sprintf("umpleonline-compiler-%d", port))
}

// Execute sends a command to the umplesync server and returns the result.
// It acquires a per-model lock to prevent concurrent writes.
func (p *Pool) Execute(req CompileRequest) (*CompileResult, error) {
	mu := p.getModelMutex(req.WorkDir)
	mu.Lock()
	defer mu.Unlock()

	return p.execute(req)
}

// ExecuteLocked sends a command while assuming the caller already holds the
// per-model lock for req.WorkDir via LockModel. This avoids self-deadlocking
// flows that need to hold the workspace lock across filesystem writes and the
// compiler invocation as one atomic operation.
func (p *Pool) ExecuteLocked(req CompileRequest) (*CompileResult, error) {
	return p.execute(req)
}

func (p *Pool) execute(req CompileRequest) (*CompileResult, error) {
	// Ensure server is running
	if err := p.ensureRunning(); err != nil {
		return nil, fmt.Errorf("compiler not available: %w", err)
	}

	// Connect
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", p.port), dialTimeout)
	if err != nil {
		// Server might have died — try restart once
		log.Printf("connection failed, restarting server: %v", err)
		if restartErr := p.startServer(); restartErr != nil {
			return nil, fmt.Errorf("restart failed: %w", restartErr)
		}
		time.Sleep(restartDelay)
		conn, err = net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", p.port), dialTimeout)
		if err != nil {
			return nil, fmt.Errorf("connect after restart failed: %w", err)
		}
	}
	defer conn.Close()

	return sendCommand(conn, req.Command)
}

func (p *Pool) Log() (*CompileResult, error) {
	if err := p.ensureRunning(); err != nil {
		return nil, fmt.Errorf("compiler not available: %w", err)
	}

	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", p.port), dialTimeout)
	if err != nil {
		return nil, fmt.Errorf("connect failed: %w", err)
	}
	defer conn.Close()

	return sendCommandWithTimeout(conn, "-log", 5*time.Second)
}

func (p *Pool) Status() StatusSnapshot {
	p.mu.Lock()
	defer p.mu.Unlock()

	pid := 0
	if p.process != nil && p.process.Process != nil {
		pid = p.process.Process.Pid
	}

	return StatusSnapshot{
		JarPath: p.jarPath,
		Port:    p.port,
		WorkDir: p.workDir,
		Alive:   p.alive,
		PID:     pid,
	}
}

func (p *Pool) startServer() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Kill existing if any
	if p.process != nil && p.process.Process != nil {
		p.process.Process.Kill()
		p.process.Wait()
	}

	if err := p.prepareWorkDir(); err != nil {
		p.alive = false
		return fmt.Errorf("prepare compiler work dir: %w", err)
	}

	cmd := p.serverCommand()
	if err := cmd.Start(); err != nil {
		p.alive = false
		return fmt.Errorf("failed to start umplesync: %w", err)
	}

	p.process = cmd
	p.alive = true

	// Monitor process in background
	go func() {
		err := cmd.Wait()
		p.mu.Lock()
		p.alive = false
		p.mu.Unlock()
		if err != nil {
			log.Printf("umplesync process exited: %v", err)
		}
	}()

	// Wait for server to be ready
	for i := 0; i < startupMaxRetries; i++ {
		time.Sleep(startupPollDelay)
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", p.port), time.Second)
		if err == nil {
			conn.Close()
			log.Printf("umplesync server ready on port %d", p.port)
			return nil
		}
	}

	return fmt.Errorf("umplesync server did not become ready within %v", startupMaxRetries*startupPollDelay)
}

func (p *Pool) serverCommand() *exec.Cmd {
	cmd := exec.Command("java", "-cp", p.jarPath, "cruise.umple.PlaygroundMain", "-server", fmt.Sprintf("%d", p.port))
	cmd.Dir = p.workDir
	return cmd
}

func (p *Pool) prepareWorkDir() error {
	if err := os.MkdirAll(p.workDir, 0755); err != nil {
		return err
	}

	for _, name := range []string{
		compilerVersionFilename,
		compilerTXLDir,
	} {
		if err := os.RemoveAll(filepath.Join(p.workDir, name)); err != nil {
			return err
		}
	}

	return nil
}

func (p *Pool) ensureRunning() error {
	p.mu.Lock()
	alive := p.alive
	p.mu.Unlock()

	if alive {
		return nil
	}
	return p.startServer()
}

// LockModel acquires the per-model mutex for the given work directory.
// Callers that operate on model files outside of Pool.Execute must use
// LockModel / UnlockModel to prevent concurrent access.
func (p *Pool) LockModel(workDir string) {
	p.getModelMutex(workDir).Lock()
}

// UnlockModel releases the per-model mutex for the given work directory.
func (p *Pool) UnlockModel(workDir string) {
	p.getModelMutex(workDir).Unlock()
}

func (p *Pool) getModelMutex(workDir string) *sync.Mutex {
	val, _ := p.modelMu.LoadOrStore(workDir, &sync.Mutex{})
	return val.(*sync.Mutex)
}

func (p *Pool) Shutdown() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.process != nil && p.process.Process != nil {
		p.process.Process.Kill()
		p.process.Wait()
	}
	p.alive = false
}
