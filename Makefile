.PHONY: dev dev-backend dev-frontend install up-prod down logs logs-backend clean tidy fetch-jar fetch-examples sync-examples test-e2e test-e2e-live test-e2e-ui check check-frontend check-backend

UMPLESYNC_JAR_URL ?= https://try.umple.org/scripts/umplesync.jar
export UMPLE_LSP_VERSION ?= $(shell npm view umple-lsp-server version 2>/dev/null || echo latest)
export DOCKER_GID := $(shell stat -c '%g' /var/run/docker.sock 2>/dev/null || echo 0)
UMPLE_LIBRARY_URL ?= https://umple.org/umpleonline/umplibrary/
LEGACY_UMPLE_GIT_URL ?= https://github.com/umple/umple.git
LEGACY_UMPLE_REF ?= master

# Prefer "docker compose" plugin; fall back to standalone "docker-compose"
COMPOSE := $(shell if docker compose version >/dev/null 2>&1; then echo "docker compose"; elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"; else echo "docker compose"; fi)

# ── Development ──

# Start everything: backend in Docker, frontend with bun (hot reload)
dev:
	@echo "Starting backend (Docker)..."
	$(COMPOSE) up -d --build
	@echo ""
	@echo "Starting frontend (bun dev server with HMR)..."
	cd frontend && bun run dev

# Start only the backend services (Docker with Air hot reload)
dev-backend:
	$(COMPOSE) up -d --build

# Start only the frontend (bun dev server with HMR)
dev-frontend:
	cd frontend && bun run dev

# Install frontend dependencies
install:
	cd frontend && bun install --frozen-lockfile

# Frontend Playwright tests (mocked backend)
test-e2e:
	cd frontend && bun run test:e2e

# Frontend Playwright tests against the live backend stack
test-e2e-live:
	cd frontend && bun run test:e2e:live

# Interactive Playwright runner for local debugging
test-e2e-ui:
	cd frontend && bun run test:e2e:ui

# Run the same frontend checks as CI
check-frontend:
	cd frontend && bun install --frozen-lockfile
	cd frontend && bun run tsc -b --noEmit
	cd frontend && bun run build
	cd frontend && bun run test:e2e

# Run the same backend checks as CI
check-backend:
	cd backend && go mod download
	cd backend && go vet ./...
	cd backend && CGO_ENABLED=0 go build -o /dev/null ./cmd/server

# Run the local equivalent of the CI workflow
check: check-frontend check-backend

# ── Production ──

# Start production stack (pulls pre-built images)
up-prod:
	$(COMPOSE) -f docker-compose.prod.yml up -d

# ── Operations ──

# Stop all services
down:
	$(COMPOSE) down

# View logs
logs:
	$(COMPOSE) logs -f

# Backend logs only
logs-backend:
	$(COMPOSE) logs -f backend

# Clean up
clean:
	$(COMPOSE) down -v
	rm -rf data/models/tmp*

# Tidy Go modules
tidy:
	cd backend && go mod tidy

# ── Jar Management ──

# Download the latest umplesync.jar published by UmpleOnline.
fetch-jar:
	@mkdir -p jars
	@echo "Fetching umplesync.jar from $(UMPLESYNC_JAR_URL)..."
	@curl -fL --retry 3 --retry-delay 5 "$(UMPLESYNC_JAR_URL)" -o jars/umplesync.jar
	@if command -v sha256sum >/dev/null 2>&1; then sha256sum jars/umplesync.jar > jars/umplesync.jar.sha256; else shasum -a 256 jars/umplesync.jar > jars/umplesync.jar.sha256; fi
	@echo "Downloaded jars/umplesync.jar"
	@echo "Recorded jars/umplesync.jar.sha256"

# Download the Umple example library into examples/, which seeds the offline
# example cache baked into the backend image. Overwrites examples/*.ump.
fetch-examples:
	bun scripts/fetch-examples.ts --library-url "$(UMPLE_LIBRARY_URL)"

# Refresh the committed example menu metadata (examples/example_manifest.json) from the legacy repo
sync-examples:
	bun scripts/sync-examples.ts --legacy-repo "$(LEGACY_UMPLE_GIT_URL)" --legacy-ref "$(LEGACY_UMPLE_REF)"
