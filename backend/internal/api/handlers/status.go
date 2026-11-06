package handlers

// GET /api/status and POST /api/status/session.
// StatusHandler builds the diagnostics payload the /status page renders: compiler pool, disk, collab, LSP, and code-exec.
// RecordSession counts one browser session per tab.

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

type StatusHandler struct {
	cfg     *config.Config
	pool    *compiler.Pool
	client  *http.Client
	started time.Time
	mu      sync.Mutex

	sessionsSinceStart int
}

type statusCounters struct {
	SessionsStarted int    `json:"sessionsStarted"`
	UpdatedAt       string `json:"updatedAt,omitempty"`
}

func NewStatusHandler(cfg *config.Config, pool *compiler.Pool) *StatusHandler {
	return &StatusHandler{
		cfg:  cfg,
		pool: pool,
		client: &http.Client{
			Timeout: 2 * time.Second,
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

	services := map[string]any{
		"codeExecution": h.serviceStatus("codeExecution", h.cfg.ExecutionURL),
		"collaboration": h.serviceStatus("collaboration", h.cfg.CollabURL),
		"lsp":           h.serviceStatus("lsp", h.cfg.LSPURL),
	}
	for _, service := range services {
		if serviceMap, ok := service.(map[string]any); ok {
			if serviceMap["status"] == "unreachable" {
				overall = "degraded"
			}
		}
	}

	counters := h.counters()

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
		"dependencies": dependencyStatus(),
		"checks":       checks,
		"umplesync":    umplesync,
		"services":     services,
		"counters":     counters,
		"legacy":       h.legacyStatus(),
	})
}

func (h *StatusHandler) RecordSession(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()

	counters, err := h.readCounters()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	counters.SessionsStarted++
	counters.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := h.writeCounters(counters); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.sessionsSinceStart++
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

	return os.WriteFile(h.countersPath(), append(data, '\n'), 0o644)
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
		status["errors"] = strings.TrimSpace(result.Errors)
	}
	return status
}

func buildStatus() map[string]any {
	sourceRef := firstPresent(os.Getenv("SOURCE_REF"), os.Getenv("GITHUB_REF"))
	imageRef := firstPresent(os.Getenv("BACKEND_IMAGE_REF"), os.Getenv("IMAGE_TAG"))

	return map[string]any{
		"sourceCommit":       firstNonEmpty(os.Getenv("SOURCE_COMMIT"), os.Getenv("GIT_COMMIT"), os.Getenv("GITHUB_SHA"), commitFromImageRef(imageRef), commandOutput("git", "rev-parse", "--short", "HEAD")),
		"sourceRef":          sourceRef,
		"sourceRefName":      firstPresent(os.Getenv("SOURCE_REF_NAME"), os.Getenv("GITHUB_REF_NAME"), refNameFromRef(sourceRef), commandOutput("git", "rev-parse", "--abbrev-ref", "HEAD")),
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
		commandDependency("gcc", "gcc", "--version"),
		commandDependency("php", "php", "-v"),
		commandDependency("docker", "docker", "--version"),
		pathDependency("txlBinary", txlBinaryPath),
		pathDependency("txlRuntime", txlLibPath),
	}
}

func (h *StatusHandler) legacyStatus() map[string]any {
	return map[string]any{
		"software": legacySoftwareStatus(),
		"listener": listenerStatus(h.cfg.UmplePort),
		"docker":   legacyDockerStatus(),
		"execution": map[string]any{
			"mainContainerName": firstNonEmpty(os.Getenv("CODE_EXEC_CONTAINER_NAME"), "code-exec"),
			"tempContainerName": firstNonEmpty(os.Getenv("CODE_RUNNER_IMAGE"), os.Getenv("EXECUTION_RUNNER_IMAGE"), "umple-code-runner:dev"),
			"port":              h.cfg.ExecutionURL,
			"timeoutSeconds":    firstNonEmpty(os.Getenv("EXECUTION_TIMEOUT_SECONDS"), "20"),
		},
		"visits": legacyVisitCounter(),
	}
}

func legacySoftwareStatus() []map[string]string {
	return []map[string]string{
		legacyCommand("php", "php", "-v"),
		legacyCommand("java", "java", "-version"),
		legacyCommand("dot", "dot", "-V"),
		legacyCommand("gcc", "gcc", "--version"),
		legacyCommand("docker", "docker", "--version"),
	}
}

