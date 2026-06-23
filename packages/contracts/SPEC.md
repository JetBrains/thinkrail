---
id: module-contracts
type: module-design
status: active
title: Wire contracts (types-only)
parent: architecture
depends-on: []
tags: [v1, wire]
---

## Responsibility

The browser↔host wire spine: the single source of truth for the protocol. Types-only, with the only
runtime exports being the WS method/channel constants and the protocol version. The one package
`apps/web` may depend on — which is what lets the UI ship independently of the host.

## Boundary

- **Owns:** the wire — entity types, the `pi` event/message types (re-exported), the WS method & channel
  registries, and the protocol version.
- **Public surface (`index.ts`):** `export type *` of `piProtocol` + `domain`; `export *` (value) of
  `wsProtocol` (`WS_METHODS`, `WS_CHANNELS`, the typed maps, `PROTOCOL_VERSION`).
- **Allowed deps:** none at runtime. **Type-only** devDeps on `@earendil-works/pi-ai` +
  `@earendil-works/pi-agent-core`, imported **only from their `/base` entries**.
- **Forbidden:** any *value* import of a `pi` package; **any** import (even `type`) of
  `@earendil-works/pi-coding-agent` (pulls `node:fs`); the pi-ai **provider subpaths** (`/anthropic`,
  `/openai`, `/google`, … — they statically load the Node provider SDKs); and importing
  `server` / `shared` / `web`.

## Contents

- **piProtocol.ts** — `import type` re-exports from the browser-safe `/base` entries:
  - `@earendil-works/pi-ai/base`: `Model`, `Message`, `UserMessage`, `AssistantMessage`,
    `ToolResultMessage`, `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`,
    `AssistantMessageEvent`, `Usage`, `StopReason`;
  - `@earendil-works/pi-agent-core/base`: `AgentEvent`, `AgentMessage`, `ThinkingLevel` (the
    `off`-inclusive one);
  - the local render union **`PiEvent`** — the real superset `AgentSessionEvent` lives in the Node-only
    `pi-coding-agent`, so it's mirrored here. Finalized when chat lands (M10/M11); until then `= AgentEvent`.
- **domain.ts** — app entities: `Project` (git repo + unique `slug`), `Workspace` (git worktree), `Session` (chat tab),
  `FileNode` (file-tree node), `TabStatus`, `Git*`/diff types.
- **wsProtocol.ts** — `WS_METHODS` (`project.*` / `workspace.*` / `fs.*` / `git.*` / `terminal.*`;
  `session.*` added at M10), `WS_CHANNELS` (`server.welcome` / `pi.event` / `pi.extensionUi` /
  `terminal.data`), the `WsMethodMap` typed request/result map + `WsParams`/`WsResult` helpers, and
  `PROTOCOL_VERSION`.

## Get right

- **Type-only, from `/base`, always** (verified vs 0.79.10: `/base` → `dist/base.d.ts`, provider-free;
  providers are separate subpaths that statically import the Node SDKs — never touch them).
- `Model` is generic — expose as `Model<any>`.
- `AssistantMessageEvent` (the streaming deltas) is nested under `message_update.assistantMessageEvent`,
  never a top-level event `type`.
- Internal relative imports are **extensionless** (`./domain`), not `./domain.ts` — `composite` emits
  declarations, which is incompatible with `allowImportingTsExtensions`.
- **Bundle gate (M1 checkpoint):** `bun build` the web app and confirm **no** `@anthropic-ai/sdk` /
  `openai` / `node:fs` appears.

## Consumed by

`web` (types + WS constants) and `server` (same, + mapping `session.*` to `AgentSession` methods). The
shell milestones (M3–M9) need `domain` + `wsProtocol`; the `pi` types + `PiEvent` are the wire for M10+.
