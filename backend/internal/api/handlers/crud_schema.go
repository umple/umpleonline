package handlers

// POST /api/crud/schema. Compiles the model and returns the object-explorer schema.
// The schema itself is built by package crud from the compiler's model.json.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/umple/umpleonline/backend/internal/api/handlers/crud"
	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/model"
)

type CrudSchemaHandler struct {
	pool  *compiler.Pool
	store *model.Store
}

func NewCrudSchemaHandler(pool *compiler.Pool, store *model.Store) *CrudSchemaHandler {
	return &CrudSchemaHandler{pool: pool, store: store}
}

type CrudSchemaRequest struct {
	Code      string `json:"code"`
	ModelID   string `json:"modelId,omitempty"`
	ActiveTabID string `json:"activeTabId,omitempty"`
}

type CrudSchemaResponse struct {
	Schema  crud.CrudSchema `json:"schema"`
	Errors  string          `json:"errors,omitempty"`
	ModelID string          `json:"modelId"`
}

func (h *CrudSchemaHandler) Schema(w http.ResponseWriter, r *http.Request) {
	var req CrudSchemaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}

	entryFile := resolveEntryFile(h.store, req.ModelID, req.ActiveTabID)
	modelID, dir, err := resolveModel(h.store, req.ModelID, req.Code, entryFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to resolve model: %v", err))
		return
	}

	// Compile to JSON
	command := fmt.Sprintf("-generate Json %s/%s", dir, entryFile)
	result, err := h.pool.Execute(compiler.CompileRequest{
		Command: command,
		WorkDir: dir,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("compile failed: %v", err))
		return
	}

	// Read model.json
	jsonOutput := result.Output
	jsonPath := filepath.Join(dir, "model.json")
	if data, err := os.ReadFile(jsonPath); err == nil {
		jsonOutput = string(data)
	}

	// Parse raw model
	var rawModel crud.RawModel
	if err := json.Unmarshal([]byte(jsonOutput), &rawModel); err != nil {
		resp := CrudSchemaResponse{
			Schema:  crud.CrudSchema{Classes: []crud.CrudClass{}, Enums: []crud.CrudEnum{}},
			Errors:  result.Errors,
			ModelID: modelID,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// Transform to CRUD schema
	schema := crud.TransformSchema(rawModel)

	resp := CrudSchemaResponse{
		Schema:  schema,
		Errors:  result.Errors,
		ModelID: modelID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
