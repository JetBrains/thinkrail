#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Ensure .env exists ──
if [ ! -f "$ROOT/.env" ]; then
    if [ -f "$ROOT/.env.example" ]; then
        cp "$ROOT/.env.example" "$ROOT/.env"
        echo "Created .env from .env.example"
    fi
fi

# ── Load .env ──
if [ -f "$ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$ROOT/.env"
    set +a
fi

BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

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

# ── Backend ──
echo "Installing backend dependencies..."
cd "$ROOT/backend"
uv sync
echo "Starting backend on :$BACKEND_PORT..."
uv run python -m app.main &
BACKEND_PID=$!

# ── Frontend ──
echo "Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install
echo "Starting frontend on :$FRONTEND_PORT..."
npm run dev &
FRONTEND_PID=$!

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
echo ""
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "          http://${LOCAL_IP}:$FRONTEND_PORT  (LAN)"
echo "Backend:  http://localhost:$BACKEND_PORT"
echo ""
echo "For remote access, install Tailscale: https://tailscale.com/download"
echo "Press Ctrl+C to stop both."

wait
