package handlers

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/config"
)

const testCompilerLog = `Version: 1.37.1.8677.83609afbe Jar example
Number of commands run since start: 12  (pace 2/h
Number of commands run since July 2019: 4567
`

type fakeStatusCompiler struct {
	calls  int
	output string
	err    error
}

func (p *fakeStatusCompiler) Status() compiler.StatusSnapshot {
	return compiler.StatusSnapshot{Alive: true, PID: 42, Port: 5555}
}
func (p *fakeStatusCompiler) Log() (*compiler.CompileResult, error) {
	p.calls++
	return &compiler.CompileResult{Output: p.output}, p.err
}

func TestSummarySharesLogAndOmitsPrivateDiagnostics(t *testing.T) {
	clearBuildStatusEnv(t)
	t.Setenv("SOURCE_REF_NAME", "master")
	t.Setenv("SOURCE_COMMIT", "abcdef123456")
	t.Setenv("DEPLOYED_AT", "2026-10-04T12:00:00Z")
	pool := &fakeStatusCompiler{output: testCompilerLog + "\nLast command from private-address /private/model.ump"}
	h := NewStatusHandler(&config.Config{ModelStorePath: t.TempDir()}, pool)
	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		h.Summary(w, httptest.NewRequest("GET", "/status/summary", nil))
		var got StatusSummary
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.Status != "ok" || got.Compiler.Version != "1.37.1.8677.83609afbe" ||
			got.Compiler.CommandsHistorical == nil || *got.Compiler.CommandsHistorical != 4567 ||
			got.Compiler.CommandsSinceStart == nil || *got.Compiler.CommandsSinceStart != 12 ||
			got.Branch != "master" || got.UpdatedAt != "2026-10-04T12:00:00Z" {
			t.Fatalf("summary: %+v", got)
		}
		if strings.Contains(w.Body.String(), "jarPath") || strings.Contains(w.Body.String(), "Last command") {
			t.Fatal("private diagnostics leaked into public summary")
		}
	}
	if pool.calls != 1 {
		t.Fatalf("made %d log calls, want 1", pool.calls)
	}
}

func TestCountersPersistAndDistinguishVisitsFromSessions(t *testing.T) {
	cfg := &config.Config{ModelStorePath: t.TempDir()}
	h := NewStatusHandler(cfg, nil)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			h.RecordVisit(w, nil)
			if w.Code != 204 {
				t.Errorf("visit status: %d", w.Code)
			}
		}()
	}
	wg.Wait()
	h.RecordSession(httptest.NewRecorder(), nil)
	restarted := NewStatusHandler(cfg, nil)
	got, err := restarted.readCounters()
	if err != nil || got.VisitsStarted != 20 || got.SessionsStarted != 1 {
		t.Fatalf("persisted counters: %+v, err=%v", got, err)
	}
	if restarted.sessionsSinceStart != 0 {
		t.Fatal("restart should reset process session count")
	}
}

func TestCompilerStatusRejectsEmptyAndFailedLogs(t *testing.T) {
	for _, pool := range []*fakeStatusCompiler{{}, {err: errors.New("offline")}} {
		h := NewStatusHandler(&config.Config{ModelStorePath: t.TempDir()}, pool)
		if got := h.umplesyncStatus(); got["status"] != "degraded" {
			t.Fatalf("failed log reported healthy: %+v", got)
		}
	}
}

func TestParseCompilerSummaryDoesNotInventMissingCounts(t *testing.T) {
	got := parseCompilerSummary("unrecognized log")
	if got.Version != "" || got.CommandsHistorical != nil || got.CommandsSinceStart != nil {
		t.Fatalf("invented compiler statistics: %+v", got)
	}
}

func TestFailedVersionCommandIsNotHealthy(t *testing.T) {
	got := commandDependency("shell", "sh", "-c", "echo failure; exit 1")
	if got["status"] != "unavailable" || got["detail"] != "failure" {
		t.Fatalf("failed command reported healthy: %+v", got)
	}
}
