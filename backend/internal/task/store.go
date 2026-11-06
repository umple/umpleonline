// Package task stores teaching-task definitions and student responses on disk.
// The task HTTP handler is the only caller.
package task

// The store creates a task, copies its starter Umple into a response directory, and records a submission.
// Task names are checked so an id cannot escape the task directory.

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Store manages filesystem-based task storage.
type Store struct {
	root string
}

var namePattern = regexp.MustCompile(`^[a-zA-Z0-9_.]{1,100}$`)

// reservedNames collide with the internal "responses/" subdirectory.
var reservedNames = map[string]bool{
	"responses": true,
}

// ValidateName checks that a task name is well-formed.
func ValidateName(name string) error {
	if !namePattern.MatchString(name) {
		return ErrInvalidName
	}
	return nil
}

func sanitizeName(name string) (string, error) {
	name = strings.ToLower(name)
	if err := ValidateName(name); err != nil {
		return "", err
	}
	if reservedNames[name] {
		return "", ErrInvalidName
	}
	return name, nil
}

func NewStore(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, fmt.Errorf("create task store root: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "responses"), 0755); err != nil {
		return nil, fmt.Errorf("create responses dir: %w", err)
	}
	return &Store{root: root}, nil
}

// CreateTask creates a new task definition on disk and returns the task view.
func (s *Store) CreateTask(req CreateTaskRequest) (view *TaskView, err error) {
	name, err := sanitizeName(req.TaskName)
	if err != nil {
		return nil, err
	}

	dir := filepath.Join(s.root, name)
	// os.Mkdir fails atomically if dir exists — no race conditions.
	if err := os.Mkdir(dir, 0755); err != nil {
		if os.IsExist(err) {
			return nil, ErrAlreadyExists
		}
		return nil, fmt.Errorf("create task dir: %w", err)
	}
	defer func() {
		if err != nil {
			os.RemoveAll(dir)
		}
	}()

	now := time.Now().UTC()

	details := TaskDetails{
		TaskName:      name,
		RequestorName: req.RequestorName,
		CompletionURL: req.CompletionURL,
		IsExperiment:  req.IsExperiment,
		CreatedAt:     now,
	}
	if err := writeJSON(filepath.Join(dir, "taskdetails.json"), details); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "instructions.md"), []byte(req.Instructions), 0644); err != nil {
		return nil, err
	}
	if len(req.Tabs) > 0 {
		if err := writeModelTabs(dir, req.Tabs); err != nil {
			return nil, err
		}
	} else {
		if err := os.WriteFile(filepath.Join(dir, "model.ump"), []byte(req.ModelCode), 0644); err != nil {
			return nil, err
		}
	}

	tv := buildTaskView(&details, req.Instructions, req.ModelCode, req.Tabs)
	return &tv, nil
}

// GetTask returns the public view of a task (no editKey).
func (s *Store) GetTask(name string) (*TaskView, error) {
	name, err := sanitizeName(name)
	if err != nil {
		return nil, ErrNotFound
	}
	dir := filepath.Join(s.root, name)
	details, err := readJSON[TaskDetails](filepath.Join(dir, "taskdetails.json"))
	if err != nil {
		return nil, ErrNotFound
	}
	tv := loadTaskView(dir, details)
	return &tv, nil
}

