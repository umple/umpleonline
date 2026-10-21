package handlers

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/umple/umpleonline/backend/internal/config"
	"github.com/umple/umpleonline/backend/internal/model"
)

func TestBuildManifestFromBundledFiles(t *testing.T) {
	handler := newTestExampleHandler(t)

	manifest, err := handler.buildManifest()
	if err != nil {
		t.Fatalf("build manifest: %v", err)
	}

	if len(manifest.sets) == 0 {
		t.Fatal("expected at least one example set")
	}

	for _, set := range manifest.sets {
		if set.ID == "" {
			t.Fatal("expected each example set to expose an id")
		}
		if set.CategoryID == "" {
			t.Fatalf("expected set %q to expose a category id", set.ID)
		}
		if len(set.Examples) == 0 {
			t.Fatalf("expected set %q to contain examples", set.ID)
		}

		for _, example := range set.Examples {
			if example.ID == "" {
				t.Fatalf("expected example in set %q to expose a stable id", set.ID)
			}
			if example.Filename == "" {
				t.Fatalf("expected example %q to expose a filename", example.ID)
			}
			if _, ok := manifest.byID[example.ID]; !ok {
				t.Fatalf("expected example %q to be present in byID lookup", example.ID)
			}

			legacyKey := normalizeLegacyExample(example.Filename)
			if legacyKey == "" {
				t.Fatalf("expected example %q to produce a legacy lookup key", example.ID)
			}
			if got := manifest.byLegacyExample[legacyKey]; got != example.ID {
				t.Fatalf("expected legacy key %q to resolve to %q, got %q", legacyKey, example.ID, got)
			}
		}
	}
}

func TestGetExample(t *testing.T) {
	handler := newTestExampleHandler(t)

	manifest, err := handler.loadManifest()
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}

	layoutSet, layoutExample := mustFindExample(t, manifest, func(set ExampleSet, example ExampleEntry) bool {
		spec := manifest.byID[example.ID]
		code, err := handler.exampleCode(spec)
		if err != nil {
			t.Fatalf("read example code for %q: %v", example.ID, err)
		}
		return strings.Contains(code, modelDelimiter)
	})
	assertGetExample(t, handler, layoutExample.ID, func(resp ExampleResponse) {
		if resp.ID != layoutExample.ID {
			t.Fatalf("unexpected example id: %q", resp.ID)
		}
		if resp.Name != layoutExample.Name {
			t.Fatalf("unexpected example name: %q", resp.Name)
		}
		if resp.SetID != layoutSet.ID {
			t.Fatalf("unexpected set id: %q", resp.SetID)
		}
		if resp.DefaultCategoryID != layoutSet.CategoryID {
			t.Fatalf("unexpected default category id: %q", resp.DefaultCategoryID)
		}
		if resp.Code == "" {
			t.Fatal("expected example code to be returned")
		}
		if resp.ModelID == "" {
			t.Fatal("expected layout-backed example to pre-create a temp model")
		}
	})

	pathSet, pathExample := mustFindExample(t, manifest, func(set ExampleSet, example ExampleEntry) bool {
		return strings.Contains(example.Filename, "/")
	})
	assertGetExample(t, handler, pathExample.ID, func(resp ExampleResponse) {
		if resp.ID != pathExample.ID {
			t.Fatalf("unexpected example id: %q", resp.ID)
		}
		if resp.Name != pathExample.Name {
			t.Fatalf("unexpected example name: %q", resp.Name)
		}
		if resp.SetID != pathSet.ID {
			t.Fatalf("unexpected extra example set id: %q", resp.SetID)
		}
	})
}

