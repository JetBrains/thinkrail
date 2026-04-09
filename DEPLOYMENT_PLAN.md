# Deployment Plan: `pip install bonsai-workspace`

> **Goal:** Ship Bonsai as a single pip-installable package so users can run it
> without cloning the repo, without Node.js, and without `uv`.
>
> **Target UX:**
> ```bash
> pip install bonsai-workspace
> export ANTHROPIC_API_KEY="sk-..."
> bonsai serve
> # → opens on http://localhost:8000
> ```

---

## Current State

Today, delivering Bonsai to a user requires:

1. Clone the repo
2. Install `uv`, `node`, `npm`
3. Run `./run.sh` (starts **two** processes: Vite on :3000, FastAPI on :8000)

The frontend and backend are fully decoupled servers. The Vite dev server proxies
`/ws` and `/terminal` WebSocket paths to the backend (see `frontend/vite.config.ts`
lines 14–25). The backend serves **only** API + WebSocket — no static files.

---

## Architecture Change

```
BEFORE (run.sh — two processes)            AFTER (bonsai serve — one process)
┌────────────────┐  proxy   ┌──────────┐  ┌──────────────────────────────────┐
│ Vite :3000     │ ───/ws─→ │ FastAPI  │  │ FastAPI :8000                    │
│ (serves React) │          │ :8000    │  │  ├─ /api/*        REST endpoints │
└────────────────┘          │ (API     │  │  ├─ /ws           WebSocket RPC  │
                            │  only)   │  │  └─ /*            Built React SPA│
                            └──────────┘  └──────────────────────────────────┘
```

The frontend is pre-built at package-build time (`npm run build → dist/`).
FastAPI serves the resulting static files. No Node.js needed at runtime.

The frontend already handles this — in production mode it uses same-origin:

```typescript
// frontend/src/main.tsx, lines 11–12
const BACKEND = import.meta.env.DEV ? "localhost:8000" : location.host;
const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";
```

No frontend code changes needed.

---

## What's in the Wheel

```
bonsai_workspace-0.1.0-py3-none-any.whl  (~5 MB)
├── bonsai/                    Python backend (renamed from app/)
│   ├── cli.py                 NEW — CLI entry point
│   ├── main.py                Modified — mounts static files
│   ├── core/
│   │   └── config.py          Modified — importlib.resources for plugin_dir
│   ├── agent/
│   ├── rpc/
│   ├── spec/
│   └── vis/
├── bonsai/frontend_dist/      Pre-built React SPA (from frontend/dist/)
│   ├── index.html
│   └── assets/                JS/CSS bundles
└── bonsai/claude_plugin/      Skills + MCP tools (from claude-plugin/)
    ├── skills/                15 SKILL.md files
    └── tools/                 vis-server.py
```

Estimated size: ~3.4 MB frontend + ~0.2 MB plugin + ~1 MB Python = **~5 MB**.

The heavy `claude-agent-sdk` (178 MB native binary per platform) is a declared
**dependency** — pip resolves the right platform wheel automatically. We don't
bundle it.

---

## Phase 1 — Rename `app/` → `bonsai/`

**Why:** The Python package is currently named `app` which is generic and conflicts
with countless other packages. PyPI convention is that import name matches package
name. The package on PyPI will be `bonsai-workspace`, importable as `bonsai`.

**What to do:**

1. Rename directory: `backend/app/` → `backend/bonsai/`

2. Find-and-replace all internal imports (~50 occurrences):
   ```
   from app.xxx  →  from bonsai.xxx
   import app.xxx  →  import bonsai.xxx
   ```
   Files affected (every `.py` that imports across modules):
   - `bonsai/main.py` — `from app.rpc.server import register_routes`
   - `bonsai/rpc/server.py` — imports from `app.core`, `app.spec`, `app.agent`, `app.vis`
   - `bonsai/rpc/methods/*.py` — imports from `app.agent`, `app.spec`
   - `bonsai/agent/service.py` — imports from `app.agent.*`, `app.core`
   - `bonsai/agent/runner.py` — imports from `app.agent.*`
   - `bonsai/agent/context.py` — imports from `app.spec`
   - `bonsai/spec/service.py` — imports from `app.core`
   - `bonsai/vis/service.py` — imports from `app.spec`, `app.core`
   - All `tests/` files
   - The `__main__` block in `main.py`: `"app.main:create_app"` → `"bonsai.main:create_app"`

3. Update `pyproject.toml`:
   ```toml
   [tool.hatch.build.targets.wheel]
   packages = ["bonsai"]    # was ["app"]
   ```