// UpdateTask updates a task definition.
// All fields are overwritten unconditionally (PUT semantics).
func (s *Store) UpdateTask(name string, req UpdateTaskRequest) (*TaskView, error) {
	name, err := sanitizeName(name)
	if err != nil {
		return nil, ErrNotFound
	}
	dir := filepath.Join(s.root, name)
	details, err := readJSON[TaskDetails](filepath.Join(dir, "taskdetails.json"))
	if err != nil {
		return nil, ErrNotFound
	}

	details.RequestorName = req.RequestorName
	details.CompletionURL = req.CompletionURL
	details.IsExperiment = req.IsExperiment

	if err := writeJSON(filepath.Join(dir, "taskdetails.json"), details); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "instructions.md"), []byte(req.Instructions), 0644); err != nil {
		return nil, err
	}

	// Clean stale files before rewriting model.
	removeUmpFiles(dir)
	if len(req.Tabs) > 0 {
		os.Remove(filepath.Join(dir, "model.ump"))
		if err := writeModelTabs(dir, req.Tabs); err != nil {
			return nil, err
		}
	} else {
		os.Remove(filepath.Join(dir, "tabs.json"))
		if err := os.WriteFile(filepath.Join(dir, "model.ump"), []byte(req.ModelCode), 0644); err != nil {
			return nil, err
		}
	}

	// Return the data we just wrote — no need to re-read from disk.
	tv := buildTaskView(details, req.Instructions, req.ModelCode, req.Tabs)
	return &tv, nil
}

// CreateResponse clones a task's model into a new response directory.
func (s *Store) CreateResponse(taskName string) (*ResponseView, error) {
	taskName, err := sanitizeName(taskName)
	if err != nil {
		return nil, ErrNotFound
	}
	taskDir := filepath.Join(s.root, taskName)
	modelCode, tabs, err := readModel(taskDir)
	if err != nil {
		return nil, ErrNotFound
	}

	respID := "resp" + randomID()
	respDir := s.responseDir(respID)
	if err := os.MkdirAll(respDir, 0755); err != nil {
		return nil, fmt.Errorf("create response dir: %w", err)
	}

	respDetails := ResponseDetails{
		TaskName:   taskName,
		ResponseID: respID,
	}
	if err := writeJSON(filepath.Join(respDir, "taskdetails.json"), respDetails); err != nil {
		return nil, err
	}
	if len(tabs) > 0 {
		if err := writeModelTabs(respDir, tabs); err != nil {
			return nil, err
		}
	} else {
		if err := os.WriteFile(filepath.Join(respDir, "model.ump"), []byte(modelCode), 0644); err != nil {
			return nil, err
		}
	}

	return buildResponseView(&respDetails, modelCode, tabs), nil
}

// GetResponse loads a response by ID.
func (s *Store) GetResponse(id string) (*ResponseView, error) {
	dir := s.responseDir(id)
	details, err := readJSON[ResponseDetails](filepath.Join(dir, "taskdetails.json"))
	if err != nil {
		return nil, ErrNotFound
	}
	modelCode, tabs, _ := readModel(dir)
	return buildResponseView(details, modelCode, tabs), nil
}

// SubmitResponse marks a response as submitted by setting submittedAt.
func (s *Store) SubmitResponse(id string) (*ResponseView, error) {
	dir := s.responseDir(id)
	details, err := readJSON[ResponseDetails](filepath.Join(dir, "taskdetails.json"))
	if err != nil {
		return nil, ErrNotFound
	}
	if details.SubmittedAt != "" {
		return nil, ErrAlreadySubmitted
	}

	details.SubmittedAt = time.Now().UTC().Format(time.RFC3339)
	if err := writeJSON(filepath.Join(dir, "taskdetails.json"), details); err != nil {
		return nil, err
	}

	modelCode, tabs, _ := readModel(dir)
	return buildResponseView(details, modelCode, tabs), nil
}

// ListResponses returns summaries of all responses for a task.
func (s *Store) ListResponses(taskName string) ([]ResponseSummary, error) {
	taskName, err := sanitizeName(taskName)
	if err != nil {
		return nil, ErrNotFound
	}
	// Verify the task exists.
	if _, err := readJSON[TaskDetails](filepath.Join(s.root, taskName, "taskdetails.json")); err != nil {
		return nil, ErrNotFound
	}

	respDir := s.responsesDir()
	entries, err := os.ReadDir(respDir)
	if err != nil {
		return []ResponseSummary{}, nil
	}

	results := make([]ResponseSummary, 0)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		rd, err := readJSON[ResponseDetails](filepath.Join(respDir, e.Name(), "taskdetails.json"))
		if err != nil || rd.TaskName != taskName {
			continue
		}
		results = append(results, ResponseSummary{
			ResponseID:  rd.ResponseID,
			SubmittedAt: rd.SubmittedAt,
		})
	}
	return results, nil
}

