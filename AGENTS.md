## Project Overview

Rewrite of UmpleOnline from legacy stack (PHP, jQuery) to modern stack. Old repo: `~/umple/`

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite, CodeMirror 6, ReactFlow, Zustand
- **Runtime**: Bun — use `bun install`, `bun run dev`, `bun run build`
- **Backend**: Go 1.24 (Chi router), communicates with umplesync.jar (Java) via TCP and Graphviz
- **Code Exec**: Node.js service for running compiled code (`code-exec/`)

## Domain & Port Mapping
| Service | Dev Port | Prod Port |
|---------|----------|-----------|
| Frontend | 3200 (Vite) | 3100 (nginx in Docker) |
| Backend API | 3001 | 3001 |

In dev, Vite proxies `/api/*` to `http://localhost:3001`. In prod, the frontend nginx container proxies `/api/*` to the backend container.

## Development Workflow

### Starting dev environment

```
make dev          # Starts backend (Docker) then frontend (bun dev)
```

Or separately:
```
make dev-backend   # Docker: backend (Go + Air)
make dev-frontend  # bun run dev (Vite HMR on port 3200)
```

### Frontend changes

Frontend uses Vite HMR — **changes are instant, no action needed**. Just ensure the dev server is running (`make dev-frontend` or `bun run dev` from `frontend/`).

### Backend changes

Backend runs in Docker with **Air** (Go hot-reloader). When you edit any `.go` file, Air detects the change and rebuilds automatically (~1-2s). No manual restart needed.

If you add new Go dependencies: run `docker compose exec backend go mod tidy`.

### When you DO need to rebuild

- Changed `Dockerfile.dev` or `docker-compose.yml` → `docker compose up -d --build`
- Changed `package.json` (new frontend deps) → `bun install`
- First time setup → `make fetch-jar && make install && make dev`
- Working offline → `make fetch-examples` first, so examples are available without the network

## Key Commands

| Command | When to use |
|---------|-------------|
| `make dev` | Start full dev environment |
| `make test-e2e` | Run mocked Playwright frontend smoke tests |
| `make test-e2e-live` | Run Playwright against the live backend stack |
| `make test-e2e-ui` | Open Playwright UI for local debugging |
| `make down` | Stop all Docker services |
| `make logs` | Tail all service logs |
| `make logs-backend` | Tail backend logs only |
| `make up-prod` | Deploy production (all services in Docker) |
| `make tidy` | Run `go mod tidy` for backend |
| `make clean` | Stop services + remove temp model data |
| `make fetch-jar` | Download the latest UmpleOnline-hosted umplesync.jar |
| `make fetch-examples` | Download the Umple example library into `examples/` as an offline seed |
| `make check` | Run the local equivalent of the CI validation suite |

## Playwright

Playwright tests live in `frontend/tests/e2e/`.

Use:

- `cd frontend && bun run test:e2e` for the default mocked frontend smoke tests
- `cd frontend && bun run test:e2e:live` only when the backend stack is already running and you want a real integration check
- `cd frontend && bun run test:e2e:ui` for local interactive debugging

When writing tests:

- Default to mocked `/api/*` responses for frontend verification; keep tests deterministic and fast
- Add or reuse stable `data-testid` hooks for key UI surfaces instead of brittle CSS or text-only selectors
- Cover one user-visible flow per test; keep smoke tests small and high-signal
- Use live-backend tests sparingly for real compile/integration verification, and gate them behind the existing opt-in flag

## Philosophy

- No backward compatibility. This repo has no existing users yet — always move forward. Use the latest tools, break things, never add shims or deprecation paths.
- When developing new features that are related to the compiler, refer to the old codebase at `~/code/umple/` for reference.

## Brand & Colors

All colors are semantic tokens defined in `frontend/src/index.css` `@theme`. Use these tokens — never hardcode hex values in components (except CodeMirror editor highlights).

