#!/usr/bin/env bash
# ThinkRail binary installer.
#
# Public-repo install:
#   curl -fsSL https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh | bash
#
# Private/internal repo (while thinkrail is still private):
#   curl -fsSL -H "Authorization: Bearer $(gh auth token)" \
#     https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh \
#     | GH_TOKEN=$(gh auth token) bash -s -- --channel nightly
#
# Auth precedence: $GH_TOKEN → $GITHUB_TOKEN → `gh auth token` (if `gh` is on PATH).
# With a token, downloads go via the authenticated API asset endpoint.
# Without a token, the public release-download URL is used.
#
# Options (pass after `-s --`):
#   --channel stable|nightly   (default: stable)
#   --version X.Y.Z|latest     (default: latest)
#   --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/thinkrail)
#                              Allowed chars: A-Z a-z 0-9 _ - . / ~ and space.
#   --no-modify-path           don't touch shell rc files; just print PATH advice
#
# After install: run `thinkrail`. To update later: `thinkrail upgrade`.

set -euo pipefail

REPO="${THINKRAIL_REPO:-JetBrains/bonsai}"
CHANNEL="stable"
VERSION="latest"
PREFIX="${HOME}/.local"
MODIFY_PATH=1

usage() {
    cat >&2 <<'EOF'
ThinkRail binary installer.

Usage:
  curl -fsSL https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh | bash
  curl -fsSL ... | bash -s -- --channel nightly --version 0.2.0 --prefix ~/.local

Options:
  --channel stable|nightly   (default: stable)
  --version X.Y.Z|latest     (default: latest)
  --prefix DIR               (default: ~/.local; binary lands at <prefix>/bin/thinkrail)
                             Allowed chars: A-Z a-z 0-9 _ - . / ~ and space.
  --no-modify-path           don't touch shell rc files; just print PATH advice

Auth (private repo): set GH_TOKEN, GITHUB_TOKEN, or have `gh` authenticated.

After install: run `thinkrail`. To update later: `thinkrail upgrade`.
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
# PREFIX is interpolated into shell rc files later (the PATH block we append
# uses double-quoted command syntax). A prefix containing $(...), backticks,
# ;, |, etc. would execute on every new terminal once written into the rc
# file. Constrain to a conservative allow-list: letters, digits, and
# '_' '-' '.' '/' '~' and space. Spaces are kept because legitimate macOS
# paths contain them.
case "${PREFIX:-}" in
    "")
        echo "Error: --prefix must not be empty" >&2; exit 1 ;;
    *[!-A-Za-z0-9_./~\ ]*)
        echo "Error: --prefix contains characters that are unsafe to write into shell rc files." >&2
        echo "Allowed: letters, digits, and '_' '-' '.' '/' '~' space." >&2
        exit 1 ;;
esac

# ── Token discovery ───────────────────────────────────────────────────────
# Picks up GH_TOKEN, GITHUB_TOKEN, or `gh auth token` (silent fallback).
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ] && command -v gh >/dev/null 2>&1; then
    TOKEN=$(gh auth token 2>/dev/null || true)
fi

# Curl auth-arg array; empty when there's no token.
CURL_AUTH=()
if [ -n "$TOKEN" ]; then
    CURL_AUTH=(-H "Authorization: Bearer $TOKEN")
fi

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
ASSET_NAME="thinkrail-${OS}-${ARCH}"
[ "$OS" = "windows" ] && ASSET_NAME="${ASSET_NAME}.exe"

api() {
    curl -fsSL "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$REPO/$1"
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

# Extract an asset ID by name from a release JSON. Used for the
# authenticated download path. We avoid depending on jq by scanning the
# JSON line-by-line: each asset's "id" appears just before its "name".
asset_id() {
    local name="$1"
    awk -v target="$name" '
        /^[[:space:]]*"id":/ {
            id = $0
            gsub(/[^0-9]/, "", id)
        }
        /^[[:space:]]*"name":/ {
            n = $0
            sub(/^.*"name":[[:space:]]*"/, "", n)
            sub(/".*$/, "", n)
            if (n == target) { print id; exit }
        }
    '
}

echo "Resolving latest $CHANNEL release for ${OS}/${ARCH} ..."
TAG=$(resolve_tag)
if [ -z "$TAG" ]; then
    echo "Failed to resolve a $CHANNEL release. Has one been published yet?" >&2
    if [ -z "$TOKEN" ]; then
        echo "(If the repo is private, set GH_TOKEN or run \`gh auth login\` and retry.)" >&2
    fi
    exit 1
fi
echo "  → $TAG"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

download_asset() {
    local name="$1" out="$2"
    if [ -n "$TOKEN" ]; then
        # Auth path: API asset endpoint works for both public and private repos.
        local id
        id=$(api "releases/tags/$TAG" | asset_id "$name")
        if [ -z "$id" ]; then
            echo "Asset $name not found in release $TAG" >&2
            exit 1
        fi
        curl -fL --progress-bar "${CURL_AUTH[@]}" \
            -H "Accept: application/octet-stream" \
            -o "$out" \
            "https://api.github.com/repos/$REPO/releases/assets/$id"
    else
        # Public path: plain release-download URL, no auth needed.
        curl -fL --progress-bar \
            -o "$out" \
            "https://github.com/$REPO/releases/download/$TAG/$name"
    fi
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
# If $BIN_DIR is already on PATH there's nothing to do. Otherwise try to
# append it to the user's shell rc file (idempotent via a marker block).
# Falls back to printing instructions when:
#   - --no-modify-path was passed
#   - running on Windows (use the Windows env tools instead)
#   - the shell is unknown / unsupported
#   - writing to the rc file fails
PATH_NEEDS_MANUAL_ADD=0
case ":$PATH:" in
    *":$BIN_DIR:"*)
        # Already on PATH — nothing to do.
        ;;
    *)
        if [ "$MODIFY_PATH" -eq 0 ] || [ "$OS" = "windows" ]; then
            PATH_NEEDS_MANUAL_ADD=1
        else
            # Detect shell. $SHELL is the login shell, which is what the user
            # will get on the next terminal — exactly what we want to update.
            shell_name=$(basename "${SHELL:-}")
            rc_file=""
            rc_line=""
            case "$shell_name" in
                bash)
                    # macOS bash reads ~/.bash_profile for login shells; Linux
                    # bash reads ~/.bashrc for interactive non-login. Pick the
                    # one that exists, defaulting to ~/.bashrc on Linux and
                    # ~/.bash_profile on macOS.
                    if [ "$OS" = "macos" ]; then
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
                    # Single-quote the path so spaces (allowed by the prefix
                    # validator) don't get split into multiple fish arguments.
                    rc_line="fish_add_path '$BIN_DIR'"
                    ;;
                *)
                    PATH_NEEDS_MANUAL_ADD=1
                    ;;
            esac

            if [ -n "$rc_file" ]; then
                marker_begin="# >>> thinkrail PATH >>>"
                marker_end="# <<< thinkrail PATH <<<"
                # If the desired rc_line already lives between our markers,
                # there's nothing to do. Otherwise strip any existing marker
                # block (so reinstalling with a different --prefix doesn't
                # leave the old PATH entry active) and append a fresh block.
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
                    # Write to a sibling temp file then mv into place so we
                    # never leave a half-written rc file behind. mktemp next
                    # to the target keeps the mv on the same filesystem
                    # (atomic).
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
                            printf '\n%s\n%s\n%s\n' \
                                "$marker_begin" \
                                "$rc_line" \
                                "$marker_end"
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
echo "Upgrade later:  thinkrail upgrade"
