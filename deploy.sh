#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$ROOT/backend/.venv"
UV_TEMP_DIR=""  # set if we install uv temporarily

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

# ── Cleanup on exit ──
cleanup() {
    trap - EXIT INT TERM
    echo ""
    echo "Shutting down..."
    kill 0 2>/dev/null
    wait 2>/dev/null

    echo "Cleaning up environment..."
    rm -rf "$VENV_DIR"
    rm -rf "$ROOT/frontend/node_modules"
    [ -n "$UV_TEMP_DIR" ] && rm -rf "$UV_TEMP_DIR"

    echo "Done."
}
trap cleanup EXIT INT TERM

# ── Install uv if missing ──
if ! command -v uv &>/dev/null; then
    echo "uv not found — installing temporarily..."
    UV_TEMP_DIR="$(mktemp -d)"
    export INSTALLER_NO_MODIFY_PATH=1
    curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR="$UV_TEMP_DIR" sh
    export PATH="$UV_TEMP_DIR:$PATH"
    echo "  uv installed at $UV_TEMP_DIR"
fi

# ── Check node / npm ──
if ! command -v node &>/dev/null; then
    echo "Error: 'node' is not installed. Install it from https://nodejs.org or via nvm."
    exit 1
fi

if ! command -v npm &>/dev/null; then
    echo "Error: 'npm' is not installed. It should come with Node.js."
    exit 1
fi

# ── Check ports are free ──
for PORT in $BACKEND_PORT $FRONTEND_PORT; do
    if lsof -iTCP:"$PORT" -sTCP:LISTEN -t &>/dev/null; then
        echo "Error: port $PORT is already in use."
        echo "Run:  lsof -iTCP:$PORT -sTCP:LISTEN"
        exit 1
    fi
done

# ── Python virtual environment (fresh) ──
echo "Creating Python virtual environment..."
rm -rf "$VENV_DIR"
cd "$ROOT/backend"
uv venv "$VENV_DIR" --python 3.11
uv sync

# ── Frontend dependencies ──
echo "Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install

# ── Start backend ──
echo "Starting backend on :$BACKEND_PORT..."
cd "$ROOT/backend"
uv run python -m app.main &

# ── Start frontend ──
echo "Starting frontend on :$FRONTEND_PORT..."
cd "$ROOT/frontend"
npm run dev &

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
echo ""
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "          http://${LOCAL_IP}:$FRONTEND_PORT  (LAN)"
echo "Backend:  http://localhost:$BACKEND_PORT"
echo ""
echo "For remote access, install Tailscale: https://tailscale.com/download"
echo "Press Ctrl+C to stop."

wait
