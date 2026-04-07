# Bonsai

**Stable version available on the [`stable`](../../tree/stable) branch.**

Specification-driven development workspace. Hierarchical, interconnected specs live in the repo alongside code — helping developers align AI coding agents through structured project context.

## Quick Start

```bash
git clone <repo-url>
cd bonsai
./deploy.sh
```

The script installs all dependencies, starts the backend and frontend, and opens:

- **Backend:** http://localhost:8000
- **Frontend:** http://localhost:3000

Press `Ctrl+C` to stop. Cleanup is automatic.

### Prerequisites

- **Node.js** (with npm)
- **Python 3.11+**
- **uv** (installed automatically if missing)

### Configuration

Copy `.env.example` to `.env` to override default ports:

```bash
cp .env.example .env
```

## Stable Version

For the latest stable release, use the `stable` branch:

```bash
git checkout stable
./deploy.sh
```
