#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Prerequisite checks ──
if ! command -v uv &>/dev/null; then
    echo "Error: 'uv' is not installed."
    echo "Install it with:  curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "Error: 'node' is not installed."
    echo "Install it from https://nodejs.org or via your package manager."
    exit 1
fi

if ! command -v npm &>/dev/null; then
    echo "Error: 'npm' is not installed."
    echo "It should come with Node.js — see https://nodejs.org"
    exit 1
fi

cleanup() {
    trap - EXIT INT TERM
    echo ""
    echo "Shutting down..."
    kill 0 2>/dev/null
    wait 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

# ── Backend (FastAPI + uvicorn on :8000) ──
echo "Installing backend dependencies..."
cd "$ROOT/backend"
uv sync
echo "Starting backend..."
uv run python -m app.main &
BACKEND_PID=$!

# ── Frontend (Vite dev server on :3000) ──
echo "Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install
echo "Starting frontend..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both."

wait
