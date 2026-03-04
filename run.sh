#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

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
echo "Starting backend..."
cd "$ROOT/backend"
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
