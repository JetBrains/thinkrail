# Bonsai

**Stable version available on the [`stable`](../../tree/stable) branch.**

Specification-driven development workspace. Hierarchical, interconnected specs live in the repo alongside code — helping developers align AI coding agents through structured project context.

## Quick Start

```bash
git clone <repo-url>
./run.sh
```

The script installs all dependencies, starts the backend and frontend, and opens:

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:8000

Press `Ctrl+C` to stop. Cleanup is automatic.

### Prerequisites

- **Node.js** (with npm)
- **Python 3.11+**
- **uv** (installed automatically if missing)

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_HOST` | `0.0.0.0` | Backend bind address |
| `BACKEND_PORT` | `8000` | Backend port |
| `FRONTEND_PORT` | `3000` | Frontend port |

### Migrating from `registry.json` to Frontmatter

Bonsai now stores spec metadata as YAML frontmatter inside each `.md` file instead of a centralized `registry.json`. If your project was created before this change, run the migration script to convert:

```bash
# From the project root
uv run python scripts/migrate_registry.py

# Or specify a project path explicitly
uv run python scripts/migrate_registry.py /path/to/your/project
```

The script will:

1. Read all entries and links from `.bonsai/registry.json`
2. Inject YAML frontmatter into each spec file
3. Archive the old registry to `.bonsai/registry.json.bak`
4. Print a summary of migrated / skipped / errored files

The SQLite index (`index.db`) is rebuilt automatically on the next Bonsai startup — no manual step needed.

> **Note:** Files that already have frontmatter are skipped, so the script is safe to re-run.

### Development

#### WebSocket Type Generation

The frontend TypeScript types for WebSocket events are auto-generated from the backend Pydantic models:

```
backend/app/agent/models.py  →  frontend/ws-events.json  →  frontend/src/types/ws-events.ts
```

**Regenerate after any change to `AgentEvent` or its payload models:**
```bash
cd frontend && npm run generate:ws-schema && npm run generate:ws-types
```

#### End-to-End Tests

Playwright specs that drive the real backend + frontend live in [`e2e/`](./e2e/README.md) — run `./run.sh` then `cd e2e && npm test`.