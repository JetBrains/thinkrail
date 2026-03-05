# Progress Tracker — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §2.1 | Status: **Active** | Created: 2026-03-02

## Overview

The Progress tab in the left panel is the project health and session activity dashboard. It combines spec-driven metrics, live session tracking, an activity timeline, session history, and cost display. There is no dedicated ProgressState — the component composes state from `useSpecStore`, `useSessionStore`, and `useCostStore`.

## 1. Component Hierarchy

```
<ProgressTab>                          // left-panel tab content (inline sections)
  |- Spec Progress section             // inline — spec completion + status breakdown
  |- Active Sessions section           // inline — running/completed session cards
  |- Cost section                      // inline — session + project cost display
  |- <ActivityTimeline />              // separate component — recent agent actions
  +- <SessionHistory />               // separate component (from SessionHistory module)
```

Only `ActivityTimeline` (in `ProgressTab/ActivityTimeline.tsx`) and `SessionHistory` (in `SessionHistory/SessionHistory.tsx`) are extracted as separate components. All other sections are rendered inline within `ProgressTab`.

## 2. Spec-Driven Metrics

### 2.1 Spec Progress

```
+-------------------------------------+
|  SPEC PROGRESS              18%    |
|  ###                         2/11  |
|                                     |
|  done 2 done  * 4 active  o 5 pending|
+-------------------------------------+
```

**Data source:** `useSpecStore` -> `specs` array (type `RegistryEntry[]`). Counts are computed inline in the component.

| Metric | Calculation |
| --- | --- |
| Percentage | `done / total * 100`, rounded via `Math.round` |
| Progress bar | Fill width = percentage, color `--green` |
| Breakdown | Three categories only: done (green), active (blue), pending = `total - done - active` (hint color) |

The component does not track `stale` or `draft` statuses separately — everything that is not `done` or `active` is counted as `pending`.

## 3. Active Session Cards

Per-session card showing status and metrics:

```
+-------------------------------------+
|  * module-design         > running  |
|    3 calls . $0.08 . 14s           |
+-------------------------------------+
```

| Field | Data Source |
| --- | --- |
| Dot (color) | `session.status`: running = `--blue`, done = `--green`, other = `--red` |
| Name | `session.name` |
| Status text | `session.status` string |
| Tool calls | `session.metrics.toolCalls` |
| Cost | `session.metrics.costUsd`, formatted to 2 decimal places |
| Duration | `session.metrics.durationMs / 1000`, rounded to nearest second |

The session list is derived from `useSessionStore` -> `sessions` (a `Map<string, Session>`), converted to an array via `Array.from(sessions.values())`. The entire section is hidden when there are no sessions.

**Not implemented:** "current step" display, file chips, 1-second elapsed timer, click-to-switch behavior.

## 4. Cost Display

```
+-------------------------------------+
|  COST                               |
|  $2.30 session . $12.45 total      |
+-------------------------------------+
```

**Data source:** `useCostStore` -> `summary` (type `CostSummary | null`).

The cost section is only rendered when `costSummary` is non-null. It displays `sessionCost` and `projectCost` formatted to 2 decimal places. No token counts, no budget bar, no budget warnings are rendered.

**Note:** The cost store is currently a stub — all actions are no-ops. The `fetchSummary`, `setBudget`, and `reset` methods have TODO comments awaiting backend `cost/*` endpoint implementation. Polling interval is set to 5 seconds.

### 4.1 CostSummary Shape

```typescript
interface CostSummary {
  sessionCost: number;         // USD since backend started
  projectCost: number;         // USD lifetime for this project
  sessionTokens: number;       // tokens since backend started
  projectTokens: number;       // tokens lifetime
  budget: CostBudget | null;   // configured budget
}

interface CostBudget {
  amount: number;              // USD
  scope: "session" | "project";// which counter to check
  warnAt: number;              // percentage (0-100) to trigger warning
}
```

`CostSummary` has no `sessions` field (no per-session cost breakdown).

## 5. Activity Timeline

Compact log of recent agent actions across all sessions:

```
14:23  wrench  Write models.py
14:23  check   toolCallEnd
14:22  speech  textDelta
14:21  bolt    Subagent: Explore
14:20  rocket  Session started
```

### 5.1 Props and Data Flow

`ActivityTimeline` receives `events: AgentEvent[]` as a prop. The parent `ProgressTab` collects all events across all sessions via:

