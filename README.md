<p align="center">
  <img src=".github/umple_logo.svg" alt="Umple" height="80">
</p>

# UmpleOnline

A modern rewrite of [UmpleOnline](https://try.umple.org) — the browser-based tool for editing [Umple](https://umple.org) models textually and graphically, generating code, and visualizing class diagrams and state machines.

This project reproduces the legacy PHP/jQuery stack with a contemporary architecture while preserving the same Umple compiler and modeling capabilities.

**Live instance:** [newumpleonline.umple.org](https://newumpleonline.umple.org)
<!-- OLD VERSION ... may be made a synonym
[umpleonline.org](https://umpleonline.org/)
-->

## How This Differs From The Original

- The original UmpleOnline in the legacy `umple` repo is a PHP/jQuery application; this repo splits the app into a React/Vite frontend, a Go API, dedicated collaboration and LSP proxy services, and a Node-based code execution service.
- Local development is container-first: `make dev` brings up the backend services and the frontend hot-reload server, instead of the older mixed script-based setup.
- The `code-exec` service defaults to port `4401`, while the legacy `UmpleCodeExecution` service defaults to `4400`, so both stacks can run on the same machine without a port collision.
- Backend, collab, LSP, and code-exec ports can all be remapped from the repo root `.env` when you need to run multiple local stacks side by side.
- This repo is forward-only. We keep the same compiler capabilities, but we are not preserving the old stack's implementation details or setup flow.

## Architecture

```
┌─────────────────────────────┐
│     Frontend (React/TS)     │  Port 3200 (dev) / 3100 (prod)
│  CodeMirror · ReactFlow     │
│  Tailwind CSS · Zustand     │
└────────────┬────────────────┘
             │ /api/* · /ws/collab/* · /ws/lsp
┌────────────▼────────────────┐
│       Backend (Go/Chi)      │  Port 3001
│  ├─ TCP ──▶ umplesync.jar   │
│  └─ pipe ─▶ Graphviz (dot)  │
└────────────┬────────────────┘
             │
┌────────────▼────────────────┐
│   Code Exec (Node.js)       │  Port 4401
│   Sandboxed code runner     │
└─────────────────────────────┘

┌─────────────────────────────┐
│  Collab (Yjs WebSocket)     │  Port 3002
└─────────────────────────────┘

┌─────────────────────────────┐
│  LSP Proxy (WS to stdio)    │  Port 9999
└─────────────────────────────┘
```

Five services, all containerized with Docker:

- **Frontend** - React 19, TypeScript, Vite, CodeMirror 6, ReactFlow. See [frontend/README.md](frontend/README.md).
- **Backend** - Go 1.24 (Chi router), communicates with `umplesync.jar` via TCP and Graphviz for diagram rendering. See [backend/README.md](backend/README.md).
- **Collab** - Yjs WebSocket server for realtime shared editing. See [collab/README.md](collab/README.md).
- **LSP Proxy** - WebSocket-to-stdio bridge for `umple-lsp-server`. See [lsp-proxy/README.md](lsp-proxy/README.md).
- **Code Exec** - Node.js service for running compiled code in a sandbox. See [code-exec/README.md](code-exec/README.md).

## Getting Started

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, available commands, and contribution guidelines.

## Examples

Example sources come from the Umple library at <https://umple.org/umpleonline/umplibrary/>, which is updated whenever Umple merges to master, so this repo keeps no duplicate copies of them. Each request tries the library first, then a runtime cache, then the example files seeded into the backend image.

`examples/example_manifest.json` stays in the repo: it holds the picker's menu metadata (labels, ordering, categories and source paths), which the library listing does not provide. Refresh it from the legacy Umple repo with:

```bash
make sync-examples
```

By default this reads the menus from `https://github.com/umple/umple.git` at `master`. You can override the source ref if needed:

```bash
make sync-examples LEGACY_UMPLE_REF=my-legacy-branch
```

Download the examples themselves into `examples/` with:

```bash
make fetch-examples
```

Those files are gitignored and act as the offline seed. Run it before working offline; the backend image is seeded the same way when images are published.

## License

[MIT](LICENSE.md) — see the license file for the full list of contributors.

## Links

- **Umple project:** [umple.org](https://umple.org)
- **Original UmpleOnline:** [try.umple.org](https://try.umple.org)
- **Umple user manual:** [manual.umple.org](https://manual.umple.org)
- **Umple compier source:** [github.com/umple/umple](https://github.com/umple/umple)
