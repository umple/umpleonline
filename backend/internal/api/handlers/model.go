package handlers

// GET /api/models/{id} loads a model for a shared link. POST /api/models/{id}/promote keeps a temporary one.
// The store in package model does the disk work. This handler is the HTTP edge.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/umple/umpleonline/backend/internal/model"
)

type ModelHandler struct {
	store *model.Store
}

func NewModelHandler(store *model.Store) *ModelHandler {
	return &ModelHandler{store: store}
}

func (h *ModelHandler) Promote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	newID, err := h.store.Promote(id)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "model not found")
		} else {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to promote model: %v", err))
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"oldId": id,
		"newId": newID,
	})
}

func (h *ModelHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	m, err := h.store.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "model not found")
		return
	}

	userCode, _, _ := splitModelSections(m.Code)

	// Try to load tabs (nil means no tabs.json / old model)
	tabsData, _ := h.store.LoadTabs(id)

	resp := map[string]any{
		"modelId": m.ID,
		"code":    userCode,
	}
	if tabsData != nil {
		tabs := make([]apiTab, len(tabsData.Tabs))
		for i, t := range tabsData.Tabs {
			code, err := h.store.ReadTabCode(id, t.Name)
			if err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to read tab %q: %v", t.Name, err))
				return
			}
			if userCode, _, hasDelimiter := splitModelSections(code); hasDelimiter {
				code = userCode
			}
			tabs[i] = apiTab{ID: t.ID, Name: t.Name, Code: code}
		}
		resp["tabs"] = tabs
		resp["activeTabId"] = tabsData.ActiveTabID
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