func TestResolveExample(t *testing.T) {
	handler := newTestExampleHandler(t)
	manifest, err := handler.loadManifest()
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}

	rootSet, rootExample := mustFindExample(t, manifest, func(set ExampleSet, example ExampleEntry) bool {
		return !strings.Contains(example.Filename, "/")
	})
	req := httptest.NewRequest(http.MethodGet, "/api/examples/resolve?example="+normalizeLegacyExample(rootExample.Filename), nil)
	res := httptest.NewRecorder()
	handler.Resolve(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("resolve example status = %d, body = %s", res.Code, res.Body.String())
	}

	var resp ExampleResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resolve response: %v", err)
	}
	if resp.ID != rootExample.ID {
		t.Fatalf("unexpected resolved example id: %q", resp.ID)
	}
	if resp.Name != rootExample.Name {
		t.Fatalf("unexpected resolved example name: %q", resp.Name)
	}
	if resp.SetID != rootSet.ID {
		t.Fatalf("unexpected resolved set id: %q", resp.SetID)
	}

	pathSet, pathExample := mustFindExample(t, manifest, func(set ExampleSet, example ExampleEntry) bool {
		return strings.Contains(example.Filename, "/")
	})
	req = httptest.NewRequest(http.MethodGet, "/api/examples/resolve?example="+normalizeLegacyExample(pathExample.Filename), nil)
	res = httptest.NewRecorder()
	handler.Resolve(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("resolve path example status = %d, body = %s", res.Code, res.Body.String())
	}

	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode path resolve response: %v", err)
	}
	if resp.ID != pathExample.ID {
		t.Fatalf("unexpected path resolved example id: %q", resp.ID)
	}
	if resp.Name != pathExample.Name {
		t.Fatalf("unexpected path resolved example name: %q", resp.Name)
	}
	if resp.SetID != pathSet.ID {
		t.Fatalf("unexpected path resolved set id: %q", resp.SetID)
	}
}

func TestLoadManifestReflectsUpdatedManifestFile(t *testing.T) {
	handler := newTestExampleHandler(t)

	firstManifest, err := handler.loadManifest()
	if err != nil {
		t.Fatalf("load initial manifest: %v", err)
	}
	if firstManifest.sets[0].Label != "Class Diagrams" {
		t.Fatalf("unexpected initial label: %q", firstManifest.sets[0].Label)
	}

	updated := exampleManifestFile{
		Sets: []exampleManifestSet{
			{
					ID:         ExampleSet1,
				Label:      "Updated Class Diagrams",
				CategoryID: ExampleCategoryClass,
				Examples: []exampleManifestEntry{
					{Filename: "2DShapes.ump", Label: "2DShapes *"},
				},
			},
		},
	}
	writeJSONFixture(t, filepath.Join(handler.examplePath, exampleManifestFileName), updated)

	secondManifest, err := handler.loadManifest()
	if err != nil {
		t.Fatalf("reload manifest: %v", err)
	}
	if secondManifest.sets[0].Label != "Updated Class Diagrams" {
		t.Fatalf("expected updated label after manifest rewrite, got %q", secondManifest.sets[0].Label)
	}
	if got := len(secondManifest.sets[0].Examples); got != 1 {
		t.Fatalf("expected updated manifest example count, got %d", got)
	}
}

// Example sources come from the Umple library rather than this repository, so
// the manifest is checked for shape and for paths the handler will accept.
func TestBundledManifestUsesSafeExamplePaths(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(bundledExamplesRoot(), exampleManifestFileName))
	if err != nil {
		t.Fatalf("read bundled manifest: %v", err)
	}

	var manifest exampleManifestFile
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode bundled manifest: %v", err)
	}

	count := 0
	for _, set := range manifest.Sets {
		if set.ID == "" || set.Label == "" || set.CategoryID == "" {
			t.Fatalf("manifest set %q is missing its menu metadata", set.ID)
		}

		for _, example := range set.Examples {
			count++
			// The same example may appear in more than one set, so source paths
			// are deliberately not required to be unique.
			if !strings.HasSuffix(example.Filename, ".ump") {
				t.Fatalf("manifest example %q is not a .ump source", example.Filename)
			}
			if !safeExamplePath(example.Filename) {
				t.Fatalf("manifest example %q is not a safe library path", example.Filename)
			}
		}
	}

	if count == 0 {
		t.Fatal("expected bundled manifest to reference at least one example")
	}
}

