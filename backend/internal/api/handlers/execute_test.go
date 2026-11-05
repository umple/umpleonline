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

	"github.com/umple/umpleonline/backend/internal/execution"
)

func TestExecuteRejectsInvalidSnapshot(t *testing.T) {
	for _, tc := range []struct {
		name     string
		language string
		tabs     []apiTab
		active   string
	}{
		{name: "unsupported language", language: "Ruby"},
		{name: "path traversal", language: "Java", tabs: []apiTab{{ID: "main", Name: "../Main", Code: "class Main {}"}}, active: "main"},
		{name: "duplicate names", language: "Java", tabs: []apiTab{{ID: "main", Name: "Main"}, {ID: "other", Name: "Main.ump"}}, active: "main"},
		{name: "missing active tab", language: "Java", tabs: []apiTab{{ID: "other", Name: "Other"}}, active: "main"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(ExecuteRequest{Code: "class Main {}", Language: tc.language, Tabs: tc.tabs, ActiveTabID: tc.active})
			if err != nil {
				t.Fatal(err)
			}
			// Validation must complete before accessing a compiler or writing files.
			handler := &ExecuteHandler{}
			rec := httptest.NewRecorder()
			handler.Execute(rec, httptest.NewRequest(http.MethodPost, "/execute", bytes.NewReader(body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestExecuteGeneratesFromFreshTabs(t *testing.T) {
	generateHandler, store := newIntegrationGenerateHandler(t)
	var runs []execution.RunRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var run execution.RunRequest
		if err := json.NewDecoder(r.Body).Decode(&run); err != nil {
			t.Error(err)
		}
		runs = append(runs, run)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(execution.ExecuteResponse{Output: "executed"})
	}))
	defer server.Close()
	handler := NewExecuteHandler(generateHandler.pool, store, execution.NewProxy(server.URL))
	modelID := ""
	for _, message := range []string{"first", "edited"} {
		mainCode := "use Helper.ump;\nclass Main { public static void main(String [] args) { System.out.println(Helper.message()); } }"
		helperCode := "class Helper { public static String message() { return \"" + message + "\"; } }"
		body, err := json.Marshal(ExecuteRequest{
			Code: mainCode, Language: "Java", ModelID: modelID, ActiveTabID: "main",
			Tabs: []apiTab{{ID: "main", Name: "Main.ump", Code: mainCode}, {ID: "helper", Name: "Helper.ump", Code: helperCode}},
		})
		if err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		handler.Execute(rec, httptest.NewRequest(http.MethodPost, "/execute", bytes.NewReader(body)))
		if rec.Code != http.StatusOK {
			t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
		}
		var response ExecuteResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Output != "executed" || response.ModelID == "" {
			t.Fatalf("unexpected response: %+v", response)
		}
		if modelID != "" && response.ModelID != modelID {
			t.Fatal("execution did not reuse model")
		}
		modelID = response.ModelID
		dir := store.ModelDir(modelID)
		contents, err := os.ReadFile(filepath.Join(dir, "Helper.ump"))
		if err != nil || string(contents) != helperCode {
			t.Fatalf("stale helper source: %s, %v", contents, err)
		}
		found := false
		err = filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.Name() == "Helper.java" {
				code, err := os.ReadFile(path)
				if err != nil {
					return err
				}
				found = strings.Contains(string(code), "return \""+message+"\"")
			}
			return nil
		})
		if err != nil || !found {
			t.Fatalf("expected Java generated from current helper tab: found=%v, err=%v", found, err)
		}
	}
	if len(runs) != 2 || runs[0].Language != "Java" || runs[1].Language != "Java" {
		t.Fatalf("unexpected execution requests: %+v", runs)
	}
}
