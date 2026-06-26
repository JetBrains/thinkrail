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
  / `activeTerminalByWorkspace` (`addTerminal`/`closeTerminalTab`/`setActiveTerminalTab`); the
  **single-session chat state** (`chatSessionId` / `turns` (pi-canonical) / `toolResults` /
  `currentAssistantId` / `isStreaming`, with `openChatSession` / `appendUserMessage` + the `handlePiEvent`
  dispatcher that folds pi events into `ChatTurn`s — Appendix B); the **M12 cheap-win + composer state**
  (`models` / `currentModel` / `thinkingLevel` / `stats` / `commands` / `chatDrafts`) and the
  **extension-UI state** (`pendingExtUi` dialog (typed by `chat`'s `ExtUiDialogRequest`) + `extUiQueue`
  (overlapping dialogs shown FIFO so none orphans its server promise) + `extUiStatus` / `extUiWidget`, fed
  by the `applyExtUi` dispatcher; `clearPendingExtUi` promotes the queue on reply); the `EditorTab`
  (`FileTab` | `ChatTab`) + `TerminalTab` types. (Chat *render* types + renderers live in the `chat` module.)
- **Public surface (barrel):** `useAppStore`, `EditorTab` (`FileTab`/`ChatTab`), `TerminalTab`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`Model`/`ThinkingLevel`/`SessionStats`/
  `SlashCommandInfo`/`ExtUiRequest`; `PiEvent`, **type-only**); `chat` (`ChatTurn`/`ToolResultState`,
  **type-only**); `transport` (`ConnectionStatus`, **type-only**); `zustand`.
- **Forbidden:** `server`/`shared`/`pi`; importing `panels`/`shell` or transport runtime.