```typescript
const allEvents: AgentEvent[] = sessionList.flatMap((s) => s.events);
```

The component slices the **last 20** entries (not 50) via `events.slice(-20).reverse()`, displaying newest first.

### 5.2 EVENT_ICONS Map

The timeline uses its own icon mapping, separate from the Chat UI tool icons:

```typescript
const EVENT_ICONS: Record<string, string> = {
  toolCallStart: "wrench",
  toolCallEnd:   "checkmark",
  textDelta:     "speech bubble",
  sessionStart:  "rocket",
  subagentStart: "lightning",
  done:          "checkmark",
  error:         "cross",
};
```

Unrecognized event types fall back to a filled circle character.

### 5.3 Timeline Entry Layout

Each entry shows: timestamp, icon, label.

| Field | Description |
| --- | --- |
| Timestamp | HH:MM format via `toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })` |
| Icon | Looked up from `EVENT_ICONS` by `event.eventType` |
| Label | For `toolCallStart`: `toolName + toolInput` (truncated to 30 chars). For all other types: the `eventType` string itself. |

### 5.4 Known Issue: Timestamps

Timestamps use `new Date()` at render time rather than the event's actual timestamp. All visible entries display the current clock time, not when the event occurred.

## 6. Session History

Rendered via the `<SessionHistory />` component imported from `@/components/SessionHistory/SessionHistory.tsx`. See [SESSION_HISTORY.md](SESSION_HISTORY.md) for details.

## 7. Update Frequency

| Metric | Update Trigger |
| --- | --- |
| Spec progress | On `registry/didUpdate` notification (triggers `specStore.fetchSpecs`) |
| Session cards | On each `agent/*` event for that session (via `sessionStore.onAgentEvent`) |
| Activity timeline | Re-renders when session events change (derived from session store) |
| Cost | Currently stubbed; will poll every 5s via `costStore.startPolling` when implemented |

## 8. CSS Classes

All styles are defined in `ProgressTab.css`.

| Class | Element |
| --- | --- |
| `.progress-tab` | Root container (flex column, gap between sections) |
| `.progress-section-header` | Section label (uppercase, 10px, `--hint` color) |
| `.progress-bar-row` | Flex row containing progress bar + percentage |
| `.progress-bar` | Progress bar track (6px height, `--border` background) |
| `.progress-bar-fill` | Progress bar fill (`--green`, animates width) |
| `.progress-pct` | Percentage text (12px, bold, right-aligned) |
| `.progress-stats` | Status breakdown row (done/active/pending counts) |
| `.stat-done` / `.stat-active` / `.stat-pending` | Individual stat colors (green/blue/hint) |
| `.progress-empty` | Empty state text (italic, hint color) |
| `.session-card` | Session card container (elevated background, border) |
| `.session-card-header` | Card header row (dot + name + status) |
| `.session-card-dot` | 6px colored circle indicating status |
| `.session-card-name` | Session name (truncated with ellipsis) |
| `.session-card-status` | Status text (10px, hint color) |
| `.session-card-metrics` | Metrics line (10px, muted color) |
| `.cost-display` | Cost text (12px) |
| `.activity-timeline` | Timeline container (flex column, max-height 200px, scrollable) |
| `.timeline-entry` | Single timeline row (flex, 11px) |
| `.timeline-time` | Timestamp (10px, hint color, 40px min-width) |
| `.timeline-icon` | Event icon (12px) |
| `.timeline-label` | Event description (muted, truncated with ellipsis) |

## 9. Known Limitations

- **No dedicated ProgressState:** State is composed from three separate Zustand stores (`specStore`, `sessionStore`, `costStore`) at render time
- **Cost store is stubbed:** All cost actions are no-ops; backend `cost/*` endpoints do not exist yet
- **Timeline timestamps are incorrect:** All entries show the current render time, not the actual event time
- **Activity timeline is not persistent:** Events are held in session store memory only; lost on page refresh
- **No budget bar or budget warnings:** The cost section only displays raw dollar amounts
- **No requirements progress or source coverage sections:** These spec metrics are not implemented
- **No file changes section:** File change tracking is not rendered in the progress tab
- **Session cards have no click behavior:** Clicking a card does not navigate to the session

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §2.1
- **Depends on:** [State Management](../src/store/README.md) (specStore, sessionStore, costStore)
- **Related:** [Session History](SESSION_HISTORY.md) (archived sessions)
