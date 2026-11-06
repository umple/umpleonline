package handlers

// POST /api/sync turns a class-diagram edit into umplesync commands and writes the model back.
// The canvas calls this for add, remove, rename, move, and association changes. It also
// clears references umplesync would otherwise leave behind.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/model"
)

type SyncHandler struct {
	pool  *compiler.Pool
	store *model.Store

	modelMu sync.Map
}

func NewSyncHandler(pool *compiler.Pool, store *model.Store) *SyncHandler {
	return &SyncHandler{pool: pool, store: store}
}

type SyncRequest struct {
	Action  string            `json:"action"`
	ModelID string            `json:"modelId,omitempty"`
	Params  map[string]string `json:"params"`
}

type SyncResponse struct {
	Code     string `json:"code"`
	Result   string `json:"result"`
	Errors   string `json:"errors,omitempty"`
	ModelID  string `json:"modelId"`
	Rejected bool   `json:"rejected,omitempty"`
	NoEffect bool   `json:"noEffect,omitempty"`
}

// Default dimensions for newly created classes (in pixels).
const (
	defaultClassWidth  = "109"
	defaultClassHeight = "41"
)

// Default multiplicity and navigability for new associations.
const (
	defaultMultiplicity = "*"
	defaultAssocPrefix  = "umpleAssociation_"
)

// validSyncActions lists the actions currently used by the frontend.
// The adapter below translates them into the raw legacy umplesync commands.
var validSyncActions = map[string]bool{
	"addClass":             true,
	"editClass":            true,
	"editPosition":         true,
	"addAssociation":       true,
	"removeAssociation":    true,
	"editAssociation":      true,
	"addGeneralization":    true,
	"removeGeneralization": true,
	"addAttribute":         true,
	"removeAttribute":      true,
	"addMethod":            true,
	"removeMethod":         true,
	"addInterface":         true,
	"removeClass":          true,
}

type syncPosition struct {
	X      any `json:"x"`
	Y      any `json:"y"`
	Width  any `json:"width"`
	Height any `json:"height"`
}

type syncAttribute struct {
	Type       string `json:"type"`
	Name       string `json:"name"`
	Modifier   string `json:"modifier,omitempty"`
	TraceColor string `json:"traceColor,omitempty"`
	NewType    string `json:"newType,omitempty"`
	NewName    string `json:"newName,omitempty"`
	DeleteType string `json:"deleteType,omitempty"`
	DeleteName string `json:"deleteName,omitempty"`
	OldType    string `json:"oldType,omitempty"`
	OldName    string `json:"oldName,omitempty"`
}

type syncMethod struct {
	Visibility       string `json:"visibility,omitempty"`
	IsAbstract       string `json:"isAbstract,omitempty"`
	Type             string `json:"type"`
	Name             string `json:"name"`
	Parameters       any    `json:"parameters,omitempty"`
	NewVisibility    string `json:"newVisibility,omitempty"`
	NewType          string `json:"newType,omitempty"`
	NewName          string `json:"newName,omitempty"`
	NewParameters    any    `json:"newParameters,omitempty"`
	DeleteVisibility string `json:"deleteVisibility,omitempty"`
	DeleteType       string `json:"deleteType,omitempty"`
	DeleteName       string `json:"deleteName,omitempty"`
	DeleteParameters any    `json:"deleteParameters,omitempty"`
	OldVisibility    string `json:"oldVisibility,omitempty"`
	OldType          string `json:"oldType,omitempty"`
	OldName          string `json:"oldName,omitempty"`
	OldParameters    any    `json:"oldParameters,omitempty"`
}

type syncClass struct {
	Position     syncPosition    `json:"position"`
	Attributes   []syncAttribute `json:"attributes"`
	Methods      []syncMethod    `json:"methods"`
	Interfaces   []string        `json:"interfaces,omitempty"`
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	OldName      string          `json:"oldname,omitempty"`
	ExtendsClass string          `json:"extendsClass,omitempty"`
	IsInterface  string          `json:"isInterface"`
	IsAbstract   string          `json:"isAbstract"`
	DisplayColor string          `json:"displayColor"`
}

