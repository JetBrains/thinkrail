#!/usr/bin/env bash
# Build the Electron app end-to-end on the current OS.
#
# Pipeline:
#   1. Build frontend          (frontend/dist/)
#   2. Build PyInstaller bundle (packaging/dist/bonsai-dir/)
#   3. Stage bundle into electron/resources/backend/
#   4. Build Electron + electron-builder
#
# Output (per OS): electron/dist/Bonsai-<version>.{dmg,AppImage,exe}
#
# Usage:
#   ./electron/scripts/build.sh                # build for current OS
#   ./electron/scripts/build.sh --skip-backend # reuse existing PyInstaller build
#   SKIP_BACKEND=1 ./electron/scripts/build.sh # same as above

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$ELECTRON_DIR/.." && pwd)"

SKIP_BACKEND=${SKIP_BACKEND:-0}
for arg in "$@"; do
  case "$arg" in
    --skip-backend) SKIP_BACKEND=1 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [ "$SKIP_BACKEND" != "1" ]; then
  echo "==> Building PyInstaller backend bundle (and frontend)"
  "$ROOT/build_and_install.sh" --no-install
fi

if [ ! -d "$ROOT/packaging/dist/bonsai-dir" ]; then
  echo "Error: $ROOT/packaging/dist/bonsai-dir not found." >&2
  echo "Run without --skip-backend to build the backend first." >&2
  exit 1
fi

echo "==> Building Electron app"
cd "$ELECTRON_DIR"
if [ ! -d node_modules ]; then
  npm install
fi
npm run package

echo ""
echo "Done. Installers in: $ELECTRON_DIR/dist/"
ls "$ELECTRON_DIR/dist" 2>/dev/null || true
