package handlers

// POST /api/crud/diagram. Turns a Graphviz DOT graph of object instances into SVG.
// The object explorer builds the DOT in the browser. This handler only runs dot.

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
)

type CrudDiagramHandler struct{}

func NewCrudDiagramHandler() *CrudDiagramHandler {
	return &CrudDiagramHandler{}
}

type CrudDiagramRequest struct {
	Dot string `json:"dot"`
}

type CrudDiagramResponse struct {
	SVG   string `json:"svg"`
	Error string `json:"error,omitempty"`
}

// Render accepts a DOT string and returns SVG via graphviz dot.
func (h *CrudDiagramHandler) Render(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB limit
	var req CrudDiagramRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Dot == "" {
		writeError(w, http.StatusBadRequest, "dot is required")
		return
	}

	tmpDir, err := os.MkdirTemp("", "crud-diagram-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create temp dir")
		return
	}
	defer os.RemoveAll(tmpDir)

	gvFile := filepath.Join(tmpDir, "instances.gv")
	svgFile := filepath.Join(tmpDir, "instances.svg")

	if err := os.WriteFile(gvFile, []byte(req.Dot), 0644); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write dot file")
		return
	}

	cmd := exec.Command("dot", "-Tsvg", "-o", svgFile, gvFile)
	if out, err := cmd.CombinedOutput(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(CrudDiagramResponse{Error: "dot failed: " + string(out)})
		return
	}

	svgData, err := os.ReadFile(svgFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read svg")
		return
	}

	resp := CrudDiagramResponse{SVG: string(svgData)}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
