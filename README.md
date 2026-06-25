<img width="1584" height="396" alt="github-cover" src="https://github.com/user-attachments/assets/bfa89ed9-9ee0-4314-8ca4-68f626e10e74" />

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)

Hierarchical, interconnected specs live in the repo alongside code — helping developers align AI coding agents through structured project context.

## 🛠️ What We Give
We inject three simple primitives directly into your repository to replace messy, unconstrained agent loops:

* **🌲 Repo-Local Spec Trees** A spec hierarchy directly inside your repo, preserving the architecture, API contracts, and constraints—everything vanilla agents constantly miss.
* **🎫 Intent-to-Spec Tickets** Drop a ticket with your raw intent, and thinkrail automatically translates it into structured markdown specs and clean code.
* **🗺️ Visual Alignment Graphs** Interactive graphs to help you brainstorm, make clear design decisions, and keep your agent perfectly aligned.

## 🚀 What You Get
When these three primitives run together as a single engine, your day-to-day development loop changes completely:

* **🕹️ Regain Control** No more babysitting agents or wrestling with runaway AI loops.
* **🧩 Effortless Decomposition** Break down messy features into manageable, bite-sized components before writing code.
* **⚓ Decision Tracking** Every architectural decision and design trade-off is permanently tracked.
* **🎯 Grip Over Agent's Focus** Keep AI locked onto the task instead of drowning in a sea of irrelevant files.

## 🏎 Quick Start

### For end users

Install with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
```
Supported platforms: Linux x64/arm64, macOS x64/arm64, Windows x64.

Once installed, run `thinkrail` to start. To update later: `thinkrail upgrade` (Linux/macOS; on Windows, re-run the installer command above).

### For developers

```bash
git clone <repo-url>
./run.sh
```

The script installs all dependencies, starts the backend and frontend, and opens (by default):

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:8000

Press `Ctrl+C` to stop. Cleanup is automatic.

## ⚙️ Development

### Prerequisites

- **Node.js** (with npm)
- **Python 3.11+**
- **uv** (installed automatically if missing)

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_HOST` | `0.0.0.0` | Backend bind address |
| `BACKEND_PORT` | `8000` | Backend port |
| `FRONTEND_PORT` | `3000` | Frontend port |

### WebSocket Type Generation

The frontend TypeScript types for WebSocket events are auto-generated from the backend Pydantic models:

```
backend/app/agent/models.py  →  frontend/ws-events.json  →  frontend/src/types/ws-events.ts
```

**Regenerate after any change to `AgentEvent` or its payload models:**
```bash
cd frontend && npm run generate:ws-schema && npm run generate:ws-types
```

### End-to-End Tests

Playwright specs that drive the real backend + frontend live in [`e2e/`](./e2e/README.md) — run `./run.sh` then `cd e2e && npm test`.


## 🥱 Other
_Does anybody ever reads it?_

### 🔎 Installation details:
Options:

```bash
# Nightly channel
... | bash -s -- --channel nightly

# Specific version
... | bash -s -- --version 0.2.0

# Custom install prefix
... | bash -s -- --prefix ~/.local

# Opt out of anonymous usage analytics
... | bash -s -- --no-analytics
```

The installer detects your OS and architecture, downloads the matching binary from the [latest release](../../releases/latest), verifies the SHA256 checksum, and installs to `~/.local/bin/thinkrail`. If `~/.local/bin` isn't on your `PATH`, the installer appends it to your shell's rc file (`~/.bashrc`, `~/.bash_profile`, `~/.zshrc`, or `~/.config/fish/conf.d/thinkrail.fish` depending on `$SHELL`) — open a new terminal or `source` the file to pick it up. Re-running with a different `--prefix` rewrites the existing entry rather than stacking a second one. Pass `--no-modify-path` to opt out.

`--prefix` accepts letters, digits, and `_` `-` `.` `/` `~` and spaces; values containing other characters (e.g. `$`, backticks, `;`) are rejected so they can't be smuggled into the rc file as executable shell.

**macOS first-launch:** the `curl … | bash` command above downloads the binary with `curl`, which does **not** quarantine it — macOS runs it without a Gatekeeper prompt. If you instead download the binary directly from the [Releases page](../../releases/latest) in a browser, macOS quarantines it and Gatekeeper blocks the first launch; clear it with right-click → **Open**, or `xattr -d com.apple.quarantine ~/.local/bin/thinkrail`.

**Authentication.** ThinkRail drives Claude Code under the hood, so Claude Code needs to be authenticated.


## 🔓 Analytics & Privacy

ThinkRail collects **anonymous usage analytics**, and it is **on by default**. The data answers product questions — are installs still active over time, which channels/platforms people install from, and which top-level features get used — and nothing more.

**The only stable identifier** is a random per-install `installation_id` (a `uuid4`) generated on your machine. Alongside it, events carry low-cardinality, non-personal environment metadata: release channel (`stable`/`nightly`/`dev`), version, OS (`macos`/`linux`/`windows`), and architecture (`x64`/`arm64`).

**Never collected:** project paths, file/spec/ticket names, prompts, code, transcripts, token counts, hostnames, usernames, or IP-derived fields.

Turn it off any time — all three paths flip the same setting:

- **At install:** `... | bash -s -- --no-analytics`
- **CLI:** `thinkrail analytics --disable` (and `--enable` / `--status`)
- **In-app:** Settings → **Privacy** → toggle off

Disabling deletes the `installation_id` and stops all network calls; re-enabling generates a fresh id (no continuity across an opt-out).