// --- view builders ---

func buildTaskView(d *TaskDetails, instructions, modelCode string, tabs []TabFile) TaskView {
	return TaskView{
		TaskName:      d.TaskName,
		RequestorName: d.RequestorName,
		CompletionURL: d.CompletionURL,
		IsExperiment:  d.IsExperiment,
		CreatedAt:     d.CreatedAt,
		Instructions:  instructions,
		ModelCode:     modelCode,
		Tabs:          tabs,
	}
}

// loadTaskView reads instructions + model from disk and builds a TaskView.
func loadTaskView(dir string, d *TaskDetails) TaskView {
	instructions, _ := os.ReadFile(filepath.Join(dir, "instructions.md"))
	modelCode, tabs, _ := readModel(dir)
	return buildTaskView(d, string(instructions), modelCode, tabs)
}

func buildResponseView(d *ResponseDetails, modelCode string, tabs []TabFile) *ResponseView {
	return &ResponseView{
		TaskName:    d.TaskName,
		ResponseID:  d.ResponseID,
		SubmittedAt: d.SubmittedAt,
		ModelCode:   modelCode,
		Tabs:        tabs,
	}
}

// --- path helpers ---

func (s *Store) responsesDir() string {
	return filepath.Join(s.root, "responses")
}

func (s *Store) responseDir(id string) string {
	return filepath.Join(s.root, "responses", sanitizeResponseID(id))
}

// --- file I/O ---

func readJSON[T any](path string) (*T, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func readModel(dir string) (string, []TabFile, error) {
	tabsPath := filepath.Join(dir, "tabs.json")
	if raw, err := os.ReadFile(tabsPath); err == nil {
		var td tabsFileData
		if err := json.Unmarshal(raw, &td); err == nil && len(td.Tabs) > 0 {
			tabs := make([]TabFile, 0, len(td.Tabs))
			for _, tm := range td.Tabs {
				code, err := os.ReadFile(filepath.Join(dir, tm.Name))
				if err != nil {
					continue
				}
				tabs = append(tabs, TabFile{Name: tm.Name, Code: string(code)})
			}
			return "", tabs, nil
		}
	}

	data, err := os.ReadFile(filepath.Join(dir, "model.ump"))
	if err != nil {
		return "", nil, err
	}
	return string(data), nil, nil
}

func writeJSON(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal json: %w", err)
	}
	return os.WriteFile(path, b, 0644)
}

// tabsFileData / tabsFileMeta mirror the tabs.json on-disk format.
type tabsFileMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type tabsFileData struct {
	ActiveTabID string         `json:"activeTabId"`
	Tabs        []tabsFileMeta `json:"tabs"`
}

func writeModelTabs(dir string, tabs []TabFile) error {
	meta := tabsFileData{Tabs: make([]tabsFileMeta, len(tabs))}
	for i, t := range tabs {
		id := fmt.Sprintf("tab-%d", i)
		meta.Tabs[i] = tabsFileMeta{ID: id, Name: t.Name}
		if i == 0 {
			meta.ActiveTabID = id
		}
	}
	if err := writeJSON(filepath.Join(dir, "tabs.json"), meta); err != nil {
		return err
	}
	for _, t := range tabs {
		if err := os.WriteFile(filepath.Join(dir, t.Name), []byte(t.Code), 0644); err != nil {
			return fmt.Errorf("write tab %s: %w", t.Name, err)
		}
	}
	return nil
}

func removeUmpFiles(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".ump") {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

func randomID() string {
	const chars = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, 10)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

func sanitizeResponseID(id string) string {
	id = filepath.Base(id)
	id = strings.ReplaceAll(id, "..", "")
	return id
}
