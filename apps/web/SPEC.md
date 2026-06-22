---
id: module-web
type: module-design
status: draft
title: Web UI client
parent: architecture
depends-on: [module-contracts]
tags: [v1, ui]
---

## Responsibility

The mobile-first React UI. Ships as static assets and dials an engine host over the wire. Renders `pi`'s
event stream as a chat-centric, multi-session IDE shell.

## Internal structure

- **transport/** — single WebSocket client; id-correlated `request`, channel `subscribe` with replay,
  reconnect/backoff. The host endpoint is a parameter (default same-origin via `inferUrl`).
- **store/** — Zustand; per-session runtime (messages, streaming state, stats). Layout/active-panel state.
- **panels/** — layout-agnostic, store-driven: `ProjectTree` (project→workspace nav), `FileTree` (All
  files), `Editor` (Monaco, center tabs), `ChangesPanel` + `DiffViewer`, `TerminalView`, `ChatView`,
  `Composer`. A panel fills its container and never knows its arrangement.
- **shell/** — the 3-column frame: left project→workspace nav, center tabbed area (file tabs +
  chat tabs), right All-files/Changes panel with terminals below. Desktop multi-pane / mobile
  single-view-with-switcher, breakpoint-driven.

## Get right

- **`apps/web` depends on `packages/contracts` only.** Never value-import `pi`; never import `server`/`shared`.
- Streaming invariant: `text_delta` / `thinking_delta` **APPEND**; `tool_execution_update.partialResult`
  **REPLACE**.
- Panels stay arrangement-agnostic so the mobile shell is an additive layer, not a rewrite.

## Later

The mobile single-view shell and PWA packaging (installable, offline shell) ride on this split without
touching panels or store.
