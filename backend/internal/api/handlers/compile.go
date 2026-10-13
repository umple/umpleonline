package handlers

// HTTP handler for POST /api/generate.
// It compiles the open model and returns generated source. The filename is historical; this is the generate route.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/umple/umpleonline/backend/internal/api/handlers/generate"
	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/config"
	"github.com/umple/umpleonline/backend/internal/model"
)

type GenerateHandler struct {
	pool    *compiler.Pool
	store   *model.Store
	service *generate.Service
}

func NewGenerateHandler(pool *compiler.Pool, store *model.Store, cfg *config.Config) *GenerateHandler {
	return &GenerateHandler{
		pool:    pool,
		store:   store,
		service: generate.NewService(cfg.UmpleSyncJar),
	}
}

type GenerateRequest struct {
	Code             string   `json:"code"`
	ModelID          string   `json:"modelId,omitempty"`
	Language         string   `json:"language,omitempty"`
	DiagramType      string   `json:"diagramType,omitempty"`
	Suboptions       []string `json:"suboptions,omitempty"`
	ClassFilterQuery string   `json:"classFilterQuery,omitempty"`
	NamedFilters     []string `json:"namedFilters,omitempty"`
	Mixsets          []string `json:"mixsets,omitempty"`
	NeedsLayout      *bool    `json:"needsLayout,omitempty"`
	Tabs             []apiTab `json:"tabs,omitempty"`
	ActiveTabID      string   `json:"activeTabId,omitempty"`
}

type GenerateResponse struct {
	Result             string                       `json:"result"`
	Errors             string                       `json:"errors,omitempty"`
	ModelID            string                       `json:"modelId"`
	SVG                string                       `json:"svg,omitempty"`
	HTML               string                       `json:"html,omitempty"`
	Layout             *GvLayout                    `json:"layout,omitempty"`
	StoredLayout       *StoredLayoutMetadata        `json:"storedLayout,omitempty"`
	GeneratedOutput    string                       `json:"generatedOutput,omitempty"`
	GeneratedLanguage  string                       `json:"generatedLanguage,omitempty"`
	GeneratedKind      string                       `json:"generatedKind,omitempty"`
	GeneratedHTML      string                       `json:"generatedHtml,omitempty"`
	GeneratedIframeURL string                       `json:"generatedIframeUrl,omitempty"`
	GeneratedDownloads []generate.GeneratedArtifact `json:"generatedDownloads,omitempty"`
	GeneratedFiles     []generate.GeneratedFile     `json:"generatedFiles,omitempty"`
}

func (h *GenerateHandler) Generate(w http.ResponseWriter, r *http.Request) {
	var req GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}
	if req.Language != "" {
		baseLanguage, _ := generate.ParseLanguageSpec(req.Language)
		if !generate.IsValidLanguage(baseLanguage) {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported language: %s", baseLanguage))
			return
		}
	}

	// Determine the compiler entry point: the active tab's file, or the
	// default for single-tab mode.
	entryFile := model.DefaultEntryFile
	entryCode := req.Code
	if len(req.Tabs) > 0 {
		seen := make(map[string]bool, len(req.Tabs))
		for _, t := range req.Tabs {
			safe, err := model.SafeTabName(t.Name)
			if err != nil {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid tab name: %s", t.Name))
				return
			}
			if seen[safe] {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("duplicate tab name: %s", safe))
				return
			}
			seen[safe] = true
			if t.ID == req.ActiveTabID {
				entryFile = safe
				entryCode = t.Code
			}
		}
	}

	unlock := lockModelWorkspace(h.pool, h.store, req.ModelID)
	defer unlock()
	workspaceLocked := req.ModelID != ""

	// Ensure model directory exists (single resolveModel for both compile + diagram)
	modelID, dir, err := resolveModel(h.store, req.ModelID, entryCode, entryFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to resolve model: %v", err))
		return
	}

	// Persist tab metadata and write each tab as a separate .ump file so
	// cross-tab `use` statements resolve correctly.
	if len(req.Tabs) > 0 {
		meta := make([]model.TabMeta, len(req.Tabs))
		files := make(map[string]string, len(req.Tabs))
		for i, t := range req.Tabs {
			safe := model.EnsureUmpExt(t.Name) // already validated above
			meta[i] = model.TabMeta{ID: t.ID, Name: safe}
			files[safe] = t.Code
		}
		if err := h.store.SaveTabs(modelID, &model.TabsData{
			ActiveTabID: req.ActiveTabID,
			Tabs:        meta,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to save tabs: %v", err))
			return
		}
		if err := h.store.SaveTabFiles(modelID, files, entryFile); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to write tab files: %v", err))
			return
		}
	}

	// Generate the authoritative JSON model using umplesync
	command := fmt.Sprintf("-generate Json %s/%s", dir, entryFile)
	execute := h.pool.Execute
	if workspaceLocked {
		execute = h.pool.ExecuteLocked
	}
	result, err := execute(compiler.CompileRequest{
		Command: command,
		WorkDir: dir,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("generation failed: %v", err))
		return
	}

	// Try to read generated JSON output
	jsonOutput := result.Output
	jsonPath := filepath.Join(dir, "model.json")
	if data, err := os.ReadFile(jsonPath); err == nil {
		jsonOutput = string(data)
	}

	resp := GenerateResponse{
		Result:  jsonOutput,
		Errors:  result.Errors,
		ModelID: modelID,
	}

	// If a diagramType was provided, generate the diagram in the same request
	if req.DiagramType != "" {
		needsLayout := req.NeedsLayout == nil || *req.NeedsLayout

		diagResp, errMsg := processDiagram(processDiagramParams{
			pool:             h.pool,
			dir:              dir,
			modelID:          modelID,
			diagramType:      req.DiagramType,
			suboptions:       req.Suboptions,
			classFilterQuery: req.ClassFilterQuery,
			namedFilters:     req.NamedFilters,
			mixsets:          req.Mixsets,
			needsLayout:      needsLayout,
			entryFile:        entryFile,
			locked:           workspaceLocked,
		})
		if errMsg != "" {
			log.Printf("diagram generation failed during output generation: %s", errMsg)
			// Don't fail the whole request — return generated result with diagram error appended
			if resp.Errors != "" {
				resp.Errors += "\n" + errMsg
			} else {
				resp.Errors = errMsg
			}
		} else {
			resp.SVG = diagResp.SVG
			resp.HTML = diagResp.HTML
			resp.Layout = diagResp.Layout
			resp.StoredLayout = diagResp.StoredLayout
			// Merge diagram errors if any
			if diagResp.Errors != "" {
				if resp.Errors != "" {
					resp.Errors += "\n" + diagResp.Errors
				} else {
					resp.Errors = diagResp.Errors
				}
			}
		}
	}

	if req.Language != "" {
		baseLanguage, suboptions := generate.ParseLanguageSpec(req.Language)
		genResp, err := h.service.Generate(baseLanguage, dir, modelID, entryFile, suboptions)
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("generation failed: %v", err))
			return
		}

		resp.GeneratedOutput = genResp.Output
		resp.GeneratedLanguage = genResp.Language
		resp.GeneratedKind = genResp.Kind
		resp.GeneratedHTML = genResp.HTML
		resp.GeneratedIframeURL = genResp.IframeURL
		resp.GeneratedDownloads = genResp.Downloads
		resp.GeneratedFiles = genResp.Files

		if genResp.Errors != "" {
			if resp.Errors != "" {
				resp.Errors += "\n" + genResp.Errors
			} else {
				resp.Errors = genResp.Errors
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