func TestResolveBundledPathBasedLegacyExample(t *testing.T) {
	store, err := model.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create model store: %v", err)
	}

	handler := NewExampleHandler(&config.Config{ExamplePath: bundledExamplesRoot()}, store)
	manifest, err := handler.loadManifest()
	if err != nil {
		t.Fatalf("load bundled manifest: %v", err)
	}

	_, example := mustFindExample(t, manifest, func(set ExampleSet, example ExampleEntry) bool {
		return strings.Contains(example.Filename, "/")
	})

	legacyExample := normalizeLegacyExample(example.Filename)
	req := httptest.NewRequest(http.MethodGet, "/api/examples/resolve?example="+legacyExample, nil)
	res := httptest.NewRecorder()
	handler.Resolve(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("resolve bundled path example status = %d, body = %s", res.Code, res.Body.String())
	}

	var resp ExampleResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode bundled resolve response: %v", err)
	}
	if resp.ID == "" {
		t.Fatal("expected bundled resolve response to include an example id")
	}
	if _, ok := manifest.byID[resp.ID]; !ok {
		t.Fatalf("expected bundled resolve response id %q to exist in manifest", resp.ID)
	}
}

func TestResolveLibraryExampleFromUpstream(t *testing.T) {
	requested := make([]string, 0, 2)
	server := newTestLibraryServer(t, &requested, map[string]string{
		"/manualexamples/BasicStateMachines1.ump": "class GarageDoor {}",
		"/VendingMachine.ump":                     "class VendingMachine {}",
	})
	handler := newTestLibraryExampleHandler(t, server.URL)

	for _, example := range []struct {
		name string
		code string
	}{
		{name: "manualexamples/BasicStateMachines1", code: "class GarageDoor {}"},
		{name: "VendingMachine", code: "class VendingMachine {}"},
	} {
		res := resolveTestExample(t, handler, example.name)
		if res.Code != http.StatusOK {
			t.Fatalf("resolve %q status = %d, body = %s", example.name, res.Code, res.Body.String())
		}

		var resp ExampleResponse
		if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode resolve response: %v", err)
		}
		if resp.Code != example.code {
			t.Fatalf("unexpected library example code: %q", resp.Code)
		}
		if resp.Name != path.Base(example.name) {
			t.Fatalf("unexpected library example name: %q", resp.Name)
		}
		if resp.SetID != "" || resp.DefaultCategoryID != "" {
			t.Fatalf("expected library example to carry no set or category, got %q and %q", resp.SetID, resp.DefaultCategoryID)
		}
	}

	if len(requested) != 2 {
		t.Fatalf("expected two library requests, got %v", requested)
	}
}

func TestResolveManifestExamplePrefersLibrary(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{
		"/2DShapes.ump": "class Upstream {}",
	})
	handler := newTestLibraryExampleHandler(t, server.URL)

	resp := resolveExampleResponse(t, handler, "2DShapes")
	if resp.Code != "class Upstream {}" {
		t.Fatalf("expected the library copy to be served, got %q", resp.Code)
	}
	if resp.Label != "2DShapes *" || resp.Name != "2DShapes" {
		t.Fatalf("unexpected manifest metadata: name = %q, label = %q", resp.Name, resp.Label)
	}
	if resp.SetID != ExampleSet1 || resp.DefaultCategoryID != ExampleCategoryClass {
		t.Fatalf("expected manifest set and category, got %q and %q", resp.SetID, resp.DefaultCategoryID)
	}
	if resp.ID == "" {
		t.Fatal("expected the manifest example id to be preserved")
	}
	if len(requested) != 1 {
		t.Fatalf("expected one library request for a manifest example, got %v", requested)
	}
	if code := readCachedExample(t, handler, "2DShapes.ump"); code != "class Upstream {}" {
		t.Fatalf("expected the fetched example to be cached, got %q", code)
	}
	assertCacheEntries(t, handler, "2DShapes.ump")
}

