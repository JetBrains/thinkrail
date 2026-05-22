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

There is no setup. Bonsai is single-user, localhost-only — no accounts, no tokens, no login screen. Run `./run.sh` (or `cd backend && uv run python -m app.main`) and open http://localhost:3000.

## Dependency Management
- **Backend:** `cd backend && uv add <package>` to add deps; `uv sync` to install
- **Frontend:** `cd frontend && npm install <package>` to add deps; `npm install` to sync

## Testing
- **Backend:** `cd backend && uv run pytest` (uses pytest-asyncio, auto mode)
- **Frontend:** `cd frontend && npm test` (vitest)
- **Frontend lint:** `cd frontend && npm run lint` (tsc --noEmit + eslint)

## Code Generation (Backend → Frontend Types)

Frontend TypeScript types are **generated from backend Pydantic models** — never hand-written. Two pipelines:

1. **REST API types:** FastAPI OpenAPI schema → `openapi-typescript` → `src/api/generated.ts`
2. **WebSocket event types:** Pydantic `AgentEvent` union → JSON Schema → `json-schema-to-typescript` → `src/types/ws-events.ts`

```bash
cd frontend && npm run generate     # regenerate all types
```

This runs automatically as a `prebuild` hook (`npm run build` triggers it). Individual steps:
```bash
npm run generate:schema     # export openapi.json from FastAPI
npm run generate:api        # openapi.json → src/api/generated.ts
npm run generate:ws-schema  # export ws-events.json from Pydantic models
npm run generate:ws-types   # ws-events.json → src/types/ws-events.ts
```

Backend CLI equivalents: `uv run python -m app.cli export-schema` and `export-ws-schema`.

**Rule:** When you change backend Pydantic models (api/schemas.py, agent/models.py), run `npm run generate` in frontend/ to keep types in sync. Generated files have "DO NOT EDIT" headers — never modify them directly.

## Code Style — Python Backend

Follow these conventions for all new Python code:

### File Structure
- `from __future__ import annotations` — **always** the first import
- Module-level docstring: triple-quote description of what the file does
- `logger = logging.getLogger(__name__)` when logging is needed
- Section separators: `# ── Section name ────────────────────────` (Unicode box-drawing `─`)

### Type Hints
- Use modern syntax: `str | None` (not `Optional[str]`), `list[str]` (not `List[str]`)
- Annotate all function signatures and return types
- Use `Any` sparingly — prefer concrete types

### Data Models
- **`@dataclass`** for simple internal containers (no serialization needed)
- **Pydantic `BaseModel`** for anything crossing API/storage boundaries
- `Field(default_factory=list)` for mutable defaults in Pydantic models

### Error Handling
- Graceful fallback: try/except returning safe defaults — never crash on non-critical paths
- `logger.debug("...", exc_info=True)` for suppressed exceptions
- Domain-specific exceptions (e.g. `SpecNotFoundError`, `FrontmatterError`) — not bare `Exception`

### Naming
- Private helpers: `_prefixed` (module-level or in-class)
- Public API: clear verb phrases (`list_specs`, `get_spec`, `parse_frontmatter`)
- Constants: `UPPER_SNAKE_CASE`

### Testing (pytest)
- Class-based organization: `class TestParseFrontmatter:`, `class TestSpecIndex:`
- Descriptive method names: `test_returns_empty_dict_for_no_frontmatter`
- Use `unittest.mock.patch` with context managers; group with `with (...):` syntax
- Async tests: `pytest-asyncio` with auto mode

### Async
- Use `async/await` for I/O-bound operations (file I/O via aiosqlite, network calls)
- `aiosqlite` for SQLite access (consistent with `app_store.py`)
- Don't mix sync and async — if a module is async, keep all its public methods async

## Code Style — Comments (Python and TypeScript)

**Default to no comments.** Names, types, tests, commits, and PR descriptions carry the context. A comment earns its place only when removing it would leave a future reader confused — and even then, write the minimum.

**Do NOT write:**
- Narration of *what* the code does — well-named identifiers already say it.
- History or migration notes ("previously this did X", "the old code path…", "this used to live in Y", "now that Z was folded into…"). Git log and PRs are the place for that.
- Version references ("since SDK 0.2.82", "after PR #98"). They rot.
- Comparison to the previous behavior to explain the current one. The current code stands on its own.
- Redundant restatement of the function/class/parameter name in prose.
- Justifications for routine choices that any reader would make the same way.

**You MAY write a comment when:**
- A hidden constraint, invariant, or external-system quirk would surprise a careful reader (e.g. "ProjectPicker's CTAs trigger a native folder dialog Playwright can't drive — recents list is the only DOM path").
- A workaround references a specific upstream bug or limitation that isn't obvious from the call site.
- A non-obvious focus/timing/DOM gotcha is load-bearing for the code to work.

If the comment describes *the current state* of the system and a reader couldn't infer it from names + types, it's fair game. If it describes *how we got here*, delete it.

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
    cli.py            # Schema export commands (export-schema, export-ws-schema)
    api/              # REST API layer (FastAPI routers)
      routers/        # files.py, fs.py, project.py, projects_known.py, server_info.py
    core/             # Config, file I/O, watcher, app_store (SQLite — projects + settings), project bootstrap, settings
    spec/             # Spec models, parser, validator, frontmatter, index, graph, service
    agent/            # Agent models, tracker, runner, service, context, persistence, credentials, revise, transcribe, permissions, pricing, model_registry, visualization
      tools/          # MCP tools: specs.py, suggest_session.py, suggest_description.py, visualization.py, orchestrator.py, change_ticket_status.py
    board/            # Meta-ticket and plan management (models, service, storage, plan, state_machine, spec_drafts)
    rpc/              # WebSocket RPC server + JSON-RPC methods
      methods/        # specs.py, agents.py, sessions.py, board.py, trash.py, vis.py, settings.py, subsessions.py
    trash/            # Soft-delete service (service.py, storage.py)
    vis/              # Visualization dashboard (models.py, service.py)
  tests/              # pytest tests (mirrors app/ structure)
frontend/
  src/
    api/              # WebSocket client, RPC hooks
    services/         # REST API clients (files, fs, project, projects, serverInfo)
    components/       # React components (AppShell, ChatStream, GraphView, BoardView, MetaTicketDetail, etc.)
    store/            # Zustand stores
    hooks/            # Custom React hooks
    context/          # React context providers
    styles/           # Global CSS, theming
    types/            # Shared TypeScript types
    utils/            # Utility functions
    constants/        # App constants
.bonsai/                        # Per-project config (committed to git)
~/.bonsai/indexes/<hash>/
  index.db            # SQLite spec index (generated, outside repo)
.bonsai/implementation_tasks/  # Task specs organized by module (agent/, core/, frontend/, rpc/, spec/)
.github/workflows/    # CI: tests.yml, nightly.yml, stable.yml, _build.yml, _release.yml
```

## Active Tasks
See `.bonsai/implementation_tasks/` for work items. All 36 initial implementation tasks are done.

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
| `/bug-fix` | Reactive bug-fix flow — edit existing specs (or bootstrap one) to capture the correct intent for an observed bug, then suggest a code-fix session |
