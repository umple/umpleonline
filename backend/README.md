# Backend API

The backend is the Go API layer for UmpleOnline. It owns model persistence,
compiler orchestration, diagram/export generation, examples, tasks, status
reporting, AI provider proxying, and the bridge to the code execution service.

## Runtime Shape

```
Browser / frontend nginx
  |
  | /api/*
  v
Go backend (Chi)
  |
  | TCP
  v
umplesync.jar server

Go backend
  |
  | HTTP
  v
code-exec service

Go backend
  |
  | filesystem
  v
/data/models, /examples, /jars
```

The backend listens on `PORT`, defaulting to `3001`. In development Vite
proxies `/api/*` to it. In production the frontend nginx container proxies
`/api/*` to the backend container.

## Internal Architecture

- `cmd/server/main.go` loads configuration, initializes stores, starts the
  compiler pool, wires the router, and handles graceful shutdown.
- `internal/config` maps environment variables to runtime config.
- `internal/api/router.go` registers all HTTP routes under `/api`.
- `internal/api/handlers` contains request handlers for generation, diagrams,
  exports, execution, examples, models, CRUD helpers, tasks, health, and status.
- `internal/compiler` starts and supervises `umplesync.jar` as a long-running
  TCP server, sends compiler commands, and serializes writes per model.
- `internal/model` stores model directories, tab metadata, `.ump` tab files,
  generated assets, and temporary-model cleanup.
- `internal/task` stores task definitions and responses on disk.
- `internal/execution` proxies run requests to `code-exec`.

The backend uses filesystem storage by design. Model IDs map to directories
under `MODEL_STORE_PATH`, and multi-tab models are represented as `tabs.json`
plus one `.ump` file per tab.

## Main API Families

- `GET /api/health` and `GET /api/status` - service and dependency health.
- `POST /api/generate` - compile and generate a target output.
- `POST /api/sync` - apply text/diagram synchronization operations.
- `POST /api/diagram` and `POST /api/export` - diagram rendering and export.
- `POST /api/execute` - compile and run generated Java/Python through
  `code-exec`.
- `GET /api/models/{id}` and `POST /api/models/{id}/promote` - model loading
  and temporary-to-durable promotion.
- `GET /api/examples`, `GET /api/examples/{id}`, and
  `GET /api/examples/resolve` - example catalog and source loading.
- `POST /api/crud/schema` and `POST /api/crud/diagram` - CRUD model helpers.
- `POST /api/tasks` and related task response routes - task workflows.
- `/api/ai/*` - provider proxying for browser-origin AI calls.

## Compiler Lifecycle

`internal/compiler.Pool` starts:

```text
java -cp $UMPLE_SYNC_JAR cruise.umple.PlaygroundMain -server $UMPLE_PORT
```

Requests connect to that server over TCP and send the command format expected
by `umplesync.jar`. If the JVM exits or a TCP dial fails, the pool attempts a
restart. Per-model mutexes prevent concurrent writes to the same model
directory while compile/sync flows are active.

## How This Differs From The Original

Legacy UmpleOnline handled most backend work in PHP. The closest original
entry points are:

- `~/umple/umpleonline/umple.php` - rendered the page, interpreted URL
  parameters, loaded examples/models, and emitted runtime configuration.
- `~/umple/umpleonline/scripts/compiler.php` - handled AJAX actions for saving,
  loading, compiling, image/export generation, and task operations.
- `~/umple/umpleonline/scripts/compiler_config.php` - contained the DataStore
  abstraction and low-level socket calls to the compiler.

This backend keeps the compiler contract but changes the architecture:

- HTTP behavior is split into typed Go handlers instead of one large
  request-switching PHP script.
- Model storage is explicit Go code under `internal/model`, not PHP helper
  functions embedded in compiler configuration.
- Compiler process supervision lives in `internal/compiler.Pool`, with restart
  and per-model locking in one place.
- Example sources are fetched from the Umple library
  (`EXAMPLE_LIBRARY_URL`) on every request, falling back to the runtime cache
  (`EXAMPLE_CACHE_PATH`) and then the seeded files (`EXAMPLE_PATH`), instead of
  being assembled from legacy page/menu generation at runtime.
- Code execution is delegated to the separate `code-exec` service instead of
  being handled inside the same PHP endpoint family.
- Status and health are first-class JSON APIs rather than operational details
  hidden behind legacy script pages.

## Development

From the repo root:

```bash
make dev-backend
make logs-backend
make tidy
```

Focused Go checks should run from this folder:

```bash
go test ./...
go vet ./...
```

When adding Go dependencies in the Docker dev stack, run:

```bash
docker compose exec backend go mod tidy
```
