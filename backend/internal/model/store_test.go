package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveTabFiles_WritesAndCleansUp(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	// Create a model directory with an initial file.
	modelID := "tmpTestModel"
	dir := store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	// Simulate resolveModel writing Model.ump
	if err := os.WriteFile(filepath.Join(dir, "Model.ump"), []byte("// main"), 0644); err != nil {
		t.Fatal(err)
	}

	files := map[string]string{
		"Model.ump":   "// main tab",
		"Person.ump":  "class Person { name; }",
		"Student.ump": "use Person.ump;\nclass Student { isA Person; }",
	}

	if err := store.SaveTabFiles(modelID, files, "Model.ump"); err != nil {
		t.Fatalf("SaveTabFiles: %v", err)
	}

	// Model.ump should NOT be overwritten (resolveModel manages it)
	data, err := os.ReadFile(filepath.Join(dir, "Model.ump"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "// main" {
		t.Errorf("Model.ump was overwritten: got %q, want %q", string(data), "// main")
	}

	// Other tabs should be written
	for _, name := range []string{"Person.ump", "Student.ump"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("expected %s to exist: %v", name, err)
		}
	}

	data, err = os.ReadFile(filepath.Join(dir, "Person.ump"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "class Person { name; }" {
		t.Errorf("Person.ump content mismatch: got %q", string(data))
	}

	// Now remove Student tab and re-save — Student.ump should be cleaned up
	files = map[string]string{
		"Model.ump":  "// main tab",
		"Person.ump": "class Person { name; }",
	}

	if err := store.SaveTabFiles(modelID, files, "Model.ump"); err != nil {
		t.Fatalf("SaveTabFiles (second call): %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "Student.ump")); !os.IsNotExist(err) {
		t.Error("Student.ump should have been cleaned up after tab removal")
	}

	// Model.ump and Person.ump should still exist
	if _, err := os.Stat(filepath.Join(dir, "Model.ump")); err != nil {
		t.Error("Model.ump should still exist")
	}
	if _, err := os.Stat(filepath.Join(dir, "Person.ump")); err != nil {
		t.Error("Person.ump should still exist")
	}
}

func TestSaveTabFiles_NonUmpFilesPreserved(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	modelID := "tmpTestModel2"
	dir := store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create non-.ump files (like model.json, tabs.json) that should not be removed
	for _, name := range []string{"model.json", "tabs.json", "Model.ump"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("{}"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	files := map[string]string{
		"Model.ump": "// code",
	}

	if err := store.SaveTabFiles(modelID, files, "Model.ump"); err != nil {
		t.Fatalf("SaveTabFiles: %v", err)
	}

	// Non-.ump files should still exist
	for _, name := range []string{"model.json", "tabs.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s should not be removed: %v", name, err)
		}
	}
}

func TestSaveTabFiles_HiddenUmpFilesPreserved(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	modelID := "tmpHiddenUmp"
	dir := store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}

	// Compiler-generated hidden .ump files should not be cleaned up
	for _, name := range []string{"Model.ump", ".generate-java.ump"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("// generated"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	files := map[string]string{
		"Model.ump": "// code",
	}

	if err := store.SaveTabFiles(modelID, files, "Model.ump"); err != nil {
		t.Fatalf("SaveTabFiles: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, ".generate-java.ump")); err != nil {
		t.Errorf(".generate-java.ump should not be removed: %v", err)
	}
}

func TestSaveTabs_OmitsCodeFromJSON(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	modelID := "tmpTabsNoCode"
	dir := store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}

	tabs := &TabsData{
		ActiveTabID: "1",
		Tabs: []TabMeta{
			{ID: "1", Name: "Model.ump"},
			{ID: "2", Name: "Bar.ump"},
		},
	}

	if err := store.SaveTabs(modelID, tabs); err != nil {
		t.Fatal(err)
	}

	// Read raw JSON and verify no "code" key
	raw, err := os.ReadFile(filepath.Join(dir, "tabs.json"))
	if err != nil {
		t.Fatal(err)
	}

	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}

	var tabEntries []map[string]any
	if err := json.Unmarshal(parsed["tabs"], &tabEntries); err != nil {
		t.Fatal(err)
	}

	for _, entry := range tabEntries {
		if _, hasCode := entry["code"]; hasCode {
			t.Errorf("tabs.json should not contain 'code' key, got: %v", entry)
		}
	}
}

func TestReadTabCode(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	modelID := "tmpReadCode"
	dir := store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}

	// Write tab files
	files := map[string]string{
		"Person.ump": "class Person { name; }",
	}
	if err := store.SaveTabFiles(modelID, files, "Model.ump"); err != nil {
		t.Fatal(err)
	}
	// Write Model.ump manually (simulating resolveModel)
	if err := os.WriteFile(filepath.Join(dir, "Model.ump"), []byte("class Foo {}"), 0644); err != nil {
		t.Fatal(err)
	}

	// ReadTabCode should return the file contents
	code, err := store.ReadTabCode(modelID, "Person.ump")
	if err != nil {
		t.Fatalf("ReadTabCode: %v", err)
	}
	if code != "class Person { name; }" {
		t.Errorf("got %q, want %q", code, "class Person { name; }")
	}

	code, err = store.ReadTabCode(modelID, "Model.ump")
	if err != nil {
		t.Fatalf("ReadTabCode: %v", err)
	}
	if code != "class Foo {}" {
		t.Errorf("got %q, want %q", code, "class Foo {}")
	}

	// Missing file should error
	_, err = store.ReadTabCode(modelID, "Missing.ump")
	if err == nil {
		t.Error("expected error for missing tab file")
	}
}

func TestSaveTabFiles_RejectsPathTraversal(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	modelID := "tmpTraversal"
	dir := store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Model.ump"), []byte("// main"), 0644); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"../evil", "../../etc/passwd", "sub/nested", "../Model"} {
		err := store.SaveTabFiles(modelID, map[string]string{
			"Model.ump": "// main",
			name:        "malicious content",
		}, "Model.ump")
		if err == nil {
			t.Errorf("SaveTabFiles should reject tab name %q", name)
		}
	}
}

func TestReadTabCode_RejectsPathTraversal(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	modelID := "tmpTraversal2"
	dir := store.ModelDir(modelID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"../evil", "../../etc/passwd", "sub/nested"} {
		_, err := store.ReadTabCode(modelID, name)
		if err == nil {
			t.Errorf("ReadTabCode should reject tab name %q", name)
		}
	}
}

func TestIsTemporary(t *testing.T) {
	tests := []struct {
		id   string
		want bool
	}{
		{"tmpabcdef1234", true},
		{"tmp", true},
		{"260405abcdef12", false},
		{"", false},
		{"permanent", false},
	}
	for _, tt := range tests {
		if got := IsTemporary(tt.id); got != tt.want {
			t.Errorf("IsTemporary(%q) = %v, want %v", tt.id, got, tt.want)
		}
	}
}

func TestPromote_TmpToPermanent(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	// Create a tmp model with some files
	m, err := store.Create("class Foo {}")
	if err != nil {
		t.Fatal(err)
	}
	if !IsTemporary(m.ID) {
		t.Fatalf("expected tmp prefix, got %q", m.ID)
	}

	// Write a tabs.json too
	if err := store.SaveTabs(m.ID, &TabsData{
		ActiveTabID: "t1",
		Tabs:        []TabMeta{{ID: "t1", Name: "Model.ump"}},
	}); err != nil {
		t.Fatal(err)
	}

	oldDir := store.ModelDir(m.ID)

	// Promote
	newID, err := store.Promote(m.ID)
	if err != nil {
		t.Fatalf("Promote: %v", err)
	}

	// New ID should not be temporary
	if IsTemporary(newID) {
		t.Errorf("promoted ID should not be temporary: %q", newID)
	}
	// New ID should start with YYMMDD (6 digits)
	if len(newID) < 6 {
		t.Fatalf("promoted ID too short: %q", newID)
	}
	for _, c := range newID[:6] {
		if c < '0' || c > '9' {
			t.Errorf("promoted ID prefix should be digits, got %q", newID[:6])
			break
		}
	}

	// Old directory should be gone
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Errorf("old directory should be removed after promote")
	}

	// New directory should exist with the model file
	newDir := store.ModelDir(newID)
	data, err := os.ReadFile(filepath.Join(newDir, "Model.ump"))
	if err != nil {
		t.Fatalf("read promoted model: %v", err)
	}
	if string(data) != "class Foo {}" {
		t.Errorf("promoted model code = %q, want %q", string(data), "class Foo {}")
	}

	// tabs.json should also be preserved
	tabs, err := store.LoadTabs(newID)
	if err != nil {
		t.Fatalf("load promoted tabs: %v", err)
	}
	if tabs == nil || len(tabs.Tabs) != 1 {
		t.Errorf("promoted tabs not preserved")
	}
}

func TestPromote_AlreadyPermanent(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	// Manually create a permanent-style directory
	permID := "260405testmodel"
	dir := filepath.Join(root, permID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Model.ump"), []byte("class Bar {}"), 0644); err != nil {
		t.Fatal(err)
	}

	// Promote should be a no-op
	result, err := store.Promote(permID)
	if err != nil {
		t.Fatalf("Promote permanent: %v", err)
	}
	if result != permID {
		t.Errorf("Promote permanent = %q, want %q (no-op)", result, permID)
	}
}

func TestPromote_NonExistent(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.Promote("tmpnonexistent")
	if err == nil {
		t.Error("expected error promoting non-existent model")
	}
}

func TestLegacyDiscoveryRespectsModernModels(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	m, err := store.Create("class Modern {}")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.ModelDir(m.ID), "Other.ump"), []byte("class Other {}"), 0644); err != nil {
		t.Fatal(err)
	}
	tabs, err := store.LoadTabs(m.ID)
	if err != nil || tabs != nil {
		t.Fatalf("modern file must not be discovered as legacy: %+v, %v", tabs, err)
	}
	if err := store.SaveTabs(m.ID, &TabsData{ActiveTabID: "other", Tabs: []TabMeta{{ID: "other", Name: "Other.ump"}}}); err != nil {
		t.Fatal(err)
	}
	if got := store.ResolveEntryFile(m.ID); got != "Other.ump" {
		t.Fatalf("metadata did not win: %s", got)
	}
}