type syncAssociation struct {
	ClassOnePosition     syncPosition `json:"classOnePosition,omitempty"`
	ClassTwoPosition     syncPosition `json:"classTwoPosition,omitempty"`
	OffsetOnePosition    syncPosition `json:"offsetOnePosition,omitempty"`
	OffsetTwoPosition    syncPosition `json:"offsetTwoPosition,omitempty"`
	ID                   string       `json:"id,omitempty"`
	ClassOneID           string       `json:"classOneId,omitempty"`
	ClassTwoID           string       `json:"classTwoId,omitempty"`
	Name                 string       `json:"name,omitempty"`
	MultiplicityOne      string       `json:"multiplicityOne,omitempty"`
	MultiplicityTwo      string       `json:"multiplicityTwo,omitempty"`
	RoleOne              string       `json:"roleOne,omitempty"`
	RoleTwo              string       `json:"roleTwo,omitempty"`
	IsLeftNavigable      string       `json:"isLeftNavigable,omitempty"`
	IsRightNavigable     string       `json:"isRightNavigable,omitempty"`
	IsLeftComposition    string       `json:"isLeftComposition,omitempty"`
	IsRightComposition   string       `json:"isRightComposition,omitempty"`
	IsSymmetricReflexive string       `json:"isSymmetricReflexive,omitempty"`
	Color                string       `json:"color,omitempty"`
	IsTraced             string       `json:"isTraced,omitempty"`
}

type syncModel struct {
	UmpleClasses      []syncClass       `json:"umpleClasses"`
	UmpleAssociations []syncAssociation `json:"umpleAssociations"`
}

func (h *SyncHandler) Sync(w http.ResponseWriter, r *http.Request) {
	var req SyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Action == "" {
		writeError(w, http.StatusBadRequest, "action is required")
		return
	}
	if !validSyncActions[req.Action] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported action: %s", req.Action))
		return
	}

	modelID := req.ModelID
	if modelID == "" {
		m, err := h.store.Create("")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create model")
			return
		}
		modelID = m.ID
	}

	dir := h.store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create model dir")
		return
	}
	modelMu := h.getModelMutex(dir)
	modelMu.Lock()
	defer modelMu.Unlock()

	umpFile := filepath.Join(dir, h.store.ResolveEntryFile(modelID))
	if err := ensureDelimitedModelFile(umpFile); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to prepare model")
		return
	}

	// Snapshot the file before mutating so we can roll back if the
	// resulting model fails compilation (the "compilation gate").
	// Position-only edits are exempt — they can never break the model.
	var snapshot []byte
	var snapshotCode string
	needsGate := req.Action != "editPosition"
	if needsGate {
		var readErr error
		snapshot, readErr = os.ReadFile(umpFile)
		if readErr != nil {
			log.Printf("sync: snapshot read failed, skipping gate: %v", readErr)
			needsGate = false
		} else {
			snapshotCode = stripModelDelimiter(string(snapshot))
		}
	}

	// umplesync.jar does not cascade-delete associations or
	// generalizations when removing a class, so we must do it ourselves
	// before issuing the removeClass command (matching the old frontend).
	if req.Action == "removeClass" {
		if err := h.cascadeBeforeRemoveClass(req.Params["className"], umpFile, dir); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	command, err := h.buildLegacySyncCommand(req, umpFile, dir)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.pool.Execute(compiler.CompileRequest{
		Command: command,
		WorkDir: dir,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("sync failed: %v", err))
		return
	}
	if isFatalSyncOutput(result.Output) {
		// Restore snapshot on fatal error so the file stays valid.
		if needsGate && snapshot != nil {
			if wErr := os.WriteFile(umpFile, snapshot, 0o644); wErr != nil {
				log.Printf("sync: failed to restore snapshot after fatal error: %v", wErr)
			}
		}
		writeError(w, http.StatusBadRequest, strings.TrimSpace(result.Output))
		return
	}

	// umplesync returns the full updated model on stdout (including the
	// delimiter and position metadata). Write it to disk so the file
	// stays in sync, then strip the delimiter for the frontend.
	fullOutput := result.Output

	// umplesync does not cascade-rename references when a class is
	// renamed, so we fix them up in the returned source.
	if req.Action == "editClass" {
		if newName := req.Params["newName"]; newName != "" && newName != req.Params["className"] {
			fullOutput = renameClassReferences(fullOutput, req.Params["className"], newName)
		}
	}

	if strings.TrimSpace(fullOutput) != "" {
		if err := os.WriteFile(umpFile, []byte(fullOutput), 0o644); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to persist synced model")
			return
		}
	} else if data, err := os.ReadFile(umpFile); err == nil {
		fullOutput = string(data)
	}
	code := stripModelDelimiter(fullOutput)

	// Compilation gate: verify that the mutated model still compiles
	// into valid JSON.  If it doesn't, roll back to the snapshot and
	// return the edit as rejected so the frontend does NOT update the
	// code editor.
	jsonModel, err := h.generateModelJSON(umpFile, dir)
	if err != nil && needsGate && snapshot != nil {
		// Restore the pre-sync file so backend stays consistent.
		if wErr := os.WriteFile(umpFile, snapshot, 0o644); wErr != nil {
			log.Printf("sync: failed to restore snapshot after rejected edit: %v", wErr)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(SyncResponse{
			Code:     snapshotCode,
			Result:   "{}",
			Errors:   err.Error(),
			ModelID:  modelID,
			Rejected: true,
		})
		return
	}
	if err != nil {
		jsonModel = []byte("{}")
	}

	// Detect no-op: if a structural edit didn't change the code, flag it
	// so the frontend can inform the user.
	noEffect := needsGate && snapshot != nil && snapshotCode == code

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(SyncResponse{
		Code:     code,
		Result:   string(jsonModel),
		Errors:   result.Errors,
		ModelID:  modelID,
		NoEffect: noEffect,
	})
}

