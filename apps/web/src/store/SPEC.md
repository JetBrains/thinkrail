---
id: submodule-web-store
type: submodule-design
status: active
title: store — Zustand app state
parent: module-web
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The single Zustand store: connection status, welcome, projects/workspaces, and the **workspace-scoped**
editor tabs + terminals (switching workspaces swaps both).

## Boundary

- **Owns:** `appStore.ts` — connection/projects/workspaces state + setters; `tabsByWorkspace` /
  `activeTabByWorkspace` (`openTab`/`closeTab`/`setActiveTab`/`clearWorkspaceTabs`); `terminalsByWorkspace`
  / `activeTerminalByWorkspace` (`addTerminal`/`closeTerminalTab`/`setActiveTerminalTab`); the `EditorTab`
  + `TerminalTab` types.
- **Public surface (barrel):** `useAppStore`, `EditorTab`, `TerminalTab`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`); `transport` (`ConnectionStatus`, **type-only**);
  `zustand`.
- **Forbidden:** `server`/`shared`/`pi`; importing `panels`/`shell` or transport runtime.
