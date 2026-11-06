package generate

// These are the request and response types for code generation, and the languages the API accepts.
// Service and the POST /api/generate handler share these types.

import "strings"

type GenerateRequest struct {
	Code        string `json:"code"`
	Language    string `json:"language"`
	ModelID     string `json:"modelId,omitempty"`
	ActiveTabID string `json:"activeTabId,omitempty"`
}

type GeneratedArtifact struct {
	Label    string `json:"label"`
	URL      string `json:"url"`
	Filename string `json:"filename,omitempty"`
}

type GeneratedFile struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

type GenerateResponse struct {
	Output    string              `json:"output"`
	Language  string              `json:"language"`
	Errors    string              `json:"errors,omitempty"`
	ModelID   string              `json:"modelId"`
	Kind      string              `json:"kind,omitempty"`
	HTML      string              `json:"html,omitempty"`
	IframeURL string              `json:"iframeUrl,omitempty"`
	Downloads []GeneratedArtifact `json:"downloads,omitempty"`
	Files     []GeneratedFile     `json:"files,omitempty"`
}

var validLanguages = map[string]bool{
	"Java":                        true,
	"javadoc":                     true,
	"Php":                         true,
	"Python":                      true,
	"Ruby":                        true,
	"Cpp":                         true,
	"RTCpp":                       true,
	"SimpleCpp":                   true,
	"Json":                        true,
	"Yuml":                        true,
	"Mermaid":                     true,
	"Ecore":                       true,
	"Papyrus":                     true,
	"TextUml":                     true,
	"Scxml":                       true,
	"Umlet":                       true,
	"USE":                         true,
	"Sql":                         true,
	"Alloy":                       true,
	"NuSMV":                       true,
	"SimulateJava":                true,
	"SimpleMetrics":               true,
	"PlainRequirementsDoc":        true,
	"CodeAnalysis":                true,
	"UmpleSelf":                   true,
	"UmpleAnnotaiveToComposition": true,
}

var htmlLanguages = map[string]bool{
	"SimpleMetrics":        true,
	"PlainRequirementsDoc": true,
	"CodeAnalysis":         true,
}

func IsValidLanguage(language string) bool {
	return validLanguages[language]
}

func IsHTMLLanguage(language string) bool {
	return htmlLanguages[language]
}

func ParseLanguageSpec(spec string) (string, []string) {
	parts := strings.Split(spec, ".")
	base := parts[0]
	if len(parts) == 1 {
		return base, nil
	}

	suboptions := make([]string, 0, len(parts)-1)
	for _, part := range parts[1:] {
		part = strings.TrimSpace(part)
		if part != "" {
			suboptions = append(suboptions, part)
		}
	}
	return base, suboptions
}
