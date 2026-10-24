package compiler

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServerCommandUsesConfiguredWorkDir(t *testing.T) {
	workDir := filepath.Join(t.TempDir(), "compiler")
	pool := &Pool{
		jarPath: "/tmp/umplesync.jar",
		port:    5555,
		workDir: workDir,
	}

	cmd := pool.serverCommand()

	if cmd.Dir != workDir {
		t.Fatalf("expected compiler server cwd %q, got %q", workDir, cmd.Dir)
	}
}

func TestPrepareWorkDirPreservesHistoricalCommandCount(t *testing.T) {
	workDir := filepath.Join(t.TempDir(), "compiler")
	if err := os.MkdirAll(filepath.Join(workDir, compilerTXLDir), 0755); err != nil {
		t.Fatalf("mkdir txl dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, compilerVersionFilename), []byte("@UMPLE_VERSION@"), 0644); err != nil {
		t.Fatalf("write version file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, compilerCommandCountFilename), []byte("1"), 0644); err != nil {
		t.Fatalf("write command count file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "keep.txt"), []byte("keep"), 0644); err != nil {
		t.Fatalf("write keep file: %v", err)
	}

	pool := &Pool{workDir: workDir}
	if err := pool.prepareWorkDir(); err != nil {
		t.Fatalf("prepare work dir: %v", err)
	}

	for _, name := range []string{
		compilerVersionFilename,
		compilerTXLDir,
	} {
		if _, err := os.Stat(filepath.Join(workDir, name)); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be removed, stat err=%v", name, err)
		}
	}

	count, err := os.ReadFile(filepath.Join(workDir, compilerCommandCountFilename))
	if err != nil || string(count) != "1" {
		t.Fatalf("historical command count was lost: %q, err=%v", count, err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "keep.txt")); err != nil {
		t.Fatalf("expected keep.txt to remain: %v", err)
	}
}
