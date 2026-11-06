// Package model stores Umple models on disk, one directory per model id.
// Handlers read and write those directories. A cleanup loop deletes temporary models.
package model

// The store creates models, reads and writes tabs, and tracks which tab is active.
// Temporary ids are the ones the cleanup loop is allowed to remove.

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// IsTemporary reports whether a model ID is a temporary (auto-cleanup) model.
func IsTemporary(id string) bool {
	return strings.HasPrefix(id, "tmp")
}

// DefaultEntryFile is the fallback filename used when no tabs.json exists
// (backward compatibility with pre-tab models). The frontend may use any
// name — the backend does not enforce a specific tab name.
const DefaultEntryFile = "Model.ump"

// TabMeta is the metadata for a single editor tab (id + display name).
// Code is NOT stored here — it lives in the individual .ump files on disk.
type TabMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TabsData is the structure persisted to and loaded from tabs.json.
type TabsData struct {
	ActiveTabID string    `json:"activeTabId"`
	Tabs        []TabMeta `json:"tabs"`
}

// Store manages filesystem-based model storage, mirroring the PHP DataStore pattern.
type Store struct {
	root string
}

func NewStore(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, fmt.Errorf("create store root: %w", err)
	}
	return &Store{root: root}, nil
}

// Create generates a new model directory with a random ID and writes the initial code.
func (s *Store) Create(code string) (*Model, error) {
	id := "tmp" + randomID()
	dir := filepath.Join(s.root, id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, DefaultEntryFile), []byte(code), 0644); err != nil {
		return nil, err
	}
	return &Model{ID: id, Code: code}, nil
}

// ModelDir returns the filesystem path for a model ID.
func (s *Store) ModelDir(id string) string {
	return filepath.Join(s.root, sanitizeID(id))
}

// Get loads a model by ID from the store root.
func (s *Store) Get(id string) (*Model, error) {
	id = sanitizeID(id)
	dir := filepath.Join(s.root, id)
	entryFile := s.ResolveEntryFile(id)
	data, err := os.ReadFile(filepath.Join(dir, entryFile))
	if err != nil {
		return nil, fmt.Errorf("model not found: %s", id)
	}
	return &Model{ID: id, Code: string(data)}, nil
}

// ResolveEntryFile returns the compiler entry-point filename for a model.
// It looks up the active tab name from tabs.json; if absent, falls back to
// DefaultEntryFile.
func (s *Store) ResolveEntryFile(modelID string) string {
	tabs, err := s.LoadTabs(modelID)
	if err != nil || tabs == nil {
		return DefaultEntryFile
	}
	if name := tabNameByID(tabs, tabs.ActiveTabID); name != "" {
		if safe, err := SafeTabName(name); err == nil {
			return safe
		}
	}
	return DefaultEntryFile
}

// TabNameByID returns the filename for a tab identified by tabID within the
// given model's tabs.json. Returns "" if not found.
func (s *Store) TabNameByID(modelID, tabID string) string {
	tabs, err := s.LoadTabs(modelID)
	if err != nil || tabs == nil {
		return ""
	}
	return tabNameByID(tabs, tabID)
}

func tabNameByID(data *TabsData, tabID string) string {
	for _, t := range data.Tabs {
		if t.ID == tabID {
			return t.Name
		}
	}
	return ""
}

// CleanupLoop periodically removes tmp model directories older than maxAge.
func (s *Store) CleanupLoop(interval time.Duration) {
	maxAge := 24 * time.Hour
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		s.cleanup(maxAge)
	}
}

// SaveTabs writes tab metadata to {modelDir}/tabs.json.
func (s *Store) SaveTabs(modelID string, data *TabsData) error {
	dir := s.ModelDir(modelID)
	b, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal tabs: %w", err)
	}
	return os.WriteFile(filepath.Join(dir, "tabs.json"), b, 0644)
}

