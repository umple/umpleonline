# Operational status

Open /status from the **Server status** link in the editor footer. The page refreshes every 30 seconds and reports:

- Backend and compiler process IDs, internal ports, service URLs and container hostnames.
- Backend software versions and paths (Java, Graphviz, Python, TXL), plus Node versions from supporting services.
- Source commit/ref, build time, release tag and deployment time.
- Persistent editor visits and browser tab sessions, and sessions since the backend started.
- Raw umplesync -log output: compiler version, uptime, command totals and categories, queue length, CPU load and command timings.
- Collaboration active clients/rooms, initiated and collaborated sessions, uptime and peak collaborators per room.
- LSP proxy sessions, rejected connections and process limits.
- Execution request counts, concurrency limit, timeout, runner image availability, Docker versions and container resource statistics.

The footer uses /api/status/summary and refreshes once per minute. Compiler log snapshots are shared for 30 seconds; monitoring requests are included in the compiler's command counts. Missing data is shown as unavailable.

## Counter definitions and persistence

A visit is an editor mount (including a page reload). A browser tab session is counted once using session storage. These are usage counts, not unique people. Dashboard visits do not increment editor counts.

Visits and sessions are stored in MODEL_STORE_PATH/status-counters.json. Compiler counters are stored in MODEL_STORE_PATH/.compiler/commandcount.txt; preserve that directory across restarts and releases. The JVM saves its command counter periodically, so a restart can lose commands since its last checkpoint. New deployments start their own history; the footer does not claim the old system's 2018/2019 totals.

A collaboration session is one room lifetime, ending when its last connection leaves. It becomes a collaborated session once it has at least two simultaneous clients. Reconnection to a still-active room does not create another session. Active users count connections, not unique individuals. Per-room peak collaborators is separate from peak connections across the server.

## Container diagnostics

The execution service already has Docker access for sandboxed execution. Its /status supplies Docker client/server versions, runner image readiness and read-only container information. The backend receives these over HTTP and needs no Docker socket or Docker executable.

STATUS_COMPOSE_PROJECT limits reported containers to the Compose project. Development and production Compose files set this automatically. The make dev-backend command also supplies development source commit, branch and build time; direct docker compose users can set SOURCE_COMMIT, SOURCE_REF, SOURCE_REF_NAME and BUILD_TIME explicitly. For a custom project name, set COMPOSE_PROJECT_NAME consistently or override STATUS_COMPOSE_PROJECT in the execution service environment. The runner image is reported separately because its short-lived containers are not Compose services.

LSP status describes the proxy and its sessions; it does not run a full language-server request. Execution status verifies Docker and runner-image availability without executing user code. An unavailable optional diagnostic is displayed explicitly. /api/health remains the lightweight container health endpoint.
