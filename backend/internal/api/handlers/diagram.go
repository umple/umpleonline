package handlers

// POST /api/diagram asks umplesync for a diagram and returns SVG plus Graphviz layout.
// The class canvas uses the layout to place nodes. Other views display the SVG or HTML as-is.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/model"
)

type DiagramHandler struct {
	pool  *compiler.Pool
	store *model.Store
}

func NewDiagramHandler(pool *compiler.Pool, store *model.Store) *DiagramHandler {
	return &DiagramHandler{pool: pool, store: store}
}

type DiagramRequest struct {
	Code             string   `json:"code"`
	DiagramType      string   `json:"diagramType"`
	ModelID          string   `json:"modelId,omitempty"`
	Suboptions       []string `json:"suboptions,omitempty"`
	ClassFilterQuery string   `json:"classFilterQuery,omitempty"`
	NamedFilters     []string `json:"namedFilters,omitempty"`
	Mixsets          []string `json:"mixsets,omitempty"`
	NeedsLayout      *bool    `json:"needsLayout,omitempty"`
	ActiveTabID      string   `json:"activeTabId,omitempty"`
}

type GvTextLine struct {
	Text string `json:"text"`
	Bold bool   `json:"bold,omitempty"`
}

type GvPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type GvNodeLayout struct {
	Name      string       `json:"name"`
	X         float64      `json:"x"`
	Y         float64      `json:"y"`
	Width     float64      `json:"width"`
	Height    float64      `json:"height"`
	Shape     string       `json:"shape,omitempty"`
	TextLines []GvTextLine `json:"textLines,omitempty"`
}

type GvEdgeLayout struct {
	Source       string    `json:"source"`
	Target       string    `json:"target"`
	Label        string    `json:"label,omitempty"`
	HeadLabel    string    `json:"headLabel,omitempty"`
	TailLabel    string    `json:"tailLabel,omitempty"`
	Points       []GvPoint `json:"points,omitempty"`
	LabelPos     *GvPoint  `json:"labelPos,omitempty"`
	HeadLabelPos *GvPoint  `json:"headLabelPos,omitempty"`
	TailLabelPos *GvPoint  `json:"tailLabelPos,omitempty"`
}

type GvLayout struct {
	BBoxWidth  float64        `json:"bboxWidth"`
	BBoxHeight float64        `json:"bboxHeight"`
	Nodes      []GvNodeLayout `json:"nodes"`
	Edges      []GvEdgeLayout `json:"edges,omitempty"`
}

type DiagramResponse struct {
	SVG          string                `json:"svg"`
	HTML         string                `json:"html,omitempty"`
	Layout       *GvLayout             `json:"layout,omitempty"`
	StoredLayout *StoredLayoutMetadata `json:"storedLayout,omitempty"`
	Errors       string                `json:"errors,omitempty"`
	ModelID      string                `json:"modelId"`
}

//go:embed assets/structureDiagram.js
var structureDiagramRuntime string

// Graphviz JSON output structures (subset we care about).
type gvJSON struct {
	BB      string     `json:"bb"`
	Objects []gvObject `json:"objects"`
	Edges   []gvEdge   `json:"edges"`
}

type gvObject struct {
	GvID    int        `json:"_gvid"`
	Name    string     `json:"name"`
	Pos     string     `json:"pos"`
	Width   string     `json:"width"`
	Height  string     `json:"height"`
	Shape   string     `json:"shape"`
	Label   string     `json:"label"`
	LDraw   []gvDrawOp `json:"_ldraw_"`
	Objects []gvObject `json:"objects"` // nested subgraph nodes
}

type gvEdge struct {
	Tail      int        `json:"tail"`
	Head      int        `json:"head"`
	Label     string     `json:"label"`
	HeadLabel string     `json:"headlabel"`
	TailLabel string     `json:"taillabel"`
	Pos       string     `json:"pos"`
	LP        string     `json:"lp"`
	HeadLP    string     `json:"head_lp"`
	TailLP    string     `json:"tail_lp"`
	Draw      []gvDrawOp `json:"_draw_"`
}

type gvDrawOp struct {
	Op     string      `json:"op"`
	Text   string      `json:"text,omitempty"`
	Face   string      `json:"face,omitempty"`
	Size   float64     `json:"size,omitempty"`
	Points [][]float64 `json:"points,omitempty"`
}

