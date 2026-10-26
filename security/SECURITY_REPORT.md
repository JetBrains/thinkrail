# ThinkRail Security Audit Report

**Date:** 2026-10-26  
**Auditor:** Security Research (Sunil)  
**Scope:** ThinkRail server (`packages/server/`), install scripts (`install.sh`, `install.ps1`), desktop app (`apps/desktop/`)  
**Severity Scale:** CVSS v3.1

---

## Executive Summary

Three critical vulnerabilities were discovered during a deep manual security review of the ThinkRail codebase. These vulnerabilities, when chained or exploited independently, allow:

1. **Full Remote Code Execution** from any webpage visited by the user (Cross-Site WebSocket Hijacking)
2. **Supply Chain Compromise** via environment variable poisoning in the install scripts
3. **Arbitrary File Read** outside the worktree via a symlink TOCTOU race in the path traversal guard

All three vulnerabilities have working Proof-of-Concept exploits and proposed code fixes with regression tests.

---

## CVE-1: Unauthenticated WebSocket RPC — Cross-Site WebSocket Hijacking (CSWSH)

| Field | Value |
|---|---|
| **Severity** | **CRITICAL (CVSS 9.6)** |
| **Attack Vector** | Network (any webpage) |
| **Attack Complexity** | Low |
| **Privileges Required** | None |
| **User Interaction** | Visiting a malicious webpage |
| **Impact** | Full RCE, file read/write, credential theft |
| **Location** | `packages/server/src/host/server.ts` lines 288–466 |

### Description

The ThinkRail WebSocket server (`localhost:24242`) accepts connections at `/ws` with **zero authentication**. There is:

1. **No authentication token** — Any process connecting to port 24242 gets full access
2. **No Origin header validation** — No check against Cross-Site WebSocket Hijacking
3. **No CORS restrictions** — HTTP file endpoints (`/files/`, `/blob/`) are also unauthenticated

The `clientKey` at line 294 is purely cosmetic:
```typescript
const clientKey = url.searchParams.get("client") ?? `anon-${randomUUID()}`;
```

Upon connection, the server immediately sends a `ServerWelcome` message (line 353) containing the **full project list, configuration, and app version** — leaking workspace IDs needed for further exploitation.

### Attack Chain

1. User visits `attacker.com` which contains JavaScript
2. JavaScript opens `new WebSocket("ws://localhost:24242/ws")`
3. Welcome message reveals workspace IDs and project paths
4. Attacker sends `terminal.reserve` → `terminal.attach` → `terminal.write` RPCs
5. **Arbitrary commands execute in the user's shell** with full user privileges

Additionally, the HTTP file-serving endpoints are also unauthenticated:
- `GET /files/{workspaceId}/{path}` — reads any file in the worktree
- `GET /blob/{workspaceId}/{oid}/{path}` — reads any git blob

### Proof of Concept

See: [`security/poc/cswsh_exploit.html`](./poc/cswsh_exploit.html)

Open this HTML file while ThinkRail is running. It connects to the local WebSocket, extracts workspace information, attaches to a terminal, and demonstrates arbitrary command execution.

### Proposed Fix

1. Generate a cryptographically random authentication token at server startup
2. Write it to a user-readable-only file in the data directory
3. Require the token as a query parameter on WebSocket upgrade and HTTP file routes
4. Validate the `Origin` header to block cross-origin WebSocket connections

Applied in: `packages/server/src/host/server.ts`

### Regression Test

See: `packages/server/src/host/server.auth.test.ts`

---

## CVE-2: Supply Chain Attack via `THINKRAIL_REPO` Environment Variable

| Field | Value |
|---|---|
| **Severity** | **CRITICAL (CVSS 9.1)** |
| **Attack Vector** | Local (environment poisoning) |
| **Attack Complexity** | Low |
| **Privileges Required** | None (shared CI/CD environments) |
| **User Interaction** | Running the install script |
| **Impact** | Arbitrary code execution as the installing user |
| **Location** | `install.sh` line 19, `install.ps1` line 193 |

### Description

Both install scripts accept an **undocumented** `THINKRAIL_REPO` environment variable that overrides the GitHub repository from which the binary is downloaded:

**install.sh line 19:**
```bash
REPO="${THINKRAIL_REPO:-JetBrains/thinkrail}"
```

**install.ps1 line 193:**
```powershell
$repo = if ($env:THINKRAIL_REPO) { $env:THINKRAIL_REPO } else { 'JetBrains/thinkrail' }
```

The critical flaw: **both the binary AND the SHA256SUMS checksum file are downloaded from the same attacker-controlled repository**. This makes the checksum verification completely self-referential:

```bash
# install.sh lines 277-280 — BOTH from $REPO
download_asset "$ASSET_NAME" "$TMP/$ASSET_NAME"   # Binary from $REPO
download_asset "SHA256SUMS" "$TMP/SHA256SUMS"       # Checksum from $REPO
```

An attacker who controls `THINKRAIL_REPO` serves a malicious binary with a matching checksum, and the verification passes.

### Attack Scenarios

1. **CI/CD Pipeline Poisoning:** In shared CI/CD environments (GitHub Actions, Jenkins, etc.), a lower-privileged job can set `THINKRAIL_REPO=attacker/malicious-repo` before the install step
2. **Shell Profile Injection:** Malware sets `export THINKRAIL_REPO=...` in `.bashrc`/`.zshrc`
3. **Dotfile Repos:** Corporate dotfile templates that include the variable
4. **Container Base Images:** A compromised base image sets the environment variable

