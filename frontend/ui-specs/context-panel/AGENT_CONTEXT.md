---
id: ui-context-panel-agent-mode
type: submodule-design
status: active
title: Agent Context — Context Usage Analytics
parent: ui-context-panel
covers:
- frontend/src/components/ContextPanel/modes/AgentContext.tsx
- frontend/src/components/ContextPanel/modes/AgentContext.css
tags:
- frontend
- ui-spec
---
# Agent Context — Context Usage Analytics

> Parent: [CONTEXT_PANEL.md](../CONTEXT_PANEL.md) | Status: **Active** | Created: 2026-03-06 | Updated: 2026-03-12

## Overview

The Agent Context mode activates when `activeSessionId` is set and no file is focused in the center panel. It renders a **context usage analytics dashboard** showing real-time token utilization, cost breakdown, tool call metrics, file I/O tracking, and cache performance for the active agent session.

This replaces the previous spec-oriented agent context (TaskSpecPreview, FilesModified, RelatedSpecs, ComplianceHints) with a metrics-first view derived from the experimental "Ctx" tab.

**Files:** `frontend/src/components/ContextPanel/modes/AgentContext.tsx` and `AgentContext.css`

---

## Data Source

All sections read from a single data object: `session.metrics.contextUsage: ContextUsage`.

**Type:** `frontend/src/types/session.ts`

```typescript
export interface ContextUsage {
  contextMax: number;
  contextTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  turnHistory: TurnUsage[];
  runBoundaries: number[];
  toolCallCounts: Record<string, number>;
  toolTokens: Record<string, { inputTokens: number; outputTokens: number }>;
  filesRead: string[];
  filesWritten: string[];
}

/** Token usage for a single API call within a turn. */
export interface IterationUsage {
  type: "message" | "compaction";
  inputTokens: number;              // fresh (non-cached) input
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation?: { ephemeral5mInputTokens: number; ephemeral1hInputTokens: number };
}

export interface TurnUsage {
  turnIndex: number;
  inputTokens: number;         // fresh input from last iteration
  outputTokens: number;        // output from last iteration
  cacheCreationTokens: number; // cache create from last iteration
  cacheReadTokens: number;     // cache read from last iteration
  totalContextTokens: number;  // last iteration total: input + cacheRead + cacheCreate + output
  costUsd: number;
  timestamp: number;
  sdkTurns: number;
  iterations?: IterationUsage[];  // per-API-call breakdown within this turn
}
// All breakdown values come from the LAST iteration (the one with the fullest context).
// Invariant: inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens == totalContextTokens
```

---

## Component Structure

```
AgentContext
  ├── .agent-context__header          (utilization summary — always visible, not collapsible)
  │   ├── .agent-context__pct         (large percentage text)
  │   ├── .agent-context__pct-bar     (progress bar)
  │   └── .agent-context__meta        (absolute token count)
  │
  ├── CollapsibleSection "Token Breakdown"
  │   └── TokenBreakdown
  │       ├── .agent-context__stacked-bar
  │       └── .agent-context__breakdown-row[] (4 items: input, cache read, cache creation, output)
  │
  ├── CollapsibleSection "Turn History"
  │   └── TurnHistory
  │       ├── .agent-context__turn-header
  │       ├── .agent-context__run-separator[] (on resume boundaries)
  │       ├── .agent-context__turn-row[]
  │       └── .agent-context__turns-summary
  │
  ├── CollapsibleSection "Tool Calls"
  │   └── ToolCalls
  │       ├── .agent-context__tool-header
  │       └── .agent-context__tool-row[] (sorted by total tokens desc)
  │
  ├── CollapsibleSection "Files Accessed"
  │   └── FilesAccessed
  │       ├── .agent-context__file-label ("Read" / "Written")
  │       ├── .agent-context__file-entry[] (clickable, max 10 per group)
  │       └── .agent-context__file-more ("+N more")
  │
  └── CollapsibleSection "Cache Stats"
      └── CacheStats
          ├── .agent-context__cache-row (hit rate %)
          ├── .agent-context__cache-bar (hit rate bar)
          └── .agent-context__cache-row[] (breakdown: read, creation, fresh)
```

---

## Utilization Header

**Purpose:** At-a-glance context window utilization. Always visible (not inside a CollapsibleSection).