4. Update `run.sh` (keep working for development):
   ```bash
   uv run python -m bonsai.main &   # was: uv run python -m app.main
   ```

**This is a mechanical change.** A project-wide find-and-replace with a test run
afterward is sufficient.

---

## Phase 2 — Create CLI Entry Point

**New file:** `backend/bonsai/cli.py`

```python
"""CLI entry point: `bonsai serve`"""
from __future__ import annotations

import argparse
import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="bonsai",
        description="Bonsai — specification-driven development workspace",
    )
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="Start the Bonsai server")
    serve.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    serve.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    serve.add_argument("--reload", action="store_true", help="Auto-reload on code changes (dev)")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        raise SystemExit(1)

    if args.command == "serve":
        uvicorn.run(
            "bonsai.main:create_app",
            factory=True,
            host=args.host,
            port=args.port,
            reload=args.reload,
        )
```

**Register in `pyproject.toml`:**

```toml
[project.scripts]
bonsai = "bonsai.cli:main"
```

After `pip install`, the user gets the `bonsai` command in their PATH.

---

## Phase 3 — Bundle Frontend + Plugin as Package Data

### 3a. Build frontend into the wheel

Hatch's `force-include` maps external directories into the wheel:

```toml
[tool.hatch.build.targets.wheel]
packages = ["bonsai"]

[tool.hatch.build.targets.wheel.force-include]
"../frontend/dist" = "bonsai/frontend_dist"
"../claude-plugin" = "bonsai/claude_plugin"
```

This means **before building the wheel**, the frontend must already be built:
```bash
cd frontend && npm ci && npm run build   # produces frontend/dist/
cd backend && hatch build                # packages everything into .whl
```

### 3b. Fix `_BONSAI_ROOT` → `importlib.resources`

**Current code** (`backend/app/core/config.py`, lines 27–46):
```python
# Hardcoded path traversal — breaks when installed via pip
_BONSAI_ROOT = Path(__file__).resolve().parent.parent.parent.parent

def load_config(project_root: Path | None = None) -> AppConfig:
    root = project_root or _discover_root()
    return AppConfig(
        project_root=root,
        bonsai_dir=root / ".bonsai",
        plugin_dir=_BONSAI_ROOT / "claude-plugin",
    )
```

**New code:**
```python
from importlib.resources import files as _pkg_files

def _default_plugin_dir() -> Path:
    """Locate the claude-plugin directory bundled as package data."""
    pkg_path = _pkg_files("bonsai").joinpath("claude_plugin")
    resolved = Path(str(pkg_path))
    if resolved.is_dir():
        return resolved
    # Fallback for editable installs / development
    return Path(__file__).resolve().parent.parent.parent.parent / "claude-plugin"

def load_config(project_root: Path | None = None) -> AppConfig:
    root = project_root or _discover_root()
    return AppConfig(
        project_root=root,
        bonsai_dir=root / ".bonsai",
        plugin_dir=_default_plugin_dir(),
    )
```

The `importlib.resources` approach works for both:
- **pip install** — finds data inside the installed wheel
- **editable install / dev** — falls back to repo-relative path

---

## Phase 4 — Serve Frontend from FastAPI

**Current code** (`backend/app/main.py`, line 31–227): The `create_app()` function
defines REST endpoints and the WebSocket route but **never mounts static files**.

**Change:** Add a static file mount at the **end** of `create_app()`, after all
API routes. The `html=True` flag makes it serve `index.html` for any unmatched
path — exactly what a React SPA router needs.

```python
# Add at the end of create_app(), just before `return app`
from fastapi.staticfiles import StaticFiles
from importlib.resources import files as _pkg_files

dist_path = Path(str(_pkg_files("bonsai").joinpath("frontend_dist")))
if dist_path.is_dir():
    app.mount("/", StaticFiles(directory=str(dist_path), html=True), name="spa")
```

**Why this works:**
- FastAPI matches routes in registration order
- `/api/*` and `/ws` are registered first → they take priority
- `/*` catch-all for static files is registered last → only fires for non-API paths
- `html=True` returns `index.html` for paths like `/workspace/session/123`
  so React Router handles client-side routing

**No frontend changes needed.** The frontend already uses same-origin in production
mode (`import.meta.env.DEV` is `false` after `vite build`).

---

## Phase 5 — Updated `pyproject.toml`

Final `backend/pyproject.toml`:

