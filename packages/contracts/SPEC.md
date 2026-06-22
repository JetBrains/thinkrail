---
id: module-contracts
type: module-design
status: draft
title: Wire contracts (types-only)
parent: architecture
depends-on: []
tags: [v1, wire]
---

## Responsibility

The wire spine: the single source of truth for the browser↔host protocol. Types-only, zero runtime value
exports except the WS method/channel constants. The only package `apps/web` may depend on.

## Contents

- **piProtocol.ts** — re-export `pi`'s published types **type-only** from the browser-safe `/base` entries
  (`@earendil-works/pi-ai/base`, `@earendil-works/pi-agent-core/base`), and **mirror the render union
  `PiEvent` locally** (derive it from the imported `AgentEvent` + the session events — `compaction_*`,
  `auto_retry_*`, `session_info_changed`, …). Also mirror the small shapes declared in the Node-only
  package: `SessionStats`, `SlashCommandInfo`, and the extension-UI WS frames (`ExtUiRequest` /
  `ExtUiResponse`).
- **domain.ts** — app entities: `Project` (git repo), `Workspace` (git worktree: branch + worktreePath +
  diffStats), `Session` (a chat tab bound to a workspace), `FileNode` (file-tree node), theme/settings/
  git-diff types.
- **wsProtocol.ts** — ours, not `pi`'s: `WS_METHODS` (`project.*` / `workspace.*` / `fs.*` / `git.*` /
  `terminal.*` / `session.*`), `WS_CHANNELS` (`pi.event` / `pi.extensionUi` / `terminal.data`), the typed
  method maps, and the **protocol version** for the welcome handshake.

## Get right

- **Type-only, from `/base`, always.** Never **value**-import any pi package in browser-bundled code, and
  **never import `@earendil-works/pi-coding-agent` at all** into `contracts` (nor the pi-ai provider
  subpaths) — they drag `node:fs` + the provider SDKs into the bundle. `pi-agent-core` + `pi-ai` are
  type-only devDeps here; `pi-coding-agent` is a runtime dep of `packages/server` only.
- Use `ThinkingLevel` from `pi-agent-core/base` (the `off`-inclusive one).
- One id model: the UI tab id vs `session.sessionId` (the `AgentSession` id) — no separate pi UUID.
