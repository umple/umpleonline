package handlers

// POST /api/export. Builds a downloadable diagram.
// Graphviz formats go through dot. Yuml, Mermaid, and the other text formats go through umplesync.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/model"
)

type ExportHandler struct {
	pool  *compiler.Pool
	store *model.Store
}

func NewExportHandler(pool *compiler.Pool, store *model.Store) *ExportHandler {
	return &ExportHandler{pool: pool, store: store}
}

type ExportRequest struct {
	Code      string `json:"code"`
	Format    string `json:"format"`
	ModelID   string `json:"modelId,omitempty"`
	ActiveTabID string `json:"activeTabId,omitempty"`
}

// validExportFormats lists the supported export formats.
var validExportFormats = map[string]bool{
	"svg":     true,
	"png":     true,
	"yuml":    true,
	"mermaid": true,
}

func (h *ExportHandler) Export(w http.ResponseWriter, r *http.Request) {
	var req ExportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}
	if req.Format == "" {
		writeError(w, http.StatusBadRequest, "format is required")
		return
	}
	if !validExportFormats[req.Format] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported format: %s", req.Format))
		return
	}

	// Ensure model directory exists
	entryFile := resolveEntryFile(h.store, req.ModelID, req.ActiveTabID)
	modelID, dir, err := resolveModel(h.store, req.ModelID, req.Code, entryFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to resolve model: %v", err))
		return
	}

	switch req.Format {
	case "svg":
		h.exportGraphviz(w, dir, modelID, "svg", entryFile)
	case "png":
		h.exportGraphviz(w, dir, modelID, "png", entryFile)
	case "yuml":
		h.exportUmple(w, dir, modelID, "Yuml", entryFile)
	case "mermaid":
		h.exportUmple(w, dir, modelID, "Mermaid", entryFile)
	}
}

// exportGraphviz generates a GvClassDiagram .gv file, then converts via dot.
func (h *ExportHandler) exportGraphviz(w http.ResponseWriter, dir, modelID, format, entryFile string) {
	// Generate .gv via umple
	command := fmt.Sprintf("-generate GvClassDiagram %s/%s", dir, entryFile)
	result, err := h.pool.Execute(compiler.CompileRequest{
		Command: command,
		WorkDir: dir,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("generation failed: %v", err))
		return
	}

	// Find the generated .gv file
	gvFile := ""
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("warning: failed to read model directory %s: %v", dir, err)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".gv") {
			gvFile = filepath.Join(dir, e.Name())
			break
		}
	}

	if gvFile == "" {
		writeError(w, http.StatusInternalServerError, "no diagram output generated")
		return
	}

	// Run dot to convert
	outFile := filepath.Join(dir, "export."+format)
	dotCmd := exec.Command("dot", "-T"+format, "-o", outFile, gvFile)
	dotCmd.Dir = dir
	if dotOutput, err := dotCmd.CombinedOutput(); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("dot conversion failed: %v: %s", err, string(dotOutput)))
		return
	}

	data, err := os.ReadFile(outFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read export output")
		return
	}

	switch format {
	case "svg":
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Write(data)
	case "png":
		w.Header().Set("Content-Type", "image/png")
		w.Write(data)
	}

	_ = result // errors already checked
}

// exportUmple generates output via umplesync.jar (Yuml, Mermaid, etc.).
func (h *ExportHandler) exportUmple(w http.ResponseWriter, dir, modelID, generator, entryFile string) {
	command := fmt.Sprintf("-generate %s %s/%s", generator, dir, entryFile)
	result, err := h.pool.Execute(compiler.CompileRequest{
		Command: command,
		WorkDir: dir,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("generation failed: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"output":  result.Output,
		"errors":  result.Errors,
		"modelId": modelID,
	})
}
