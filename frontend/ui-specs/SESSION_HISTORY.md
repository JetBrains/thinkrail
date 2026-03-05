# Session History & Persistence — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §3 | Status: **Active** | Created: 2026-03-02

## Overview

Completed and closed agent sessions are preserved with their full chat log (all agent events). Users can review past conversations in read-only mode by restoring them into the existing session panel with a `restored: true` flag. Session data is stored in-memory for v1, with backend persistence for restore.

## 1. Component Hierarchy

```
<ProgressTab>
  ...
  <SessionHistory>                     // section in Progress tab
    <HistoryItem /> ...                // one per archived session (direct children)
  </SessionHistory>
</ProgressTab>
```

There are no `HistoryHeader`, `HistoryList`, `ReadOnlySession`, `SessionHeader`, or `SessionSummary` components. The `ProgressTab` renders the "History" section header itself; `SessionHistory` is a flat wrapper that maps `HistoryItem` components.

Read-only replay reuses the existing `SessionPanel` -> `ChatStream` pipeline. When a session is restored from the backend, it is inserted into `sessionStore.sessions` with `restored: true`, and the `SessionPanel` renders a `RestoredBar` (with a "Resume Session" button) in place of the `InputArea`.

## 2. Session Lifecycle

```
Running -> Done/Error -> Tab closed -> Archived (in-memory)
```

A session enters the archive when the user closes its tab via `closeSession(taskId)`:
1. If the session is still running, the backend is told to end it (`api.end(taskId)`).
2. The session is removed from `sessions` and appended to `archivedSessions[]`.
3. The `result` field is set to `"done"` if the session status was `"done"`, otherwise `"error"`.

There is no `"interrupted"` result on `ArchivedSession` -- interrupted sessions that are closed are archived as `"error"`.

## 3. Data Types

### ArchivedSession

```typescript
interface ArchivedSession {
  taskId: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  startedAt: number;              // epoch ms
  endedAt: number;                // epoch ms
  result: "done" | "error";       // no "interrupted"
  costUsd: number;
  turns: number;
  durationMs: number;
  model: string;
  config: AgentConfig;            // full agent configuration snapshot
  events: AgentEvent[];           // all agent events in order
}
```

### AgentConfig

```typescript
interface AgentConfig {
  model: string;
  maxTurns: number;
  permissionMode: string;
  streamText: boolean;
}
```

### AgentEvent

```typescript
interface AgentEvent {
  taskId: string;
  sessionId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
}
```

Where `EventType` is one of: `"sessionStart"`, `"textDelta"`, `"toolCallStart"`, `"toolCallEnd"`, `"turnComplete"`, `"interrupted"`, `"subagentStart"`, `"subagentEnd"`, `"notification"`, `"compact"`, `"progress"`, `"done"`, `"error"`, `"permissionDenied"`, `"askUserQuestion"`, `"confirmAction"`, `"userMessage"`.

## 4. History List (Progress Tab)

Displayed in the Progress tab inside a `<div className="progress-section">` beneath Active Sessions, Cost, and Activity sections. The section header ("History") is rendered by `ProgressTab`, not by `SessionHistory`.

```
History
+--------------------------------------+
|  checkmark  goal-and-requirements    |
|     $0.05 . 3 turns . 30s           |
|  checkmark  spec-init               |
|     $0.03 . 1 turns . 12s           |
|  cross  test-runner                  |
|     $0.02 . 2 turns . 8s            |
+--------------------------------------+
```

Each `HistoryItem` renders two rows:
1. **Header row** (`.history-item-header`): status badge + session name
2. **Meta row** (`.history-item-meta`): cost, turns count, and formatted duration

| Element | Description |
| --- | --- |
| Status badge | checkmark (`history-badge-done`, green) for `result === "done"` / cross (`history-badge-error`, red) for `result === "error"` |
| Session name | Full name, not truncated |
| Cost | `$X.XX` format |
| Turns | `N turns` -- number of conversation turns |
| Duration | `Ns` for < 60s, `Nm` for >= 60s |

**Ordering:** newest first -- the `archivedSessions` array is spread, reversed, and sliced.

**Visible count:** 10 items maximum (hardcoded `slice(0, 10)`). There is no "Show more" button or pagination.

**Empty state:** When no archived sessions exist, renders `<div className="progress-empty">No completed sessions</div>`.

