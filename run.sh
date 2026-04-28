#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$ROOT/backend/.venv"
UV_TEMP_DIR=""  # set if we install uv temporarily
FRESH=0

for arg in "$@"; do
    case "$arg" in
        --fresh) FRESH=1 ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

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

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# ── Cleanup on exit ──
cleanup() {
    trap - EXIT INT TERM
    echo ""
    echo "Shutting down..."
    kill 0 2>/dev/null
    wait 2>/dev/null

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
port_in_use() {
    if command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | grep -q ":$1 "
    elif command -v lsof &>/dev/null; then
        lsof -iTCP:"$1" -sTCP:LISTEN -t &>/dev/null
    else
        return 1  # can't check, assume free
    fi
}
# Probe up to +10 from $1; echo the first free port and return 0, else return 1.
find_free_port() {
    local start=$1
    local max=$((start + 10))
    local p
    for ((p=start; p<=max; p++)); do
        if ! port_in_use "$p"; then
            echo "$p"
            return 0
        fi
    done
    return 1
}
# For each named port var, if its current value is busy, substitute the next
# free port within +10 and warn; if the whole range is busy, exit non-zero.
for VAR in BACKEND_PORT FRONTEND_PORT; do
    requested=${!VAR}
    if port_in_use "$requested"; then
        if substitute=$(find_free_port "$requested"); then
            if [ "$substitute" != "$requested" ]; then
                echo "port $requested is in use; using $substitute instead"
                printf -v "$VAR" '%s' "$substitute"
                export "${VAR?}"
            fi
        else
            echo "Error: ports $requested..$((requested + 10)) are all in use." >&2
            exit 1
        fi
    fi
done

# ── Python virtual environment ──
cd "$ROOT/backend"
if [ "$FRESH" = "1" ]; then
    echo "Creating fresh Python virtual environment..."
    rm -rf "$VENV_DIR"
    uv venv "$VENV_DIR" --python 3.11
elif [ ! -d "$VENV_DIR" ]; then
    echo "No virtual environment found, creating..."
    uv venv "$VENV_DIR" --python 3.11
fi
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