### Data Algorithm

```
Input:  cu.contextTokens, cu.contextMax
Output: { pct: number, color: string }

1. pct = round((contextTokens / contextMax) * 100), or 0 if contextMax == 0
2. Color thresholds:
   - pct >= 90 → var(--red)
   - pct >= 70 → var(--gold)
   - pct < 70  → var(--green)
```

### Rendering

```
<div className="agent-context__header">
  <div className="agent-context__pct" style={{ color }}>{pct}%</div>
  <div className="agent-context__pct-bar">
    <div className="agent-context__pct-fill"
         style={{ width: `${min(pct, 100)}%`, background: color }} />
  </div>
  <div className="agent-context__meta">
    {fmtTokens(contextTokens)} / {fmtTokens(contextMax)}
  </div>
</div>
```

### CSS Classes

| Class | Description |
|---|---|
| `.agent-context__header` | Flex row, center-aligned, gap sm, padding sm/md, border-bottom |
| `.agent-context__pct` | 16px, font-weight 700, min-width 42px, color dynamic |
| `.agent-context__pct-bar` | Flex 1, height 4px, background border color, rounded 2px, overflow hidden |
| `.agent-context__pct-fill` | Height 100%, rounded 2px, transition width 0.4s ease |
| `.agent-context__meta` | 10px, muted color, white-space nowrap |

---

## Section 1: Token Breakdown

**Purpose:** Visualize how token budget is distributed across input, cache, and output categories.

### Data Algorithm

```
Input:  cu.inputTokens, cu.cacheReadTokens, cu.cacheCreationTokens, cu.outputTokens
Output: Array of { label, color, value, widthPct }

Categories (in bar order):
  1. "Input (fresh)"    → var(--blue)
  2. "Cache read"       → var(--green)
  3. "Cache creation"   → var(--gold)
  4. "Output"           → var(--purple, var(--cyan))

total = sum of all 4 values
widthPct = (value / total) * 100 for each
If total == 0 → show "No token data yet"
```

### Rendering

```
CollapsibleSection
  title: "Token Breakdown"
  defaultExpanded: true

  <div className="agent-context__stacked-bar">
    {items with widthPct > 0 → <span style={{ width, background }} />}
  </div>
  {items.map(item =>
    <div className="agent-context__breakdown-row">
      <span className="agent-context__breakdown-dot" style={{ background: color }} />
      <span className="agent-context__breakdown-label">{label}</span>
      <span className="agent-context__breakdown-value">{fmtTokens(value)}</span>
    </div>
  )}
```

### CSS Classes

| Class | Description |
|---|---|
| `.agent-context__stacked-bar` | Flex row, height 6px, rounded 3px, overflow hidden, margin-bottom sm |
| `.agent-context__stacked-bar > span` | Height 100%, transition width 0.3s ease |
| `.agent-context__breakdown-row` | Flex row, center-aligned, gap xs, font-size 11px |
| `.agent-context__breakdown-dot` | 6px circle, flex-shrink 0 |
| `.agent-context__breakdown-label` | Flex 1, muted color |
| `.agent-context__breakdown-value` | Tabular-nums, text color |

---

## Section 2: Turn History

**Purpose:** Table of every conversation turn showing token consumption and cost per exchange.

### Data Algorithm

```
Input:  cu.turnHistory: TurnUsage[], cu.runBoundaries: number[]
Output: Ordered rows with optional run separators

1. Build Set from runBoundaries for O(1) lookup
2. Track runCounter — increment when boundary index is hit
3. For each turn:
   a. If index is in boundarySet and runCounter > 1 → insert run separator row
   b. Render turn row: turnIndex+1, fmtTokens(inputTokens), fmtTokens(outputTokens), $costUsd
4. If totalSdkTurns > turns.length → show summary: "X exchanges · Y SDK turns total"
5. If no turns → show "No turns yet"
```

### Rendering

```
CollapsibleSection
  title: "Turn History"
  count: turnHistory.length

  <div className="agent-context__turns">
    <div className="agent-context__turn-row agent-context__turn-header">
      <span>#</span><span>Input</span><span>Output</span><span>Cost</span>
    </div>
    {rows: separator divs + turn row divs}
    {summary row if SDK turns > exchanges}
  </div>
```

