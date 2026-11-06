package generate

// These helpers collect the source files a generation left on disk, and zip them for download.
// Service calls these helpers after the Umple compiler finishes.

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func languageExtensions(lang string) []string {
	switch lang {
	case "Java", "SimulateJava":
		return []string{".java"}
	case "Python":
		return []string{".py"}
	case "Php":
		return []string{".php"}
	case "Ruby":
		return []string{".rb"}
	case "Cpp", "RTCpp", "SimpleCpp":
		return []string{".cpp", ".h"}
	case "Json":
		return []string{".json"}
	case "Sql":
		return []string{".sql"}
	case "Alloy":
		return []string{".als"}
	case "NuSMV":
		return []string{".smv"}
	case "USE":
		return []string{".use"}
	case "Ecore":
		return []string{".ecore"}
	case "TextUml":
		return []string{".tuml"}
	case "Umlet":
		return []string{".uxf"}
	case "Yuml":
		return []string{".yuml"}
	case "Papyrus":
		return []string{".uml", ".notation", ".di", ".project"}
	case "Scxml":
		return []string{".scxml"}
	case "Mermaid":
		return []string{".mermaid"}
	default:
		return nil
	}
}

// cleanGeneratedFiles removes stale files matching the language's extensions
// from dir before a new generation run. This prevents readGeneratedFiles from
// picking up leftover artifacts from previous generations.
func cleanGeneratedFiles(dir, language, entryFile string) {
	exts := languageExtensions(language)
	if len(exts) == 0 {
		return
	}
	extSet := make(map[string]bool, len(exts))
	for _, ext := range exts {
		extSet[ext] = true
	}
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if extSet[filepath.Ext(path)] && filepath.Base(path) != entryFile {
			os.Remove(path)
		}
		return nil
	})
}

func readGeneratedFiles(dir, language, entryFile string) (string, []GeneratedFile, []string, error) {
	exts := languageExtensions(language)
	if len(exts) == 0 {
		return "", nil, nil, fmt.Errorf("unknown language: %s", language)
	}

	extSet := make(map[string]bool, len(exts))
	for _, ext := range exts {
		extSet[ext] = true
	}

	var paths []string
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if extSet[filepath.Ext(path)] && filepath.Base(path) != entryFile {
			paths = append(paths, path)
		}
		return nil
	})
	sort.Strings(paths)

	if len(paths) == 0 {
		return "", nil, nil, fmt.Errorf("no generated files found")
	}

	var parts []string
	files := make([]GeneratedFile, 0, len(paths))
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		content := string(data)
		parts = append(parts, content)

		relPath, err := filepath.Rel(dir, p)
		if err != nil {
			relPath = filepath.Base(p)
		}
		relPath = filepath.ToSlash(relPath)
		files = append(files, GeneratedFile{
			Name:    filepath.Base(p),
			Path:    relPath,
			Content: content,
		})
	}

	return strings.Join(parts, "\n"), files, paths, nil
}

func prepareGeneratedWorkspace(dir, name string) (string, error) {
	workspace := filepath.Join(dir, name)
	if err := os.RemoveAll(workspace); err != nil {
		return "", fmt.Errorf("clear %s workspace: %w", strings.ToLower(name), err)
	}
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		return "", fmt.Errorf("create %s workspace: %w", strings.ToLower(name), err)
	}
	return workspace, nil
}

func zipGeneratedArtifacts(zipPath, root string, paths []string) error {
	file, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := zip.NewWriter(file)

	seen := map[string]bool{}
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		if info.IsDir() {
			filepath.WalkDir(p, func(current string, d os.DirEntry, walkErr error) error {
				if walkErr != nil || d.IsDir() {
					return nil
				}
				addFileToZip(writer, root, current, seen)
				return nil
			})
			continue
		}
		addFileToZip(writer, root, p, seen)
	}

	return writer.Close()
}

func addFileToZip(writer *zip.Writer, root, fullPath string, seen map[string]bool) error {
	relPath, err := filepath.Rel(root, fullPath)
	if err != nil {
		return err
	}
	relPath = filepath.ToSlash(relPath)
	if seen[relPath] {
		return nil
	}
	seen[relPath] = true

	f, err := os.Open(fullPath)
	if err != nil {
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = relPath
	header.Method = zip.Deflate

	w, err := writer.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, f)
	return err
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