const ptToPx = 96.0 / 72.0

func parseGvLayout(jsonData []byte) *GvLayout {
	var gv gvJSON
	if err := json.Unmarshal(jsonData, &gv); err != nil {
		return nil
	}

	bbParts := strings.Split(gv.BB, ",")
	if len(bbParts) < 4 {
		return nil
	}
	bbHeight, _ := strconv.ParseFloat(bbParts[3], 64)
	bbWidth, _ := strconv.ParseFloat(bbParts[2], 64)

	layout := &GvLayout{
		BBoxWidth:  bbWidth * ptToPx,
		BBoxHeight: bbHeight * ptToPx,
	}

	// Build _gvid → name lookup for edge resolution
	idToName := map[int]string{}

	// Flatten objects recursively (subgraphs may nest nodes)
	var flatten func(objects []gvObject)
	flatten = func(objects []gvObject) {
		for _, obj := range objects {
			if obj.Pos != "" {
				idToName[obj.GvID] = obj.Name

				posParts := strings.Split(obj.Pos, ",")
				if len(posParts) >= 2 {
					gvX, _ := strconv.ParseFloat(posParts[0], 64)
					gvY, _ := strconv.ParseFloat(posParts[1], 64)
					w, _ := strconv.ParseFloat(obj.Width, 64)
					h, _ := strconv.ParseFloat(obj.Height, 64)

					layout.Nodes = append(layout.Nodes, GvNodeLayout{
						Name:      obj.Name,
						X:         gvX * ptToPx,
						Y:         (bbHeight - gvY) * ptToPx, // flip Y axis
						Width:     w * 72 * ptToPx,           // inches → points → pixels
						Height:    h * 72 * ptToPx,
						Shape:     obj.Shape,
						TextLines: extractTextLines(obj.LDraw),
					})
				}
			}
			if len(obj.Objects) > 0 {
				flatten(obj.Objects)
			}
		}
	}
	flatten(gv.Objects)

	// Extract edges
	for _, e := range gv.Edges {
		src, ok1 := idToName[e.Tail]
		tgt, ok2 := idToName[e.Head]
		if !ok1 || !ok2 {
			continue
		}
		layout.Edges = append(layout.Edges, GvEdgeLayout{
			Source:       src,
			Target:       tgt,
			Label:        e.Label,
			HeadLabel:    e.HeadLabel,
			TailLabel:    e.TailLabel,
			Points:       extractEdgePoints(e.Draw, bbHeight),
			LabelPos:     parseEdgePoint(e.LP, bbHeight),
			HeadLabelPos: parseEdgePoint(e.HeadLP, bbHeight),
			TailLabelPos: parseEdgePoint(e.TailLP, bbHeight),
		})
	}

	return layout
}

func extractEdgePoints(ops []gvDrawOp, bbHeight float64) []GvPoint {
	for _, op := range ops {
		if op.Op != "b" || len(op.Points) == 0 {
			continue
		}

		points := make([]GvPoint, 0, len(op.Points))
		for _, pt := range op.Points {
			if len(pt) < 2 {
				continue
			}
			points = append(points, GvPoint{
				X: pt[0] * ptToPx,
				Y: (bbHeight - pt[1]) * ptToPx,
			})
		}
		return points
	}
	return nil
}

func parseEdgePoint(pos string, bbHeight float64) *GvPoint {
	if pos == "" {
		return nil
	}
	parts := strings.Split(pos, ",")
	if len(parts) < 2 {
		return nil
	}
	x, errX := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	y, errY := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if errX != nil || errY != nil {
		return nil
	}
	return &GvPoint{
		X: x * ptToPx,
		Y: (bbHeight - y) * ptToPx,
	}
}

// extractTextLines pulls visible text from _ldraw_ draw operations.
// The preceding F (font) operation tells us the face; names containing
// "Bold" indicate a bold line (used for node titles).
func extractTextLines(ops []gvDrawOp) []GvTextLine {
	var lines []GvTextLine
	var curFace string
	for _, op := range ops {
		switch op.Op {
		case "F":
			curFace = op.Face
		case "T":
			if text := strings.TrimSpace(op.Text); text != "" {
				bold := strings.Contains(strings.ToLower(curFace), "bold")
				lines = append(lines, GvTextLine{Text: text, Bold: bold})
			}
		}
	}
	return lines
}

