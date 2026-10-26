#!/usr/bin/env bash
# Regression test: Verify install scripts don't accept THINKRAIL_REPO override
#
# This test checks that the install scripts have hardcoded the official
# repository and do NOT accept the THINKRAIL_REPO environment variable.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PASS=0
FAIL=0

assert_not_contains() {
    local file="$1" pattern="$2" desc="$3"
    if grep -q "$pattern" "$file" 2>/dev/null; then
        echo -e "${RED}FAIL${NC}: $desc"
        echo "  File: $file"
        echo "  Pattern found: $pattern"
        grep -n "$pattern" "$file" | head -3 | sed 's/^/  /'
        FAIL=$((FAIL + 1))
    else
        echo -e "${GREEN}PASS${NC}: $desc"
        PASS=$((PASS + 1))
    fi
}

assert_contains() {
    local file="$1" pattern="$2" desc="$3"
    if grep -q "$pattern" "$file" 2>/dev/null; then
        echo -e "${GREEN}PASS${NC}: $desc"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}FAIL${NC}: $desc"
        echo "  File: $file"
        echo "  Pattern NOT found: $pattern"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== Install Script Supply Chain Regression Tests ==="
echo

# Test 1: install.sh should NOT reference THINKRAIL_REPO
assert_not_contains \
    "$REPO_ROOT/install.sh" \
    'THINKRAIL_REPO' \
    "install.sh does not reference THINKRAIL_REPO env var"

# Test 2: install.ps1 should NOT reference THINKRAIL_REPO
assert_not_contains \
    "$REPO_ROOT/install.ps1" \
    'THINKRAIL_REPO' \
    "install.ps1 does not reference THINKRAIL_REPO env var"

# Test 3: install.sh should have hardcoded official repo
assert_contains \
    "$REPO_ROOT/install.sh" \
    'REPO="JetBrains/thinkrail"' \
    "install.sh has hardcoded official repository"

# Test 4: install.ps1 should have hardcoded official repo
assert_contains \
    "$REPO_ROOT/install.ps1" \
    "JetBrains/thinkrail" \
    "install.ps1 references official repository"

# Test 5: install.sh should NOT use variable substitution for REPO
assert_not_contains \
    "$REPO_ROOT/install.sh" \
    '${THINKRAIL_REPO' \
    "install.sh does not use THINKRAIL_REPO variable substitution"

# Test 6: install.ps1 should NOT use $env:THINKRAIL_REPO
assert_not_contains \
    "$REPO_ROOT/install.ps1" \
    '$env:THINKRAIL_REPO' \
    "install.ps1 does not use \$env:THINKRAIL_REPO"

echo
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}REGRESSION DETECTED: Install scripts still vulnerable to supply chain attack${NC}"
    exit 1
else
    echo -e "${GREEN}All checks passed: Supply chain vulnerability is fixed${NC}"
    exit 0
fi
