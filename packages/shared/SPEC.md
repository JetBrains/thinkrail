---
id: module-shared
type: module-design
status: draft
title: Shared server-side utilities
parent: architecture
depends-on: []
tags: [v1, host]
---

## Responsibility

Cross-cutting runtime utilities used by the engine host. Server-side only — never bundled into `apps/web`.
Exposed through explicit subpath exports, not a barrel.

## Contents

- **/shellEnv** — `resolveShellEnv()`: probe a login shell for PATH when a GUI-launched process lacks the
  user's PATH. The in-process agent runs its bash/tools using the host process env, so without this a
  Finder/Dock-launched app can't find `git`/`node`/etc.

## Get right

- `resolveShellEnv()` runs **once at startup, before creating any `AgentSession`**.
- No-op on win32 or when PATH already looks complete; else spawn a login shell `-l -i -c 'env -0'` (retry
  without `-i`), parse `\0` entries, overwrite `process.env.PATH`, 5s timeout.
