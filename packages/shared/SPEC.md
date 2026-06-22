---
id: module-shared
type: module-design
status: active
title: Shared server-side utilities
parent: architecture
depends-on: []
tags: [v1, host]
---

## Responsibility

Cross-cutting runtime utilities used by the engine host. Server-side only — never bundled into `apps/web`.
Exposed through explicit subpath exports, not a barrel.

## Boundary

- **Owns:** host-side runtime helpers that are neither engine- nor transport-specific.
- **Public surface:** `@thinkrail-pi/shared/shellEnv` → `resolveShellEnv()`, `pathLooksComplete()`.
- **Allowed deps:** Bun/Node runtime (`@types/bun`); may use `contracts` types if needed (none today).
- **Forbidden:** importing `server` / `web` / any `pi` package; being imported by `web` (it carries
  Bun/Node code that must not reach the browser bundle).

## Contents

- **/shellEnv** — `resolveShellEnv()`: ensure `process.env.PATH` is the user's full login PATH so the
  in-process agent's bash/tools find `git`/`node`/etc. when the host is launched from Finder/Dock.

## Get right

- Runs **once at startup, before creating any `AgentSession`**.
- No-op on win32, or when PATH already contains a user dir (`/.nvm/`, `/homebrew/`, `/usr/local/bin`,
  `/.bun/`) — `pathLooksComplete()`.
- Else spawn a login shell `[$SHELL||/bin/zsh, -l, -i, -c, env -0]` (retry without `-i` on non-zero exit),
  5s timeout, parse the `\0`-separated entries, overwrite `process.env.PATH`. Never throws — on any
  failure it leaves PATH untouched.