### Proof of Concept

See: [`security/poc/supply_chain_demo.sh`](./poc/supply_chain_demo.sh)

This script demonstrates how an attacker creates a fake GitHub release with a malicious binary and matching SHA256SUMS, then shows the install script would accept it.

### Proposed Fix

1. **Remove** the `THINKRAIL_REPO` environment variable override entirely
2. **Hardcode** the official repository `JetBrains/thinkrail`
3. If a development override is needed, require an explicit `--repo` CLI flag (not environment variable)

Applied in: `install.sh`, `install.ps1`

### Regression Test

See: `security/tests/install_repo_pinned.test.sh`

---

## CVE-3: TOCTOU Symlink Race in Path Traversal Guard — Arbitrary File Read

| Field | Value |
|---|---|
| **Severity** | **HIGH (CVSS 7.5)** |
| **Attack Vector** | Local (malicious git repository) |
| **Attack Complexity** | Medium (requires timing) |
| **Privileges Required** | None (cloning a repo is normal usage) |
| **User Interaction** | Opening a malicious project |
| **Impact** | Read arbitrary files outside the worktree (secrets, SSH keys, etc.) |
| **Location** | `packages/server/src/fs/files.ts` lines 26–62, 79–87 |

### Description

The `resolveInWorktree` function has a Time-of-Check-Time-of-Use (TOCTOU) race condition between the symlink security check and the actual file read.

**The vulnerable flow in `readFile` (lines 79–87):**

```typescript
export function readFile(workspaceId, path) {
    const { abs } = resolveInWorktree(workspaceId, path, true);  // Step 1: CHECK
    const bytes = readFileSync(abs);                               // Step 2: USE
    // ...
}
```

**Inside `resolveInWorktree` (lines 48–62):**

```typescript
function resolveInWorktree(workspaceId, path, followLeaf) {
    // ...
    const abs = resolve(root, path);     // String manipulation only — no symlink resolution
    // ... containment check on string ...
    assertExistingAncestorContained(root, abs);  // realpathSync resolves symlinks at TIME T1
    return { root, abs };                         // Returns UNRESOLVED path
}
```

**The race condition:**

1. `assertExistingAncestorContained` calls `realpathSync(abs)` → resolves symlinks → checks containment at **time T1** ✓
2. Function returns `abs` (the **un-dereferenced** path string)
3. `readFileSync(abs)` resolves symlinks **again** at **time T2**
4. If the symlink target changes between T1 and T2, the containment check is bypassed

### Attack Chain

1. Attacker creates a malicious git repository containing:
   - `data/config.txt` → symlink to `./legitimate-file.txt` (inside worktree)
   - A background script (git hook or watched file) that rapidly swaps the symlink
2. User clones the repository and opens it in ThinkRail
3. ThinkRail's file browser reads `data/config.txt`:
   - Security check resolves symlink → `./legitimate-file.txt` → **inside worktree** ✓
   - Symlink is swapped to `../../../../etc/passwd` (or `~/.ssh/id_rsa`)
   - `readFileSync` follows the new symlink → **reads sensitive file outside worktree**

### Proof of Concept

See: [`security/poc/toctou_race.py`](./poc/toctou_race.py)

This script creates a race condition by spawning a thread that rapidly swaps a symlink while the main thread requests the file through the API.

### Proposed Fix

After the security check passes, resolve the final path using `realpathSync` and perform a **second containment check** on the resolved path. Use the resolved path for all subsequent file operations:

```typescript
function resolveInWorktree(workspaceId, path, followLeaf) {
    // ... existing checks ...
    assertExistingAncestorContained(root, followLeaf ? abs : dirname(abs));
    
    // NEW: Re-resolve and re-check to close TOCTOU window
    const realAbs = realpathSync(abs);
    const realRoot = realpathSync(root);
    if (!isContained(realRoot, realAbs)) throw new Error("Path escapes the worktree");
    
    return { root, abs: realAbs };  // Return the RESOLVED path
}
```

Applied in: `packages/server/src/fs/files.ts`

### Regression Test

See: `packages/server/src/fs/files.toctou.test.ts`

---

## Summary Table

| # | Vulnerability | Severity | CVSS | Status |
|---|---|---|---|---|
| 1 | Unauthenticated WebSocket RPC (CSWSH) | **CRITICAL** | 9.6 | Fixed |
| 2 | Supply Chain via THINKRAIL_REPO | **CRITICAL** | 9.1 | Fixed |
| 3 | TOCTOU Symlink Race in Path Guard | **HIGH** | 7.5 | Fixed |

## Files Modified

| File | Change |
|---|---|
| `packages/server/src/host/server.ts` | Added WebSocket auth token + Origin validation |
| `packages/server/src/fs/files.ts` | Closed TOCTOU race with post-check realpath resolution |
| `install.sh` | Removed THINKRAIL_REPO env var override |
| `install.ps1` | Removed THINKRAIL_REPO env var override |

## Files Added

| File | Purpose |
|---|---|
| `security/SECURITY_REPORT.md` | This report |
| `security/poc/cswsh_exploit.html` | PoC for CVE-1 |
| `security/poc/supply_chain_demo.sh` | PoC for CVE-2 |
| `security/poc/toctou_race.py` | PoC for CVE-3 |
| `packages/server/src/host/server.auth.test.ts` | Regression tests for CVE-1 |
| `packages/server/src/fs/files.toctou.test.ts` | Regression tests for CVE-3 |
| `security/tests/install_repo_pinned.test.sh` | Regression tests for CVE-2 |
