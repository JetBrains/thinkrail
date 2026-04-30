#!/usr/bin/env bash
# Build a standalone Bonsai executable and install it to ~/.local/bin (no sudo).
#
# Usage:
#   ./build_and_install.sh                # build + install to ~/.local/bin
#   ./build_and_install.sh --run          # build + install, then launch (auto-opens browser)
#   ./build_and_install.sh --clean        # wipe previous build artifacts first
#   ./build_and_install.sh --no-install   # build only, don't copy the binary
#   ./build_and_install.sh --prefix DIR   # install into DIR/bin instead of ~/.local/bin
#
# Output:
#   packaging/dist/bonsai          (single-file executable; broken on macOS 15+)
#   packaging/dist/bonsai-dir/     (directory bundle; this is what gets installed)
#   <prefix>/libexec/bonsai/       (installed bundle, default prefix: ~/.local)
#   <prefix>/bin/bonsai            (symlink into the bundle's launcher)

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN_AFTER=0
CLEAN=0
INSTALL=1
PREFIX="$HOME/.local"
UV_TEMP_DIR=""

while [ $# -gt 0 ]; do
    case "$1" in
        --run) RUN_AFTER=1; shift ;;
        --clean) CLEAN=1; shift ;;
        --no-install) INSTALL=0; shift ;;
        --prefix) PREFIX="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

cleanup() {
    [ -n "$UV_TEMP_DIR" ] && rm -rf "$UV_TEMP_DIR"
}
trap cleanup EXIT

# ── Toolchain checks ──
if ! command -v uv &>/dev/null; then
    echo "uv not found — installing temporarily..."
    UV_TEMP_DIR="$(mktemp -d)"
    export INSTALLER_NO_MODIFY_PATH=1
    curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR="$UV_TEMP_DIR" sh
    export PATH="$UV_TEMP_DIR:$PATH"
fi
command -v node >/dev/null || { echo "Error: 'node' not installed (https://nodejs.org)."; exit 1; }
command -v npm  >/dev/null || { echo "Error: 'npm' not installed."; exit 1; }

# ── Optional clean ──
if [ "$CLEAN" = "1" ]; then
    echo "Cleaning previous build artifacts..."
    rm -rf "$ROOT/frontend/dist" "$ROOT/packaging/dist" "$ROOT/packaging/build"
fi

# ── Build frontend (produces frontend/dist/, bundled by PyInstaller) ──
echo "==> Building frontend"
cd "$ROOT/frontend"
npm install
npm run build

# ── Sync backend deps ──
echo "==> Syncing backend dependencies"
cd "$ROOT/backend"
uv sync

# ── PyInstaller bundle ──
echo "==> Building standalone executable with PyInstaller"
cd "$ROOT/packaging"
uv run --project "$ROOT/backend" --with pyinstaller \
    pyinstaller bonsai.spec --noconfirm --distpath dist --workpath build

BINARY="$ROOT/packaging/dist/bonsai"
DIR_BINARY="$ROOT/packaging/dist/bonsai-dir/bonsai"

echo ""
echo "Build complete."
echo "  Single-file:  $BINARY"
echo "  Directory:    $DIR_BINARY"

# ── Install to <prefix>/bin (no sudo — defaults to ~/.local/bin) ──
#
# We install the PyInstaller *directory* bundle (bonsai-dir/) into
# <prefix>/libexec/bonsai and symlink <prefix>/bin/bonsai to its launcher.
#
# Why not the single-file binary? On recent macOS (Sequoia / 15+), the
# single-file PyInstaller bootloader unpacks to /var/folders/.../_MEI*
# at runtime; AppleSystemPolicy rejects the unpacked payload and SIGKILLs
# the process at load (kernel log: "load code signature error 2"). The
# directory bundle is loaded normally and works fine.
INSTALLED=""
ON_PATH=0
if [ "$INSTALL" = "1" ]; then
    BIN_DIR="$PREFIX/bin"
    LIBEXEC_DIR="$PREFIX/libexec/bonsai"
    DEST="$BIN_DIR/bonsai"
    SRC_DIR="$ROOT/packaging/dist/bonsai-dir"

    echo ""
    echo "==> Installing bundle to $LIBEXEC_DIR"
    mkdir -p "$BIN_DIR" "$(dirname "$LIBEXEC_DIR")"
    rm -rf "$LIBEXEC_DIR"
    cp -R "$SRC_DIR" "$LIBEXEC_DIR"

    echo "==> Linking $DEST -> $LIBEXEC_DIR/bonsai"
    ln -sf "$LIBEXEC_DIR/bonsai" "$DEST"
    INSTALLED="$DEST"
    echo "    Installed: $DEST"

    # Check whether BIN_DIR is on PATH so we can warn the user if not.
    case ":$PATH:" in
        *":$BIN_DIR:"*) ON_PATH=1 ;;
    esac
fi

echo ""
if [ -n "$INSTALLED" ]; then
    if [ "$ON_PATH" = "1" ]; then
        echo "Run with:  bonsai            (auto-opens browser at http://127.0.0.1:8000)"
        echo "First run: bonsai --init-admin <id> \"<Your Name>\""
    else
        echo "NOTE: $DEST_DIR is not on your PATH."
        echo "      Add it to your shell profile, e.g.:"
        echo "          echo 'export PATH=\"$DEST_DIR:\$PATH\"' >> ~/.zshrc && exec zsh"
        echo "      Or run the binary directly:"
        echo "          $INSTALLED"
        echo "      First run: $INSTALLED --init-admin <id> \"<Your Name>\""
    fi
else
    echo "Run with:  $BINARY"
fi

if [ "$RUN_AFTER" = "1" ]; then
    echo ""
    LAUNCH="${INSTALLED:-$BINARY}"
    echo "==> Launching $LAUNCH (browser will open automatically)"
    exec "$LAUNCH"
fi
