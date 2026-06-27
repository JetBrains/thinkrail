---
id: submodule-web-panels
type: submodule-design
status: active
title: panels — feature views
parent: module-web
depends-on: [module-contracts]
tags: [v1, ui]
---

## Responsibility

The layout-agnostic, store-driven feature views. A panel fills its container and never knows its
arrangement (so the mobile shell is an additive layer, not a rewrite).

## Boundary

- **Owns:** `ProjectTree`, `FileTree`, `RightPanel`, `ChangesPanel` + lazy `DiffViewer`, `CenterTabs` +
  lazy `MonacoEditor`, `TerminalsPanel` + lazy `TerminalInstance`. Panels compose their own sub-panels
  (e.g. `RightPanel`→`FileTree`/`ChangesPanel`, `CenterTabs`→`MonacoEditor`) — an internal hierarchy.
  `CenterTabs` closing a chat tab routes to `store.closeChatToHistory` (keeps the session alive) and shows a
  **chat-history** dropdown (recently-closed + disk-only chats, shown only when non-empty). On
  workspace-activate it **hydrates**: `session.list` → **live** sessions auto-restore as tabs
  (`session.getMessages` → `messagesToRuntime` → `store.hydrateSession`); **disk-only** ones go to history
  via `store.noteClosedChats`. Reopening restores a live runtime's tab, or for a disk-only chat re-opens it
  on the host (`getMessages`) + hydrates — so a reload, a second tab, or a host restart all rebuild from the
  host.
- **Public surface:** the top-level panels the shell mounts (`ProjectTree`, `CenterTabs`, `RightPanel`,
  `TerminalsPanel`), imported **per-file** (no barrel — keeps the lazy chunks split).
- **Allowed deps:** `store`, `transport`, `components/ui`, `lib`, `contracts`; `lucide-react`; and the
  heavy libs each lazy panel owns (`monaco-editor`, `shiki`, `@xterm/*`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

## Get right

- `RightPanel`/`ChangesPanel` watch the store's `changesRequest` deep-link (set by a chat turn-divider's
  "files changed" chip): when it targets the active workspace, `RightPanel` flips to the Changes tab and
  `ChangesPanel` selects the requested file (matched by path suffix against `git.status`).
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
