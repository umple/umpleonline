package handlers

// These helpers split an Umple file into editable source and the hidden layout section after the end-of-model marker.
// The editor shows only the source. Sync keeps the layout section so umplesync can round-trip positions.

import (
	"regexp"
	"slices"
	"strings"
)

const modelDelimiter = "//$?[End_of_model]$?"

type StoredLayoutMetadata struct {
	HasStoredLayout  bool     `json:"hasStoredLayout"`
	NodeNames        []string `json:"nodeNames,omitempty"`
	AssociationNames []string `json:"associationNames,omitempty"`
}

var (
	classifierDefRe       = regexp.MustCompile(`(?m)^\s*(?:class|interface|associationClass)\s+(\w+)\b`)
	layoutBlockRe         = regexp.MustCompile(`(?ms)^\s*(class|interface|associationClass)\s+(\w+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*`)
	elementPositionRe     = regexp.MustCompile(`(?m)^\s*position\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s*;`)
	associationPositionRe = regexp.MustCompile(`(?m)^\s*position\.association\s+([^\s]+)\s+[^;\n]+;`)
)

func splitModelSections(code string) (userCode string, hiddenLayout string, hasDelimiter bool) {
	idx := strings.Index(code, modelDelimiter)
	if idx < 0 {
		return strings.TrimRight(code, "\n"), "", false
	}

	userCode = strings.TrimRight(code[:idx], "\n")
	hiddenLayout = strings.Trim(strings.TrimPrefix(code[idx:], modelDelimiter), "\n")
	return userCode, hiddenLayout, true
}

func joinModelSections(userCode string, hiddenLayout string, keepDelimiter bool) string {
	userCode = strings.TrimRight(userCode, "\n")
	hiddenLayout = strings.Trim(hiddenLayout, "\n")

	switch {
	case hiddenLayout != "":
		if userCode == "" {
			return modelDelimiter + "\n" + hiddenLayout + "\n"
		}
		return userCode + "\n\n" + modelDelimiter + "\n" + hiddenLayout + "\n"
	case keepDelimiter:
		if userCode == "" {
			return modelDelimiter + "\n"
		}
		return userCode + "\n\n" + modelDelimiter + "\n"
	case userCode == "":
		return ""
	default:
		return userCode + "\n"
	}
}

func definedClassifierNames(model string) map[string]bool {
	if idx := strings.Index(model, modelDelimiter); idx >= 0 {
		model = model[:idx]
	}

	out := make(map[string]bool)
	for _, match := range classifierDefRe.FindAllStringSubmatch(model, -1) {
		out[match[1]] = true
	}
	return out
}

func filterHiddenLayoutSection(userCode string, hiddenLayout string) string {
	if strings.TrimSpace(hiddenLayout) == "" {
		return ""
	}

	defined := definedClassifierNames(userCode)
	if len(defined) == 0 {
		return ""
	}

	keepNamespaceReset := strings.Contains(hiddenLayout, "namespace -;")
	blocks := layoutBlockRe.FindAllStringSubmatch(hiddenLayout, -1)
	if len(blocks) == 0 {
		return ""
	}

	var kept []string
	for _, block := range blocks {
		name := block[2]
		if !defined[name] {
			continue
		}
		kept = append(kept, strings.TrimSpace(block[0]))
	}

	if len(kept) == 0 {
		return ""
	}

	var out strings.Builder
	if keepNamespaceReset {
		out.WriteString("namespace -;\n\n")
	}
	for i, block := range kept {
		if i > 0 {
			out.WriteString("\n\n")
		}
		out.WriteString(block)
	}
	return out.String()
}

func mergeModelCodeWithStoredLayout(code string, existing string) string {
	userCode, _, _ := splitModelSections(code)
	_, existingHiddenLayout, hasDelimiter := splitModelSections(existing)

	filteredHiddenLayout := filterHiddenLayoutSection(userCode, existingHiddenLayout)
	return joinModelSections(userCode, filteredHiddenLayout, hasDelimiter)
}

func extractStoredLayoutMetadata(code string) *StoredLayoutMetadata {
	_, hiddenLayout, _ := splitModelSections(code)
	if strings.TrimSpace(hiddenLayout) == "" {
		return nil
	}

	nodeNames := make(map[string]bool)
	associationNames := make(map[string]bool)
	for _, block := range layoutBlockRe.FindAllStringSubmatch(hiddenLayout, -1) {
		name := block[2]
		body := block[3]

		if elementPositionRe.MatchString(body) {
			nodeNames[name] = true
		}
		for _, match := range associationPositionRe.FindAllStringSubmatch(body, -1) {
			associationNames[match[1]] = true
		}
	}

	if len(nodeNames) == 0 && len(associationNames) == 0 {
		return nil
	}

	nodeList := make([]string, 0, len(nodeNames))
	for name := range nodeNames {
		nodeList = append(nodeList, name)
	}
	slices.Sort(nodeList)

	associationList := make([]string, 0, len(associationNames))
	for name := range associationNames {
		associationList = append(associationList, name)
	}
	slices.Sort(associationList)

	return &StoredLayoutMetadata{
		HasStoredLayout:  true,
		NodeNames:        nodeList,
		AssociationNames: associationList,
	}
}
