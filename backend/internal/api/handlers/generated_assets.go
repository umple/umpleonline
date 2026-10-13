package handlers

// GET /api/generated/{modelId}/... serves files the compiler wrote for that model.
// Generated HTML references images this way. The path is checked so a request cannot leave the model directory.

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/umple/umpleonline/backend/internal/model"
)

type GeneratedAssetHandler struct {
	store *model.Store
}

func NewGeneratedAssetHandler(store *model.Store) *GeneratedAssetHandler {
	return &GeneratedAssetHandler{store: store}
}

func (h *GeneratedAssetHandler) Serve(w http.ResponseWriter, r *http.Request) {
	modelID := chi.URLParam(r, "modelId")
	relPath := chi.URLParam(r, "*")
	if relPath == "" {
		writeError(w, http.StatusBadRequest, "asset path is required")
		return
	}

	root := h.store.ModelDir(modelID)
	cleanRel := strings.TrimPrefix(path.Clean("/"+relPath), "/")
	fullPath := filepath.Join(root, filepath.FromSlash(cleanRel))
	if !isWithinRoot(root, fullPath) {
		writeError(w, http.StatusBadRequest, "invalid asset path")
		return
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}

	if info.IsDir() {
		// Serve directory index if present; http.ServeFile handles missing files.
		for _, candidate := range []string{"index.html", "index.htm"} {
			indexPath := filepath.Join(fullPath, candidate)
			if fi, err := os.Stat(indexPath); err == nil && !fi.IsDir() {
				http.ServeFile(w, r, indexPath)
				return
			}
		}
		writeError(w, http.StatusNotFound, "directory index not found")
		return
	}

	http.ServeFile(w, r, fullPath)
}

func isWithinRoot(root, target string) bool {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	// Resolve symlinks so traversal via symlink is caught
	if resolved, err := filepath.EvalSymlinks(absTarget); err == nil {
		absTarget = resolved
	}
	if resolved, err := filepath.EvalSymlinks(absRoot); err == nil {
		absRoot = resolved
	}
	rel, err := filepath.Rel(absRoot, absTarget)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != "..")
}
