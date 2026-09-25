#!/usr/bin/env bash
# ThinkRail binary installer — downloads the single-file `thinkrail` executable for your platform from
# the GitHub releases, verifies its checksum, and puts it on your PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
#
# Options (pass after `-s --`):
#   --channel stable|nightly   (default: stable)
#   --version X.Y.Z|X.Y.Z-nightly.N|latest
#                              (default: latest)
#   --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/thinkrail)
#   --no-modify-path           don't touch shell rc files; just print PATH advice
#
# After install, run `thinkrail`. To update later, run `thinkrail update`; to remove it, run
# `thinkrail uninstall`.

set -euo pipefail

REPO="${THINKRAIL_REPO:-JetBrains/thinkrail}"
CHANNEL="stable"
VERSION="latest"
if [ -z "${HOME:-}" ]; then
    echo "Error: HOME is not set; pass a shell environment with a home directory." >&2
    exit 1
fi
PREFIX="${HOME}/.local"
MODIFY_PATH=1

usage() {
    cat >&2 <<'EOF'
ThinkRail binary installer.

Usage:
  curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
  curl -fsSL ... | bash -s -- --channel nightly --version 0.2.0-nightly.4 --prefix ~/.local

Options:
  --channel stable|nightly   (default: stable)
  --version X.Y.Z|X.Y.Z-nightly.N|latest
                             (default: latest)
  --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/thinkrail)
  --no-modify-path           don't touch shell rc files; just print PATH advice

After install, run `thinkrail`. To update later, run `thinkrail update`; to remove it, run
`thinkrail uninstall`.
EOF
    exit "${1:-0}"
}

missing_value() {
    echo "Error: $1 requires a value" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --channel)
            [ $# -ge 2 ] || missing_value "$1"
            CHANNEL="$2"
            shift 2
            ;;
        --channel=*)
            CHANNEL="${1#*=}"
            [ -n "$CHANNEL" ] || missing_value "--channel"
            shift
            ;;
        --version)
            [ $# -ge 2 ] || missing_value "$1"
            VERSION="$2"
            shift 2
            ;;
        --version=*)
            VERSION="${1#*=}"
            [ -n "$VERSION" ] || missing_value "--version"
            shift
            ;;
        --prefix)
            [ $# -ge 2 ] || missing_value "$1"
            PREFIX="$2"
            shift 2
            ;;
        --prefix=*)
            PREFIX="${1#*=}"
            [ -n "$PREFIX" ] || missing_value "--prefix"
            shift
            ;;
        --no-modify-path)
            MODIFY_PATH=0
            shift
            ;;
        -h|--help)
            usage 0
            ;;
        *)
            echo "Unknown arg: $1" >&2
            usage 1
            ;;
    esac
done

case "$CHANNEL" in
    stable|nightly) ;;
    *)
        echo "Invalid channel: $CHANNEL (expected: stable or nightly)" >&2
        exit 1
        ;;
esac

if [[ ! "$VERSION" =~ ^(latest|[0-9]+\.[0-9]+\.[0-9]+(-nightly\.[0-9]+)?)$ ]]; then
    echo "Invalid version: $VERSION (expected: X.Y.Z, X.Y.Z-nightly.N, or latest)" >&2
    exit 1
fi
if [ "$VERSION" != "latest" ]; then
    if [ "$CHANNEL" = "stable" ] && [[ "$VERSION" = *-nightly.* ]]; then
        echo "Version $VERSION does not belong to the stable channel" >&2
        exit 1
    fi
    if [ "$CHANNEL" = "nightly" ] && [[ "$VERSION" != *-nightly.* ]]; then
        echo "Version $VERSION does not belong to the nightly channel" >&2
        exit 1
    fi
fi

detect_os() {
    case "$(uname -s)" in
        Linux*) echo linux ;;
        Darwin*) echo darwin ;;
        MINGW*|MSYS*|CYGWIN*) echo windows ;;
        *)
            echo "Unsupported OS: $(uname -s)" >&2
            exit 1
            ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo x64 ;;
        arm64|aarch64) echo arm64 ;;
        *)
            echo "Unsupported architecture: $(uname -m)" >&2
            exit 1
            ;;
    esac
}

case "$PREFIX" in
    "~") PREFIX="$HOME" ;;
    "~/"*) PREFIX="$HOME/${PREFIX#\~/}" ;;
esac
[ -n "$PREFIX" ] || missing_value "--prefix"