func (h *SyncHandler) getModelMutex(modelDir string) *sync.Mutex {
	val, _ := h.modelMu.LoadOrStore(modelDir, &sync.Mutex{})
	return val.(*sync.Mutex)
}

func ensureDelimitedModelFile(umpFile string) error {
	data, err := os.ReadFile(umpFile)
	if err != nil {
		if os.IsNotExist(err) {
			return os.WriteFile(umpFile, []byte(modelDelimiter), 0o644)
		}
		return err
	}

	content := string(data)
	if strings.Contains(content, modelDelimiter) {
		return nil
	}

	content = strings.TrimRight(content, "\n")
	if content == "" {
		content = modelDelimiter
	} else {
		content += "\n" + modelDelimiter + "\n"
	}
	return os.WriteFile(umpFile, []byte(content), 0o644)
}

// cascadeBeforeRemoveClass strips every reference to className from the
// model text before umplesync's -removeClass runs.
//
// umplesync only removes the class definition itself; it does NOT clean up
// references in other classes (inline associations, isA, standalone
// association blocks).  Without this pre-processing the model ends up with
// dangling references that break subsequent JSON generation.
func (h *SyncHandler) cascadeBeforeRemoveClass(className string, umpFile string, dir string) error {
	data, err := os.ReadFile(umpFile)
	if err != nil {
		return err
	}
	cleaned := removeClassReferences(string(data), className)
	if cleaned != string(data) {
		if err := os.WriteFile(umpFile, []byte(cleaned), 0o644); err != nil {
			return fmt.Errorf("failed to clean up references: %v", err)
		}
	}
	return nil
}

// removeClassReferences removes every mention of className from an Umple
// source file: standalone association blocks, inline association lines,
// isA generalization lines, and associationClass blocks.
func removeClassReferences(content string, className string) string {
	q := regexp.QuoteMeta(className)

	patterns := []string{
		// 1. Standalone association blocks: association [name] { … className … }
		`(?m)^\s*association\s*(?:\w+\s*)?\{[^}]*\b` + q + `\b[^}]*\}[ \t]*\n?`,

		// 2. Inline association lines containing an operator (-- -> <@>)
		//    and the class name, in either order.
		`(?m)^[^\n]*(?:--|->|<@>)[^\n]*\b` + q + `\b[^\n]*;[ \t]*\n?`,
		`(?m)^[^\n]*\b` + q + `\b[^\n]*(?:--|->|<@>)[^\n]*;[ \t]*\n?`,

		// 3a. isA lines where isA starts the line (multi-line class format).
		`(?m)^\s*isA\b[^\n]*\b` + q + `\b[^\n]*;[ \t]*\n?`,

		// 3b. Inline isA clause within a single-line class definition
		//     (e.g. "class Foo { isA Bar; }").  Removes only the clause,
		//     not the entire line, so the class and its other members survive.
		`[ \t]*isA\s+` + q + `\b\s*;`,
	}

	for _, p := range patterns {
		if re, err := regexp.Compile(p); err == nil {
			content = re.ReplaceAllString(content, "")
		}
	}

	// 4. associationClass blocks that reference className as an endpoint.
	//    These may contain nested braces (e.g. enum values like
	//    CRUD_Value { R, RW }), so we match one level of brace nesting and
	//    use a functional replacement to check the body for the class name.
	acBlockRe := regexp.MustCompile(`(?ms)^\s*associationClass\s+\w+\s*\{(?:[^{}]*|\{[^{}]*\})*\}[ \t]*\n?`)
	classRe := regexp.MustCompile(`\b` + q + `\b`)
	content = acBlockRe.ReplaceAllStringFunc(content, func(match string) string {
		if classRe.MatchString(match) {
			return ""
		}
		return match
	})

	return content
}