func TestResolveManifestExampleUsesCacheWhenLibraryUnreachable(t *testing.T) {
	requested := make([]string, 0, 2)
	server := newTestLibraryServer(t, &requested, map[string]string{
		"/2DShapes.ump": "class Upstream {}",
	})
	handler := newTestLibraryExampleHandler(t, server.URL)

	if resp := resolveExampleResponse(t, handler, "2DShapes"); resp.Code != "class Upstream {}" {
		t.Fatalf("expected the library copy to be served, got %q", resp.Code)
	}

	server.Close()

	resp := resolveExampleResponse(t, handler, "2DShapes")
	if resp.Code != "class Upstream {}" {
		t.Fatalf("expected the cached copy to be served, got %q", resp.Code)
	}
	if resp.Label != "2DShapes *" {
		t.Fatalf("unexpected manifest label: %q", resp.Label)
	}
}

func TestResolveLibraryExampleReplacesStaleCache(t *testing.T) {
	requested := make([]string, 0, 2)
	files := map[string]string{"/manualexamples/Garage.ump": "class Garage {}"}
	server := newTestLibraryServer(t, &requested, files)
	handler := newTestLibraryExampleHandler(t, server.URL)

	if resp := resolveExampleResponse(t, handler, "manualexamples/Garage"); resp.Code != "class Garage {}" {
		t.Fatalf("unexpected first response: %q", resp.Code)
	}

	files["/manualexamples/Garage.ump"] = "class GarageDoor {}"

	if resp := resolveExampleResponse(t, handler, "manualexamples/Garage"); resp.Code != "class GarageDoor {}" {
		t.Fatalf("expected the updated library copy, got %q", resp.Code)
	}
	if code := readCachedExample(t, handler, "manualexamples/Garage.ump"); code != "class GarageDoor {}" {
		t.Fatalf("expected the cache to be refreshed, got %q", code)
	}

	server.Close()

	if resp := resolveExampleResponse(t, handler, "manualexamples/Garage"); resp.Code != "class GarageDoor {}" {
		t.Fatalf("expected the refreshed cache to be served, got %q", resp.Code)
	}
}

func TestResolveManifestExampleUsesCacheWithoutLibraryURL(t *testing.T) {
	handler := newTestLibraryExampleHandler(t, "")
	if err := os.MkdirAll(handler.cachePath, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	writeTextFixture(t, filepath.Join(handler.cachePath, "BankingSystemA.ump"), "class Cached {}")

	resp := resolveExampleResponse(t, handler, "BankingSystemA")
	if resp.Code != "class Cached {}" {
		t.Fatalf("expected the cached copy to be served, got %q", resp.Code)
	}
	if resp.SetID != ExampleSet1 {
		t.Fatalf("expected the manifest set to be preserved, got %q", resp.SetID)
	}
}

func TestResolveManifestExampleFallsBackToSeededFile(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{})
	server.Close()

	handler := newTestLibraryExampleHandler(t, server.URL)

	resp := resolveExampleResponse(t, handler, "BankingSystemA")
	if resp.Code != "class Account {}" {
		t.Fatalf("expected the seeded example to be served, got %q", resp.Code)
	}
	if resp.SetID != ExampleSet1 {
		t.Fatalf("expected the manifest set to be preserved, got %q", resp.SetID)
	}
	if _, err := os.Stat(handler.cachePath); !os.IsNotExist(err) {
		t.Fatalf("expected no cache directory after a failed fetch, got %v", err)
	}
}

func TestResolveManifestExampleMissingEverywhere(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{})
	handler := newTestLibraryExampleHandler(t, server.URL)

	if err := os.Remove(filepath.Join(handler.examplePath, "BankingSystemA.ump")); err != nil {
		t.Fatalf("remove seeded example: %v", err)
	}

	res := resolveTestExample(t, handler, "BankingSystemA")
	if res.Code != http.StatusNotFound {
		t.Fatalf("resolve unavailable example status = %d, body = %s", res.Code, res.Body.String())
	}
}

func TestResolveLibraryExampleSurvivesCacheWriteFailure(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{
		"/manualexamples/Garage.ump": "class Garage {}",
	})
	handler := newTestLibraryExampleHandler(t, server.URL)

	// A regular file where the cache directory belongs makes every cache write fail.
	writeTextFixture(t, handler.cachePath, "not a directory")

	if resp := resolveExampleResponse(t, handler, "manualexamples/Garage"); resp.Code != "class Garage {}" {
		t.Fatalf("expected the library copy to be served, got %q", resp.Code)
	}
}