**Click behavior:** Not implemented. `HistoryItem` does not have an `onClick` handler.

## 5. Read-Only Replay Mode

Read-only replay is not triggered by clicking a `HistoryItem`. Instead, it is achieved through `sessionStore.restoreSession(taskId)`, which loads a session from the backend persistence layer.

### Restore Flow

1. If the session already exists in memory, it is simply activated (`switchSession`).
2. Otherwise, `restoreSession` calls the backend `session/get` RPC method to load the session data.
3. Backend events are converted to the `AgentEvent` format.
4. All `askUserQuestion` and `confirmAction` events are marked as answered (with `{ historical: true }`).
5. A `Session` object is created with `status: "done"` and `restored: true`.
6. The session is added to `sessions` and set as active.

### Rendering in SessionPanel

When a restored session is displayed:
- The same `<ChatStream>` component renders all events, reusing chat UI components.
- The `<SessionStatusLine>` is shown but with controls disabled (`disabled={activeSession.restored || isDone}`).
- Instead of `<InputArea>`, a `<RestoredBar>` is rendered:

```
+----------------------------------------------+
|  This is a restored session (read-only)      |
|                          [Resume Session]    |
+----------------------------------------------+
```

The "Resume Session" button calls `session/continue` on the backend, which creates a new task that continues from the old session's conversation. The old session tab is replaced with the new resumed session, carrying over the event history.

### CSS Classes for RestoredBar

| Class | Element |
| --- | --- |
| `.restored-bar` | Container bar at bottom |
| `.restored-bar-text` | "This is a restored session (read-only)" label |
| `.restored-bar-btn` | "Resume Session" button |

## 6. Storage

### V1: In-Memory Archive

- `archivedSessions` array lives in `sessionStore` (not a separate store).
- Populated when `closeSession(taskId)` is called.
- Lost on page refresh.
- No maximum limit (memory-bound).

### Backend Persistence (Implemented)

Sessions are persisted by the backend and can be loaded via `session/get`. The `restoreSession` action handles loading and inserting them into the live session map. This is used for the read-only replay feature described in section 5.

## 7. Search & Filter

Not implemented. Acknowledged as optional -- implement when session count makes filtering necessary.

## 8. State

There is no dedicated `SessionHistoryState` store. All history state lives within the main `SessionStore`:

```typescript
interface SessionStore {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  archivedSessions: ArchivedSession[];

  // ... other actions
  closeSession: (taskId: string) => void;       // archives + removes from sessions
  restoreSession: (taskId: string) => Promise<void>;  // loads from backend into sessions
}
```

The `Session` interface includes an optional `restored?: boolean` flag that marks sessions loaded from disk as read-only.

### Relevant Actions

| Action | Trigger | Effect |
| --- | --- | --- |
| `closeSession(taskId)` | User closes session tab | Removes from `sessions`, appends to `archivedSessions`, optionally ends backend task |
| `restoreSession(taskId)` | External trigger (not from HistoryItem click) | Loads session from backend, inserts into `sessions` with `restored: true`, sets as active |

## 9. CSS Classes

| Class | Element |
| --- | --- |
| `.session-history` | Outer wrapper of the history list |
| `.history-item` | Individual archived session entry |
| `.history-item-header` | Header row: badge + name |
| `.history-badge` | Status icon span (base class) |
| `.history-badge-done` | Done status modifier (checkmark, green) |
| `.history-badge-error` | Error status modifier (cross, red) |
| `.history-item-name` | Session name text |
| `.history-item-meta` | Meta row: cost, turns, duration |
| `.progress-empty` | Empty state ("No completed sessions") |

## Known Limitations

- **In-memory archive only:** `archivedSessions` array is lost on page refresh (backend persistence covers the restore path separately).
- **No click-to-replay from history list:** `HistoryItem` does not open the session; restore is triggered via a separate mechanism.
- **No export:** Cannot export session logs to file.
- **No search within session:** Cannot search for text across archived session events.
- **Fixed visible count:** Hardcoded to 10 items; no pagination or "Show more".

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) section 3
- **Depends on:** [Chat UI](CHAT_UI.md) (reuses chat components for restored session rendering), sessionStore (`archivedSessions`, `restoreSession`)
- **Related:** [Progress Tracker](PROGRESS_TRACKER.md) (session history section rendered within ProgressTab)
