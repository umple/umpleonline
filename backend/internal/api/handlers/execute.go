package handlers

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
	Code        string   `json:"code"`
	Language    string   `json:"language"`
	ModelID     string   `json:"modelId,omitempty"`
	ActiveTabID string   `json:"activeTabId,omitempty"`
	Tabs        []apiTab `json:"tabs,omitempty"`
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
	if req.Language != "Java" && req.Language != "Python" {
		writeError(w, http.StatusBadRequest, "execution is only supported for Java and Python")
		return
	}

	entryFile := model.DefaultEntryFile
	if len(req.Tabs) > 0 {
		var err error
		entryFile, req.Code, err = executionEntry(req.Tabs, req.ActiveTabID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	} else {
		entryFile = resolveEntryFile(h.store, req.ModelID, req.ActiveTabID)
	}

	unlock := lockModelWorkspace(h.pool, h.store, req.ModelID)
	defer unlock()

	// Persist the complete editor snapshot before compiling, including fresh
	// models and edits made while dynamic generation is disabled.
	modelID, dir, err := resolveModel(h.store, req.ModelID, req.Code, entryFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to resolve model: %v", err))
		return
	}

	if err := saveExecutionTabs(h.store, modelID, req.Tabs, req.ActiveTabID, entryFile); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to save tabs: %v", err))
		return
	}

	// First: compile/generate the target language
	command := fmt.Sprintf("-generate %s %s/%s -cx", req.Language, dir, entryFile)
	execute := h.pool.Execute
	if req.ModelID != "" {
		execute = h.pool.ExecuteLocked
	}
	compileResult, err := execute(compiler.CompileRequest{
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

// executionEntry validates the snapshot before any model files are changed.
func executionEntry(tabs []apiTab, activeTabID string) (string, string, error) {
	seen := make(map[string]bool, len(tabs))
	entryFile, entryCode := "", ""
	for _, tab := range tabs {
		name, err := model.SafeTabName(tab.Name)
		if err != nil {
			return "", "", fmt.Errorf("invalid tab name: %s", tab.Name)
		}
		if seen[name] {
			return "", "", fmt.Errorf("duplicate tab name: %s", name)
		}
		seen[name] = true
		if tab.ID == activeTabID {
			entryFile, entryCode = name, tab.Code
		}
	}
	if entryFile == "" {
		return "", "", fmt.Errorf("active tab not found")
	}
	return entryFile, entryCode, nil
}

func saveExecutionTabs(store *model.Store, modelID string, tabs []apiTab, activeTabID, entryFile string) error {
	if len(tabs) == 0 {
		return nil
	}
	meta := make([]model.TabMeta, len(tabs))
	files := make(map[string]string, len(tabs))
	for i, tab := range tabs {
		name := model.EnsureUmpExt(tab.Name) // validated by executionEntry
		meta[i] = model.TabMeta{ID: tab.ID, Name: name}
		files[name] = tab.Code
	}
	if err := store.SaveTabs(modelID, &model.TabsData{ActiveTabID: activeTabID, Tabs: meta}); err != nil {
		return err
	}
	return store.SaveTabFiles(modelID, files, entryFile)
}