func TestResolveUnsafeManifestExampleWritesNoCacheFile(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{})
	handler := newTestLibraryExampleHandler(t, server.URL)

	root := t.TempDir()
	writeJSONFixture(t, filepath.Join(root, exampleManifestFileName), exampleManifestFile{
		Sets: []exampleManifestSet{{
			ID:         ExampleSet1,
			Label:      "Class Diagrams",
			CategoryID: ExampleCategoryClass,
			Examples:   []exampleManifestEntry{{Filename: "../escaped.ump", Label: "Escaped"}},
		}},
	})
	handler.examplePath = root

	// A readable file at the escaped location must not be served either.
	writeTextFixture(t, filepath.Join(filepath.Dir(root), "escaped.ump"), "class Escaped {}")

	res := resolveTestExample(t, handler, "../escaped")
	if res.Code != http.StatusNotFound {
		t.Fatalf("resolve unsafe manifest path status = %d, body = %s", res.Code, res.Body.String())
	}
	if strings.Contains(res.Body.String(), "Escaped") {
		t.Fatalf("expected no file outside the example root to be read, got %s", res.Body.String())
	}
	if len(requested) != 0 {
		t.Fatalf("expected no library request for an unsafe manifest path, got %v", requested)
	}
	assertCacheEntries(t, handler)
}

func TestResolveLibraryExampleMissingUpstream(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{})
	handler := newTestLibraryExampleHandler(t, server.URL)

	res := resolveTestExample(t, handler, "manualexamples/NoSuchExample")
	if res.Code != http.StatusNotFound {
		t.Fatalf("resolve missing example status = %d, body = %s", res.Code, res.Body.String())
	}
	if len(requested) != 1 {
		t.Fatalf("expected one library request, got %v", requested)
	}
}

func TestResolveRejectsUnsafeLibraryExamplePaths(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{})
	handler := newTestLibraryExampleHandler(t, server.URL)

	for _, example := range []string{
		"../../etc/passwd",
		"..",
		"manualexamples/../../../etc/passwd",
		"//etc/passwd",
		"manualexamples//BasicStateMachines1",
		"./BasicStateMachines1",
		"manualexamples/Basic State Machines1",
		"https://example.com/Evil",
		"manualexamples/Basic\\StateMachines1",
	} {
		res := resolveTestExample(t, handler, example)
		if res.Code != http.StatusNotFound {
			t.Fatalf("resolve %q status = %d, body = %s", example, res.Code, res.Body.String())
		}
	}

	if len(requested) != 0 {
		t.Fatalf("expected no library requests for unsafe paths, got %v", requested)
	}
}

func TestResolveLibraryExampleRejectsOversizedResponse(t *testing.T) {
	requested := make([]string, 0, 1)
	// A body this large is sent chunked, so the limit cannot rely on Content-Length.
	server := newTestLibraryServer(t, &requested, map[string]string{
		"/manualexamples/Huge.ump": strings.Repeat("a", maxLibraryExampleBytes+1),
	})
	handler := newTestLibraryExampleHandler(t, server.URL)

	res := resolveTestExample(t, handler, "manualexamples/Huge")
	if res.Code != http.StatusNotFound {
		t.Fatalf("resolve oversized example status = %d, body = %s", res.Code, res.Body.String())
	}
	assertCacheEntries(t, handler)
}

