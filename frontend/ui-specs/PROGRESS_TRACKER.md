# Progress Tracker — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §2.1 | Status: **Active** | Created: 2026-03-02

## Overview

The Progress tab in the left panel is the unified project health and session activity dashboard. It combines spec-driven metrics, live session tracking, file change monitoring, activity timeline, and cost/budget management. The backend provides a dedicated cost API for persistent tracking.

## 1. Component Hierarchy

```
<ProgressTab>                          // left-panel tab content
  <SpecProgress />                     // spec completion + status breakdown
  <RequirementsProgress />             // requirements coverage
  <SourceCoverage />                   // source path coverage
  <ActiveSessions>                     // running/completed session cards
    <SessionTracker /> ...
  </ActiveSessions>
  <SessionHistory />                   // archived sessions (see SESSION_HISTORY.md)
  <ActivityTimeline>                   // recent agent actions
    <TimelineItem /> ...
  </ActivityTimeline>
  <FileChanges>                        // files modified by sessions
    <FileChangeItem /> ...
  </FileChanges>
  <CostBudget />                       // cost tracking + budget bar
</ProgressTab>
```

## 2. Spec-Driven Metrics

### 2.1 Spec Progress

```
┌─────────────────────────────────────┐
│  SPEC PROGRESS              18%    │
│  ███░░░░░░░░░░░░░░░░         2/11  │
│                                     │
│  ✓ 2 done  ● 4 active  ○ 5 pending│
└─────────────────────────────────────┘
```

**Data source:** `spec/list` RPC → count by status.

| Metric | Calculation |
| --- | --- |
| Percentage | `done / total * 100` |
| Progress bar | Fill width = percentage, color `--green` |
| Breakdown | Count per status: done, active, pending, stale, draft |

### 2.2 Requirements Progress

```
┌─────────────────────────────────────┐
│  REQUIREMENTS               50%    │
│  ██████████░░░░░░░░░░        2/4   │
└─────────────────────────────────────┘
```

**Data source:** Specs tagged with requirement IDs, cross-referenced with `GOAL&REQUIREMENTS.md` entries.

| Metric | Calculation |
| --- | --- |
| Percentage | Requirements with at least one spec → count / total |
| Bar color | `--blue` |

### 2.3 Source Coverage

```
┌─────────────────────────────────────┐
│  SOURCE COVERAGE            67%    │
│  ████████████░░░░░░░         8/12  │
└─────────────────────────────────────┘
```

**Data source:** Union of all `covers` fields from registry entries vs. total source directories.

**Source path discovery:** Scan project root for top-level source directories (e.g., `backend/app/spec/`, `backend/app/core/`, `frontend/src/`). Compare against covered paths.

## 3. Active Session Tracker

Per-session card showing live metrics:

```
┌─────────────────────────────────────┐
│  ● module-design         ▸ running  │
│    Step: Writing models.py          │
│    3 files · $0.08 · 2m 14s        │
│    + models.py  + service.py        │
└─────────────────────────────────────┘
```

| Field | Data Source |
| --- | --- |
| Name + status | Session store |
| Current step | Latest `agent/toolCallStart` → `toolName: toolInput` |
| File count | Count of unique files from `Write`/`Edit` tool calls |
| Cost | Accumulated from backend cost API (see §6) |
| Elapsed time | `Date.now() - session.startedAt` |
| File chips | Files from `Write`/`Edit` tool calls. `+` = new, `~` = modified |

**Update triggers:**
- `agent/toolCallStart` → update "Current step"
- `agent/toolCallEnd` where `toolName` is `Write`/`Edit` → add file chip
- `agent/done` → update status to "done", finalize cost
- Elapsed time → update every 1s via `setInterval`

**Click behavior:** clicking a session card switches to that session tab in the center panel.

## 4. Activity Timeline

Compact log of recent agent actions across all sessions:

```
14:23  ✏️  Write models.py
14:22  📖  Read README.md
14:22  🔍  Grep "BaseModel"
14:21  ⚡  Subagent: Explore
14:20  🚀  Session started
```

| Field | Description |
| --- | --- |
| Timestamp | HH:MM format |
| Icon | Tool icon (same mapping as CHAT_UI.md §4 Tool Icons) |
| Description | `toolName + summary` (file path for Read/Write, pattern for Grep) |

**Data source:** All `agent/toolCallStart` events across sessions. Stored in a ring buffer (max 50 entries).

**Click behavior:** clicking a timeline entry switches to the session and scrolls chat to that event.

## 5. File Changes

Files modified across all active sessions:

```
+  backend/app/spec/models.py
+  backend/app/spec/service.py
~  backend/app/spec/README.md
```

| Prefix | Meaning | Color |
| --- | --- | --- |
| `+` | Created | `--green` |
| `~` | Modified | `--gold` |
| `-` | Deleted | `--red` |

**Data source:** `agent/toolCallEnd` where `toolName` is `Write` (new file) or `Edit` (modified). Track unique file paths with their operation type.

**Click behavior:** clicking a file opens the Diff view in the right panel for that file.

**Badge:** The Progress tab label shows a badge count of changed files (e.g., `Progress 3`).

## 6. Cost & Budget — Backend API

### 6.1 New RPC Methods

