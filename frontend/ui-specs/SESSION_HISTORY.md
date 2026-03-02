# Session History & Persistence — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §3 | Status: **Active** | Created: 2026-03-02

## Overview

Completed and closed agent sessions are preserved with their full chat log (all agent events). Users can review past conversations in read-only mode. Session data is stored in-memory for v1, with a path toward disk persistence.

## 1. Component Hierarchy

```
<SessionHistory>                       // section in Progress tab
  <HistoryHeader />                    // "Session History" + count
  <HistoryList>
    <HistoryItem /> ...                // one per archived session
  </HistoryList>
</SessionHistory>

<ReadOnlySession>                      // center-panel tab (when replaying)
  <SessionHeader />                    // name, skill, "read-only" badge
  <ChatStream />                       // same Chat UI components, non-interactive
  <SessionSummary />                   // replaces input area
</ReadOnlySession>
```

## 2. Session Lifecycle

```
Running → Done/Error → Archived
                ↓
         Tab closed by user
                ↓
           Archived
```

A session enters the archive when:
1. `agent/done` or `agent/error` received AND the user closes the tab
2. User explicitly closes a completed session tab
3. Running session is interrupted and then closed

## 3. Archived Session Data

Each archived session stores the **complete event log**:

```typescript
interface ArchivedSession {
  // Metadata
  taskId: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  startedAt: number;              // epoch ms
  endedAt: number;                // epoch ms
  result: "done" | "error" | "interrupted";
  costUsd: number;
  turns: number;
  durationMs: number;
  model: string;

  // Full event log
  events: AgentEvent[];           // all agent/* events in order
}

type AgentEvent = {
  type: string;                   // "agent/textDelta", "agent/toolCallStart", etc.
  timestamp: number;              // epoch ms
  params: Record<string, any>;    // event-specific params
};
```

## 4. History List (Progress Tab)

Displayed in the Progress tab below Active Sessions:

```
SESSION HISTORY                    12
┌──────────────────────────────────────┐
│  ✓  goal-and-requirements  $0.05 30s│
│  ✓  spec-init              $0.03 12s│
│  ✓  architecture-design    $0.12 45s│
│  ✕  test-runner             $0.02 err│
│  ✓  module-design          $0.34 3m │
│         [Show more...]              │
└──────────────────────────────────────┘
```

| Column | Description |
| --- | --- |
| Status icon | `✓` (done, `--green`) / `✕` (error, `--red`) / `⊘` (interrupted, `--hint`) |
| Session name | Truncated to fit panel width |
| Cost | USD for that session |
| Duration | Formatted: `12s`, `3m`, `1h 5m` |

**Ordering:** newest first (most recent archived session at top).

**Pagination:** show last 5 by default, "Show more..." loads next 10.

**Click behavior:** clicking an archived session opens it in read-only mode in the center panel.

## 5. Read-Only Replay Mode

When an archived session is opened, it renders in the center panel as a new tab:

```
┌─ module-design (archived) ─┬─ ... ─┐
```

### Tab Appearance

- Tab name: `{name} (archived)`
- Status dot: gray (not running)
- No close confirmation needed (it's already archived)

### Chat Rendering

- Same `<ChatStream>` components from CHAT_UI.md
- All message types rendered identically (text, tool cards, questions, etc.)
- **Non-interactive:** question cards show the chosen answer (grayed out, non-clickable). Approval cards show the decision taken.
- Input area replaced by `<SessionSummary>`:

```
┌──────────────────────────────────────────────┐
│  Session completed · $0.34 · 15 turns · 3m   │
│  claude-opus-4-6 · 45k tokens               │
└──────────────────────────────────────────────┘
```

### Answered Question Display

For `agent/askUserQuestion` events that were already answered:

```
┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
│  APPROACH                      │
│  Which format to prioritize?   │
│                                │
│  ✓ Markdown first              │ ← chosen answer highlighted
│    JSON first                  │ ← other options dimmed
│                                │
│  Answered                      │ ← status badge instead of buttons
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

### Answered Approval Display

```
┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
│  ✓ Approved                    │ ← green badge
│  Bash: pip install markdown... │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

## 6. Storage

### V1: In-Memory

- All archived sessions stored in a client-side array
- Lost on page refresh
- Maximum: unlimited (memory-bound, typically <100 sessions)

### V2 (future): Backend Persistence

Path toward persistent storage:

| Approach | Description |
| --- | --- |
| File-based | Each session saved as `.specs/sessions/{taskId}.json` |
| RPC methods | `session/list`, `session/get`, `session/delete` |
| Loading | Lazy-load event log on demand, metadata always in memory |
| Cleanup | Auto-delete sessions older than N days (configurable) |

**Note:** V2 is not implemented in this spec — listed as a future direction. The in-memory approach is sufficient for v1 since the backend is a localhost dev tool (sessions last as long as the browser tab is open).

## 7. Search & Filter

Within the history list:

- **Filter by result:** buttons for `All | Done | Error | Interrupted`
- **Filter by skill:** dropdown of skills used
- **Search by name:** text filter on session name

These filters are optional for v1 — implement when session count makes them necessary.

## 8. State

```typescript
interface SessionHistoryState {
  archivedSessions: ArchivedSession[];  // newest first
  visibleCount: number;                  // pagination (default: 5)
  openReplayId: string | null;           // taskId of session being replayed
  filter: {
    result: "all" | "done" | "error" | "interrupted";
    skillId: string | null;
    searchQuery: string;
  };
}
```

### Actions

| Action | Trigger | Effect |
| --- | --- | --- |
| `archiveSession(session)` | Session done/error + tab closed | Add to `archivedSessions` |
| `openReplay(taskId)` | Click history item | Create read-only tab in center panel |
| `closeReplay(taskId)` | Close archived tab | Remove read-only tab |
| `showMore` | Click "Show more" | Increment `visibleCount` by 10 |
| `setFilter(filter)` | Filter controls | Update filter, re-render list |

## 9. CSS Classes

| Class | Element |
| --- | --- |
| `.hist-section` | History section in Progress tab |
| `.hist-header` | Section header with count |
| `.hist-list` | Scrollable list container |
| `.hist-item` | Individual session entry |
| `.hist-item .hist-icon` | Result icon (✓/✕/⊘) |
| `.hist-item .hist-name` | Session name |
| `.hist-item .hist-meta` | Cost + duration |
| `.hist-show-more` | "Show more" button |
| `.replay-badge` | "read-only" / "archived" badge on tab |
| `.replay-summary` | Session summary replacing input area |
| `.q-answered` | Answered question card (non-interactive) |
| `.ap-answered` | Answered approval card (non-interactive) |

## Known Limitations

- **In-memory only (v1):** All archived sessions lost on page refresh
- **No export:** Cannot export session logs to file (JSON, markdown, etc.)
- **No search within session:** Cannot search for text across archived session events

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §3
- **Depends on:** [Chat UI](CHAT_UI.md) (reuses chat components for replay), [State Management](../src/store/README.md) (sessionStore.archivedSessions)
- **Related:** [Progress Tracker](PROGRESS_TRACKER.md) (session history section)