func TestResolveLibraryExampleDoesNotFollowRedirects(t *testing.T) {
	followed := make([]string, 0, 1)
	target := newTestLibraryServer(t, &followed, map[string]string{
		"/extraExamples1/Redirected.ump": "class Redirected {}",
	})

	library := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+r.URL.Path, http.StatusFound)
	}))
	t.Cleanup(library.Close)

	handler := newTestLibraryExampleHandler(t, library.URL)
	writeTextFixture(t, filepath.Join(handler.examplePath, "extraExamples1", "Redirected.ump"), "class Bundled {}")

	res := resolveTestExample(t, handler, "extraExamples1/Redirected")
	if res.Code != http.StatusOK {
		t.Fatalf("resolve redirected example status = %d, body = %s", res.Code, res.Body.String())
	}

	var resp ExampleResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resolve response: %v", err)
	}
	if resp.Code != "class Bundled {}" {
		t.Fatalf("expected the bundled copy to be served, got %q", resp.Code)
	}
	if len(followed) != 0 {
		t.Fatalf("expected the redirect target to receive no requests, got %v", followed)
	}
}

func TestResolveLibraryExampleFallsBackToBundledCopy(t *testing.T) {
	requested := make([]string, 0, 1)
	server := newTestLibraryServer(t, &requested, map[string]string{})
	server.Close()

	handler := newTestLibraryExampleHandler(t, server.URL)
	writeTextFixture(t, filepath.Join(handler.examplePath, "extraExamples1", "Unlisted.ump"), "class Unlisted {}")

	res := resolveTestExample(t, handler, "extraExamples1/Unlisted")
	if res.Code != http.StatusOK {
		t.Fatalf("resolve unreachable library example status = %d, body = %s", res.Code, res.Body.String())
	}

	var resp ExampleResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resolve response: %v", err)
	}
	if resp.Code != "class Unlisted {}" {
		t.Fatalf("expected the bundled copy to be served, got %q", resp.Code)
	}
}

func newTestExampleHandler(t *testing.T) *ExampleHandler {
	t.Helper()

	store, err := model.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create model store: %v", err)
	}

	exampleRoot := newTestExampleRoot(t)
	cfg := &config.Config{
		ExamplePath: exampleRoot,
	}
	return NewExampleHandler(cfg, store)
}

func newTestExampleRoot(t *testing.T) string {
	t.Helper()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "extraExamples1"), 0o755); err != nil {
		t.Fatalf("create extra examples dir: %v", err)
	}

	manifest := exampleManifestFile{
		Sets: []exampleManifestSet{
			{
					ID:         ExampleSet1,
				Label:      "Class Diagrams",
				CategoryID: ExampleCategoryClass,
				Examples: []exampleManifestEntry{
					{Filename: "2DShapes.ump", Label: "2DShapes *"},
					{Filename: "BankingSystemA.ump", Label: "Banking System A"},
				},
			},
			{
					ID:         ExampleSet2,
				Label:      "Extra Class Diagrams",
				CategoryID: ExampleCategoryClass,
				Examples: []exampleManifestEntry{
					{Filename: "extraExamples1/ATOM.ecore.ump", Label: "ATOM Web Syndication"},
				},
			},
			{
					ID:         ExampleSet3,
				Label:      "State Machines",
				CategoryID: ExampleCategoryState,
				Examples: []exampleManifestEntry{
					{Filename: "DigitalWatchFlat.ump", Label: "Digital Watch (Flat) *"},
				},
			},
			{
					ID:         ExampleSet4,
					Label:      "Feature Diagrams",
				CategoryID: ExampleCategoryFeature,
				Examples: []exampleManifestEntry{
					{Filename: "BerkeleyDB_SPL.ump", Label: "BerkeleyDB SPL"},
				},
			},
			{
					ID:         ExampleSet5,
				Label:      "Composite Structure",
				CategoryID: ExampleCategoryStructure,
				Examples: []exampleManifestEntry{
					{Filename: "PingPong.ump", Label: "Ping Pong"},
				},
			},
		},
	}

	writeJSONFixture(t, filepath.Join(root, exampleManifestFileName), manifest)
	writeTextFixture(t, filepath.Join(root, "2DShapes.ump"), "class Shape {}\n\n"+modelDelimiter+"\nclass Shape {\n  position 1 2 3 4;\n}\n")
	writeTextFixture(t, filepath.Join(root, "BankingSystemA.ump"), "class Account {}")
	writeTextFixture(t, filepath.Join(root, "extraExamples1", "ATOM.ecore.ump"), "class Atom {}")
	writeTextFixture(t, filepath.Join(root, "DigitalWatchFlat.ump"), "class Watch {}")
	writeTextFixture(t, filepath.Join(root, "BerkeleyDB_SPL.ump"), "class FeatureFlag {}")
	writeTextFixture(t, filepath.Join(root, "PingPong.ump"), "class Ping {}")

	return root
}