### CSS Classes

| Class | Description |
|---|---|
| `.agent-context__turns` | Flex column, gap 1px, max-height 240px, overflow-y auto |
| `.agent-context__turn-row` | Grid: `42px 1fr 1fr 50px`, gap xs, font-size 10px, tabular-nums |
| `.agent-context__turn-header` | Muted, font-weight 600, 9px, uppercase, letter-spacing 0.3px |
| `.agent-context__turn-dim` | Hint color (turn index number) |
| `.agent-context__run-separator` | Flex center, 9px, muted, font-weight 600, dashed border-top |
| `.agent-context__turns-summary` | 9px, hint, center-aligned, border-top solid, margin-top 2px |

---

## Section 3: Tool Calls

**Purpose:** Table of tools invoked by the agent, sorted by total token cost (most expensive first).

### Data Algorithm

```
Input:  cu.toolCallCounts: Record<string, number>,
        cu.toolTokens: Record<string, { inputTokens, outputTokens }>
Output: Sorted array of { name, calls, inTok, outTok, total }

1. Merge tool names from both records (union of keys)
2. For each tool: calls = counts[name] ?? 0, tokens from toolTokens[name] ?? {0,0}
3. Sort descending by total (inTok + outTok)
4. If no tools → show "No tool calls yet"
```

### Rendering

```
CollapsibleSection
  title: "Tool Calls"
  count: sum of all call counts

  <div className="agent-context__tool-table">
    <div className="agent-context__tool-row agent-context__tool-header">
      <span>Tool</span><span>Calls</span><span>In ~tok</span><span>Out ~tok</span>
    </div>
    {rows.map(r =>
      <div className="agent-context__tool-row">
        <span className="agent-context__tool-name" title={name}>{name}</span>
        <span>{calls}</span>
        <span>{fmtTokens(inTok)}</span>
        <span>{fmtTokens(outTok)}</span>
      </div>
    )}
  </div>
```

### CSS Classes

| Class | Description |
|---|---|
| `.agent-context__tool-table` | Flex column, gap 1px, max-height 200px, overflow-y auto |
| `.agent-context__tool-row` | Grid: `1fr 40px 56px 56px`, gap xs, font-size 10px, tabular-nums |
| `.agent-context__tool-header` | Muted, font-weight 600, 9px, uppercase |
| `.agent-context__tool-name` | Overflow hidden, text-overflow ellipsis, white-space nowrap |

---

## Section 4: Files Accessed

**Purpose:** Show files read and written by the agent during the session, with click-to-preview.

### Data Algorithm

```
Input:  cu.filesRead: string[], cu.filesWritten: string[]
Output: Two groups (Read, Written) with abbreviated paths

1. For each group, show up to MAX_FILES (10) entries
2. If more → show "+N more" indicator
3. Path abbreviation: if > 3 segments, show ".../{last 3 segments}"
4. If both empty → show "No files accessed yet"
```

### Rendering

```
CollapsibleSection
  title: "Files Accessed"
  count: filesRead.length + filesWritten.length

  <div className="agent-context__files">
    {filesRead.length > 0 && (
      <>
        <div className="agent-context__file-label">Read ({count})</div>
        {filesRead.slice(0, 10).map(f =>
          <div className="agent-context__file-entry"
               title={f}
               onClick={() => loadPreview(f)}>
            {shortPath(f)}
          </div>
        )}
        {filesRead.length > 10 && <div className="agent-context__file-more">+N more</div>}
      </>
    )}
    {/* Same pattern for filesWritten */}
  </div>
```

### Helper Functions

```typescript
function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : p;
}
```

**File:** `frontend/src/components/ContextPanel/utils.tsx`

### CSS Classes

| Class | Description |
|---|---|
| `.agent-context__files` | Flex column, gap 1px |
| `.agent-context__file-label` | 9px, font-weight 600, muted, uppercase, margin-top xs |
| `.agent-context__file-entry` | 10px, cyan color, ellipsis overflow, cursor pointer, hover underline |
| `.agent-context__file-more` | 10px, hint color, margin-top 2px |

### Store Dependencies

- `useFileStore` → `loadPreview` (click to open file in center panel)

---

## Section 5: Cache Stats

**Purpose:** Show cache hit rate and breakdown of cache token categories.

