#!/usr/bin/env bash
# Compute the next release version (nightly or stable) from existing git tags.
#
# Tag formats recognised:
#   vX.Y.Z              -> stable
#   vX.Y.Z-nightly.N    -> nightly (N is a per-base counter)
#
# Output is the bare version (no `v` prefix). Errors go to stderr.
# Exit codes: 0 ok, 1 invalid input or validation failure, 2 git error.

set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

usage() {
    cat >&2 <<EOF
Usage:
  $(basename "$0") nightly         [--tags="<space-separated>"]
  $(basename "$0") stable          --bump=major|minor|patch [--tags=...]
  $(basename "$0") stable          --bump=explicit --version=X.Y.Z [--tags=...]
  $(basename "$0") latest-stable   [--tags=...]
  $(basename "$0") latest-nightly  [--tags=...]

Tags come from \`git tag -l\` unless --tags is provided (for testing).
EOF
    exit 1
}

# Normalise X.Y.Z[-nightly.N] into a sortable string.
# A trailing ".1.0" on stable vs ".0.<N>" on nightly ensures stable > pre-release
# of the same base, matching semver (the opposite of plain \`sort -V\`).
normalize() {
    local v="$1"
    if [[ "$v" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        printf '%010d.%010d.%010d.1.%010d\n' \
            "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" 0
    elif [[ "$v" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)-nightly\.([0-9]+)$ ]]; then
        printf '%010d.%010d.%010d.0.%010d\n' \
            "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
    else
        return 1
    fi
}

semver_gt() {
    local a b
    a=$(normalize "$1") || return 2
    b=$(normalize "$2") || return 2
    [[ "$a" > "$b" ]]
}

semver_ge() {
    local a b
    a=$(normalize "$1") || return 2
    b=$(normalize "$2") || return 2
    [[ "$a" > "$b" ]] || [[ "$a" == "$b" ]]
}

base_of() {
    [[ "$1" =~ ^([0-9]+\.[0-9]+\.[0-9]+) ]] || return 1
    printf '%s\n' "${BASH_REMATCH[1]}"
}

nightly_counter_of() {
    if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.([0-9]+)$ ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
    else
        printf '0\n'
    fi
}

bump_major() { awk -F. '{print $1+1".0.0"}' <<<"$1"; }
bump_minor() { awk -F. '{print $1"."$2+1".0"}' <<<"$1"; }
bump_patch() { awk -F. '{print $1"."$2"."$3+1}' <<<"$1"; }

TAGS_OVERRIDE=""

load_tags() {
    if [ -n "$TAGS_OVERRIDE" ]; then
        printf '%s\n' $TAGS_OVERRIDE
    else
        git tag -l 2>/dev/null || { echo "error: 'git tag' failed (not a git repo?)" >&2; exit 2; }
    fi
}

highest_matching() {
    local pattern="$1"
    local highest="" v
    while IFS= read -r tag; do
        [ -z "$tag" ] && continue
        [[ "$tag" =~ $pattern ]] || continue
        v="${tag#v}"
        if [ -z "$highest" ] || semver_gt "$v" "$highest"; then
            highest="$v"
        fi
    done
    printf '%s\n' "$highest"
}

cmd_latest_stable() {
    load_tags | highest_matching '^v[0-9]+\.[0-9]+\.[0-9]+$'
}

cmd_latest_nightly() {
    load_tags | highest_matching '^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+$'
}

cmd_nightly() {
    local hs hn next_minor nightly_base n
    hs=$(cmd_latest_stable)
    hn=$(cmd_latest_nightly)
    next_minor=$(bump_minor "${hs:-0.0.0}")

    if [ -n "$hn" ]; then
        nightly_base=$(base_of "$hn")
        if semver_ge "$nightly_base" "$next_minor"; then
            n=$(nightly_counter_of "$hn")
            printf '%s-nightly.%d\n' "$nightly_base" "$((n + 1))"
            return 0
        fi
    fi
    printf '%s-nightly.1\n' "$next_minor"
}

cmd_stable() {
    local bump="" version=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --bump=*)    bump="${1#*=}";    shift ;;
            --version=*) version="${1#*=}"; shift ;;
            *) die "unknown arg: $1" ;;
        esac
    done
    [ -z "$bump" ] && die "stable: --bump is required"

    local hs hn candidate
    hs=$(cmd_latest_stable)
    hn=$(cmd_latest_nightly)

    case "$bump" in
        major) candidate=$(bump_major "${hs:-0.0.0}") ;;
        minor) candidate=$(bump_minor "${hs:-0.0.0}") ;;
        patch) candidate=$(bump_patch "${hs:-0.0.0}") ;;
        explicit)
            [ -z "$version" ] && die "stable --bump=explicit requires --version=X.Y.Z"
            [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
                || die "version must be X.Y.Z (no v prefix, no pre-release): $version"
            candidate="$version"
            ;;
        *) die "stable: --bump must be major|minor|patch|explicit (got: $bump)" ;;
    esac

    if [ -n "$hs" ] && ! semver_gt "$candidate" "$hs"; then
        die "$candidate is not greater than latest stable $hs"
    fi

    # Minor/major bumps consume the in-flight nightly line, so they must clear
    # its base. Patch hotfixes don't — they ship out-of-band. For explicit, we
    # detect "patch-shaped" bumps (same major.minor as latest stable) and skip
    # the check; otherwise treat as minor/major.
    local require_nightly_clear=0
    case "$bump" in
        major|minor) require_nightly_clear=1 ;;
        explicit)
            require_nightly_clear=1
            if [ -n "$hs" ]; then
                local cM cm _cp hM hm _hp
                IFS=. read -r cM cm _cp <<<"$candidate"
                IFS=. read -r hM hm _hp <<<"$hs"
                if [ "$cM" = "$hM" ] && [ "$cm" = "$hm" ]; then
                    require_nightly_clear=0
                fi
            fi
            ;;
    esac

    if [ "$require_nightly_clear" -eq 1 ] && [ -n "$hn" ]; then
        local nb; nb=$(base_of "$hn")
        if ! semver_ge "$candidate" "$nb"; then
            die "$candidate is below in-flight nightly base $nb"
        fi
    fi

    printf '%s\n' "$candidate"
}

main() {
    [ $# -eq 0 ] && usage

    local cmd="$1"; shift
    local newargs=()
    local arg
    for arg in "$@"; do
        case "$arg" in
            --tags=*) TAGS_OVERRIDE="${arg#*=}" ;;
            *) newargs+=("$arg") ;;
        esac
    done
    set -- "${newargs[@]+"${newargs[@]}"}"

    case "$cmd" in
        nightly)         cmd_nightly ;;
        stable)          cmd_stable "$@" ;;
        latest-stable)   cmd_latest_stable ;;
        latest-nightly)  cmd_latest_nightly ;;
        -h|--help)       usage ;;
        *) die "unknown command: $cmd" ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
