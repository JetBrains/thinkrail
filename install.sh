#!/usr/bin/env bash
# Bonsai binary installer.
#
#   curl -fsSL https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh | bash
#
# Options (pass after `-s --`):
#   --channel stable|nightly   (default: stable)
#   --version X.Y.Z|latest     (default: latest)
#   --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/bonsai)
#
# After install: run `bonsai`. To update later: `bonsai upgrade`.

set -euo pipefail

REPO="${BONSAI_REPO:-JetBrains/bonsai}"
CHANNEL="stable"
VERSION="latest"
PREFIX="${HOME}/.local"

usage() {
    cat >&2 <<'EOF'
Bonsai binary installer.

Usage:
  curl -fsSL https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh | bash
  curl -fsSL ... | bash -s -- --channel nightly --version 0.2.0 --prefix ~/.local

Options:
  --channel stable|nightly   (default: stable)
  --version X.Y.Z|latest     (default: latest)
  --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/bonsai)

After install: run `bonsai`. To update later: `bonsai upgrade`.
EOF
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --channel)   CHANNEL="$2";       shift 2 ;;
        --channel=*) CHANNEL="${1#*=}";  shift ;;
        --version)   VERSION="$2";       shift 2 ;;
        --version=*) VERSION="${1#*=}";  shift ;;
        --prefix)    PREFIX="$2";        shift 2 ;;
        --prefix=*)  PREFIX="${1#*=}";   shift ;;
        -h|--help)   usage 0 ;;
        *) echo "Unknown arg: $1" >&2; usage 1 ;;
    esac
done

case "$CHANNEL" in
    stable|nightly) ;;
    *) echo "Invalid channel: $CHANNEL (expected: stable or nightly)" >&2; exit 1 ;;
esac

detect_os() {
    case "$(uname -s)" in
        Linux*)  echo linux ;;
        Darwin*) echo macos ;;
        MINGW*|MSYS*|CYGWIN*) echo windows ;;
        *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   echo x64 ;;
        arm64|aarch64)  echo arm64 ;;
        *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac
}

OS=$(detect_os)
ARCH=$(detect_arch)
ASSET_NAME="bonsai-${OS}-${ARCH}"
[ "$OS" = "windows" ] && ASSET_NAME="${ASSET_NAME}.exe"

api() {
    curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/$1"
}

resolve_tag() {
    if [ "$VERSION" != "latest" ]; then
        printf 'v%s\n' "${VERSION#v}"
        return
    fi
    if [ "$CHANNEL" = "stable" ]; then
        api "releases/latest" \
            | grep '"tag_name"' \
            | head -1 \
            | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
    else
        api "releases?per_page=20" \
            | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+"' \
            | head -1 \
            | sed -E 's/.*"(v[^"]+)".*/\1/'
    fi
}

echo "Resolving latest $CHANNEL release for ${OS}/${ARCH} ..."
TAG=$(resolve_tag)
if [ -z "$TAG" ]; then
    echo "Failed to resolve a $CHANNEL release. Has one been published yet?" >&2
    exit 1
fi
echo "  → $TAG"

DOWNLOAD_BASE="https://github.com/$REPO/releases/download/$TAG"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $ASSET_NAME ..."
curl -fL --progress-bar -o "$TMP/$ASSET_NAME" "$DOWNLOAD_BASE/$ASSET_NAME"
echo "Downloading SHA256SUMS ..."
curl -fsSL -o "$TMP/SHA256SUMS" "$DOWNLOAD_BASE/SHA256SUMS"

echo "Verifying checksum ..."
expected=$(grep -E " ${ASSET_NAME}\$" "$TMP/SHA256SUMS" | awk '{print $1}')
if [ -z "$expected" ]; then
    echo "Checksum entry not found for $ASSET_NAME in SHA256SUMS" >&2
    exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$TMP/$ASSET_NAME" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$TMP/$ASSET_NAME" | awk '{print $1}')
else
    echo "Neither sha256sum nor shasum found; cannot verify checksum" >&2
    exit 1
fi
if [ "$expected" != "$actual" ]; then
    echo "Checksum mismatch!" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
fi
echo "  → ok"

BIN_DIR="$PREFIX/bin"
mkdir -p "$BIN_DIR"
DEST="$BIN_DIR/bonsai"
[ "$OS" = "windows" ] && DEST="$BIN_DIR/bonsai.exe"
mv "$TMP/$ASSET_NAME" "$DEST"
chmod +x "$DEST"
echo "Installed → $DEST"

CONFIG_DIR="${HOME}/.config/bonsai"
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/install.json" <<EOF
{
  "channel": "$CHANNEL",
  "version": "${TAG#v}",
  "tag": "$TAG",
  "prefix": "$PREFIX",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo
echo "Bonsai ${TAG#v} ($CHANNEL) installed."
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Add to PATH:    export PATH=\"\$PATH:$BIN_DIR\"" ;;
esac
echo "Run:            bonsai"
echo "Upgrade later:  bonsai upgrade"