// validSuboptions lists the fixed -s flags allowed for umplesync.jar diagram generation.
var validSuboptions = map[string]bool{
	"hideattributes":        true,
	"showmethods":           true,
	"hideactions":           true,
	"showtransitionlabels":  true,
	"hideguards":            true,
	"showguardlabels":       true,
	"hidenaturallanguage":   true,
	"showFeatureDependency": true,
	"gvortho":               true,
	"gvdot":                 true,
	"gvsfdp":                true,
	"gvcirco":               true,
	"gvneato":               true,
	"gvfdp":                 true,
	"gvtwopi":               true,
	"gvdark":                true,
}

type diagramOutputKind int

const (
	outputGV diagramOutputKind = iota
	outputHTML
)

// diagramTypeInfo classifies each supported diagram type by its output kind.
// GV types produce .gv files processed through dot; HTML types return HTML on stdout.
var diagramTypeInfo = map[string]diagramOutputKind{
	"GvClassDiagram":              outputGV,
	"GvStateDiagram":              outputGV,
	"GvFeatureDiagram":            outputGV,
	"GvClassTraitDiagram":         outputGV,
	"StructureDiagram":            outputHTML,
	"GvEntityRelationshipDiagram": outputGV,
	"InstanceDiagram":             outputGV,
	"EventSequence":               outputHTML,
	"StateTables":                 outputHTML,
}

// processDiagramParams bundles everything needed to run diagram generation
// against an already-resolved model directory.
type processDiagramParams struct {
	pool             *compiler.Pool
	dir              string
	modelID          string
	diagramType      string
	suboptions       []string
	classFilterQuery string
	namedFilters     []string
	mixsets          []string
	needsLayout      bool
	entryFile        string
	locked           bool
}