| Token | Usage |
|-------|-------|
| `brand` / `brand-hover` / `brand-light` | CTAs, active tabs, selected states |
| `surface-0` / `surface-1` / `surface-2` | Backgrounds: content → toolbar → hover |
| `ink` / `ink-muted` / `ink-faint` / `ink-inverse` | Text: primary → secondary → disabled → on-brand |
| `border` / `border-strong` | Dividers → focused/active borders |
| `status-error` / `status-warning` / `status-success` | Functional status indicators |

Source: [uOttawa brand guidelines](https://www.uottawa.ca/about-us/administration-services/brand)

## CI/CD

CI (`.github/workflows/ci.yml`) runs on pull requests and validates the repo: TypeScript check, frontend build, Playwright smoke tests, and Go vet/build.

Publish Images (`.github/workflows/publish-images.yml`) runs on every push to `master`: it re-runs CI, builds the three production images, and pushes immutable GHCR tags in the form `sha-<full_commit_sha>`. It also refreshes `latest` for convenience, but production releases must always use the immutable `sha-*` tags.

Release (`.github/workflows/release.yml`) is the production promotion step: create a Git tag for the version you want to ship, then run Actions → Release and choose that existing tag (for example `v0.0.7`). The workflow deploys the exact published images for that tag's commit to the server and then creates the matching GitHub Release entry, which acts as the production changelog and release ledger.

Rollback uses the same Release workflow: run it again and select an older release tag whose commit already has published images.

Registry Cleanup (`.github/workflows/registry-cleanup.yml`) runs on a schedule and deletes old GHCR image versions while keeping the recent production history and the newest unpublished candidates.

Images are pushed to `ghcr.io/umple/umpleonline/{backend,frontend,code-exec}` using immutable `sha-<commit>` tags.

| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | Server hostname/IP |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_SSH_KEY` | SSH private key |
| `DEPLOY_SSH_PORT` | SSH port (default 22) |
| `DEPLOY_PATH` | Path to deploy directory (CD creates it + syncs compose file) |
| `DEPLOY_HOST_FINGERPRINT` | SSH host key fingerprint used to verify the deployment target (store as `SHA256:<hash>`, including the `SHA256:` prefix) |

To generate it on your machine:

```bash
ssh-keyscan -p "$DEPLOY_SSH_PORT" "$DEPLOY_HOST" | ssh-keygen -lf -
```

From the output, copy the `SHA256:<hash>` value for the **ECDSA** key (`ecdsa-sha2-nistp256`). The release workflow uses `appleboy/scp-action` → `drone-scp` → Go's `crypto/ssh`, which negotiates ECDSA — not ED25519 like OpenSSH does. Using the wrong key type's fingerprint will cause a handshake mismatch.

### Server setup (one-time)

Release automatically copies `docker-compose.prod.yml` from the repo, but the server `.env` must already exist with a production `ALLOWED_ORIGINS` value. The server still needs a few manual prerequisites:

```bash
mkdir -p ~/deploy/umpleonline
cat > ~/deploy/umpleonline/.env <<'EOF'
ALLOWED_ORIGINS=https://your-domain.example.com
FRONTEND_BIND_HOST=127.0.0.1
FRONTEND_HOST_PORT=3100
EOF
```

Required host dependencies:
- Docker with either `docker compose` or `docker-compose`
- TXL installed on the host at `/usr/local/bin/txl` and `/usr/local/lib/txl`
- Persistent storage at `~/deploy/umpleonline/data/models` if you want saved/generated model files to survive releases

### Migrating to prof's server

1. Install Docker on the new server
2. Install TXL on the host at `/usr/local/bin/txl` and `/usr/local/lib/txl`
3. Create the deploy directory, `.env`, and `data/models` directory (see above)
4. Copy any existing `data/models` contents if you need persisted models on the new server
5. Configure a reverse proxy (nginx or Cloudflare Tunnel) to forward the domain to that server's configured `FRONTEND_HOST_PORT` on localhost
6. Update the 6 GitHub secrets to point to the new server
7. Create or identify the Git tag for the version you want in production, then run the Release workflow for that tag