// renameClassReferences replaces every occurrence of oldName with newName
// in the user-code section of an Umple source file.  The position/layout
// section (after the model delimiter) is left untouched — umplesync handles
// position identifiers itself.
//
// This is the rename counterpart of removeClassReferences: umplesync's
// -editClass renames the class definition but does NOT update references
// in other classes (associations, isA, associationClass endpoints, typed
// attributes, etc.).
func renameClassReferences(content string, oldName, newName string) string {
	userCode := content
	posSection := ""
	if idx := strings.Index(content, modelDelimiter); idx >= 0 {
		userCode = content[:idx]
		posSection = content[idx:]
	}

	q := regexp.QuoteMeta(oldName)
	re := regexp.MustCompile(`\b` + q + `\b`)
	userCode = re.ReplaceAllString(userCode, newName)

	return userCode + posSection
}

func (h *SyncHandler) buildLegacySyncCommand(req SyncRequest, umpFile string, dir string) (string, error) {
	switch req.Action {
	case "addClass":
		payload, err := json.Marshal(syncClass{
			Position: syncPosition{
				X:      req.Params["x"],
				Y:      req.Params["y"],
				Width:  defaultClassWidth,
				Height: defaultClassHeight,
			},
			Attributes:   []syncAttribute{},
			Methods:      []syncMethod{},
			Interfaces:   []string{},
			ID:           req.Params["className"],
			Name:         req.Params["className"],
			IsInterface:  "false",
			IsAbstract:   "false",
			DisplayColor: "transparent",
		})
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("addClass", payload, umpFile), nil
	case "addAssociation":
		offsetOneX := req.Params["offsetOneX"]
		if offsetOneX == "" {
			offsetOneX = "0"
		}
		offsetOneY := req.Params["offsetOneY"]
		if offsetOneY == "" {
			offsetOneY = "0"
		}
		offsetTwoX := req.Params["offsetTwoX"]
		if offsetTwoX == "" {
			offsetTwoX = "0"
		}
		offsetTwoY := req.Params["offsetTwoY"]
		if offsetTwoY == "" {
			offsetTwoY = "0"
		}
		assoc := syncAssociation{
			ClassOnePosition: syncPosition{},
			ClassTwoPosition: syncPosition{},
			OffsetOnePosition: syncPosition{
				X:      offsetOneX,
				Y:      offsetOneY,
				Width:  "0",
				Height: "0",
			},
			OffsetTwoPosition: syncPosition{
				X:      offsetTwoX,
				Y:      offsetTwoY,
				Width:  "0",
				Height: "0",
			},
			ID:                   defaultAssocPrefix + "0",
			ClassOneID:           req.Params["classOneId"],
			ClassTwoID:           req.Params["classTwoId"],
			Name:                 req.Params["classOneId"] + "__" + req.Params["classTwoId"],
			MultiplicityOne:      defaultMultiplicity,
			MultiplicityTwo:      defaultMultiplicity,
			RoleOne:              "",
			RoleTwo:              "",
			IsLeftNavigable:      "true",
			IsRightNavigable:     "true",
			IsLeftComposition:    "false",
			IsRightComposition:   "false",
			IsSymmetricReflexive: "false",
			Color:                "black",
		}

		model, err := h.loadCurrentModel(umpFile, dir)
		if err == nil {
			if cls := findClass(model.UmpleClasses, assoc.ClassOneID); cls != nil {
				assoc.ClassOnePosition = cls.Position
			}
			if cls := findClass(model.UmpleClasses, assoc.ClassTwoID); cls != nil {
				assoc.ClassTwoPosition = cls.Position
			}
			assoc.ID = fmt.Sprintf("%s%d", defaultAssocPrefix, len(model.UmpleAssociations))
		}

		payload, err := json.Marshal(assoc)
		if err != nil {
			return "", fmt.Errorf("failed to encode association payload")
		}
		return rawSyncCommand("addAssociation", payload, umpFile), nil
	case "addGeneralization":
		model, err := h.loadCurrentModel(umpFile, dir)
		if err != nil {
			return "", err
		}
		child := findClass(model.UmpleClasses, req.Params["childClass"])
		parent := findClass(model.UmpleClasses, req.Params["parentClass"])
		if child == nil || parent == nil {
			return "", fmt.Errorf("class not found for generalization")
		}

		payload, err := json.Marshal(map[string]any{
			"childId":        child.Name,
			"parentId":       parent.Name,
			"childPosition":  child.Position,
			"parentPosition": parent.Position,
		})
		if err != nil {
			return "", fmt.Errorf("failed to encode generalization payload")
		}
		return rawSyncCommand("addGeneralization", payload, umpFile), nil
	}

	model, err := h.loadCurrentModel(umpFile, dir)
	if err != nil {
		return "", err
	}

	switch req.Action {
	case "editClass":
		className := req.Params["className"]
		newName := req.Params["newName"]
		cls := findClass(model.UmpleClasses, className)
		if cls == nil {
			return "", fmt.Errorf("class not found: %s", className)
		}

		cls.OldName = cls.Name
		cls.Name = newName
		cls.ID = newName
		cls.Position.Width = defaultClassWidth

		// Note: reference updates (associations, ExtendsClass) are handled
		// by renameClassReferences in the post-processing step after
		// umplesync returns.

		payload, err := json.Marshal(cls)
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("editClass", payload, umpFile), nil
	case "editPosition":
		cls := findClass(model.UmpleClasses, req.Params["className"])
		if cls == nil {
			return "", fmt.Errorf("class not found: %s", req.Params["className"])
		}
		cls.Position.X = req.Params["x"]
		cls.Position.Y = req.Params["y"]

		payload, err := json.Marshal(cls)
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("editClass", payload, umpFile), nil
	case "addAttribute":
		cls := findClass(model.UmpleClasses, req.Params["className"])
		if cls == nil {
			return "", fmt.Errorf("class not found: %s", req.Params["className"])
		}

		attrType := req.Params["attributeType"]
		if attrType == "" {
			attrType = "String"
		}
		cls.Attributes = append(cls.Attributes, syncAttribute{
			Type:       attrType,
			Name:       req.Params["attributeName"],
			Modifier:   "",
			TraceColor: "black",
			NewType:    attrType,
			NewName:    req.Params["attributeName"],
		})

		payload, err := json.Marshal(cls)
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("editClass", payload, umpFile), nil
	case "removeAttribute":
		cls := findClass(model.UmpleClasses, req.Params["className"])
		if cls == nil {
			return "", fmt.Errorf("class not found: %s", req.Params["className"])
		}

		// umplesync's EditAction expects a minimal attribute object with
		// only "deleteName" to signal deletion.
		cls.Attributes = []syncAttribute{{
			DeleteName: req.Params["attributeName"],
		}}

		payload, err := json.Marshal(cls)
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("editClass", payload, umpFile), nil
	case "addMethod":
		cls := findClass(model.UmpleClasses, req.Params["className"])
		if cls == nil {
			return "", fmt.Errorf("class not found: %s", req.Params["className"])
		}
		if isAssociationClassDefinition(umpFile, cls.Name) {
			return "", fmt.Errorf("methods cannot be added to association classes from the diagram")
		}

		methodType := req.Params["methodType"]
		if methodType == "" {
			methodType = "void"
		}
		parameters := parseMethodParameters(req.Params["methodParameters"])
		cls.Methods = append(cls.Methods, syncMethod{
			Visibility:    "public",
			IsAbstract:    "",
			Type:          methodType,
			Name:          req.Params["methodName"],
			Parameters:    parameters,
			NewVisibility: "public",
			NewType:       methodType,
			NewName:       req.Params["methodName"],
			NewParameters: parameters,
		})

		payload, err := json.Marshal(cls)
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("editClass", payload, umpFile), nil
	case "removeMethod":
		cls := findClass(model.UmpleClasses, req.Params["className"])
		if cls == nil {
			return "", fmt.Errorf("class not found: %s", req.Params["className"])
		}

		// umplesync's EditAction expects a minimal method object with
		// only "deleteName" to signal deletion.
		cls.Methods = []syncMethod{{
			DeleteName: req.Params["methodName"],
		}}

		payload, err := json.Marshal(cls)
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("editClass", payload, umpFile), nil
	case "removeClass":
		cls := findClass(model.UmpleClasses, req.Params["className"])
		if cls == nil {
			return "", fmt.Errorf("class not found: %s", req.Params["className"])
		}

		payload, err := json.Marshal(cls)
		if err != nil {
			return "", fmt.Errorf("failed to encode class payload")
		}
		return rawSyncCommand("removeClass", payload, umpFile), nil
	case "removeAssociation", "editAssociation":
		assoc := findAssociation(model.UmpleAssociations, req.Params["classOneId"], req.Params["classTwoId"], req.Params["assocId"])
		if assoc == nil {
			return "", fmt.Errorf("association not found")
		}

		payload, err := json.Marshal(assoc)
		if err != nil {
			return "", fmt.Errorf("failed to encode association payload")
		}
		return rawSyncCommand(req.Action, payload, umpFile), nil
	case "removeGeneralization":
		payload, err := json.Marshal(map[string]any{
			"childId": req.Params["childClass"],
		})
		if err != nil {
			return "", fmt.Errorf("failed to encode generalization payload")
		}
		return rawSyncCommand("removeGeneralization", payload, umpFile), nil
	case "addInterface":
		return "", fmt.Errorf("addInterface not implemented")
	default:
		return "", fmt.Errorf("unsupported action: %s", req.Action)
	}
}

