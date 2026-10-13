package handlers

// HTTP API for teaching tasks: create and edit a task, open a student response, and submit it.
// The task sheet and /tasks routes call these handlers. Files live in package task.

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/umple/umpleonline/backend/internal/task"
)

// TaskHandler handles HTTP requests for the task feature.
type TaskHandler struct {
	store *task.Store
}

// NewTaskHandler creates a new TaskHandler.
func NewTaskHandler(store *task.Store) *TaskHandler {
	return &TaskHandler{store: store}
}

// Create handles POST /api/tasks.
func (h *TaskHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req task.CreateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	view, err := h.store.CreateTask(req)
	if err != nil {
		writeTaskError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(view)
}

// Get handles GET /api/tasks/{name}.
func (h *TaskHandler) Get(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	view, err := h.store.GetTask(name)
	if err != nil {
		writeTaskError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(view)
}

// Update handles PUT /api/tasks/{name}.
func (h *TaskHandler) Update(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	var req task.UpdateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	view, err := h.store.UpdateTask(name, req)
	if err != nil {
		writeTaskError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(view)
}

// CreateResponse handles POST /api/tasks/{name}/responses.
func (h *TaskHandler) CreateResponse(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	view, err := h.store.CreateResponse(name)
	if err != nil {
		writeTaskError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(view)
}

// GetResponse handles GET /api/tasks/responses/{id}.
func (h *TaskHandler) GetResponse(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	view, err := h.store.GetResponse(id)
	if err != nil {
		writeTaskError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(view)
}

// SubmitResponse handles POST /api/tasks/responses/{id}/submit.
func (h *TaskHandler) SubmitResponse(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	view, err := h.store.SubmitResponse(id)
	if err != nil {
		writeTaskError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(view)
}

// ListResponses handles GET /api/tasks/{name}/responses.
func (h *TaskHandler) ListResponses(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	list, err := h.store.ListResponses(name)
	if err != nil {
		writeTaskError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

// writeTaskError maps task store sentinel errors to HTTP status codes.
func writeTaskError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, task.ErrInvalidName):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, task.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, task.ErrAlreadyExists):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, task.ErrAlreadySubmitted):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
