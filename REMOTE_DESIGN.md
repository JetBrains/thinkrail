# Remote Access Design Document

> **Status:** Mostly implemented (bind + frontend proxy changes landed; LAN display pending)
> **Date:** 2026-03-18
> **Scope:** Enable accessing Bonsai from devices other than the host machine

---

## Table of Contents

1. [Problem Analysis](#1-problem-analysis)
2. [Approach Comparison](#2-approach-comparison)
3. [Recommended Approach](#3-recommended-approach)
4. [Implementation Plan](#4-implementation-plan)
5. [Network Topology](#5-network-topology)
6. [Security Considerations](#6-security-considerations)
7. [Verification Steps](#7-verification-steps)

---

## 1. Problem Analysis

### Current Architecture

Bonsai runs two servers locally:

| Component | Bind Address | Port | Role |
|-----------|-------------|------|------|
| FastAPI (uvicorn) | `127.0.0.1` | 8080 | Backend: WebSocket RPC, REST API, agent execution |
| Vite dev server | `localhost` | 5173 | Frontend: React app, proxies `/ws` and `/terminal` to backend |

The browser connects to Vite on `:5173`, which proxies WebSocket and terminal traffic to FastAPI on `:8080`. REST API calls from the frontend go directly to `:8080` in dev mode.

### Why Remote Access Fails

Both servers bind to `127.0.0.1` (loopback). The OS kernel drops any packet arriving from a non-loopback network interface destined for `127.0.0.1`. This is not a firewall issue — it's a fundamental binding constraint. No amount of port-forwarding or firewall rules will make a `127.0.0.1`-bound service reachable from another machine.

### Hardcoded `localhost` References

Six locations in the codebase hardcode `localhost:8080`:

| File | Line | Code |
|------|------|------|
| `backend/app/main.py` | 238 | `host="127.0.0.1"` |
| `backend/app/core/config.py` | 12 | `host: str = "127.0.0.1"` |
| `frontend/vite.config.ts` | 16, 21 | `target: "http://localhost:8080"` (proxy rules) |
| `frontend/src/main.tsx` | 11 | `const BACKEND = import.meta.env.DEV ? "localhost:8080" : location.host` |
| `frontend/src/store/fileStore.ts` | 4 | `const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : ""` |
| `frontend/src/components/FileTree/FileTree.tsx` | 6 | `const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : ""` |
| `frontend/src/components/ProjectPicker/ProjectPicker.tsx` | 5 | `const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : ""` |

Note: The Vite proxy targets (`localhost:8080`) are correct and should **not** change — Vite runs on the same machine as FastAPI, so the proxy always connects locally. Only browser-facing URLs need fixing.

---

## 2. Approach Comparison

### Approach 1: Bind to `0.0.0.0` (LAN Access)

Change server bindings from `127.0.0.1` to `0.0.0.0` so they listen on all interfaces.

```
┌───────────── Host Machine ──────────────┐
│  Vite :5173 (0.0.0.0)                  │
│    └──proxy──► FastAPI :8080 (0.0.0.0)  │
└─────────────────┬───────────────────────┘
                  │ LAN (192.168.x.x)
        ┌─────────┴─────────┐
        ▼                   ▼
   ┌─────────┐        ┌─────────┐
   │ Laptop  │        │ Phone   │
   │ :5173   │        │ :5173   │
   └─────────┘        └─────────┘
```

- **Pros:** 2-line change, zero extra tooling, works on phone
- **Cons:** LAN only, no encryption, no authentication, plain HTTP

### Approach 2: SSH Tunnel (No Code Changes)

Forward ports over SSH: `ssh -L 5173:localhost:5173 -L 8080:localhost:8080 user@host`

```
┌─── Host Machine ───┐          ┌──── Client ─────┐
│ Vite    :5173      │◄═══SSH═══│ localhost:5173   │
│ FastAPI :8080      │  tunnel  │ localhost:8080   │
│ (127.0.0.1 both)  │          │ (forwarded)      │
└────────────────────┘          └──────────────────┘
```

- **Pros:** Encrypted, zero code changes, no ports exposed on LAN
- **Cons:** Per-device setup, impractical on phones, tunnels drop on network changes

### Approach 3: Reverse Proxy (Caddy/Nginx)

Place a reverse proxy in front of both servers, optionally with HTTPS via Let's Encrypt.

```
┌─────────────── Host Machine ────────────────────┐
│                                                  │
│  ┌──────────────────────────────┐                │
│  │ Caddy/Nginx :443             │                │
│  │  /ws, /terminal → :8080     │                │
│  │  /*            → :5173      │                │
│  └──────────────────────────────┘                │
│        │                  │                      │
│        ▼                  ▼                      │
│  FastAPI :8080      Vite :5173                   │
│  (127.0.0.1)       (127.0.0.1)                   │
└──────────────────────────────────────────────────┘
         ▲
         │ HTTPS :443
    ┌────┴────┐
    │ Browser │
    └─────────┘
```

Example Caddy config:
```
bonsai.example.com {
    handle /ws*    { reverse_proxy localhost:8080 }
    handle /terminal* { reverse_proxy localhost:8080 }
    handle /api/*  { reverse_proxy localhost:8080 }
    handle        { reverse_proxy localhost:5173 }
}
```

- **Pros:** Real HTTPS, single port (443), professional setup
- **Cons:** Needs a domain name, requires port 443/80 open to internet, more setup complexity

### Approach 4: Tailscale VPN

Install Tailscale on host and client devices. Access via Tailscale IP (`100.x.y.z`) or MagicDNS hostname.

```
          ┌─────────────────────────────┐
          │   Tailscale Coordination    │
          │   Server (key exchange)     │
          └──────┬──────────┬───────────┘
                 │          │
    ┌────────────┴──┐  ┌───┴────────────┐
    │ Host Machine  │  │ Client Device  │
    │ 100.x.y.z    │  │ 100.a.b.c     │
    │               │◄═══WireGuard════►│               │
    │ Vite :5173    │  peer-to-peer    │ Browser       │
    │ FastAPI :8080 │  encrypted       │ 100.x.y.z:5173│
    └───────────────┘                  └───────────────┘
```

- **Pros:** Encrypted (WireGuard), works from anywhere, works on phone, zero port exposure to LAN/internet, MagicDNS
- **Cons:** Requires Tailscale account + installation on all devices, no HTTPS in browser (but wire is encrypted)

### Approach 5: Production Build + Single Server

Build frontend to static files (`npm run build`), serve from FastAPI. Single process, single port.

```
┌──────── Host Machine ─────────┐
│  FastAPI :8080                │
│    /ws         → WebSocket    │
│    /terminal   → WebSocket    │
│    /api/*      → REST API     │
│    /*          → static files │
│                  (dist/)      │
└───────────┬───────────────────┘
            │
       ┌────┴────┐
       │ Browser │
       │ :8080   │
       └─────────┘
```

- **Pros:** Simplest deployment topology, no proxy needed, single port
- **Cons:** Lose Vite HMR during development, must rebuild on every frontend change

### Comparison Matrix

```
                    │ Code    │ Works on │ Encrypted │ Works from │ Setup
                    │ Changes │  Phone   │           │ Anywhere   │ Effort
────────────────────┼─────────┼──────────┼───────────┼────────────┼────────
 1. 0.0.0.0 bind   │  Small  │    ✓     │     ✗     │  LAN only  │  Low
 2. SSH tunnel      │  None   │    ~     │     ✓     │     ✓      │  Med
 3. Caddy proxy     │  Small  │    ✓     │     ✓     │     ✓      │  High
 4. Tailscale       │  Small  │    ✓     │     ✓     │     ✓      │  Low
 5. Prod build      │  Medium │    ✓     │  depends  │  depends   │  Med
```

---

## 3. Recommended Approach

**Tailscale + `0.0.0.0` bind (Approach 4 + Approach 1)**

### Rationale

- **Encrypted by default** — WireGuard peer-to-peer encryption with no certificate management
- **Works from anywhere** — laptop, phone, different networks — as long as Tailscale is connected
- **No port exposure** — nothing opens on the LAN or internet; only Tailscale network members can connect
- **Minimal code changes** — same small changes as Approach 1, Tailscale handles the rest
- **No domain required** — MagicDNS provides automatic hostnames (e.g., `my-machine:5173`)

### Key Design Insight: Route Through Vite Proxy

The critical architectural decision is to **route all frontend-to-backend traffic through Vite's dev server proxy** rather than exposing the backend port directly to browsers:

1. **Browser connects to one URL only** — Vite on `:5173`. No second port to remember or expose.
2. **All `localhost:8080` hardcoding in frontend disappears** — replaced by relative URLs like `/api/file/read` and `/ws`.
3. **Vite proxy target stays `localhost:8080`** — both servers run on the same machine, so the proxy always connects locally. Only the browser-facing side needs to be remote-accessible.

This means in practice, only port `5173` needs to be reachable from remote devices. Port `8080` can remain bound to `0.0.0.0` for flexibility but is not strictly required for browser access.

```
Browser (remote)                    Host Machine
────────────────                    ────────────
GET /api/file/read ──────────────►  Vite :5173 (0.0.0.0)
                                      │
                                      │ proxy rule: /api/* → localhost:8080
                                      ▼
                                    FastAPI :8080
                                      │
                                      ▼
                                    Response flows back through proxy
```

---

## 4. Implementation Plan

### Overview: 9 Files to Modify

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | `backend/app/core/config.py` | Default host `127.0.0.1` → `0.0.0.0` | Low |
| 2 | `backend/app/main.py` | Read host/port from config instead of hardcoding | Low |
| 3 | `backend/tests/core/test_config.py` | Update assertion for new default | Low |
| 4 | `frontend/vite.config.ts` | Add `host: '0.0.0.0'` to server config, add `/api` proxy rule | Low |
| 5 | `frontend/src/main.tsx` | Use relative WebSocket URL via Vite proxy | Low |
| 6 | `frontend/src/store/fileStore.ts` | Remove `API_BASE`, use relative URLs | Low |
| 7 | `frontend/src/components/FileTree/FileTree.tsx` | Remove `API_BASE`, use relative URLs | Low |
| 8 | `frontend/src/components/ProjectPicker/ProjectPicker.tsx` | Remove `API_BASE`, use relative URLs | Low |
| 9 | `run.sh` | Print Tailscale-friendly access URLs | Low |

### File 1: `backend/app/core/config.py`

Change the default host to `0.0.0.0` and support environment variable overrides.

```python
# Before (line 12)
host: str = "127.0.0.1"
port: int = 8000

# After
host: str = "0.0.0.0"
port: int = 8000
```

Additionally, in `load_config()`, read from environment variables:

```python
import os

def load_config(project_root: Path | None = None) -> AppConfig:
    root = project_root or _discover_root()
    return AppConfig(
        project_root=root,
        bonsai_dir=root / ".bonsai",
        plugin_dir=_BONSAI_ROOT / "claude-plugin",
        host=os.environ.get("BONSAI_HOST", "0.0.0.0"),
        port=int(os.environ.get("BONSAI_PORT", "8080")),
    )
```

This allows reverting to localhost with `BONSAI_HOST=127.0.0.1` if needed.

### File 2: `backend/app/main.py`

Use config values instead of hardcoded strings.

```python
# Before (lines 232-240)
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=8080,
    )

# After
if __name__ == "__main__":
    import uvicorn
    from app.core.config import load_config

    _cfg = load_config()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=_cfg.host,
        port=_cfg.port,
    )
```

### File 3: `backend/tests/core/test_config.py`

Update the assertion to match the new default.

```python
# Before (line 27)
assert cfg.host == "127.0.0.1"

# After
assert cfg.host == "0.0.0.0"
```

### File 4: `frontend/vite.config.ts`

Bind Vite to all interfaces and add a proxy rule for `/api` routes.

```typescript
// Before
server: {
  port: 5173,
  proxy: {
    "/ws": { ... },
    "/terminal": { ... },
  },
},

// After
server: {
  port: 5173,
  host: "0.0.0.0",
  proxy: {
    "/ws": {
      target: "http://localhost:8080",
      ws: true,
      changeOrigin: true,
    },
    "/terminal": {
      target: "http://localhost:8080",
      ws: true,
      changeOrigin: true,
    },
    "/api": {
      target: "http://localhost:8080",
      changeOrigin: true,
    },
  },
},
```

Note: The proxy targets remain `localhost:8080` — this is correct because the proxy runs on the same machine as the backend. Adding the `/api` proxy rule means all frontend REST calls can use relative URLs.

### File 5: `frontend/src/main.tsx`

Replace hardcoded backend address with relative URL through Vite proxy.

```typescript
// Before (lines 11-12)
const BACKEND = import.meta.env.DEV ? "localhost:8080" : location.host;
const WS_PROTO = import.meta.env.DEV ? "ws:" : location.protocol === "https:" ? "wss:" : "ws:";

// After
const WS_PROTO = location.protocol === "https:" ? "wss:" : "ws:";

// ...
// Before (line 37)
const wsUrl = `${WS_PROTO}//${BACKEND}/ws?project=${encodeURIComponent(projectPath)}`;

// After — uses location.host so it works from any device
const wsUrl = `${WS_PROTO}//${location.host}/ws?project=${encodeURIComponent(projectPath)}`;
```

This works because Vite's proxy forwards `/ws` to the backend in dev mode, and in production the frontend is served by the backend directly.

### File 6: `frontend/src/store/fileStore.ts`

Remove the `API_BASE` constant and use relative URLs.

```typescript
// Before (line 4)
const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : "";

// After — delete the line entirely. All fetch calls become relative:
// fetch(`${API_BASE}/api/file/read?...`)  →  fetch(`/api/file/read?...`)
```

All `${API_BASE}/api/...` usages in this file become `/api/...`.

### File 7: `frontend/src/components/FileTree/FileTree.tsx`

Same pattern as File 6.

```typescript
// Before (line 6)
const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : "";

// After — delete the line, use relative URLs in all fetch calls
```

### File 8: `frontend/src/components/ProjectPicker/ProjectPicker.tsx`

Same pattern as File 6.

```typescript
// Before (line 5)
const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : "";

// After — delete the line, use relative URLs in all fetch calls
```

### File 9: `run.sh`

Print helpful access information.

```bash
# Before (lines 52-53)
echo "Backend:  http://localhost:8080"
echo "Frontend: http://localhost:5173"

# After
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
echo "Frontend: http://localhost:5173"
echo "          http://${LOCAL_IP}:5173  (LAN)"
echo "Backend:  http://localhost:8080"
echo ""
echo "For remote access, install Tailscale: https://tailscale.com/download"
```

---

## 5. Network Topology

### Before (Current State)

```
┌───────────────────── Host Machine ──────────────────────┐
│                                                          │
│  Browser ──► Vite :5173 ──proxy──► FastAPI :8080         │
│              (127.0.0.1)           (127.0.0.1)           │
│                                                          │
│  ✓ Accessible from this machine only                     │
│  ✗ Any remote device → connection refused                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### After: LAN Access (0.0.0.0 bind only)

```
┌───────────────────── Host Machine ──────────────────────┐
│                                                          │
│  Vite :5173 (0.0.0.0)                                   │
│    ├── serves React app                                  │
│    ├── proxies /ws       → localhost:8080                │
│    ├── proxies /terminal → localhost:8080                │
│    └── proxies /api/*    → localhost:8080                │
│                                                          │
│  FastAPI :8080 (0.0.0.0)                                 │
│    ├── WebSocket RPC                                     │
│    ├── REST API (/api/*)                                 │
│    └── Terminal WebSocket                                │
│                                                          │
└────────────────────────┬─────────────────────────────────┘
                         │
              LAN (192.168.x.x)
           ┌─────────────┼─────────────┐
           │             │             │
     ┌─────┴─────┐ ┌────┴─────┐ ┌────┴──────┐
     │ Laptop    │ │ Phone    │ │ Tablet    │
     │ :5173 ✓  │ │ :5173 ✓ │ │ :5173 ✓  │
     │ HTTP only │ │ HTTP     │ │ HTTP      │
     └───────────┘ └──────────┘ └───────────┘
```

### After: Tailscale + 0.0.0.0 (Recommended)

```
                ┌─────────────────────────────┐
                │  Tailscale Coordination     │
                │  Server (key exchange only)  │
                └──────┬──────────┬───────────┘
                       │          │
          ┌────────────┘          └────────────┐
          │                                    │
┌─────────┴──────── Host Machine ──────┐  ┌───┴──── Any Device ──────┐
│                                      │  │                          │
│  Tailscale IP: 100.64.x.y           │  │  Tailscale IP: 100.64.a.b│
│  MagicDNS: my-machine               │  │                          │
│                                      │  │  Browser                 │
│  Vite :5173 (0.0.0.0)               │  │  http://100.64.x.y:5173  │
│    └── proxies to FastAPI :8080      │  │  or                      │
│                                      │  │  http://my-machine:5173  │
│  FastAPI :8080 (0.0.0.0)            │  │                          │
│                                      │  └──────────────────────────┘
└──────────────────────────────────────┘
         ▲                    ▲
         │   WireGuard        │
         │   encrypted        │
         │   peer-to-peer     │
         ▼                    ▼
┌─────── Laptop ───────┐  ┌─────── Phone ─────────┐
│ 100.64.c.d           │  │ 100.64.e.f            │
│ http://my-machine:5173│  │ http://my-machine:5173│
│ (encrypted tunnel)   │  │ (encrypted tunnel)    │
└──────────────────────┘  └───────────────────────┘
```

Key properties of this topology:
- **No ports open** on the LAN or internet
- **WireGuard encryption** between all peers (even if traffic traverses public internet)
- **NAT traversal** built in — works behind routers, firewalls, cellular networks
- **MagicDNS** — no need to remember IP addresses
- **Survives network changes** — seamless WiFi ↔ cellular transitions

---

## 6. Security Considerations

### Current State

| Aspect | Status | Notes |
|--------|--------|-------|
| Bind address | `127.0.0.1` | Safe — kernel drops remote packets |
| CORS | `allow_origins=["*"]` | Permissive, but irrelevant when only localhost can connect |
| Authentication | None | Not needed for single-user localhost |
| HTTPS | None | Not needed for loopback traffic |

### After 0.0.0.0 Bind (Without VPN)

| Aspect | Risk | Mitigation |
|--------|------|------------|
| Network exposure | **Medium** — any device on the LAN can access both ports | Acceptable on trusted home/office networks |
| Eavesdropping | **Low-Medium** — HTTP traffic is unencrypted on the wire | Use on trusted networks only, or add Tailscale |
| CORS `*` | **Low** — a malicious page on LAN could make cross-origin requests | Acceptable for dev tool; no sensitive data at rest |
| No auth | **Low** — anyone on LAN can use Bonsai | Acceptable for personal use |

### After Tailscale (Recommended)

| Aspect | Risk | Mitigation |
|--------|------|------------|
| Network exposure | **Minimal** — only Tailscale network members can connect | Tailscale ACLs can further restrict access |
| Eavesdropping | **None** — WireGuard encrypts all traffic end-to-end | Peer-to-peer; no relay sees plaintext |
| CORS `*` | **Negligible** — attack surface limited to Tailscale network | Same trusted device set |
| No auth | **Low** — only your own devices are on the Tailscale network | Can add Tailscale ACLs if sharing with others |
| Port exposure | **None** — no LAN or internet ports opened | Tailscale uses outbound connections for NAT traversal |

### Environment Variable Escape Hatch

Setting `BONSAI_HOST=127.0.0.1` reverts to localhost-only binding without any code changes, providing a quick way to lock down access if needed.

---

## 7. Verification Steps

### Step 1: Confirm Server Bindings

After applying code changes, verify both servers bind to `0.0.0.0`:

```bash
# Start Bonsai
./run.sh

# In another terminal — check listening addresses
ss -tlnp | grep -E ':(5173|8080)'
# Expected: 0.0.0.0:5173 and 0.0.0.0:8080 (not 127.0.0.1)
```

### Step 2: Local Access Still Works

```bash
# Frontend serves React app
curl -s http://localhost:5173/ | head -5

# API proxy works through Vite
curl -s http://localhost:5173/api/file/read?path=/tmp/test.txt

# Direct backend access still works
curl -s http://localhost:8080/api/file/read?path=/tmp/test.txt
```

### Step 3: LAN Access Works

From another device on the same network:

```bash
# Find the host machine's LAN IP
hostname -I  # on host machine

# From remote device
curl http://192.168.x.x:5173/
# Should return the React app HTML
```

### Step 4: WebSocket Connects Remotely

1. Open browser on remote device → `http://<host-ip>:5173`
2. Open browser DevTools → Network tab → filter by "WS"
3. Select a project in ProjectPicker
4. Verify WebSocket connects to `ws://<host-ip>:5173/ws?project=...`
5. Verify the connection stays open (no immediate close)

### Step 5: Frontend API Calls Work Remotely

1. On remote device, open Bonsai in browser
2. Verify ProjectPicker loads and lists directories (uses `/api/...` routes)
3. Select a project → verify FileTree loads
4. Open a file → verify file content loads
5. Check browser console for any `localhost:8080` errors (there should be none)

### Step 6: Tailscale Access (If Installed)

```bash
# On host machine
tailscale status
# Note the Tailscale IP (100.x.y.z) and MagicDNS name

# From any Tailscale-connected device
curl http://100.x.y.z:5173/
curl http://my-machine:5173/    # if MagicDNS is enabled

# Open in browser
# http://my-machine:5173
```

### Step 7: Run Tests

```bash
cd backend && uv run pytest tests/core/test_config.py -v
# Verify test_returns_app_config passes with new host default
```

### Step 8: Environment Variable Override

```bash
# Verify localhost-only mode still works
BONSAI_HOST=127.0.0.1 ./run.sh

# From another device — should be refused
curl http://192.168.x.x:5173/   # connection refused ✓
```

## HOW TO

Here's the complete step-by-step for both machines.

---
Host Machine (where Bonsai code lives)

### Step 1: Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### Step 2: Start Tailscale and authenticate

```bash
sudo tailscale up
```

This opens a browser link — sign in with Google/GitHub/etc to create your Tailscale account (or log into existing one).

### Step 3: Note your Tailscale IP

```bash
tailscale ip -4 # Example output: 100.64.0.2
```

### Step 4: (Optional) Enable MagicDNS

Go to https://login.tailscale.com/admin/dns and enable MagicDNS. This lets you use a hostname instead of the IP (e.g., my-machine instead of 100.64.0.2).

### Step 5: Start Bonsai
```bash
cd ~/projects/aiir/bonsai
./run.sh
# You'll see output like:
# Frontend: http://localhost:5173
#          http://192.168.1.42:5173  (LAN)
# Backend:  http://localhost:8080
# For remote access, install Tailscale: https://tailscale.com/download
# Press Ctrl+C to stop both.
#
# Done. Host is ready.
```

---
Remote Machine (laptop, phone, tablet)

### Step 1: Install Tailscale

- Linux: `curl -fsSL https://tailscale.com/install.sh | sh`
- macOS: `brew install tailscale or install from App Store`
- iOS / Android: Install "Tailscale" from App Store / Play Store

### Step 2: Start Tailscale and sign in with the same account

```bash
sudo tailscale up        # Linux/macOS
```
On phone, just open the app and sign in.

### Step 3: Verify connection

```bash 
tailscale status
# Should show both your host and this device
```

### Step 4: Open Bonsai in the browser

Navigate to:

`http://100.64.0.2:5173`

Or with MagicDNS:

`http://my-machine:5173`

That's it. ProjectPicker loads, you select a project, and everything works — file tree, editor, WebSocket, terminal.

---
Quick Verification Checklist

|  #  |           Check           |                           How                           |
| --- | --- | --- |
| 1   | Tailscale running on both | tailscale status shows both devices                     |
| 2   | Bonsai started on host    | `./run.sh` output visible                               |
| 3   | Page loads on remote      | Browser shows ProjectPicker                             |
| 4   | WebSocket connects        | Open DevTools → Network → WS tab, see active connection |
| 5   | Files load                | Select project, file tree appears, click a file         |