OS=$(detect_os)
METADATA_PREFIX="$PREFIX"
CONFIG_HOME="$HOME"
if [ "$OS" = "windows" ]; then
    if [[ ! "$PREFIX" =~ ^[-A-Za-z0-9_./:\ \\]+$ ]]; then
        echo "Error: --prefix contains unsafe characters." >&2
        exit 1
    fi
    command -v cygpath >/dev/null 2>&1 || {
        echo "Error: cygpath is required when running install.sh on Windows." >&2
        exit 1
    }
    PREFIX=$(cygpath -u -- "$PREFIX") || {
        echo "Error: --prefix must be an absolute Windows path." >&2
        exit 1
    }
    METADATA_PREFIX=$(cygpath -m -- "$PREFIX") || {
        echo "Error: --prefix must be an absolute Windows path." >&2
        exit 1
    }
    if [[ ! "$PREFIX" = /* ]] || [[ ! "$METADATA_PREFIX" =~ ^([A-Za-z]:/|//[^/]+/[^/]+) ]]; then
        echo "Error: --prefix must be an absolute Windows path." >&2
        exit 1
    fi
    if [ -z "${USERPROFILE:-}" ]; then
        echo "Error: USERPROFILE is not set; it is required when running install.sh on Windows." >&2
        exit 1
    fi
    CONFIG_HOME=$(cygpath -u -- "$USERPROFILE") || {
        echo "Error: USERPROFILE is not a usable Windows path." >&2
        exit 1
    }
else
    if [[ ! "$PREFIX" =~ ^[-A-Za-z0-9_./\ ]+$ ]]; then
        echo "Error: --prefix contains characters that are unsafe to write into shell rc files." >&2
        echo "Allowed: letters, digits, and '_' '-' '.' '/' space." >&2
        exit 1
    fi
    if [[ "$PREFIX" != /* ]]; then
        echo "Error: --prefix must be an absolute path." >&2
        exit 1
    fi
fi

ARCH=$(detect_arch)
[ "$OS" = "windows" ] && ARCH="x64"
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
        printf 'v%s\n' "$VERSION"
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
if [ "$CHANNEL" = "stable" ]; then
    TAG_VALID_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+$'
else
    TAG_VALID_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+$'
fi
if [[ ! "$TAG" =~ $TAG_VALID_PATTERN ]]; then
    echo "Invalid resolved tag for the $CHANNEL channel: $TAG" >&2
    exit 1
fi
echo "  → $TAG"

TMP=$(mktemp -d)
STAGED_BINARY=""
META_TMP=""
cleanup() {
    [ -z "$STAGED_BINARY" ] || rm -f "$STAGED_BINARY" || true
    [ -z "$META_TMP" ] || rm -f "$META_TMP" || true
    rm -rf "$TMP" || true
}
trap cleanup EXIT

download_asset() {
    local name="$1" out="$2"
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
STAGED_BINARY=$(mktemp "$BIN_DIR/.thinkrail.XXXXXX.new")
if ! cp "$TMP/$ASSET_NAME" "$STAGED_BINARY"; then
    echo "Failed to stage ThinkRail in $BIN_DIR; the previous executable was left unchanged." >&2
    exit 1
fi
if ! chmod +x "$STAGED_BINARY"; then
    echo "Failed to make the staged ThinkRail executable runnable; the previous executable was left unchanged." >&2
    exit 1
fi
if ! mv -f "$STAGED_BINARY" "$DEST"; then
    echo "Failed to replace $DEST; the previous executable was left unchanged." >&2
    exit 1
fi
STAGED_BINARY=""
echo "Installed → $DEST"

CONFIG_DIR="$CONFIG_HOME/.config/thinkrail"
mkdir -p "$CONFIG_DIR"
META_TMP=$(mktemp "$CONFIG_DIR/.install.json.XXXXXX.tmp")
cat > "$META_TMP" <<EOF
{
  "channel": "$CHANNEL",
  "version": "${TAG#v}",
  "tag": "$TAG",
  "prefix": "$METADATA_PREFIX",
  "path_entry_added": false,
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
if ! mv -f "$META_TMP" "$CONFIG_DIR/install.json"; then
    echo "Failed to record install metadata in $CONFIG_DIR." >&2
    exit 1
fi
META_TMP=""

echo
echo "ThinkRail ${TAG#v} ($CHANNEL) installed."

PATH_NEEDS_MANUAL_ADD=0
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
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
                *) PATH_NEEDS_MANUAL_ADD=1 ;;
            esac

            if [ -n "$rc_file" ]; then
                marker_begin="# >>> thinkrail PATH >>>"
                marker_end="# <<< thinkrail PATH <<<"
                markers_valid=1
                if [ -f "$rc_file" ] && ! awk -v begin="$marker_begin" -v end="$marker_end" '
                    $0 == begin {
                        if (in_block) bad = 1
                        in_block = 1
                        next
                    }
                    $0 == end {
                        if (!in_block) bad = 1
                        in_block = 0
                        next
                    }
                    END { exit (bad || in_block) ? 1 : 0 }
                ' "$rc_file" 2>/dev/null; then
                    markers_valid=0
                    echo "PATH:           warning: malformed ThinkRail PATH markers in $rc_file; left it unchanged" >&2
                    PATH_NEEDS_MANUAL_ADD=1
                fi

                if [ "$markers_valid" -eq 1 ] && [ -f "$rc_file" ] \
                    && awk -v begin="$marker_begin" -v end="$marker_end" -v target="$rc_line" '
                        $0 == begin { in_block = 1; next }
                        $0 == end { in_block = 0; next }
                        in_block && $0 == target { found = 1; exit }
                        END { exit found ? 0 : 1 }
                    ' "$rc_file" 2>/dev/null; then
                    echo "PATH:           already configured in $rc_file"
                elif [ "$markers_valid" -eq 1 ]; then
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
                        } > "$tmp_rc" 2>/dev/null && mv -f "$tmp_rc" "$rc_file" 2>/dev/null; then
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
                        [ -z "$tmp_rc" ] || rm -f "$tmp_rc"
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
echo "Uninstall:      thinkrail uninstall"
