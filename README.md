# Bonsai

**Stable version available on the [`stable`](../../tree/stable) branch.**

Specification-driven development workspace. Hierarchical, interconnected specs live in the repo alongside code — helping developers align AI coding agents through structured project context.

## Quick Start

### For end users — desktop app

Download the installer for your OS from the [latest release](../../releases/latest):

| OS | File |
|----|------|
| macOS | `Bonsai-<version>-arm64.dmg` (Apple Silicon) or `Bonsai-<version>-x64.dmg` (Intel) |
| Linux | `Bonsai-<version>.AppImage` |
| Windows | `Bonsai Setup <version>.exe` |

The app is unsigned, so on first launch:
- **macOS:** right-click the app → Open (Gatekeeper warns once).
- **Windows:** SmartScreen will warn — click "More info" → "Run anyway".

Auto-update from GitHub releases is enabled on Linux and Windows. macOS auto-update is disabled until the app is signed; re-download to upgrade.

**Anthropic API key.** The desktop app spawns its backend on launch and needs an Anthropic key. Two paths, in order of convenience:

1. **Shell rc export** (recommended). If you already have `export ANTHROPIC_API_KEY=sk-ant-...` in `~/.zshrc`, `~/.bash_profile`, or `~/.config/fish/config.fish`, you're done — the desktop app spawns your login shell at startup and imports its env, so a Finder/dock launch sees the same key your terminal does. Same trick VS Code, Hyper, and GitHub Desktop use.
2. **Per-app dotenv** (fallback). For users on shells we can't import (tcsh, nushell), or anyone who wants the key scoped to Bonsai instead of system-wide:

   ```bash
   mkdir -p ~/.bonsai
   echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.bonsai/.env
   ```

If neither path supplies a key, sessions fail on the first turn with `Not logged in · Please run /login`. Set `BONSAI_NO_SHELL_ENV=1` to disable the shell-env import (e.g. if a slow `~/.zshrc` makes startup feel sluggish).

### For developers

```bash
git clone <repo-url>
./run.sh
```

The script installs all dependencies, starts the backend and frontend, and opens:

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:8000

Press `Ctrl+C` to stop. Cleanup is automatic.

### Building distributables locally

```bash
./build_and_install.sh         # standalone CLI executable (PyInstaller)
./electron/scripts/build.sh    # Electron installer for the current OS
```

See [`packaging/README.md`](packaging/README.md) and [`electron/README.md`](electron/README.md) for details.

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