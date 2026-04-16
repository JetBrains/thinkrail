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

## Authentication & First-Time Setup

### Development (from source)

Create the first admin user via CLI:

```bash
cd backend && uv run python -m app.cli create-user --id bonsai --name "Bonsai" --admin
# → Token: bns_a8f3k2m9...
```
