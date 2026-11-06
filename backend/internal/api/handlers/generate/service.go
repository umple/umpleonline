// Package generate runs Umple code generation for POST /api/generate.
// Service shells out to the Umple compiler. The other files collect what it wrote and special-case Javadoc.
package generate

// Service runs one generation: a programming language, Javadoc, or Yuml.
// The HTTP handler in handlers/compile.go calls Service.Generate.

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

//go:embed javadoc_theme.css
var javadocThemeCSS []byte

type Service struct {
	jarPath string
}

func NewService(jarPath string) *Service {
	return &Service{jarPath: jarPath}
}

func (s *Service) Generate(baseLanguage, dir, modelID, entryFile string, suboptions []string) (GenerateResponse, error) {
	switch baseLanguage {
	case "javadoc":
		return s.generateJavadoc(dir, modelID, entryFile)
	case "Yuml":
		return s.generateYuml(dir, modelID, entryFile)
	default:
		return s.generateGeneric(baseLanguage, dir, modelID, entryFile, suboptions)
	}
}

func (s *Service) generateGeneric(language, dir, modelID, entryFile string, suboptions []string) (GenerateResponse, error) {
	outputDir := dir
	var stdout, stderr string
	var runErr error
	if language == "Java" {
		var err error
		outputDir, stdout, stderr, runErr, err = s.generateJavaSources(dir, entryFile)
		if err != nil {
			return GenerateResponse{}, err
		}
	} else {
		cleanGeneratedFiles(dir, language, entryFile)
		stdout, stderr, runErr = s.runGenerateCommand(language, filepath.Join(dir, entryFile), dir, suboptions)
	}
	output := strings.TrimSpace(stdout)

	outputFiles, generatedFiles, paths, err := readGeneratedFiles(outputDir, language, entryFile)
	if err == nil && outputFiles != "" {
		output = outputFiles
	}

	if runErr != nil && strings.TrimSpace(stderr) == "" {
		stderr = runErr.Error()
	}

	resp := GenerateResponse{
		Output:   output,
		Language: language,
		Errors:   strings.TrimSpace(stderr),
		ModelID:  modelID,
		Kind:     "text",
		Files:    generatedFiles,
	}

	if IsHTMLLanguage(language) {
		resp.Kind = "html"
		resp.HTML = output
	}

	if len(paths) > 0 {
		zipName := language + "FromUmple.zip"
		if language == "Papyrus" {
			zipName = "PapyrusFromUmple.zip"
		}
		zipPath := filepath.Join(dir, zipName)
		if err := zipGeneratedArtifacts(zipPath, dir, paths); err == nil {
			resp.Downloads = append(resp.Downloads, GeneratedArtifact{
				Label:    "Download ZIP",
				URL:      buildGeneratedAssetURL(modelID, zipName),
				Filename: zipName,
			})
		}
	}

	if language == "Papyrus" && output == "" {
		resp.Output = "Papyrus project generated."
	}

	return resp, nil
}

func (s *Service) generateJavadoc(dir, modelID, entryFile string) (GenerateResponse, error) {
	javaDir, stdout, stderr, runErr, err := s.generateJavaSources(dir, entryFile)
	if err != nil {
		return GenerateResponse{}, err
	}
	output := strings.TrimSpace(stdout)

	javadocSrcDir, err := prepareJavadocSources(javaDir, entryFile)
	if err != nil {
		return GenerateResponse{}, err
	}

	outputFiles, _, javaFiles, err := readGeneratedFiles(javadocSrcDir, "Java", entryFile)
	if err == nil && outputFiles != "" {
		output = outputFiles
	}

	if len(javaFiles) == 0 {
		return GenerateResponse{
			Output:   output,
			Language: "Java",
			Errors:   firstNonEmpty(strings.TrimSpace(stderr), errString(runErr), "No generated Java files found for Javadoc."),
			ModelID:  modelID,
			Kind:     "text",
		}, nil
	}

	javadocDir := filepath.Join(dir, "javadoc")
	_ = os.RemoveAll(javadocDir)
	if err := os.MkdirAll(javadocDir, 0o755); err != nil {
		return GenerateResponse{}, fmt.Errorf("create javadoc dir: %w", err)
	}

	args := append([]string{"-d", javadocDir, "-quiet", "-Xdoclint:none"}, javaFiles...)
	javadocOut, javadocErr := exec.Command("javadoc", args...).CombinedOutput()
	javadocErrors := summarizeJavadocOutput(string(javadocOut))
	if javadocErr != nil && javadocErrors == "" {
		javadocErrors = javadocErr.Error()
	}

	applyJavadocTheme(javadocDir)

	downloads := []GeneratedArtifact{}
	zipName := "javadocFromUmple.zip"
	zipPath := filepath.Join(dir, zipName)
	if err := zipGeneratedArtifacts(zipPath, dir, []string{javadocDir}); err == nil {
		downloads = append(downloads, GeneratedArtifact{
			Label:    "Download Javadoc ZIP",
			URL:      buildGeneratedAssetURL(modelID, zipName),
			Filename: zipName,
		})
	}

	if _, err := os.Stat(filepath.Join(javadocDir, "index.html")); err != nil {
		return GenerateResponse{
			Output:   firstNonEmpty(output, "Javadoc generation failed."),
			Language: "Java",
			Errors:   firstNonEmpty(strings.TrimSpace(stderr), errString(runErr), javadocErrors),
			ModelID:  modelID,
			Kind:     "text",
		}, nil
	}

	return GenerateResponse{
		Output:    "Javadoc generated.",
		Language:  "Java",
		Errors:    firstNonEmpty(strings.TrimSpace(stderr), errString(runErr), javadocErrors),
		ModelID:   modelID,
		Kind:      "iframe",
		IframeURL: buildGeneratedAssetURL(modelID, "javadoc/index.html"),
		Downloads: downloads,
	}, nil
}

