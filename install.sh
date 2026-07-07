#!/usr/bin/env bash
# ThinkRail binary installer — downloads the single-file `thinkrail` executable for your platform from
# the GitHub releases, verifies its checksum, and puts it on your PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
#
# Options (pass after `-s --`):
#   --channel stable|nightly   (default: stable)
#   --version X.Y.Z|latest     (default: latest)
#   --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/thinkrail)
#                              Allowed chars: A-Z a-z 0-9 _ - . / ~ and space.
#   --no-modify-path           don't touch shell rc files; just print PATH advice
#
# After install, run `thinkrail`. To update later, run `thinkrail update` (or re-run this installer).

set -euo pipefail

REPO="${THINKRAIL_REPO:-JetBrains/thinkrail}"
CHANNEL="stable"
VERSION="latest"
PREFIX="${HOME}/.local"
MODIFY_PATH=1

usage() {
    cat >&2 <<'EOF'
ThinkRail binary installer.

Usage:
  curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
  curl -fsSL ... | bash -s -- --channel nightly --version 0.2.0 --prefix ~/.local

Options:
  --channel stable|nightly   (default: stable)
  --version X.Y.Z|latest     (default: latest)
  --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/thinkrail)
                             Allowed chars: A-Z a-z 0-9 _ - . / ~ and space.
  --no-modify-path           don't touch shell rc files; just print PATH advice

After install, run `thinkrail`. To update later, run `thinkrail update` (or re-run this installer).
EOF
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --channel)         CHANNEL="$2";       shift 2 ;;
        --channel=*)       CHANNEL="${1#*=}";  shift ;;
        --version)         VERSION="$2";       shift 2 ;;
        --version=*)       VERSION="${1#*=}";  shift ;;
        --prefix)          PREFIX="$2";        shift 2 ;;
        --prefix=*)        PREFIX="${1#*=}";   shift ;;
        --no-modify-path)  MODIFY_PATH=0;      shift ;;
        -h|--help)         usage 0 ;;
        *) echo "Unknown arg: $1" >&2; usage 1 ;;
    esac
done

case "$CHANNEL" in
    stable|nightly) ;;
    *) echo "Invalid channel: $CHANNEL (expected: stable or nightly)" >&2; exit 1 ;;
esac

# ── Validate PREFIX ───────────────────────────────────────────────────────
# PREFIX is interpolated into shell rc files later. Constrain to a conservative allow-list so a prefix
# containing $(...), backticks, ;, |, etc. can't execute when written into an rc file.
case "${PREFIX:-}" in
    "")
        echo "Error: --prefix must not be empty" >&2; exit 1 ;;
    *[!-A-Za-z0-9_./~\ ]*)
        echo "Error: --prefix contains characters that are unsafe to write into shell rc files." >&2
        echo "Allowed: letters, digits, and '_' '-' '.' '/' '~' space." >&2
        exit 1 ;;
esac

detect_os() {
    case "$(uname -s)" in
        Linux*)  echo linux ;;
        Darwin*) echo darwin ;;
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
# Windows on ARM has no native build yet; the x64 binary runs under emulation.
[ "$OS" = "windows" ] && ARCH="x64"
# Intel macOS isn't prebuilt (the release matrix skips it for runner-queue latency).
if [ "$OS" = "darwin" ] && [ "$ARCH" = "x64" ]; then
    echo "No prebuilt ThinkRail for Intel macOS." >&2
    echo "Use an Apple Silicon Mac, or build from source: https://github.com/$REPO" >&2
    echo "(On Apple Silicon, run this from a native arm64 shell — a Rosetta shell reports x86_64.)" >&2
    exit 1
fi
ASSET_NAME="thinkrail-${OS}-${ARCH}"
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

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

download_asset() {
    local name="$1" out="$2"
    # -L follows the redirect to the pre-signed asset URL.
    curl -fL --progress-bar -o "$out" \
        "https://github.com/$REPO/releases/download/$TAG/$name"
}

echo "Downloading $ASSET_NAME ..."
download_asset "$ASSET_NAME" "$TMP/$ASSET_NAME"
echo "Downloading SHA256SUMS ..."
download_asset "SHA256SUMS" "$TMP/SHA256SUMS"

