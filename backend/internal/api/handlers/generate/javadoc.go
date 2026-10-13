package generate

// These helpers prepare generated Java so javadoc can run, and shorten javadoc's console output for the message pane.
// Service calls this when the generate target is Javadoc.

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func prepareJavadocSources(javaDir, entryFile string) (string, error) {
	javadocSrcDir, err := prepareGeneratedWorkspace(filepath.Dir(javaDir), "javadoc-src")
	if err != nil {
		return "", err
	}

	err = filepath.WalkDir(javaDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		rel, err := filepath.Rel(javaDir, path)
		if err != nil {
			return err
		}
		dst := filepath.Join(javadocSrcDir, rel)

		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		if filepath.Ext(path) != ".java" {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		sanitized := sanitizeJavaContentForJavadoc(string(data), entryFile)
		return os.WriteFile(dst, []byte(sanitized), 0o644)
	})
	if err != nil {
		return "", fmt.Errorf("prepare Javadoc sources: %w", err)
	}

	return javadocSrcDir, nil
}

func sanitizeJavaContentForJavadoc(content, entryFile string) string {
	lines := strings.Split(content, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.Contains(line, "@@@skip") {
			continue
		}
		out = append(out, line)
	}
	sanitized := strings.Join(out, "\n")
	return strings.ReplaceAll(sanitized, ".generate-java.ump", entryFile)
}

func summarizeJavadocOutput(output string) string {
	if output == "" {
		return ""
	}

	lines := strings.Split(output, "\n")
	kept := make([]string, 0, len(lines))
	skipNextIndented := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			skipNextIndented = false
			continue
		}

		if skipNextIndented && (strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")) {
			skipNextIndented = false
			continue
		}
		skipNextIndented = false

		switch {
		case strings.HasPrefix(trimmed, "Loading source file "):
			continue
		case strings.HasPrefix(trimmed, "Constructing Javadoc information"):
			continue
		case strings.HasPrefix(trimmed, "Building "):
			continue
		case strings.HasPrefix(trimmed, "Generating "):
			continue
		case strings.HasPrefix(trimmed, "Standard Doclet version "):
			continue
		case strings.Contains(trimmed, "The -footer option is no longer supported"):
			continue
		case strings.HasPrefix(trimmed, "It may be removed in a future release."):
			continue
		case strings.Contains(trimmed, "warning: no comment"):
			skipNextIndented = true
			continue
		case strings.HasSuffix(trimmed, "warnings") || strings.HasSuffix(trimmed, "warning"):
			continue
		}

		kept = append(kept, trimmed)
	}

	return strings.TrimSpace(strings.Join(kept, "\n"))
}
