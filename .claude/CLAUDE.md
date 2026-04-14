# Bonsai

This project uses specification-driven development.

## Tech Stack
- **Backend:** Python 3.11+ (use `uv` to run Python, pytest, and manage dependencies)
- **Frontend:** TypeScript/React (Vite dev server, npm for deps)

## Running the Project
```bash
./run.sh          # starts both backend and frontend
```
- **Backend:** FastAPI + uvicorn on http://localhost:8000
- **Frontend:** Vite dev server on http://localhost:3000 (proxies /ws and /terminal to backend)

To run individually:
```bash
cd backend && uv run python -m app.main    # backend only
cd frontend && npm run dev                  # frontend only
```

## First-Time Setup

Create the first admin user before accessing the web UI:
```bash
cd backend && uv run python -m app.cli create-user --id <your-id> --name "<Your Name>" --admin
```
This outputs a `bns_` token. Enter it on the login screen at http://localhost:3000.

Alternatively, on first launch with no users, the web UI shows a SetupScreen to create the first admin directly.

To promote an existing user to admin:
```bash
cd backend && uv run python -m app.cli set-admin --id <user-id>
```

## Dependency Management
- **Backend:** `cd backend && uv add <package>` to add deps; `uv sync` to install
- **Frontend:** `cd frontend && npm install <package>` to add deps; `npm install` to sync

## Testing
- **Backend:** `cd backend && uv run pytest` (uses pytest-asyncio, auto mode)
- **Frontend:** `cd frontend && npm test` (vitest)
- **Frontend lint:** `cd frontend && npm run lint` (tsc --noEmit + eslint)

## Spec-Driven Rules
1. Check specs before implementing: read existing specs first
2. Create specs before code: use /spec-init, /module-design, etc.
3. Update specs with code: when code changes, update corresponding spec
4. Track progress: use /spec-status to check coverage
5. **Post-implementation alignment check:** After finishing implementation of a task or group of tasks, compare the code against the relevant specs (module README.md, task specs, DESIGN_DOC.md). For each discrepancy found, use AskUserQuestion to ask the user what to do — options should include "Update spec to match code", "Update code to match spec", and "Skip / leave as-is". Address discrepancies one at a time.

## Project Layout
```
backend/
  app/
    main.py           # FastAPI entry point (create_app factory)
    cli.py            # Admin CLI (create-user, list-users)
    core/             # Config, file I/O, watcher, server_store (SQLite)
    spec/             # Spec models, parser, validator, registry, graph, service
    agent/            # Agent models, tracker, runner, service, context, persistence
    rpc/              # WebSocket RPC server + JSON-RPC methods
      methods/        # specs.py, agents.py, admin.py, user.py, auth.py
  tests/              # pytest tests (mirrors app/ structure)
frontend/
  src/
    api/              # WebSocket client, RPC hooks
    components/       # React components (AppShell, LoginScreen, SetupScreen, AdminPanel, etc.)
    store/            # Zustand stores
    styles/           # Global CSS, theming
    types/            # Shared TypeScript types
    utils/            # Utility functions
.bonsai/
  registry.json       # Spec registry (all specs and links)
current_tasks/        # Task specs organized by module (agent/, core/, frontend/, rpc/, spec/)
```

## Active Tasks
See `current_tasks/` for work items. All 36 initial implementation tasks are done.

## Specifications & Spec-Driven Skills

Run `/spec-status` to see specification coverage.

### Available spec-driven skills
| Skill | Purpose |
|-------|---------|
| `/spec-init` | Initialize a project for spec-driven development |
| `/spec-status` | Show spec coverage, health, and gaps |
| `/spec-next` | Suggest what to specify next based on priority |
| `/spec-lint` | Validate spec structure, links, completeness |
| `/spec-review` | Review specs against code for accuracy |
| `/spec-from-code` | Reverse-engineer specs from existing code |
| `/goal-and-requirements` | Define project goal and requirements |
| `/architecture-design` | Create system-wide architecture design doc |
| `/module-design` | Create module-level design spec (README.md) |
| `/submodule-design` | Create sub-component design spec |
| `/task-spec` | Create actionable task spec for a bug/feature |