func legacyCommand(name string, command string, args ...string) map[string]string {
	result := commandDependency(name, command, args...)
	if path, err := exec.LookPath(command); err == nil {
		result["path"] = path
	}
	return result
}

func listenerStatus(port int) map[string]string {
	result := map[string]string{
		"port": fmt.Sprint(port),
	}
	if _, err := exec.LookPath("lsof"); err != nil {
		result["status"] = "unavailable"
		result["detail"] = err.Error()
		return result
	}

	output := commandOutput("lsof", "-nP", "-i", fmt.Sprintf(":%d", port), "-sTCP:LISTEN")
	if output == "" {
		result["status"] = "unavailable"
		result["detail"] = "no listening process reported"
		return result
	}

	result["status"] = "ok"
	result["detail"] = output
	return result
}

func legacyDockerStatus() map[string]any {
	type dockerTarget struct {
		Name       string   `json:"name"`
		Candidates []string `json:"candidates"`
	}

	targets := []dockerTarget{
		{Name: "backend", Candidates: compactStrings(os.Getenv("BACKEND_CONTAINER_NAME"), "umpleonline-prod-backend-1", "umpleonline-dev-backend-1")},
		{Name: "collaboration", Candidates: compactStrings(os.Getenv("COLLAB_CONTAINER_NAME"), "umpleonline-prod-collab-1", "umpleonline-dev-collab-1")},
		{Name: "lsp", Candidates: compactStrings(os.Getenv("LSP_CONTAINER_NAME"), "umpleonline-prod-lsp-proxy-1", "umpleonline-dev-lsp-proxy-1")},
		{Name: "codeExecution", Candidates: compactStrings(os.Getenv("CODE_EXEC_CONTAINER_NAME"), "umpleonline-prod-code-exec-1", "umpleonline-dev-code-exec-1")},
		{Name: "codeRunner", Candidates: compactStrings(os.Getenv("CODE_RUNNER_CONTAINER_NAME"), "umple-code-runner", os.Getenv("CODE_RUNNER_IMAGE"), os.Getenv("EXECUTION_RUNNER_IMAGE"))},
	}

	status := map[string]any{
		"containers": targets,
		"stats":      []map[string]any{},
	}
	if _, err := exec.LookPath("docker"); err != nil {
		status["status"] = "unavailable"
		status["detail"] = err.Error()
		return status
	}

	records := []map[string]any{}
	for _, target := range targets {
		record := map[string]any{
			"name":       target.Name,
			"status":     "unavailable",
			"candidates": target.Candidates,
		}

		for _, candidate := range target.Candidates {
			output, ok := commandOutputOK("docker", "container", "stats", "--no-stream", "--format", "json", candidate)
			if !ok || output == "" {
				continue
			}

			stat := map[string]any{}
			if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &stat); err != nil {
				record["status"] = "unparsed"
				record["container"] = candidate
				record["detail"] = strings.TrimSpace(output)
				break
			}
			record["status"] = "ok"
			record["container"] = candidate
			for key, value := range stat {
				record[key] = value
			}
			break
		}
		records = append(records, record)
	}

	status["status"] = "ok"
	status["stats"] = records
	return status
}

func legacyVisitCounter() map[string]string {
	paths := []string{
		filepath.Join(".", "countlog.txt"),
		filepath.Join("..", "countlog.txt"),
		filepath.Join(os.Getenv("MODEL_STORE_PATH"), "countlog.txt"),
	}
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		return map[string]string{
			"status": "ok",
			"label":  "visits since October 2018",
			"value":  strings.TrimSpace(string(data)),
			"path":   path,
		}
	}

	return map[string]string{
		"status": "unavailable",
		"label":  "visits since October 2018",
		"detail": "legacy countlog.txt not found in this deployment",
	}
}

func compactStrings(values ...string) []string {
	seen := map[string]bool{}
	compacted := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		compacted = append(compacted, value)
	}
	return compacted
}

func commandDependency(name string, command string, args ...string) map[string]string {
	output := commandOutput(command, args...)
	if output == "" {
		return map[string]string{
			"name":   name,
			"status": "unavailable",
		}
	}

	return map[string]string{
		"name":   name,
		"status": "ok",
		"detail": output,
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

func commandOutput(command string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, command, args...)
	output, err := cmd.CombinedOutput()
	if err != nil && len(output) == 0 {
		return ""
	}

	return strings.TrimSpace(string(output))
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