func newTestLibraryExampleHandler(t *testing.T, libraryURL string) *ExampleHandler {
	t.Helper()

	store, err := model.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create model store: %v", err)
	}

	cfg := &config.Config{
		ExamplePath:      newTestExampleRoot(t),
		ExampleLibrary:   libraryURL,
		ExampleCachePath: filepath.Join(t.TempDir(), "cache"),
	}
	return NewExampleHandler(cfg, store)
}

func newTestLibraryServer(t *testing.T, requested *[]string, files map[string]string) *httptest.Server {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*requested = append(*requested, r.URL.Path)
		code, ok := files[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Write([]byte(code))
	}))
	t.Cleanup(server.Close)
	return server
}

func resolveTestExample(t *testing.T, handler *ExampleHandler, example string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/api/examples/resolve?example="+url.QueryEscape(example), nil)
	res := httptest.NewRecorder()
	handler.Resolve(res, req)
	return res
}

func resolveExampleResponse(t *testing.T, handler *ExampleHandler, example string) ExampleResponse {
	t.Helper()

	res := resolveTestExample(t, handler, example)
	if res.Code != http.StatusOK {
		t.Fatalf("resolve %q status = %d, body = %s", example, res.Code, res.Body.String())
	}

	var resp ExampleResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resolve response: %v", err)
	}
	return resp
}

// assertCacheEntries checks the cache holds exactly the expected examples, so
// that a rejected download leaves neither a truncated file nor a temporary one.
func assertCacheEntries(t *testing.T, handler *ExampleHandler, want ...string) {
	t.Helper()

	found := make([]string, 0, len(want))
	err := filepath.WalkDir(handler.cachePath, func(current string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		relative, err := filepath.Rel(handler.cachePath, current)
		if err != nil {
			return err
		}
		found = append(found, filepath.ToSlash(relative))
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		t.Fatalf("walk cache: %v", err)
	}

	if strings.Join(found, ",") != strings.Join(want, ",") {
		t.Fatalf("cache contains %v, want %v", found, want)
	}
}

func readCachedExample(t *testing.T, handler *ExampleHandler, sourcePath string) string {
	t.Helper()

	data, err := os.ReadFile(filepath.Join(handler.cachePath, filepath.FromSlash(sourcePath)))
	if err != nil {
		t.Fatalf("read cached example: %v", err)
	}
	return string(data)
}

func writeJSONFixture(t *testing.T, target string, value any) {
	t.Helper()

	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		t.Fatalf("write json fixture: %v", err)
	}
}

func writeTextFixture(t *testing.T, target, value string) {
	t.Helper()

	if err := os.WriteFile(target, []byte(value), 0o644); err != nil {
		t.Fatalf("write text fixture: %v", err)
	}
}

func assertGetExample(t *testing.T, handler *ExampleHandler, id string, check func(ExampleResponse)) {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/api/examples/"+id, nil)
	req = withExampleRouteID(req, id)
	res := httptest.NewRecorder()
	handler.Get(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("get example status = %d, body = %s", res.Code, res.Body.String())
	}

	var resp ExampleResponse
	if err := json.Unmarshal(res.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	check(resp)
}

func mustFindExample(
	t *testing.T,
	manifest *exampleManifest,
	match func(ExampleSet, ExampleEntry) bool,
) (ExampleSet, ExampleEntry) {
	t.Helper()

	for _, set := range manifest.sets {
		for _, example := range set.Examples {
			if match(set, example) {
				return set, example
			}
		}
	}

	t.Fatal("expected to find matching example")
	return ExampleSet{}, ExampleEntry{}
}

func withExampleRouteID(req *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func bundledExamplesRoot() string {
	return filepath.Join("..", "..", "..", "..", "examples")
}