// SaveTabFiles writes each tab's code as a separate .ump file in the model
// directory and removes stale .ump files that no longer correspond to any tab.
// files maps tab name (e.g. "Person.ump") → code.
// entryFile is skipped because resolveModel manages it (with layout data
// merged in). All other tabs are written so cross-tab `use` statements resolve.
func (s *Store) SaveTabFiles(modelID string, files map[string]string, entryFile string) error {
	dir := s.ModelDir(modelID)

	// Build set of tab filenames that should exist on disk.
	// Always include entryFile since resolveModel manages it.
	tabFileNames := make(map[string]bool, len(files)+1)
	tabFileNames[entryFile] = true
	for name := range files {
		safe, err := SafeTabName(name)
		if err != nil {
			return err
		}
		tabFileNames[safe] = true
	}

	// Write each tab to its own .ump file (skip entryFile — managed by resolveModel).
	for name, code := range files {
		fileName, err := SafeTabName(name)
		if err != nil {
			return err
		}
		if fileName == entryFile {
			continue
		}
		path := filepath.Join(dir, fileName)
		if err := os.WriteFile(path, []byte(code), 0644); err != nil {
			return fmt.Errorf("write tab file %s: %w", fileName, err)
		}
	}

	// Remove stale .ump files that don't belong to any tab.
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil // non-fatal: directory may not exist yet
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".ump") || strings.HasPrefix(name, ".") {
			continue
		}
		if !tabFileNames[name] {
			if err := os.Remove(filepath.Join(dir, name)); err != nil {
				log.Printf("failed to remove stale tab file %s: %v", name, err)
			}
		}
	}

	return nil
}

// SafeTabName validates and normalises a tab filename. It rejects names
// containing path separators or ".." to prevent directory-traversal attacks,
// and ensures the result has a ".ump" extension.
func SafeTabName(name string) (string, error) {
	name = EnsureUmpExt(name)
	if name != filepath.Base(name) || strings.Contains(name, "..") {
		return "", fmt.Errorf("invalid tab name: %s", name)
	}
	return name, nil
}

// EnsureUmpExt appends ".ump" if the name doesn't already have it.
func EnsureUmpExt(name string) string {
	if strings.HasSuffix(name, ".ump") {
		return name
	}
	return name + ".ump"
}

// LoadTabs reads tab metadata from {modelDir}/tabs.json.
// Returns nil, nil if the file does not exist (backward compat).
func (s *Store) LoadTabs(modelID string) (*TabsData, error) {
	dir := s.ModelDir(modelID)
	b, err := os.ReadFile(filepath.Join(dir, "tabs.json"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read tabs: %w", err)
	}
	var data TabsData
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, fmt.Errorf("unmarshal tabs: %w", err)
	}
	return &data, nil
}

// ReadTabCode reads a single tab's code from its .ump file on disk.
func (s *Store) ReadTabCode(modelID, tabName string) (string, error) {
	fileName, err := SafeTabName(tabName)
	if err != nil {
		return "", err
	}
	dir := s.ModelDir(modelID)
	data, err := os.ReadFile(filepath.Join(dir, fileName))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (s *Store) cleanup(maxAge time.Duration) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		log.Printf("cleanup: failed to read store: %v", err)
		return
	}
	cutoff := time.Now().Add(-maxAge)
	for _, e := range entries {
		if !e.IsDir() || !IsTemporary(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			path := filepath.Join(s.root, e.Name())
			if err := os.RemoveAll(path); err != nil {
				log.Printf("cleanup: failed to remove %s: %v", path, err)
			} else {
				log.Printf("cleanup: removed old model %s", e.Name())
			}
		}
	}
}

// Promote converts a temporary model to a permanent one by renaming its
// directory. Returns the new permanent ID. If the model is already permanent,
// returns the same ID (no-op).
func (s *Store) Promote(id string) (string, error) {
	id = sanitizeID(id)
	if !IsTemporary(id) {
		return id, nil
	}
	oldDir := filepath.Join(s.root, id)
	if _, err := os.Stat(oldDir); err != nil {
		return "", fmt.Errorf("promote: %w", err)
	}
	newID := permanentID()
	newDir := filepath.Join(s.root, newID)
	if err := os.Rename(oldDir, newDir); err != nil {
		return "", fmt.Errorf("promote model: %w", err)
	}
	return newID, nil
}

func permanentID() string {
	return time.Now().Format("060102") + randomID()
}

func randomID() string {
	const chars = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, 10)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

func sanitizeID(id string) string {
	// Prevent directory traversal
	id = filepath.Base(id)
	id = strings.ReplaceAll(id, "..", "")
	return id
}
