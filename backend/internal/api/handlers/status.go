package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/config"
)

type statusCompiler interface {
	Status() compiler.StatusSnapshot
	Log() (*compiler.CompileResult, error)
}

type StatusHandler struct {
	cfg     *config.Config
	pool    statusCompiler
	client  *http.Client
	started time.Time
	mu      sync.Mutex

	sessionsSinceStart int
	logMu              sync.Mutex
	logCheckedAt       time.Time
	logCache           map[string]any
}

type statusCounters struct {
	VisitsStarted   int    `json:"visitsStarted"`
	SessionsStarted int    `json:"sessionsStarted"`
	UpdatedAt       string `json:"updatedAt,omitempty"`
}

func NewStatusHandler(cfg *config.Config, pool statusCompiler) *StatusHandler {
	return &StatusHandler{
		cfg:  cfg,
		pool: pool,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		started: time.Now(),
	}
}

func (h *StatusHandler) Status(w http.ResponseWriter, r *http.Request) {
	checks := map[string]map[string]string{}
	overall := "ok"

	recordStatusCheck(checks, "umplesyncJar", h.requirePath(h.cfg.UmpleSyncJar))
	recordStatusCheck(checks, "txlBinary", h.requirePath(txlBinaryPath))
	recordStatusCheck(checks, "txlRuntime", h.requirePath(txlLibPath))
	recordStatusCheck(checks, "modelStore", h.requireWritableDir(h.cfg.ModelStorePath))
	recordStatusCheck(checks, "executionService", h.requireExecutionService())

	for _, check := range checks {
		if check["status"] != "ok" {
			overall = "degraded"
			break
		}
	}

	umplesync := h.umplesyncStatus()
	if status, _ := umplesync["status"].(string); status != "ok" {
		overall = "degraded"
	}

	type serviceResult struct {
		name string
		data map[string]any
	}
	results := make(chan serviceResult, 3)
	for name, url := range map[string]string{
		"codeExecution": h.cfg.ExecutionURL, "collaboration": h.cfg.CollabURL, "lsp": h.cfg.LSPURL,
	} {
		go func(name, url string) { results <- serviceResult{name, h.serviceStatus(name, url)} }(name, url)
	}
	services := map[string]any{}
	for i := 0; i < 3; i++ {
		result := <-results
		services[result.name] = result.data
	}
	for _, service := range services {
		if serviceMap, ok := service.(map[string]any); ok {
			if serviceMap["status"] != "ok" {
				overall = "degraded"
			}
		}
	}

	counters := h.counters()
	if counters["status"] != "ok" {
		overall = "degraded"
	}
	dependencies := dependencyStatus()
	for _, dependency := range dependencies {
		if (dependency["name"] == "java" || dependency["name"] == "dot") && dependency["status"] != "ok" {
			overall = "degraded"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":        overall,
		"generatedAt":   time.Now().UTC().Format(time.RFC3339),
		"uptimeSeconds": int(time.Since(h.started).Seconds()),
		"build":         buildStatus(),
		"release":       releaseStatus(),
		"process": map[string]any{
			"pid":       os.Getpid(),
			"hostname":  hostname(),
			"goVersion": runtime.Version(),
			"os":        runtime.GOOS,
			"arch":      runtime.GOARCH,
		},
		"config": map[string]any{
			"backendPort":    h.cfg.Port,
			"umplePort":      h.cfg.UmplePort,
			"modelStorePath": h.cfg.ModelStorePath,
			"examplePath":    h.cfg.ExamplePath,
			"executionURL":   h.cfg.ExecutionURL,
			"collabURL":      h.cfg.CollabURL,
			"lspURL":         h.cfg.LSPURL,
		},
		"dependencies": dependencies,
		"checks":       checks,
		"umplesync":    umplesync,
		"services":     services,
		"counters":     counters,
		"legacy":       h.operationalStatus(dependencies, services["codeExecution"].(map[string]any)),
		"summary":      h.summary(umplesync),
	})
}

func (h *StatusHandler) RecordSession(w http.ResponseWriter, r *http.Request) {
	h.recordCounter(w, true)
}

func (h *StatusHandler) RecordVisit(w http.ResponseWriter, r *http.Request) {
	h.recordCounter(w, false)
}

func (h *StatusHandler) recordCounter(w http.ResponseWriter, session bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	counters, err := h.readCounters()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if session {
		counters.SessionsStarted++
	} else {
		counters.VisitsStarted++
	}
	counters.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := h.writeCounters(counters); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if session {
		h.sessionsSinceStart++
	}
	w.WriteHeader(http.StatusNoContent)
}

func recordStatusCheck(checks map[string]map[string]string, name string, err error) {
	if err != nil {
		checks[name] = map[string]string{
			"status": "degraded",
			"detail": err.Error(),
		}
		return
	}

	checks[name] = map[string]string{"status": "ok"}
}

