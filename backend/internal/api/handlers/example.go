package handlers

import (
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/umple/umpleonline/backend/internal/config"
	"github.com/umple/umpleonline/backend/internal/model"
)

const exampleManifestFileName = "example_manifest.json"

const maxLibraryExampleBytes = 1 << 20

// Example names may address subdirectories of the Umple library, but nothing
// outside it. Classic UmpleOnline restricts the argument the same way.
var libraryExamplePattern = regexp.MustCompile(`^[A-Za-z0-9_.\-/]+$`)

type ExampleEntry struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Label    string `json:"label"`
	Filename string `json:"filename"`
}

type ExampleCategoryID string

const (
	ExampleCategoryClass     ExampleCategoryID = "class"
	ExampleCategoryState     ExampleCategoryID = "state"
	ExampleCategoryStructure ExampleCategoryID = "structure"
	ExampleCategoryFeature   ExampleCategoryID = "feature"
)

type ExampleSetID string

const (
	ExampleSet1 ExampleSetID = "example-set-1"
	ExampleSet2 ExampleSetID = "example-set-2"
	ExampleSet3 ExampleSetID = "example-set-3"
	ExampleSet4 ExampleSetID = "example-set-4"
	ExampleSet5 ExampleSetID = "example-set-5"
)

type ExampleSet struct {
	ID         ExampleSetID      `json:"id"`
	Label      string            `json:"label"`
	CategoryID ExampleCategoryID `json:"categoryId"`
	Examples   []ExampleEntry    `json:"examples"`
}

type ExampleResponse struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Label             string            `json:"label"`
	Code              string            `json:"code"`
	ModelID           string            `json:"modelId,omitempty"`
	SetID             ExampleSetID      `json:"setId,omitempty"`
	DefaultCategoryID ExampleCategoryID `json:"defaultCategoryId,omitempty"`
}

type ExampleHandler struct {
	examplePath string
	libraryURL  string
	client      *http.Client
	store       *model.Store
}

type exampleManifest struct {
	sets            []ExampleSet
	byID            map[string]exampleSpec
	byLegacyExample map[string]string
}

type exampleSpec struct {
	entry      ExampleEntry
	setID      ExampleSetID
	categoryID ExampleCategoryID
	sourcePath string
	library    bool
}

type exampleManifestFile struct {
	Sets []exampleManifestSet `json:"sets"`
}

type exampleManifestSet struct {
	ID         ExampleSetID           `json:"id"`
	Label      string                 `json:"label"`
	CategoryID ExampleCategoryID      `json:"categoryId"`
	Examples   []exampleManifestEntry `json:"examples"`
}

type exampleManifestEntry struct {
	Filename string `json:"filename"`
	Label    string `json:"label"`
}

type fetchError struct {
	status int
	err    error
}

func (e *fetchError) Error() string {
	return e.err.Error()
}

func (e *fetchError) Unwrap() error {
	return e.err
}

func NewExampleHandler(cfg *config.Config, store *model.Store) *ExampleHandler {
	return &ExampleHandler{
		examplePath: cfg.ExamplePath,
		libraryURL:  cfg.ExampleLibrary,
		client: &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		store: store,
	}
}

func (h *ExampleHandler) List(w http.ResponseWriter, r *http.Request) {
	manifest, err := h.loadManifest()
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to load bundled examples")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(manifest.sets)
}

func (h *ExampleHandler) Resolve(w http.ResponseWriter, r *http.Request) {
	legacyExample := normalizeLegacyExample(r.URL.Query().Get("example"))
	if legacyExample == "" {
		writeError(w, http.StatusBadRequest, "missing example")
		return
	}

	manifest, err := h.loadManifest()
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to load bundled examples")
		return
	}

	id, ok := manifest.byLegacyExample[legacyExample]
	if !ok {
		spec, valid := libraryExampleSpec(legacyExample)
		if !valid {
			writeError(w, http.StatusNotFound, "example not found")
			return
		}
		h.respondWithExample(w, spec)
		return
	}

	h.respondWithExample(w, manifest.byID[id])
}

func (h *ExampleHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		writeError(w, http.StatusNotFound, "example not found")
		return
	}

	manifest, err := h.loadManifest()
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to load bundled examples")
		return
	}

	spec, ok := manifest.byID[id]
	if !ok {
		writeError(w, http.StatusNotFound, "example not found")
		return
	}

	h.respondWithExample(w, spec)
}

