package handlers

// GET /api/health checks the compiler jar, TXL, the model directory, and code-exec.
// Process managers hit this. The /status page uses the richer report from status.go.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/umple/umpleonline/backend/internal/config"
)

const (
	txlBinaryPath = "/usr/local/bin/txl"
	txlLibPath    = "/usr/local/lib/txl"
)

type HealthHandler struct {
	cfg    *config.Config
	client *http.Client
}

func NewHealthHandler(cfg *config.Config) *HealthHandler {
	return &HealthHandler{
		cfg: cfg,
		client: &http.Client{
			Timeout: 2 * time.Second,
		},
	}
}

func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{}
	failures := map[string]string{}

	h.recordCheck(checks, failures, "umplesyncJar", h.requirePath(h.cfg.UmpleSyncJar))
	h.recordCheck(checks, failures, "txlBinary", h.requirePath(txlBinaryPath))
	h.recordCheck(checks, failures, "txlRuntime", h.requirePath(txlLibPath))
	h.recordCheck(checks, failures, "modelStore", h.requireWritableDir(h.cfg.ModelStorePath))
	h.recordCheck(checks, failures, "executionService", h.requireExecutionService())

	w.Header().Set("Content-Type", "application/json")
	if len(failures) > 0 {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":   "degraded",
			"checks":   checks,
			"failures": failures,
		})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"checks": checks,
	})
}

func (h *HealthHandler) recordCheck(checks, failures map[string]string, name string, err error) {
	if err != nil {
		failures[name] = err.Error()
		return
	}

	checks[name] = "ok"
}

func (h *HealthHandler) requirePath(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%s unavailable: %w", path, err)
	}

	return nil
}

func (h *HealthHandler) requireWritableDir(path string) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("create dir: %w", err)
	}

	file, err := os.CreateTemp(path, ".healthcheck-*")
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

func (h *HealthHandler) requireExecutionService() error {
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
