# Contributing to UmpleOnline

This guide walks you through everything you need to set up the project, make changes, test them, and submit a pull request. No prior experience with the specific tools is assumed — follow the steps in order and you'll be up and running.

## Table of Contents

- [Environment Setup](#environment-setup)
  - [Prerequisites](#prerequisites)
  - [First-Time Setup](#first-time-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Making Changes](#making-changes)
- [Running Tests](#running-tests)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Troubleshooting](#troubleshooting)
- [AI Agent Tests](#ai-agent-tests)

---


> [!TIP]
> ### Quick AI Setup
> ```bash
> git clone https://github.com/umple/umpleonline.git && \
>   cd umpleonline
> ```
> **Copy this prompt to your AI for quick setup:**
> ```
> Help me setup the development env for this project, please follow the guidance
> in: https://github.com/umple/umpleonline/blob/master/CONTRIBUTING.md#environment-setup
>
> After setup, verify it works: run `make dev`, wait for Vite to print a local
> URL, then curl http://localhost:3200 to confirm the frontend returns HTML, and
> curl http://localhost:3200/api/health to confirm the backend is healthy.
> ```

## Environment Setup

### Prerequisites

You need two tools installed on your machine before you begin. Both are free and work on macOS, Linux, and Windows (via WSL).

#### 1. Docker

Docker runs the backend services in containers so you don't need to install Go, Java, or Graphviz on your machine.

- **Install (Linux/WSL):** `curl -fsSL https://get.docker.com | sh`
- **Install (macOS):** `brew install --cask docker` (requires [Homebrew](https://brew.sh/)), then open Docker from Applications once to finish setup
- **Verify:** `docker --version` should print a version number
- **Also verify Docker Compose:** `docker compose version` (note: no hyphen)

> **Linux note:** After installing, you may need to add your user to the `docker` group so you can run Docker without `sudo`:
> ```bash
> sudo usermod -aG docker $USER
> ```
> Then **log out and log back in** for the group change to take effect.

> **Windows users:** Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and ensure WSL 2 integration is enabled in Docker Desktop settings.

#### 2. Bun

Bun is the JavaScript runtime and package manager we use for the frontend (similar to Node.js + npm, but faster).

- **Install:** `curl -fsSL https://bun.sh/install | bash` (then restart your terminal)
- **Verify:** `bun --version`

### First-Time Setup

Run these commands in order. Each one is explained below.

```bash
# 1. Clone the repository if not done
git clone https://github.com/umple/umpleonline.git && \
  cd umpleonline

# 2. Download the Umple compiler JAR
make fetch-jar

# 3. Install frontend dependencies
make install

# 4. Start everything
make dev
```

**What each step does:**

1. **`git clone`** — Downloads the repository to your machine.
2. **`make fetch-jar`** — Downloads the latest UmpleOnline-hosted `umplesync.jar` (the Umple compiler) into the `jars/` directory and records its SHA256 digest. The backend needs this to compile Umple code.
3. **`make install`** — Runs `bun install` in the `frontend/` directory to download all JavaScript/TypeScript dependencies.
4. **`make dev`** — Starts the backend services in Docker, then starts the frontend dev server. You'll see Vite output in your terminal.

Once you see Vite's output with a local URL, open **[http://localhost:3200](http://localhost:3200)** in your browser.

> **Tip:** The `make dev` command occupies your terminal (the frontend dev server runs in the foreground). To stop it, press `Ctrl+C`. The backend Docker containers will keep running in the background — stop them with `make down`.

---

## Project Structure

```
umpleonline/
├── frontend/           # React/TypeScript frontend (Vite, CodeMirror, ReactFlow)
├── backend/            # Go API server (communicates with umplesync.jar + Graphviz)
├── code-exec/          # Node.js sandboxed code runner
├── examples/           # Example menu metadata; .ump seed (downloaded via make fetch-examples, gitignored)
├── jars/               # umplesync.jar and digest (downloaded via make fetch-jar, gitignored)
├── data/               # Runtime data (models, temp files)
├── .github/workflows/  # CI/CD pipelines
├── Makefile            # All dev commands
└── AGENTS.md           # Detailed dev reference (AI agents & humans)
```

---

## Development Workflow

### How hot reload works

Once `make dev` is running, you rarely need to restart anything:

- **Frontend changes** (anything in `frontend/src/`): Saved files are reflected in the browser instantly via Vite's Hot Module Replacement (HMR). No reload needed.
- **Backend changes** (anything in `backend/`): The Go backend runs with [Air](https://github.com/air-verse/air), a hot-reloader for Go. When you save a `.go` file, Air detects the change and rebuilds automatically (~1-2 seconds).

### When you DO need to restart

| What changed | What to do |
|--------------|------------|
| `frontend/package.json` (added a new dependency) | Run `bun install` from the `frontend/` directory |
| `docker-compose.yml` or a `Dockerfile` | Run `docker compose up -d --build` |
| New Go dependency | Run `docker compose exec backend go mod tidy` |

### Stopping the dev environment

```bash
# Stop the frontend dev server: Ctrl+C in the terminal where make dev is running
# Stop the backend Docker containers:
make down
```

### Useful commands while developing

| Command | What it does |
|---------|--------------|
| `make dev` | Start everything (backend Docker + frontend Vite) |
| `make dev-backend` | Start only the backend in Docker |
| `make dev-frontend` | Start only the frontend Vite server |
| `make down` | Stop all Docker containers |
| `make logs` | Show live logs from all services |
| `make logs-backend` | Show live logs from the backend only |
| `make clean` | Stop everything and delete temp model data |
| `make check` | Run the full CI validation suite locally |

---

## Making Changes

### 1. Create a branch

Always work on a branch, never directly on `master`.

```bash
git checkout master          # Start from the latest master
git pull                     # Make sure you have the latest changes
git checkout -b issue#42_fix-diagram-zoom   # Create and switch to a new branch
```

Branch naming convention: `issue#<number>_<short-description>` (e.g. `issue#42_fix-diagram-zoom`).

### 2. Make your changes

Edit files in your editor of choice. The dev server will pick up your changes automatically (see [hot reload](#how-hot-reload-works) above).

### 3. Check your work

Before committing, run the same checks that CI will run:

```bash
make check
```

This runs TypeScript type checking, the frontend build, Playwright E2E tests, and Go vet/build. **If `make check` passes locally, CI will pass too.**

### 4. Commit your changes

```bash
git add frontend/src/components/MyComponent.tsx   # Stage specific files
git commit -m "Add zoom controls to diagram panel"
```

> **Tip:** Stage specific files by name rather than using `git add .`, which can accidentally include files you didn't mean to commit.

---

## Running Tests

### Playwright E2E tests (primary test suite)

Playwright tests simulate a real user interacting with the app in a browser. They live in `frontend/tests/e2e/`.

```bash
# Run all mocked E2E tests (fast, no backend needed)
make test-e2e

# Run E2E tests against the live backend (requires make dev to be running)
make test-e2e-live

# Open the Playwright UI for interactive debugging (very helpful!)
make test-e2e-ui
```

**When to use which:**

- **`make test-e2e`** — Run this before every commit. These tests mock all API responses so they're fast and don't require the backend. This is what CI runs.
- **`make test-e2e-live`** — Run this when you've changed something that involves the backend (e.g., compilation, code execution). You need `make dev` running first.
- **`make test-e2e-ui`** — Use this when a test is failing and you want to see what's happening. It opens a visual debugger where you can step through the test and see the browser.

### Unit tests (Vitest)

```bash
cd frontend && bun run vitest run
```

### Full CI check

```bash
make check
```

This is the single command you should run before pushing. It runs:
1. `bun install --frozen-lockfile` (verify deps are clean)
2. TypeScript type checking (`tsc`)
3. Frontend production build
4. Playwright E2E smoke tests
5. Go module download, `go vet`, and Go build

---

## Submitting a Pull Request

- Commit format: `type(scope): summary` with issue references (e.g. `fix(parser): handle nested state machines, Fixes #1234`)
- Branch naming: `issue#<number>_<short-description>`
- When making a PR, read `.github/PULL_REQUEST_TEMPLATE.md` for detailed guidelines on PR titles, descriptions, and content requirements.
- When making an issue, read `.github/ISSUE_TEMPLATE.md` for detailed guidelines.

### Important

- **Run `make check` before pushing.** This catches most issues before CI does, saving you a round-trip.
- **Keep PRs focused.** One feature or fix per PR. If you find an unrelated issue while working, open a separate issue or PR for it.
- **Include screenshots for UI changes.** Reviewers can't run your branch — show them what it looks like.
- By submitting a PR, you agree that your work will be licensed under the project's [MIT license](LICENSE.md).

---

## Troubleshooting

### `make fetch-jar` fails

Check that you can reach `https://try.umple.org/scripts/umplesync.jar` from your network, then rerun `make fetch-jar`. The command no longer requires GitHub CLI authentication.

### `make dev` fails with "Cannot connect to the Docker daemon"

Docker isn't running. Start Docker Desktop (macOS/Windows) or the Docker service (Linux: `sudo systemctl start docker`).

### Port 3200 already in use

Another process is using that port. Either stop it, or find what's using it:

```bash
lsof -i :3200   # macOS/Linux
```

### Frontend shows "failed to fetch" or API errors

The backend probably isn't running. In a separate terminal, check:

```bash
make logs-backend
```

If the backend container isn't running, start it:

```bash
make dev-backend
```

### TypeScript errors in your editor but `make check` passes

Your editor's TypeScript server might be out of date. In VS Code, open the command palette (`Ctrl+Shift+P`) and run "TypeScript: Restart TS Server".

### Docker build is slow or stuck

If a Docker build seems to hang, it might be downloading base images for the first time. This is normal on first run. Subsequent builds are cached and much faster.

### `make check` fails on Go checks but you only changed frontend code

The Go checks require the backend dependencies to be downloaded. Run `make check` again — it should download them on the first run. If it persists, ensure Docker is running, then try:

```bash
cd backend && go mod download
```

---

## AI Agent Tests

The AI agent test suite (`frontend/src/ai/__tests__/agent-loop.test.ts`) calls a real LLM API. These tests are **skipped by default** and require a personal API key to run. You don't need to run these for normal development.

To enable them:

1. Copy the example env file:
   ```bash
   cp frontend/.env.test.example frontend/.env.test
   ```
2. Fill in your API key in `frontend/.env.test`:
   ```
   AI_PROVIDER=openrouter
   AI_MODEL=minimax/minimax-m2.7
   AI_API_KEY=your-api-key-here
   ```
3. Run with the live flag:
   ```bash
   cd frontend \
     && AI_LIVE_TESTS=1 bun run vitest run src/ai/__tests__/agent-loop.test.ts
   ```

> **Do not commit `.env.test`** — it is gitignored. Only `.env.test.example` is tracked.
