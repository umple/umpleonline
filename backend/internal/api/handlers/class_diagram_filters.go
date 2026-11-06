package handlers

// buildTransientClassDiagramOverlay writes a temporary Umple copy with class-diagram filter, mixset, and separator directives applied.
// diagram.go compiles that copy so the canvas can hide classes without rewriting the user's text.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type classDiagramOverlayParams struct {
	classFilterQuery string
	namedFilters     []string
	mixsets          []string
}

var (
	overlayIdentifierRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	explicitFilterRe    = regexp.MustCompile(`(?m)^\s*filter\s*\{`)
)

func isValidDiagramSuboption(opt string) bool {
	if validSuboptions[opt] {
		return true
	}
	_, ok := parseGvSeparatorSuboption(opt)
	return ok
}

func parseGvSeparatorSuboption(opt string) (float64, bool) {
	if !strings.HasPrefix(opt, "gvseparator=") {
		return 0, false
	}

	value, err := strconv.ParseFloat(strings.TrimPrefix(opt, "gvseparator="), 64)
	if err != nil || value <= 0 {
		return 0, false
	}

	return value, true
}

func buildTransientClassDiagramOverlay(
	p processDiagramParams,
	modelPath string,
	modelSource string,
) (string, func(), error) {
	if !isClassDiagramType(p.diagramType) {
		return "", func() {}, nil
	}

	overlay := classDiagramOverlayParams{
		classFilterQuery: p.classFilterQuery,
		namedFilters:     p.namedFilters,
		mixsets:          p.mixsets,
	}

	hasExplicitFilter := workspaceHasExplicitFilter(p.dir)
	nextSource, changed := applyClassDiagramOverlay(modelSource, overlay, hasExplicitFilter)
	if !changed {
		return "", func() {}, nil
	}

	tempName := fmt.Sprintf(".diagram-overlay-%s", filepath.Base(p.entryFile))
	tempPath := filepath.Join(p.dir, tempName)
	if err := os.WriteFile(tempPath, []byte(nextSource), 0o644); err != nil {
		return "", nil, err
	}

	return tempPath, func() {
		_ = os.Remove(tempPath)
	}, nil
}

func isClassDiagramType(diagramType string) bool {
	return diagramType == "GvClassDiagram" || diagramType == "GvClassTraitDiagram"
}

func applyClassDiagramOverlay(
	modelSource string,
	overlay classDiagramOverlayParams,
	hasExplicitFilter bool,
) (string, bool) {
	userCode, hiddenLayout, hasDelimiter := splitModelSections(modelSource)
	directives := buildClassDiagramOverlayDirectives(overlay, hasExplicitFilter)
	if len(directives) == 0 {
		return modelSource, false
	}

	nextUserCode := strings.TrimRight(userCode, "\n")
	if nextUserCode != "" {
		nextUserCode += "\n\n"
	}
	nextUserCode += strings.Join(directives, "\n")

	return joinModelSections(nextUserCode, hiddenLayout, hasDelimiter), true
}

func buildClassDiagramOverlayDirectives(
	overlay classDiagramOverlayParams,
	hasExplicitFilter bool,
) []string {
	var directives []string

	for _, mixset := range overlay.mixsets {
		if isValidOverlayIdentifier(mixset) {
			directives = append(directives, "use "+mixset+";")
		}
	}

	for _, namedFilter := range overlay.namedFilters {
		if isValidOverlayIdentifier(namedFilter) {
			directives = append(directives, fmt.Sprintf("filter {includeFilter %s;}", namedFilter))
		}
	}

	var includeParts []string
	var hopParts []string
	for _, token := range strings.Fields(strings.TrimSpace(overlay.classFilterQuery)) {
		if token == "" {
			continue
		}
		if _, ok := parseGvSeparatorSuboption(token); ok {
			directives = append(directives, fmt.Sprintf("suboption %q;", token))
			continue
		}
		if hopCount, err := strconv.Atoi(token); err == nil && hopCount > 0 {
			hopParts = append(hopParts, fmt.Sprintf("hops { association %d;}", hopCount))
			continue
		}
		if strings.HasPrefix(token, "gv") {
			continue
		}
		includeParts = append(includeParts, "include "+token+";")
	}

	if !hasExplicitFilter && (len(includeParts) > 0 || len(hopParts) > 0) {
		filterParts := append(includeParts, hopParts...)
		directives = append(directives, "filter { "+strings.Join(filterParts, " ")+" }")
	}

	return directives
}

func isValidOverlayIdentifier(value string) bool {
	return overlayIdentifierRe.MatchString(value)
}

func workspaceHasExplicitFilter(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ump") || strings.HasPrefix(entry.Name(), ".diagram-overlay-") {
			continue
		}
		source, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		if hasExplicitTopLevelFilter(string(source)) {
			return true
		}
	}

	return false
}

func hasExplicitTopLevelFilter(code string) bool {
	userCode, _, _ := splitModelSections(code)
	withoutBlockComments := regexp.MustCompile(`/\*[\s\S]*?\*/`).ReplaceAllString(userCode, "")
	withoutLineComments := regexp.MustCompile(`(?m)//.*$`).ReplaceAllString(withoutBlockComments, "")
	return explicitFilterRe.MatchString(withoutLineComments)
}