### Data Algorithm

```
Input:  cu.inputTokens, cu.cacheReadTokens, cu.cacheCreationTokens
Output: { hitRate: number, color: string, rows: { label, value }[] }

1. totalInput = inputTokens + cacheReadTokens + cacheCreationTokens
2. hitRate = round((cacheReadTokens / totalInput) * 100), or 0 if totalInput == 0
3. Color: hitRate > 50 → var(--green), else var(--gold)
4. Breakdown rows: Cache read, Cache creation, Fresh input
5. If totalInput == 0 → show "No cache data yet"
```

### Rendering

```
CollapsibleSection
  title: "Cache Stats"

  <div className="agent-context__cache-row">
    <span className="agent-context__cache-label">Cache hit rate</span>
    <span className="agent-context__cache-value" style={{ color }}>{hitRate}%</span>
  </div>
  <div className="agent-context__cache-bar">
    <div className="agent-context__cache-fill"
         style={{ width: `${hitRate}%`, background: color }} />
  </div>
  {breakdown rows: Cache read, Cache creation, Fresh input}
```

### CSS Classes

| Class | Description |
|---|---|
| `.agent-context__cache-row` | Flex row, center-aligned, gap sm, font-size 11px, margin-bottom 3px |
| `.agent-context__cache-label` | Muted color, flex 1 |
| `.agent-context__cache-value` | Tabular-nums |
| `.agent-context__cache-bar` | Height 4px, rounded 2px, overflow hidden, background border, margin-top xs |
| `.agent-context__cache-fill` | Height 100%, rounded 2px, transition width 0.3s ease |

---

## Shared Utility: fmtTokens

```typescript
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
```

**File:** `frontend/src/components/ContextPanel/utils.tsx`

---

## Empty State

When `activeSessionId` is set but the session has no `contextUsage` data yet:

```
<div className="agent-context__empty">No active session</div>
```

Uses the same `.agent-context__empty` style: padding lg, 12px, hint color, center, italic.

---

## File Layout

| File | Responsibility |
|---|---|
| `modes/AgentContext.tsx` | Main component: utilization header + 5 CollapsibleSection wrappers |
| `modes/AgentContext.css` | All `.agent-context__*` BEM styles (migrated from ContextTab.css) |
| `utils.tsx` | Shared helpers: `fmtTokens`, `shortPath` (extended) |
| `CollapsibleSection.tsx` | Shared collapsible wrapper (unchanged) |

### Removed Files

| File | Reason |
|---|---|
| `modes/ContextTab.tsx` | Absorbed into AgentContext.tsx |
| `modes/ContextTab.css` | Migrated to AgentContext.css with BEM naming |
| `sections/TaskSpecPreview.tsx` | Replaced by utilization header + token breakdown |
| `sections/FilesModified.tsx` | Replaced by Files Accessed section |
| `sections/RelatedSpecs.tsx` | Removed — agent mode is now metrics-focused |
| `sections/ComplianceHints.tsx` | Removed — was a placeholder, deferred indefinitely |

---

## Known Limitations

- **Turn-level updates only** — Token counts update on turn completion, not mid-stream. There is a visible lag during long tool-use loops.
- **Estimated tool token counts** — `toolTokens` values are estimates based on SDK reporting, not exact per-call costs. The "~tok" column headers reflect this.
- **Cache data availability** — Cache read/creation tokens depend on the Claude SDK reporting them. May show zero for providers or configurations that don't expose cache metrics.
- **No per-run cost subtotals** — Run separators in Turn History are visual only; there's no aggregated cost-per-run display.
- **Files list is not live** — `filesRead` / `filesWritten` are populated from SDK events and may not include files accessed via MCP tools.

---

## Dependencies

- **Parent spec:** [CONTEXT_PANEL.md](../CONTEXT_PANEL.md)
- **Sibling spec:** [SPEC_CONTEXT.md](SPEC_CONTEXT.md) (shares utils.tsx, CollapsibleSection)
- **Stores:** `sessionStore` (sessions, activeSessionId, session.metrics.contextUsage), `fileStore` (loadPreview)
- **Components:** `CollapsibleSection` (shared wrapper)
- **Types:** `ContextUsage`, `TurnUsage` from `types/session.ts`
- **No backend changes required**