func (h *StatusHandler) requirePath(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%s unavailable: %w", path, err)
	}

	return nil
}

func (h *StatusHandler) requireWritableDir(path string) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("create dir: %w", err)
	}

	file, err := os.CreateTemp(path, ".statuscheck-*")
	if err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}

	name := file.Name()
	if err := file.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	if err := os.Remove(name); err != nil {
		return fmt.Errorf("remove temp file: %w", err)
	}

	return nil
}

func (h *StatusHandler) requireExecutionService() error {
	url := strings.TrimRight(h.cfg.ExecutionURL, "/") + "/health"
	resp, err := h.client.Get(url)
	if err != nil {
		return fmt.Errorf("request %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("request %s returned status %d", url, resp.StatusCode)
	}

	return nil
}

func (h *StatusHandler) counters() map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()

	counters, err := h.readCounters()
	if err != nil {
		return map[string]any{
			"status": "degraded",
			"error":  err.Error(),
		}
	}

	return map[string]any{
		"status":                    "ok",
		"sessionsStartedHistorical": counters.SessionsStarted,
		"visitsStartedHistorical":   counters.VisitsStarted,
		"sessionsStartedSinceStart": h.sessionsSinceStart,
		"updatedAt":                 counters.UpdatedAt,
	}
}

func (h *StatusHandler) readCounters() (statusCounters, error) {
	var counters statusCounters
	data, err := os.ReadFile(h.countersPath())
	if err != nil {
		if os.IsNotExist(err) {
			return counters, nil
		}
		return counters, fmt.Errorf("read counters: %w", err)
	}

	if err := json.Unmarshal(data, &counters); err != nil {
		return counters, fmt.Errorf("parse counters: %w", err)
	}

	return counters, nil
}

func (h *StatusHandler) writeCounters(counters statusCounters) error {
	if err := os.MkdirAll(h.cfg.ModelStorePath, 0o755); err != nil {
		return fmt.Errorf("create counter dir: %w", err)
	}

	data, err := json.MarshalIndent(counters, "", "  ")
	if err != nil {
		return fmt.Errorf("encode counters: %w", err)
	}

	file, err := os.CreateTemp(h.cfg.ModelStorePath, ".status-counters-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0o644); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(append(data, '\n')); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), h.countersPath())
}

func (h *StatusHandler) countersPath() string {
	return filepath.Join(h.cfg.ModelStorePath, "status-counters.json")
}

func (h *StatusHandler) serviceStatus(name string, baseURL string) map[string]any {
	url := strings.TrimRight(baseURL, "/") + "/status"
	var body map[string]any
	if err := h.fetchJSON(url, &body); err != nil {
		return map[string]any{
			"name":   name,
			"status": "unreachable",
			"url":    url,
			"error":  err.Error(),
		}
	}

	body["name"] = name
	body["url"] = url
	if _, ok := body["status"]; !ok {
		body["status"] = "ok"
	}
	return body
}

func (h *StatusHandler) fetchJSON(url string, target any) error {
	resp, err := h.client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}

	return json.NewDecoder(resp.Body).Decode(target)
}

func (h *StatusHandler) umplesyncStatus() map[string]any {
	// Log commands contribute to JVM counters; share one snapshot across users.
	h.logMu.Lock()
	defer h.logMu.Unlock()
	if h.logCache != nil && time.Since(h.logCheckedAt) < 30*time.Second {
		return h.logCache
	}
	status := h.readUmplesyncStatus()
	h.logCache = status
	h.logCheckedAt = time.Now()
	status["checkedAt"] = h.logCheckedAt.UTC().Format(time.RFC3339)
	return status
}

func (h *StatusHandler) readUmplesyncStatus() map[string]any {
	snapshot := h.pool.Status()
	status := map[string]any{
		"status":  "ok",
		"jarPath": snapshot.JarPath,
		"port":    snapshot.Port,
		"workDir": snapshot.WorkDir,
		"alive":   snapshot.Alive,
	}
	if snapshot.PID != 0 {
		status["pid"] = snapshot.PID
	}

	result, err := h.pool.Log()
	if err != nil {
		status["status"] = "degraded"
		status["error"] = err.Error()
		return status
	}

	status["log"] = strings.TrimSpace(result.Output)
	if strings.TrimSpace(result.Errors) != "" {
		status["status"] = "degraded"
		status["errors"] = strings.TrimSpace(result.Errors)
	}
	if status["log"] == "" {
		status["status"] = "degraded"
		status["error"] = "Compiler returned no log output"
	}
	return status
}

