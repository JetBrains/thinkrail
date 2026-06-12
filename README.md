# ThinkRail

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)

Specification-driven development workspace. Hierarchical, interconnected specs live in the repo alongside code — helping developers align AI coding agents through structured project context.

## Quick Start

### For end users

Install with a single command (works while the repo is internal — uses your `gh` auth):

```bash
TOKEN=$(gh auth token)
curl -fsSL -H "Authorization: Bearer $TOKEN" https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh \
  | GH_TOKEN="$TOKEN" bash -s -- --channel nightly
```

Once the repo is public, the plain form will work for everyone:

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh | bash
```

Options:

```bash
# Nightly channel
... | bash -s -- --channel nightly

# Specific version
... | bash -s -- --version 0.2.0

# Custom install prefix
... | bash -s -- --prefix ~/.local
```

The installer detects your OS and architecture, downloads the matching binary from the [latest release](../../releases/latest), verifies the SHA256 checksum, and installs to `~/.local/bin/thinkrail`. If `~/.local/bin` isn't on your `PATH`, the installer appends it to your shell's rc file (`~/.bashrc`, `~/.bash_profile`, `~/.zshrc`, or `~/.config/fish/conf.d/thinkrail.fish` depending on `$SHELL`) — open a new terminal or `source` the file to pick it up. Re-running with a different `--prefix` rewrites the existing entry rather than stacking a second one. Pass `--no-modify-path` to opt out.

`--prefix` accepts letters, digits, and `_` `-` `.` `/` `~` and spaces; values containing other characters (e.g. `$`, backticks, `;`) are rejected so they can't be smuggled into the rc file as executable shell.

Supported platforms: Linux x64/arm64, macOS x64/arm64, Windows x64.

Once installed, run `thinkrail` to start. To update later: `thinkrail upgrade` (Linux/macOS; on Windows, re-run the installer command above).

> **macOS first-launch:** binaries are not yet code-signed. macOS will show a Gatekeeper warning the first time you run `thinkrail`. Either right-click the binary → **Open**, or run `xattr -d com.apple.quarantine ~/.local/bin/thinkrail` once.

**Authentication.** ThinkRail drives Claude Code under the hood, so Claude Code needs to be authenticated.

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
```

See [`packaging/README.md`](packaging/README.md) for details.

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

ThinkRail now stores spec metadata as YAML frontmatter inside each `.md` file instead of a centralized `registry.json`. If your project was created before this change, run the migration script to convert:

```bash
# From the project root
uv run python scripts/migrate_registry.py

# Or specify a project path explicitly
uv run python scripts/migrate_registry.py /path/to/your/project
```

The script will:

1. Read all entries and links from `.tr/registry.json`
2. Inject YAML frontmatter into each spec file
3. Archive the old registry to `.tr/registry.json.bak`
4. Print a summary of migrated / skipped / errored files

The SQLite index (`index.db`) is rebuilt automatically on the next ThinkRail startup — no manual step needed.

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