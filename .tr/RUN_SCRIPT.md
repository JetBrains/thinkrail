---
id: run-script
type: submodule-design
status: active
title: Run Script (run.sh) — Developer Bootstrap & Port Handling
parent: design-doc
covers:
  - run.sh
tags:
  - developer-workflow
  - infrastructure
---
# Run Script (`run.sh`) — Developer Bootstrap & Port Handling

## Purpose

`run.sh` is the developer entry point that brings up the full local stack with a single command. It loads `.env`, ensures `uv` / `node` / `npm` are available, performs a port-preflight, then starts the backend (FastAPI on `BACKEND_PORT`) and the frontend (Vite on `FRONTEND_PORT`) as supervised child processes.

## Expected behaviour

- Creates `.env` from `.env.example` on first run if missing; loads `.env` into the environment.
- Resolves `BACKEND_PORT` (default `8000`) and `FRONTEND_PORT` (default `3000`).
- Verifies `node` and `npm` are installed; auto-installs `uv` to a temp dir if missing (cleaned up on exit).
- **Port preflight (corrected intent — bug fix scope):** when the requested `BACKEND_PORT` or `FRONTEND_PORT` is already in use, the script must **not** fail. It picks the next free port within a small range (e.g., up to `+10` of the requested port), warns the user about the substitution (e.g., `"port 8000 is in use; using 8001 instead"`), and continues with the substitute. Only when the entire range is exhausted does the script exit non-zero with a clear error naming the exhausted range.
- Installs Python deps via `uv sync` and frontend deps via `npm install`.
- Starts the backend (`uv run python -m app.main`) and the frontend (`npm run dev`) as backgrounded children; prints localhost and LAN URLs.
- Traps `EXIT`/`INT`/`TERM` to kill children, wait for cleanup, and remove any temp `uv` install dir.
- Accepts `--fresh` to recreate the Python venv from scratch; rejects unknown arguments with a clear error.

## Cross-references

- **Parent:** [`design-doc`](../DESIGN_DOC.md) — system architecture (backend + frontend)
- **Siblings:** _no peers — first spec for this area_
- **Covers:** `run.sh`
