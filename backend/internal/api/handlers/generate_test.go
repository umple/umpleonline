package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/config"
	"github.com/umple/umpleonline/backend/internal/model"
)

func newIntegrationGenerateHandler(t *testing.T) (*GenerateHandler, *model.Store) {
	t.Helper()

	store, err := model.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}

	jarPath := os.Getenv("UMPLE_SYNC_JAR")
	if jarPath == "" {
		jarPath = "/jars/umplesync.jar"
	}
	if _, err := os.Stat(jarPath); err != nil {
		t.Skipf("umplesync.jar not available: %v", err)
	}

	pool, err := compiler.NewPool(jarPath, reserveTCPPort(t))
	if err != nil {
		t.Fatalf("create compiler pool: %v", err)
	}
	t.Cleanup(pool.Shutdown)

	cfg := &config.Config{UmpleSyncJar: jarPath}
	return NewGenerateHandler(pool, store, cfg), store
}

func postGenerate(t *testing.T, handler *GenerateHandler, req GenerateRequest) GenerateResponse {
	t.Helper()

	body, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	httpReq := httptest.NewRequest(http.MethodPost, "/generate", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.Generate(rec, httpReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status %d:\n%s", rec.Code, rec.Body.String())
	}

	var resp GenerateResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func TestGenerateJavaClearsStaleSourcesBetweenModels(t *testing.T) {
	handler, store := newIntegrationGenerateHandler(t)

	first := postGenerate(t, handler, GenerateRequest{
		Code:     readExampleFixture(t, "2DShapes.ump"),
		Language: "Java",
	})
	if !strings.Contains(first.GeneratedOutput, "package Shapes.core;") {
		t.Fatalf("expected first generation to include Shapes.core package:\n%s", first.GeneratedOutput)
	}

	second := postGenerate(t, handler, GenerateRequest{
		Code:     readExampleFixture(t, "AccessControl2.ump"),
		Language: "Java",
		ModelID:  first.ModelID,
	})
	if !strings.Contains(second.GeneratedOutput, "package accessControlSystem;") {
		t.Fatalf("expected second generation to include accessControlSystem package:\n%s", second.GeneratedOutput)
	}
	if strings.Contains(second.GeneratedOutput, "package Shapes.core;") {
		t.Fatalf("second generation should not include stale Shapes.core output:\n%s", second.GeneratedOutput)
	}

	modelDir := store.ModelDir(second.ModelID)
	javaRoot := filepath.Join(modelDir, "Java") + string(os.PathSeparator)
	var stray []string
	filepath.WalkDir(modelDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if filepath.Ext(path) == ".java" && !strings.HasPrefix(path, javaRoot) {
			stray = append(stray, path)
		}
		return nil
	})
	if len(stray) > 0 {
		t.Fatalf("expected Java sources to stay inside %s, found stray files: %v", javaRoot, stray)
	}
}

func TestLockModelWorkspaceBlocksConcurrentAccessForExistingModels(t *testing.T) {
	store, err := model.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}

	m, err := store.Create("class Invoice {}")
	if err != nil {
		t.Fatalf("create model: %v", err)
	}

	pool := &compiler.Pool{}
	unlock := lockModelWorkspace(pool, store, m.ID)

	acquired := make(chan struct{})
	go func() {
		defer close(acquired)
		unlockSecond := lockModelWorkspace(pool, store, m.ID)
		unlockSecond()
	}()

	select {
	case <-acquired:
		t.Fatal("second lock should block until the first lock is released")
	case <-time.After(100 * time.Millisecond):
	}

	unlock()

	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("second lock did not acquire after the first lock was released")
	}
}

func TestGenerateLegacyModel(t *testing.T) {
	handler, store := newIntegrationGenerateHandler(t)
	id := "160101legacycompile"
	dir := store.ModelDir(id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	for name, code := range map[string]string{"model.ump": "use Other.ump;\nclass Legacy {}", "Other.ump": "class Other {}"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(code), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, code := range []string{"use Other.ump;\nclass Legacy {}", "use Other.ump;\nclass Legacy { String name; }"} {
		res := postGenerate(t, handler, GenerateRequest{
			ModelID: id, Code: code, Language: "Java", ActiveTabID: "main",
			Tabs: []apiTab{{ID: "main", Name: "model.ump", Code: code}, {ID: "Other.ump", Name: "Other.ump", Code: "class Other {}"}},
		})
		if !strings.Contains(res.GeneratedOutput, "class Legacy") || !strings.Contains(res.GeneratedOutput, "class Other") {
			t.Fatalf("legacy generation failed: %+v", res)
		}
		reopened, err := store.Get(id)
		if err != nil || !strings.Contains(reopened.Code, code) {
			t.Fatalf("reopen: %+v, %v", reopened, err)
		}
	}
}