// processDiagram generates a diagram from a model directory that already
// contains the entry .ump file. It returns a DiagramResponse or an error string.
// This is shared by both the /api/diagram endpoint and the merged /api/generate
// endpoint when diagramType is provided.
func processDiagram(p processDiagramParams) (*DiagramResponse, string) {
	outputKind, ok := diagramTypeInfo[p.diagramType]
	if !ok {
		return nil, fmt.Sprintf("unsupported diagram type: %s", p.diagramType)
	}

	modelPath := filepath.Join(p.dir, p.entryFile)
	modelData, _ := os.ReadFile(modelPath)
	storedLayout := extractStoredLayoutMetadata(string(modelData))
	commandModelPath := modelPath

	if overlayPath, cleanupOverlay, err := buildTransientClassDiagramOverlay(p, modelPath, string(modelData)); err != nil {
		return nil, fmt.Sprintf("failed to prepare diagram overlay: %v", err)
	} else if overlayPath != "" {
		commandModelPath = overlayPath
		defer cleanupOverlay()
	}

	// Remove stale .gv files so the directory scan after generation
	// always picks the newly generated file, not a leftover from a
	// previous diagram type.
	if cleanEntries, err := os.ReadDir(p.dir); err == nil {
		for _, e := range cleanEntries {
			if strings.HasSuffix(e.Name(), ".gv") {
				if removeErr := os.Remove(filepath.Join(p.dir, e.Name())); removeErr != nil {
					log.Printf("warning: failed to remove stale .gv file %s: %v", e.Name(), removeErr)
				}
			}
		}
	}

	// Generate .gv file using umple, appending validated suboptions as -s flags
	command := fmt.Sprintf("-generate %s %s", p.diagramType, commandModelPath)
	for _, opt := range p.suboptions {
		if isValidDiagramSuboption(opt) {
			command += " -s " + opt
		}
	}
	execute := p.pool.Execute
	if p.locked {
		execute = p.pool.ExecuteLocked
	}
	result, err := execute(compiler.CompileRequest{
		Command: command,
		WorkDir: p.dir,
	})
	if err != nil {
		return nil, fmt.Sprintf("diagram generation failed: %v", err)
	}

	// HTML output types (EventSequence, StateTables): prefer socket output,
	// but fall back to reading model.html from disk (Umple may write there instead).
	if outputKind == outputHTML {
		html := result.Output
		if strings.TrimSpace(html) == "" {
			htmlPath := filepath.Join(p.dir, "model.html")
			if data, readErr := os.ReadFile(htmlPath); readErr == nil {
				html = string(data)
			}
		}
		if p.diagramType == "StructureDiagram" {
			html = buildStructureDiagramHTML(html)
		}
		return &DiagramResponse{
			HTML:         html,
			StoredLayout: storedLayout,
			Errors:       result.Errors,
			ModelID:      p.modelID,
		}, ""
	}

	// GV output types: find the generated .gv file and run dot
	gvFile := ""
	entries, err := os.ReadDir(p.dir)
	if err != nil {
		return nil, "failed to read model directory: " + err.Error()
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".gv") {
			gvFile = filepath.Join(p.dir, e.Name())
			break
		}
	}

	if gvFile == "" {
		return nil, "no diagram output generated"
	}

	// Run dot -Tsvg (always) and optionally dot -Tjson for layout data
	var (
		svgData   []byte
		layout    *GvLayout
		svgErr    error
		svgErrMsg string
	)

	var wg sync.WaitGroup
	wg.Add(1)

	// SVG generation
	go func() {
		defer wg.Done()
		svgFile := filepath.Join(p.dir, "diagram.svg")
		// Remove any leftover SVG so a real failure isn't masked by stale output.
		os.Remove(svgFile)
		cmd := exec.Command("dot", "-Tsvg", "-o", svgFile, gvFile)
		cmd.Dir = p.dir
		if out, err := cmd.CombinedOutput(); err != nil {
			// Some layout engines (e.g. sfdp on Alpine) exit non-zero with
			// a warning but still produce valid output via -o.
			if data, readErr := os.ReadFile(svgFile); readErr == nil && len(data) > 0 {
				svgData = data
				return
			}
			svgErr = err
			svgErrMsg = string(out)
			return
		}
		svgData, svgErr = os.ReadFile(svgFile)
	}()

	// JSON layout extraction — only when the caller needs layout data
	if p.needsLayout {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := exec.Command("dot", "-Tjson", gvFile)
			cmd.Dir = p.dir
			// cmd.Output() populates stdout even on ExitError (e.g. sfdp
			// overlap warning). Only bail on non-exit failures.
			jsonData, err := cmd.Output()
			if err != nil {
				if _, ok := err.(*exec.ExitError); !ok {
					return
				}
			}
			if len(jsonData) > 0 {
				layout = parseGvLayout(jsonData)
			}
		}()
	}

	wg.Wait()

	if svgErr != nil {
		if svgErrMsg != "" {
			return nil, fmt.Sprintf("dot conversion failed: %v: %s", svgErr, svgErrMsg)
		}
		return nil, "failed to read SVG output"
	}

	return &DiagramResponse{
		SVG:          string(svgData),
		Layout:       layout,
		StoredLayout: storedLayout,
		Errors:       result.Errors,
		ModelID:      p.modelID,
	}, ""
}

func (h *DiagramHandler) Generate(w http.ResponseWriter, r *http.Request) {
	var req DiagramRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}
	if req.DiagramType == "" {
		writeError(w, http.StatusBadRequest, "diagramType is required")
		return
	}
	if _, ok := diagramTypeInfo[req.DiagramType]; !ok {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported diagram type: %s", req.DiagramType))
		return
	}

	// Ensure model directory exists
	entryFile := resolveEntryFile(h.store, req.ModelID, req.ActiveTabID)
	modelID, dir, err := resolveModel(h.store, req.ModelID, req.Code, entryFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to resolve model: %v", err))
		return
	}

	// Default needsLayout to true for backward compatibility
	needsLayout := req.NeedsLayout == nil || *req.NeedsLayout

	resp, errMsg := processDiagram(processDiagramParams{
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
	})
	if errMsg != "" {
		writeError(w, http.StatusInternalServerError, errMsg)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func buildStructureDiagramHTML(generated string) string {
	script := strings.TrimSpace(generated)
	if script == "" {
		return ""
	}

	script = strings.ReplaceAll(script, "##CANVAS_ID##", "svgCanvas")

	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; width: 100%%; height: 100%%; overflow: auto; background: transparent; }
    #structure-root { width: 100%%; min-height: 100%%; display: flex; align-items: flex-start; justify-content: center; padding: 16px; box-sizing: border-box; }
    #svgCanvas { max-width: 100%%; }
  </style>
</head>
<body>
  <div id="structure-root">
    <svg id="svgCanvas" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
  <script>%s</script>
  <script>%s</script>
</body>
</html>`, structureDiagramRuntime, script)
}