func (h *SyncHandler) loadCurrentModel(umpFile string, dir string) (*syncModel, error) {
	data, err := h.generateModelJSON(umpFile, dir)
	if err != nil {
		return nil, err
	}

	var model syncModel
	if err := json.Unmarshal(data, &model); err != nil {
		return nil, fmt.Errorf("failed to parse current model JSON")
	}

	for i := range model.UmpleClasses {
		if model.UmpleClasses[i].DisplayColor == "" {
			model.UmpleClasses[i].DisplayColor = "transparent"
		}
		if model.UmpleClasses[i].Interfaces == nil {
			model.UmpleClasses[i].Interfaces = []string{}
		}
	}

	return &model, nil
}

func (h *SyncHandler) generateModelJSON(umpFile string, dir string) ([]byte, error) {
	result, err := h.pool.Execute(compiler.CompileRequest{
		Command: fmt.Sprintf("-generate Json %s", umpFile),
		WorkDir: dir,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load current model: %v", err)
	}

	// The compiler may report validation warnings (e.g. undefined class in
	// association) yet still produce valid JSON.  Try to read the generated
	// file or stdout before giving up — otherwise models with any warning
	// become completely uneditable from the diagram.
	data, readErr := os.ReadFile(filepath.Join(dir, "model.json"))
	if readErr == nil {
		return data, nil
	}
	if result.Output != "" {
		return []byte(result.Output), nil
	}
	if result.Errors != "" {
		return nil, fmt.Errorf("failed to load current model: %s", result.Errors)
	}
	return nil, fmt.Errorf("failed to load current model JSON")
}

func rawSyncCommand(action string, payload []byte, umpFile string) string {
	return fmt.Sprintf("-%s %s %s", action, strconv.Quote(string(payload)), umpFile)
}

func isFatalSyncOutput(output string) bool {
	return strings.Contains(output, "FATAL ERROR PARSING UMPLE DIAGRAM")
}

// stripModelDelimiter removes the umplesync end-of-model marker and any
// position metadata that follows it.  The on-disk entry file keeps both
// sections so umplesync can round-trip positions, but the editor should
// only ever see the user-authored Umple code.
func stripModelDelimiter(code string) string {
	if idx := strings.Index(code, modelDelimiter); idx >= 0 {
		code = code[:idx]
	}
	return strings.TrimRight(code, "\n") + "\n"
}

func parseMethodParameters(raw string) []map[string]string {
	parts := splitMethodParameters(raw)
	if len(parts) == 0 {
		return []map[string]string{{}}
	}

	params := make([]map[string]string, 0, len(parts))
	for _, part := range parts {
		paramType := extractMethodParameterType(part)
		if paramType != "" {
			params = append(params, encodeLegacyMethodParameter(paramType))
		}
	}

	if len(params) == 0 {
		return []map[string]string{{}}
	}

	return params
}

func splitMethodParameters(raw string) []string {
	var (
		parts []string
		start int
		angle int
		paren int
		brack int
		brace int
	)

	for i, r := range raw {
		switch r {
		case '<':
			angle++
		case '>':
			if angle > 0 {
				angle--
			}
		case '(':
			paren++
		case ')':
			if paren > 0 {
				paren--
			}
		case '[':
			brack++
		case ']':
			if brack > 0 {
				brack--
			}
		case '{':
			brace++
		case '}':
			if brace > 0 {
				brace--
			}
		case ',':
			if angle == 0 && paren == 0 && brack == 0 && brace == 0 {
				part := strings.TrimSpace(raw[start:i])
				if part != "" {
					parts = append(parts, part)
				}
				start = i + 1
			}
		}
	}

	last := strings.TrimSpace(raw[start:])
	if last != "" {
		parts = append(parts, last)
	}

	return parts
}

func extractMethodParameterType(raw string) string {
	param := strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
	if param == "" {
		return ""
	}

	lastSpace := -1
	angle := 0
	paren := 0
	brack := 0
	brace := 0
	for i, r := range param {
		switch r {
		case '<':
			angle++
		case '>':
			if angle > 0 {
				angle--
			}
		case '(':
			paren++
		case ')':
			if paren > 0 {
				paren--
			}
		case '[':
			brack++
		case ']':
			if brack > 0 {
				brack--
			}
		case '{':
			brace++
		case '}':
			if brace > 0 {
				brace--
			}
		default:
			if (r == ' ' || r == '\t') && angle == 0 && paren == 0 && brack == 0 && brace == 0 {
				lastSpace = i
			}
		}
	}

	if lastSpace == -1 {
		return param
	}

	paramType := strings.TrimSpace(param[:lastSpace])
	paramName := strings.TrimSpace(param[lastSpace+1:])
	if paramType == "" || paramName == "" || !methodParameterNamePattern.MatchString(paramName) {
		return param
	}

	return paramType
}

func encodeLegacyMethodParameter(paramType string) map[string]string {
	chars := make(map[string]string)
	index := 0
	for _, r := range paramType {
		chars[fmt.Sprintf("%03d", index)] = string(r)
		index++
	}
	return chars
}

var methodParameterNamePattern = regexp.MustCompile(`^[A-Za-z_]\w*$`)

func isAssociationClassDefinition(umpFile string, className string) bool {
	data, err := os.ReadFile(umpFile)
	if err != nil {
		return false
	}

	userCode := string(data)
	if idx := strings.Index(userCode, modelDelimiter); idx >= 0 {
		userCode = userCode[:idx]
	}

	pattern := `(?m)^\s*associationClass\s+` + regexp.QuoteMeta(className) + `\b`
	return regexp.MustCompile(pattern).MatchString(userCode)
}

func findClass(classes []syncClass, name string) *syncClass {
	for i := range classes {
		if classes[i].Name == name || classes[i].ID == name {
			return &classes[i]
		}
	}
	return nil
}

func findAssociation(associations []syncAssociation, classOneID string, classTwoID string, assocID string) *syncAssociation {
	// Prefer matching by unique association ID (disambiguates parallel associations)
	if assocID != "" {
		for i := range associations {
			if associations[i].ID == assocID {
				return &associations[i]
			}
		}
	}
	// Fallback: match by endpoint classes (first match)
	for i := range associations {
		a := &associations[i]
		if a.ClassOneID == classOneID && a.ClassTwoID == classTwoID {
			return a
		}
		if a.ClassOneID == classTwoID && a.ClassTwoID == classOneID {
			return a
		}
	}
	return nil
}
