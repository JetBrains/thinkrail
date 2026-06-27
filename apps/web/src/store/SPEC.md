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

The single Zustand store: connection status, welcome, projects/workspaces, the **workspace-scoped**
editor tabs + terminals (switching workspaces swaps both), and a **per-session chat runtime** for each live
`AgentSession` (so several chats stream concurrently).

## Boundary

- **Owns:** `appStore.ts` — connection/projects/workspaces state + setters; `tabsByWorkspace` /
  `activeTabByWorkspace` (`openTab`/`closeTab`/`setActiveTab`/`clearWorkspaceTabs`); `terminalsByWorkspace`
  / `activeTerminalByWorkspace` (`addTerminal`/`closeTerminalTab`/`setActiveTerminalTab`); the
  **per-session chat state** — `sessions: Record<sessionId, SessionRuntime>`, where a `SessionRuntime` holds
  one chat's `turns` (pi-canonical) / `toolResults` / `currentAssistantId` / `isStreaming` / `model` /
  `thinkingLevel` / `stats` / `commands` / `draft` and its **extension-UI state** (`pendingExtUi` (typed by
  `chat`'s `ExtUiDialogRequest`) + `extUiQueue` (overlapping dialogs FIFO so none orphans its server
  promise) + `extUiStatus` / `extUiWidget`). `openChatSession` creates a runtime; `closeChatRuntime` /
  `clearWorkspaceTabs` drop it; per-session mutators (`appendUserMessage` / `setStats` / `setCommands` /
  `setCurrentModel` / `setThinkingLevel` / `setChatDraft` / `clearPendingExtUi`) take a `sessionId`. Closed
  chats are reopenable: **`closeChatToHistory`** removes a chat tab but **keeps its runtime + session
  alive**, recording it in **`closedChatsByWorkspace`** (`ClosedChat[]`, per workspace, most-recent-first);
  **`reopenChat`** restores the tab with full state (the runtime never left); **`noteClosedChats`** records
  disk-only sessions (from `session.list`) there too — idempotently (skips live/open/already-listed) — so a
  chat that survived a host restart is reopenable. **`hydrateSession`** rebuilds a runtime + tab from a host
  `SessionSummary` + converted transcript on connect — a no-op if a runtime already exists, so a live/ahead
  chat is never clobbered. The
  pure **`reduceSessionEvent`** folds a `PiEvent` into a runtime (Appendix B); **`handlePiEvent(event,
  sessionId)`** and **`applyExtUi(request)`** route by id via the `withRuntime` helper (a no-op for an
  unknown session). The host-wide **`models`** list stays global (not per session). The `EditorTab`
  (`FileTab` | `ChatTab`) + `TerminalTab` + `ClosedChat` + `SessionRuntime` types. (Chat *render* types +
  renderers live in the `chat` module.)
- **Public surface (barrel):** `useAppStore`, `EditorTab` (`FileTab`/`ChatTab`), `TerminalTab`, `ClosedChat`,
  `SessionRuntime` + `EMPTY_RUNTIME` (ChatView's pre-creation fallback), `reduceSessionEvent`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`Model`/`ThinkingLevel`/`SessionStats`/
  `SlashCommandInfo`/`ExtUiRequest`; `PiEvent`, **type-only**); `chat` (`ChatTurn`/`ToolResultState`,
  **type-only**); `transport` (`ConnectionStatus`, **type-only**); `zustand`.
- **Forbidden:** `server`/`shared`/`pi`; importing `panels`/`shell` or transport runtime.