func (s *Service) generateYuml(dir, modelID, entryFile string) (GenerateResponse, error) {
	stdout, stderr, runErr := s.runGenerateCommand("Yuml", filepath.Join(dir, entryFile), dir, nil)
	output := strings.TrimSpace(stdout)
	if output == "" {
		if outputFiles, _, _, err := readGeneratedFiles(dir, "Yuml", entryFile); err == nil && outputFiles != "" {
			output = strings.TrimSpace(outputFiles)
		}
	}

	yumlPath := filepath.Join(dir, "yuml.txt")
	if output != "" {
		_ = os.WriteFile(yumlPath, []byte(output), 0o644)
	}

	downloads := []GeneratedArtifact{{
		Label:    "Download Yuml Text",
		URL:      buildGeneratedAssetURL(modelID, "yuml.txt"),
		Filename: "yuml.txt",
	}}

	imageHTML := ""
	if output != "" {
		pngPath := filepath.Join(dir, "yuml.png")
		if err := fetchYumlPNG(output, pngPath); err == nil {
			downloads = append(downloads, GeneratedArtifact{
				Label:    "Download PNG",
				URL:      buildGeneratedAssetURL(modelID, "yuml.png"),
				Filename: "yuml.png",
			})
			imageHTML = fmt.Sprintf(`<p><img src="%s" alt="Yuml diagram" /></p>`, buildGeneratedAssetURL(modelID, "yuml.png"))
		} else if strings.TrimSpace(stderr) == "" {
			stderr = err.Error()
		}
	}

	html := fmt.Sprintf(
		`<p><a href="%s" target="_blank" rel="noreferrer">Download the Yuml text</a>. You can also render it at <a href="https://yuml.me/diagram/plain/class/draw" target="_blank" rel="noreferrer">yuml.me</a>.</p>%s`,
		buildGeneratedAssetURL(modelID, "yuml.txt"),
		imageHTML,
	)

	if runErr != nil && strings.TrimSpace(stderr) == "" {
		stderr = runErr.Error()
	}

	return GenerateResponse{
		Output:    output,
		Language:  "Yuml",
		Errors:    strings.TrimSpace(stderr),
		ModelID:   modelID,
		Kind:      "html",
		HTML:      html,
		Downloads: downloads,
	}, nil
}

func (s *Service) runGenerateCommand(language, modelFile, workDir string, suboptions []string) (string, string, error) {
	args := []string{"-jar", s.jarPath, "-generate", language, modelFile}
	for _, opt := range suboptions {
		args = append(args, "-s", opt)
	}

	cmd := exec.Command("java", args...)
	cmd.Dir = workDir

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return stdout.String(), stderr.String(), exitErr
		}
		return stdout.String(), stderr.String(), err
	}
	return stdout.String(), stderr.String(), nil
}

func (s *Service) generateJavaSources(dir, entryFile string) (string, string, string, error, error) {
	javaDir, err := prepareGeneratedWorkspace(dir, "Java")
	if err != nil {
		return "", "", "", nil, err
	}

	modelFile := filepath.Join(dir, entryFile)
	code, err := os.ReadFile(modelFile)
	if err != nil {
		return "", "", "", nil, fmt.Errorf("read %s: %w", entryFile, err)
	}

	wrapperFile := filepath.Join(dir, ".generate-java.ump")
	wrapperCode := "generate Java \"./Java/\" --override-all;\n" + string(code)
	if err := os.WriteFile(wrapperFile, []byte(wrapperCode), 0o644); err != nil {
		return "", "", "", nil, fmt.Errorf("write Java generation wrapper: %w", err)
	}
	defer os.Remove(wrapperFile)

	args := []string{"-jar", s.jarPath, "-source", wrapperFile}
	cmd := exec.Command("java", args...)
	cmd.Dir = dir

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return javaDir, stdout.String(), stderr.String(), exitErr, nil
		}
		return javaDir, stdout.String(), stderr.String(), nil, err
	}

	return javaDir, stdout.String(), stderr.String(), nil, nil
}

func buildGeneratedAssetURL(modelID, relPath string) string {
	parts := strings.Split(filepath.ToSlash(relPath), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return "/api/generated/" + url.PathEscape(modelID) + "/" + strings.Join(parts, "/")
}

func applyJavadocTheme(javadocDir string) {
	marker := "\n/* --- UmpleOnline theme overrides --- */\n"
	for _, stylesheet := range []string{
		filepath.Join(javadocDir, "stylesheet.css"),
		filepath.Join(javadocDir, "resources", "stylesheet.css"),
		filepath.Join(javadocDir, "resource-files", "stylesheet.css"),
	} {
		data, err := os.ReadFile(stylesheet)
		if err != nil {
			continue
		}
		if bytes.Contains(data, []byte(marker)) {
			continue
		}
		_ = os.WriteFile(stylesheet, append(data, append([]byte(marker), javadocThemeCSS...)...), 0o644)
	}
}

func fetchYumlPNG(yumlText, dst string) error {
	encoded := url.PathEscape(yumlText)
	apiURL := "https://yuml.me/diagram/plain/class/" + encoded + ".png"

	resp, err := http.Get(apiURL)
	if err != nil {
		return fmt.Errorf("yuml.me request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("yuml.me returned status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading yuml.me response: %w", err)
	}

	return os.WriteFile(dst, data, 0o644)
}