func (h *ExampleHandler) respondWithExample(w http.ResponseWriter, spec exampleSpec) {
	raw, err := h.exampleCode(spec)
	if err != nil {
		var fetchErr *fetchError
		if errors.As(err, &fetchErr) && fetchErr.status == http.StatusNotFound {
			writeError(w, http.StatusNotFound, "example not found")
			return
		}
		writeError(w, http.StatusBadGateway, "failed to load example")
		return
	}

	userCode, _, hasDelimiter := splitModelSections(raw)
	resp := ExampleResponse{
		ID:                spec.entry.ID,
		Name:              spec.entry.Name,
		Label:             spec.entry.Label,
		Code:              userCode,
		SetID:             spec.setID,
		DefaultCategoryID: spec.categoryID,
	}

	// Preserve stored Graphviz layout for examples that carry a hidden layout
	// section by pre-creating a temp model before the first compile.
	if hasDelimiter {
		m, createErr := h.store.Create(raw)
		if createErr == nil {
			resp.ModelID = m.ID
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *ExampleHandler) loadManifest() (*exampleManifest, error) {
	return h.buildManifest()
}

func (h *ExampleHandler) buildManifest() (*exampleManifest, error) {
	raw, err := os.ReadFile(filepath.Join(h.examplePath, exampleManifestFileName))
	if err != nil {
		return nil, fmt.Errorf("read example manifest: %w", err)
	}

	var file exampleManifestFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, fmt.Errorf("decode example manifest: %w", err)
	}

	manifest := &exampleManifest{
		sets:            make([]ExampleSet, 0, len(file.Sets)),
		byID:            make(map[string]exampleSpec),
		byLegacyExample: make(map[string]string),
	}

	for _, setDef := range file.Sets {
		set := ExampleSet{
			ID:         setDef.ID,
			Label:      setDef.Label,
			CategoryID: setDef.CategoryID,
			Examples:   make([]ExampleEntry, 0, len(setDef.Examples)),
		}

		for _, item := range setDef.Examples {
			sourcePath := strings.TrimLeft(item.Filename, "/")
			name := strings.TrimSuffix(path.Base(sourcePath), ".ump")
			id := stableExampleID(setDef.ID, sourcePath)
			label := item.Label
			if label == "" {
				label = name
			}

			entry := ExampleEntry{
				ID:       id,
				Name:     name,
				Label:    label,
				Filename: sourcePath,
			}
			spec := exampleSpec{
				entry:      entry,
				setID:      setDef.ID,
				categoryID: setDef.CategoryID,
				sourcePath: sourcePath,
			}

			set.Examples = append(set.Examples, entry)
			manifest.byID[id] = spec

			legacyKey := normalizeLegacyExample(sourcePath)
			if _, exists := manifest.byLegacyExample[legacyKey]; !exists {
				manifest.byLegacyExample[legacyKey] = id
			}
		}

		manifest.sets = append(manifest.sets, set)
	}

	return manifest, nil
}

func (h *ExampleHandler) exampleCode(spec exampleSpec) (string, error) {
	if spec.library && h.libraryURL != "" {
		if code, err := h.libraryExampleCode(spec.sourcePath); err == nil {
			return code, nil
		}
	}

	data, err := os.ReadFile(filepath.Join(h.examplePath, filepath.FromSlash(spec.sourcePath)))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", &fetchError{status: http.StatusNotFound, err: err}
		}
		return "", err
	}
	return string(data), nil
}

func (h *ExampleHandler) libraryExampleCode(sourcePath string) (string, error) {
	resp, err := h.client.Get(strings.TrimRight(h.libraryURL, "/") + "/" + sourcePath)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxLibraryExampleBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxLibraryExampleBytes {
		return "", fmt.Errorf("example exceeds %d bytes", maxLibraryExampleBytes)
	}
	return string(data), nil
}

// libraryExampleSpec describes an example that the bundled manifest does not
// list, so that it can be loaded from the Umple library by path.
func libraryExampleSpec(legacyExample string) (exampleSpec, bool) {
	if !libraryExamplePattern.MatchString(legacyExample) ||
		path.Clean(legacyExample) != legacyExample ||
		path.IsAbs(legacyExample) ||
		strings.HasPrefix(legacyExample, "..") {
		return exampleSpec{}, false
	}

	sourcePath := legacyExample + ".ump"
	name := path.Base(legacyExample)
	return exampleSpec{
		entry: ExampleEntry{
			ID:       stableExampleID("", sourcePath),
			Name:     name,
			Label:    name,
			Filename: sourcePath,
		},
		sourcePath: sourcePath,
		library:    true,
	}, true
}

func stableExampleID(setID ExampleSetID, raw string) string {
	sum := sha1.Sum([]byte(string(setID) + "::" + raw))
	return fmt.Sprintf("ex-%x", sum[:8])
}

func normalizeLegacyExample(raw string) string {
	value := strings.TrimSpace(raw)
	value = strings.TrimPrefix(value, "/")
	return strings.TrimSuffix(value, ".ump")
}