| Method | Params | Returns | Description |
| --- | --- | --- | --- |
| `cost/summary` | `{}` | `CostSummary` | Get current cost data |
| `cost/setBudget` | `{ budget: CostBudget }` | `null` | Set budget configuration |
| `cost/reset` | `{ scope: "session" }` | `null` | Reset session cost counter |

### 6.2 CostSummary Shape

```typescript
interface CostSummary {
  sessionCost: number;         // USD since backend started
  projectCost: number;         // USD lifetime for this project
  sessionTokens: number;       // tokens since backend started
  projectTokens: number;       // tokens lifetime
  budget: CostBudget | null;   // configured budget
  sessions: SessionCostEntry[];// per-session breakdown
}

interface CostBudget {
  amount: number;              // USD
  scope: "session" | "project";// which counter to check
  warnAt: number;              // percentage (0-100) to trigger warning (default: 80)
}

interface SessionCostEntry {
  taskId: string;
  name: string;
  costUsd: number;
  tokens: number;
  status: string;
}
```

### 6.3 Persistence

| Scope | Storage | Survives Restart |
| --- | --- | --- |
| Session cost | In-memory (backend) | No |
| Project cost | `.specs/cost.json` | Yes |
| Budget config | `.specs/cost.json` | Yes |

`.specs/cost.json` format:

```json
{
  "projectCost": 12.45,
  "projectTokens": 1250000,
  "budget": { "amount": 50.00, "scope": "project", "warnAt": 80 },
  "history": [
    { "date": "2026-03-02", "cost": 2.30, "tokens": 230000, "sessions": 5 }
  ]
}
```

### 6.4 Cost Accumulation

- On each `agent/done` event, backend adds `costUsd` and `usage` to both session and project counters
- Project counter saved to `.specs/cost.json` after each update (atomic write)
- Frontend polls `cost/summary` every 10s while sessions are running, or receives updates via a new `cost/didUpdate` notification

## 7. Cost & Budget Display

```
┌─────────────────────────────────────┐
│  SESSION COST                       │
│  $2.30 total  ·  230k tokens       │
│                                     │
│  PROJECT COST                       │
│  $12.45 lifetime  ·  1.25M tokens  │
│                                     │
│  Budget: $50.00          25% used   │
│  █████████░░░░░░░░░░░░░░            │
└─────────────────────────────────────┘
```

### Budget Bar Colors

| Usage | Color |
| --- | --- |
| < `warnAt`% | `--green` |
| ≥ `warnAt`% and < 100% | `--gold` |
| ≥ 100% | `--red` |

### Budget Warning

When budget threshold is reached:
1. Budget bar turns gold/red
2. Toast notification: "Budget warning: {X}% of ${amount} used"
3. Status bar shows "⚠ Budget: {X}%"
4. Sessions are NOT auto-stopped — warning only (user decides)

## 8. Update Frequency

| Metric | Update Trigger |
| --- | --- |
| Spec progress | On `registry/didUpdate` notification |
| Requirements | On `registry/didUpdate` notification |
| Source coverage | On `registry/didUpdate` notification |
| Session tracker | On each `agent/*` event for that session |
| Activity timeline | On each `agent/toolCallStart` |
| File changes | On each `agent/toolCallEnd` (Write/Edit) |
| Cost | On `agent/done` + poll every 10s |

## 9. State

```typescript
interface ProgressState {
  // Spec metrics
  specCounts: { done: number; active: number; pending: number; stale: number; draft: number; total: number };
  requirementsProgress: { covered: number; total: number };
  sourceCoverage: { covered: number; total: number };

  // Sessions
  activeSessions: SessionTrackerInfo[];

  // Activity
  timeline: TimelineEntry[];         // ring buffer, max 50
  fileChanges: Map<string, "created" | "modified" | "deleted">;

  // Cost
  costSummary: CostSummary | null;
}
```

## 10. CSS Classes

| Class | Element |
| --- | --- |
| `.prog-section` | Metric card container |
| `.prog-label` | Metric label + percentage |
| `.prog-pct` | Percentage number |
| `.prog-bar` | Progress bar track |
| `.prog-bar-fill` | Progress bar fill |
| `.prog-bar-fill.green` / `.blue` / `.gold` / `.red` | Fill color variants |
| `.prog-counts` | Status breakdown row |
| `.sess-tracker` | Session card |
| `.st-top` / `.st-step` / `.st-meta` / `.st-files` | Session card parts |
| `.st-file` / `.st-file.new` / `.st-file.mod` | File change chips |
| `.timeline-item` | Timeline entry |
| `.tl-time` / `.tl-icon` / `.tl-desc` | Timeline parts |
| `.cost-section` | Cost card |
| `.cost-row` / `.cost-val` / `.cost-label` | Cost display |

## Known Limitations

- **Source coverage is approximate:** Counts directory-level coverage, not file or function-level
- **Cost estimates during run are approximate:** Exact cost only available from agent/done event
- **Activity timeline is not persistent:** Lost on page refresh (ring buffer in memory only)

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §2.1
- **Depends on:** [API Client](../src/api/README.md) (cost/*, spec/list), [State Management](../src/store/README.md) (costStore, sessionStore)
- **Related:** [Session History](SESSION_HISTORY.md) (archived sessions), [Diff Viewer](DIFF_VIEWER.md) (file changes → diff)