```toml
[project]
name = "bonsai-workspace"
version = "0.1.0"
description = "Bonsai — specification-driven development workspace"
readme = "README.md"
requires-python = ">=3.11"
license = { text = "MIT" }
dependencies = [
    "pydantic>=2.0",
    "watchfiles>=1.0",
    "fastapi>=0.115",
    "uvicorn[standard]>=0.34",
    "jsonrpcserver>=5.0",
    "claude-agent-sdk>=0.1",
]

[project.scripts]
bonsai = "bonsai.cli:main"

[project.optional-dependencies]
transcription = ["openai>=1.0"]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "httpx>=0.27",
]

[tool.hatch.build.targets.wheel]
packages = ["bonsai"]

[tool.hatch.build.targets.wheel.force-include]
"../frontend/dist" = "bonsai/frontend_dist"
"../claude-plugin" = "bonsai/claude_plugin"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

---

## Phase 6 — Build Script

**New file:** `scripts/build-package.sh`

```bash
#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building frontend..."
cd "$ROOT/frontend"
npm ci
npm run build
echo "    frontend/dist/ ready ($(du -sh dist | cut -f1))"

echo "==> Building Python wheel..."
cd "$ROOT/backend"
hatch build
echo ""
echo "==> Done!"
ls -lh dist/*.whl
echo ""
echo "Install with:  pip install dist/bonsai_workspace-*.whl"
echo "Then run:       bonsai serve"
```

---

## Phase 7 — Verify

### Test in a clean virtual environment:

```bash
# Create a fresh venv (not the dev one)
python3.11 -m venv /tmp/bonsai-test
source /tmp/bonsai-test/bin/activate

# Install the wheel
pip install backend/dist/bonsai_workspace-0.1.0-py3-none-any.whl

# Set API key
export ANTHROPIC_API_KEY="sk-..."

# Run
bonsai serve

# Open http://localhost:8000 → should see the full Bonsai UI
```

### Checklist:

- [ ] `bonsai serve` starts without errors
- [ ] `http://localhost:8000` serves the React SPA
- [ ] Project picker loads, can select a project directory
- [ ] WebSocket connects (`/ws?project=...`)
- [ ] Spec CRUD works (create, read, update, delete)
- [ ] Agent session starts and streams responses
- [ ] Graph view renders
- [ ] File viewer works
- [ ] `bonsai serve --port 9000` respects custom port
- [ ] `Ctrl+C` shuts down cleanly

---

## Phase 8 — Publish to PyPI (Optional)

```bash
# One-time setup
pip install twine

# Upload
twine upload backend/dist/bonsai_workspace-0.1.0*

# Users install with:
pip install bonsai-workspace
```

Or use GitHub Actions to auto-publish on tag:

```yaml
# .github/workflows/publish.yml
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: cd frontend && npm ci && npm run build
      - run: cd backend && pip install hatch && hatch build
      - run: pip install twine && twine upload backend/dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

---

## Development Workflow After These Changes

For **developers** working on the codebase, nothing breaks:

```bash
# Option A: Same as before (two servers, hot-reload)
./run.sh

# Option B: Editable install (single server, no hot-reload on frontend)
cd backend && pip install -e .
bonsai serve --reload
```

The `run.sh` script continues to work for development with hot-reload on both
frontend and backend. The `bonsai serve` command is for production / distribution.

---

## Summary of All Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/app/` → `backend/bonsai/` | Rename | Match PyPI package name |
| `backend/bonsai/cli.py` | Create | CLI: `bonsai serve --host --port` |
| `backend/bonsai/main.py` | Edit | Mount `StaticFiles` for frontend SPA |
| `backend/bonsai/core/config.py` | Edit | `importlib.resources` for plugin_dir |
| `backend/pyproject.toml` | Edit | Scripts, force-include, package name |
| `backend/bonsai/**/*.py` | Edit | `from app.` → `from bonsai.` (~50 files) |
| `backend/tests/**/*.py` | Edit | Same import rename |
| `run.sh` | Edit | `python -m bonsai.main` |
| `scripts/build-package.sh` | Create | Frontend build + wheel build |
| Frontend code | **None** | Already handles same-origin in prod |

**Estimated effort:** 1–2 days.

---

## Open Questions

1. **PyPI name availability** — Is `bonsai-workspace` available? Check with
   `pip index versions bonsai-workspace`. Alternatives: `bonsai-dev`, `bonsai-specs`.

2. **`claude-agent-sdk` on PyPI** — Is this package publicly available on PyPI?
   If it's private/internal, users would need a custom index URL or a pre-install
   step. This is the single biggest external dependency risk.

3. **Version strategy** — Hardcoded `0.1.0` for now. Consider
   `hatch-vcs` for git-tag-based versioning later.

4. **License** — Placeholder `MIT` above. Decide on actual license before
   publishing.