echo "Verifying checksum ..."
expected=$(awk -v name="$ASSET_NAME" '$2 == name {print $1; exit}' "$TMP/SHA256SUMS")
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
DEST="$BIN_DIR/thinkrail"
[ "$OS" = "windows" ] && DEST="$BIN_DIR/thinkrail.exe"
mv "$TMP/$ASSET_NAME" "$DEST"
chmod +x "$DEST"
echo "Installed → $DEST"

CONFIG_DIR="${HOME}/.config/thinkrail"
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
echo "ThinkRail ${TAG#v} ($CHANNEL) installed."

# ── PATH setup ────────────────────────────────────────────────────────────
# If $BIN_DIR is on PATH, nothing to do. Otherwise append it to the login shell's rc file (idempotent
# via a marker block), or print instructions when we can't / shouldn't touch it.
PATH_NEEDS_MANUAL_ADD=0
case ":$PATH:" in
    *":$BIN_DIR:"*)
        ;;
    *)
        if [ "$MODIFY_PATH" -eq 0 ] || [ "$OS" = "windows" ]; then
            PATH_NEEDS_MANUAL_ADD=1
        else
            shell_name=$(basename "${SHELL:-}")
            rc_file=""
            rc_line=""
            case "$shell_name" in
                bash)
                    if [ "$OS" = "darwin" ]; then
                        rc_file="$HOME/.bash_profile"
                    else
                        rc_file="$HOME/.bashrc"
                    fi
                    rc_line="export PATH=\"\$PATH:$BIN_DIR\""
                    ;;
                zsh)
                    rc_file="${ZDOTDIR:-$HOME}/.zshrc"
                    rc_line="export PATH=\"\$PATH:$BIN_DIR\""
                    ;;
                fish)
                    rc_file="$HOME/.config/fish/conf.d/thinkrail.fish"
                    rc_line="fish_add_path '$BIN_DIR'"
                    ;;
                *)
                    PATH_NEEDS_MANUAL_ADD=1
                    ;;
            esac

            if [ -n "$rc_file" ]; then
                marker_begin="# >>> thinkrail PATH >>>"
                marker_end="# <<< thinkrail PATH <<<"
                if [ -f "$rc_file" ] \
                    && awk -v begin="$marker_begin" -v end="$marker_end" -v target="$rc_line" '
                        $0 == begin { in_block = 1; next }
                        $0 == end { in_block = 0; next }
                        in_block && $0 == target { found = 1; exit }
                        END { exit found ? 0 : 1 }
                    ' "$rc_file" 2>/dev/null; then
                    echo "PATH:           already configured in $rc_file"
                else
                    had_stale_block=0
                    if [ -f "$rc_file" ] && grep -Fq "$marker_begin" "$rc_file" 2>/dev/null; then
                        had_stale_block=1
                    fi
                    mkdir -p "$(dirname "$rc_file")" 2>/dev/null || true
                    tmp_rc=$(mktemp "${rc_file}.XXXXXX" 2>/dev/null) || tmp_rc=""
                    wrote_ok=0
                    if [ -n "$tmp_rc" ]; then
                        if {
                            if [ -f "$rc_file" ]; then
                                awk -v begin="$marker_begin" -v end="$marker_end" '
                                    $0 == begin { skip = 1; next }
                                    $0 == end && skip { skip = 0; next }
                                    !skip { print }
                                ' "$rc_file"
                            fi
                            printf '\n%s\n%s\n%s\n' "$marker_begin" "$rc_line" "$marker_end"
                        } > "$tmp_rc" 2>/dev/null && mv "$tmp_rc" "$rc_file" 2>/dev/null; then
                            wrote_ok=1
                        fi
                    fi
                    if [ "$wrote_ok" -eq 1 ]; then
                        if [ "$had_stale_block" -eq 1 ]; then
                            echo "PATH:           updated $rc_file to point at $BIN_DIR"
                        else
                            echo "PATH:           added $BIN_DIR to $rc_file"
                        fi
                        echo "                start a new shell or run: source $rc_file"
                    else
                        if [ -n "$tmp_rc" ]; then rm -f "$tmp_rc"; fi
                        echo "PATH:           could not write to $rc_file" >&2
                        PATH_NEEDS_MANUAL_ADD=1
                    fi
                fi
            fi
        fi
        ;;
esac

if [ "$PATH_NEEDS_MANUAL_ADD" -eq 1 ]; then
    echo "Add to PATH:    export PATH=\"\$PATH:$BIN_DIR\""
fi

echo "Run:            thinkrail"
echo "Update later:   thinkrail update"
