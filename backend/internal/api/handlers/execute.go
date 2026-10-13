package handlers

// POST /api/execute. Compiles the model, then asks code-exec to run a main method.
// The message pane shows the program output this handler returns.

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/execution"
	"github.com/umple/umpleonline/backend/internal/model"
)

type ExecuteHandler struct {
	pool  *compiler.Pool
	store *model.Store
	proxy *execution.Proxy
}

func NewExecuteHandler(pool *compiler.Pool, store *model.Store, proxy *execution.Proxy) *ExecuteHandler {
	return &ExecuteHandler{pool: pool, store: store, proxy: proxy}
}

type ExecuteRequest struct {
	Code      string `json:"code"`
	Language  string `json:"language"`
	ModelID   string `json:"modelId,omitempty"`
	ActiveTabID string `json:"activeTabId,omitempty"`
}

type ExecuteResponse struct {
	Output  string `json:"output"`
	Errors  string `json:"errors,omitempty"`
	ModelID string `json:"modelId"`
}

func (h *ExecuteHandler) Execute(w http.ResponseWriter, r *http.Request) {
	var req ExecuteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}
	if req.Language == "" {
		writeError(w, http.StatusBadRequest, "language is required")
		return
	}

	// Ensure model directory exists
	entryFile := resolveEntryFile(h.store, req.ModelID, req.ActiveTabID)
	modelID, dir, err := resolveModel(h.store, req.ModelID, req.Code, entryFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to resolve model: %v", err))
		return
	}

	// First: compile/generate the target language
	command := fmt.Sprintf("-generate %s %s/%s -cx", req.Language, dir, entryFile)
	compileResult, err := h.pool.Execute(compiler.CompileRequest{
		Command: command,
		WorkDir: dir,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("compilation failed: %v", err))
		return
	}

	// Proxy to the code-exec service with the model directory path.
	// code-exec handles compile errors itself (checks for main class file).
	execResult, err := h.proxy.Execute(dir, compileResult.Errors, req.Language)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("execution failed: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ExecuteResponse{
		Output:  execResult.Output,
		Errors:  execResult.Errors,
		ModelID: modelID,
	})
}
