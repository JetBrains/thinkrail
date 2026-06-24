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
- **Public surface:** the top-level panels the shell mounts (`ProjectTree`, `CenterTabs`, `RightPanel`,
  `TerminalsPanel`), imported **per-file** (no barrel — keeps the lazy chunks split).
- **Allowed deps:** `store`, `transport`, `components/ui`, `lib`, `contracts`; `lucide-react`; and the
  heavy libs each lazy panel owns (`monaco-editor`, `shiki`, `@xterm/*`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

## Get right

- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