func buildStatus() map[string]any {
	sourceRef := firstPresent(os.Getenv("SOURCE_REF"), os.Getenv("GITHUB_REF"))
	imageRef := firstPresent(os.Getenv("BACKEND_IMAGE_REF"), os.Getenv("IMAGE_TAG"))

	return map[string]any{
		"sourceCommit":       firstNonEmpty(os.Getenv("SOURCE_COMMIT"), os.Getenv("GIT_COMMIT"), os.Getenv("GITHUB_SHA"), commitFromImageRef(imageRef), gitOutput("rev-parse", "--short", "HEAD")),
		"sourceRef":          sourceRef,
		"sourceRefName":      firstPresent(os.Getenv("SOURCE_REF_NAME"), os.Getenv("GITHUB_REF_NAME"), os.Getenv("GIT_BRANCH"), refNameFromRef(sourceRef), gitOutput("rev-parse", "--abbrev-ref", "HEAD")),
		"sourceRefType":      firstPresent(os.Getenv("SOURCE_REF_TYPE"), refTypeFromRef(sourceRef)),
		"builtAt":            os.Getenv("BUILD_TIME"),
		"backendImage":       imageRef,
		"umplesyncJarSource": os.Getenv("UMPLESYNC_JAR_URL"),
		"umplesyncJarSha256": os.Getenv("UMPLESYNC_JAR_SHA256"),
	}
}

func releaseStatus() map[string]any {
	release := map[string]any{
		"releaseTag":   os.Getenv("RELEASE_TAG"),
		"deployedAt":   os.Getenv("DEPLOYED_AT"),
		"sourceCommit": os.Getenv("DEPLOYED_SOURCE_COMMIT"),
		"sourceRef":    os.Getenv("DEPLOYED_SOURCE_REF"),
		"backendImage": firstPresent(os.Getenv("BACKEND_IMAGE_REF"), os.Getenv("IMAGE_TAG")),
	}
	for _, value := range release {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return release
		}
	}
	return map[string]any{}
}

func commitFromImageRef(imageRef string) string {
	_, tag, ok := strings.Cut(strings.TrimSpace(imageRef), ":sha-")
	if !ok {
		return ""
	}
	return tag
}

func refNameFromRef(ref string) string {
	ref = strings.TrimSpace(ref)
	if name, ok := strings.CutPrefix(ref, "refs/heads/"); ok {
		return name
	}
	if name, ok := strings.CutPrefix(ref, "refs/tags/"); ok {
		return name
	}
	return ""
}

func refTypeFromRef(ref string) string {
	ref = strings.TrimSpace(ref)
	if strings.HasPrefix(ref, "refs/heads/") {
		return "branch"
	}
	if strings.HasPrefix(ref, "refs/tags/") {
		return "tag"
	}
	return ""
}

func dependencyStatus() []map[string]string {
	return []map[string]string{
		commandDependency("java", "java", "-version"),
		commandDependency("dot", "dot", "-V"),
		commandDependency("python", "python3", "--version"),
		pathDependency("txlBinary", txlBinaryPath),
		pathDependency("txlRuntime", txlLibPath),
	}
}

func (h *StatusHandler) operationalStatus(dependencies []map[string]string, execution map[string]any) map[string]any {
	snapshot := h.pool.Status()
	listenerState := "unavailable"
	if snapshot.Alive {
		listenerState = "ok"
	}
	docker, ok := execution["docker"].(map[string]any)
	if !ok {
		docker = map[string]any{"status": "unavailable", "detail": "Execution service did not report Docker diagnostics"}
	}
	return map[string]any{
		"software": dependencies,
		"listener": map[string]any{"status": listenerState, "port": snapshot.Port, "pid": snapshot.PID},
		"docker":   docker,
		"execution": map[string]any{
			"runnerImage":    execution["runnerImage"],
			"runner":         execution["runner"],
			"port":           h.cfg.ExecutionURL,
			"timeoutSeconds": execution["timeoutSeconds"],
		},
		"visits": h.visitStatus(),
	}
}

func (h *StatusHandler) visitStatus() map[string]any {
	counters := h.counters()
	return map[string]any{
		"status":    counters["status"],
		"label":     "Editor visits since tracking began in this deployment",
		"value":     counters["visitsStartedHistorical"],
		"updatedAt": counters["updatedAt"],
	}
}

func gitOutput(args ...string) string {
	output, ok := commandOutputOK("git", args...)
	if !ok {
		return ""
	}
	return output
}

func commandDependency(name string, command string, args ...string) map[string]string {
	output, ok := commandOutputOK(command, args...)
	if !ok || output == "" {
		return map[string]string{
			"name":   name,
			"status": "unavailable",
			"detail": output,
		}
	}

	path, _ := exec.LookPath(command)
	return map[string]string{
		"name": name, "status": "ok", "detail": output, "path": path,
	}
}

func pathDependency(name string, path string) map[string]string {
	if _, err := os.Stat(path); err != nil {
		return map[string]string{
			"name":   name,
			"status": "unavailable",
			"detail": err.Error(),
		}
	}

	return map[string]string{
		"name":   name,
		"status": "ok",
		"detail": path,
	}
}

func commandOutputOK(command string, args ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, command, args...)
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err == nil
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil {
		return ""
	}
	return name
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "unknown"
}

func firstPresent(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
