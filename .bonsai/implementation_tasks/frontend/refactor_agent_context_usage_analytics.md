---
id: task-refactor-agent-context-analytics
type: task-spec
status: done
title: 'Refactor Agent Context: Replace with Context Usage Analytics'
implements:
- ui-context-panel-agent-mode
covers:
- frontend/src/components/ContextPanel/modes/AgentContext.tsx
- frontend/src/components/ContextPanel/modes/AgentContext.css
tags:
- high
- refactor
- frontend
---
# Refactor Agent Context: Replace with Context Usage Analytics

> Implements: [AGENT_CONTEXT.md](../../frontend/ui-specs/context-panel/AGENT_CONTEXT.md)
> Supersedes: `feature_context_panel_agent_sections` (done)
> Status: **done** | Priority: **high** | Created: 2026-03-12 | Completed: 2026-03-12

## Goal

Replace the current Agent Context mode (TaskSpecPreview, FilesModified, RelatedSpecs, ComplianceHints) with the context usage analytics dashboard from the experimental ContextTab. This makes `session.metrics.contextUsage` the primary data source for the agent mode, showing token utilization, turn history, tool costs, file I/O, and cache performance.

The ContextTab already works as a pin-mode overlay. This task moves its content into the inline agent mode, adopts the shared `CollapsibleSection` component, migrates CSS to BEM naming, and removes the now-redundant "Ctx" pin button.

## Plan

### 1. Rewrite `AgentContext.tsx`

**File:** `frontend/src/components/ContextPanel/modes/AgentContext.tsx`

Move the rendering logic from `ContextTab.tsx` into `AgentContext.tsx`:

- Import `CollapsibleSection` (not the inline `Section`)
- Import `useSessionStore`, `useFileStore`, types from `@/types/session.ts`
- Import helpers from `../utils.ts`

Component structure:
```
AgentContext
  → Utilization header (always visible, not in CollapsibleSection)
  → CollapsibleSection "Token Breakdown" (count: undefined, defaultExpanded: true)
    → TokenBreakdown sub-component
  → CollapsibleSection "Turn History" (count: turnHistory.length)
    → TurnHistory sub-component
  → CollapsibleSection "Tool Calls" (count: total tool calls)
    → ToolCalls sub-component
  → CollapsibleSection "Files Accessed" (count: filesRead.length + filesWritten.length)
    → FilesAccessed sub-component
  → CollapsibleSection "Cache Stats"
    → CacheStats sub-component
```

All sub-components (TokenBreakdown, TurnHistory, ToolCalls, FilesAccessed, CacheStats) are defined in the same file — no separate section files.

Empty state: `"No active session"` when no `activeSessionId` or session not found.

### 2. Create `AgentContext.css` with BEM naming

**File:** `frontend/src/components/ContextPanel/modes/AgentContext.css`

Migrate all styles from `ContextTab.css`, renaming:
- `ctx-tab` → `agent-context`
- `ctx-tab-summary` → `agent-context__header`
- `ctx-tab-pct` → `agent-context__pct`
- `ctx-tab-pct-bar` → `agent-context__pct-bar`
- `ctx-tab-pct-fill` → `agent-context__pct-fill`
- `ctx-tab-meta` → `agent-context__meta`
- `ctx-tab-breakdown*` → `agent-context__breakdown*`
- `ctx-tab-stacked-bar` → `agent-context__stacked-bar`
- `ctx-tab-turns*` → `agent-context__turns*` / `agent-context__turn-*`
- `ctx-tab-turn-*` → `agent-context__turn-*`
- `ctx-tab-run-separator` → `agent-context__run-separator`
- `ctx-tab-tool-*` → `agent-context__tool-*`
- `ctx-tab-file*` → `agent-context__file-*`
- `ctx-tab-cache-*` → `agent-context__cache-*`
- `ctx-tab-empty` → `agent-context__empty`
- `ctx-tab-section` → removed (using CollapsibleSection instead)
- `ctx-tab-heading*` → removed (using CollapsibleSection instead)

### 3. Update `ContextPanel.tsx` — remove Ctx pin button

**File:** `frontend/src/components/ContextPanel/ContextPanel.tsx`

- Remove `import { ContextTab }`
- Change `PinMode` from `"none" | "dashboard" | "context"` to `"none" | "dashboard"`
- Remove the "Ctx" button from the header
- Remove the `pin === "context"` branch from `ModeContent`
- Remove the `pin === "context"` case from `headerConfig`
- Keep the 📊 dashboard pin button unchanged

### 4. Extend `utils.ts` with shared helpers

**File:** `frontend/src/components/ContextPanel/utils.ts`

Add:
```typescript
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : p;
}
```

### 5. Delete obsolete files

- `frontend/src/components/ContextPanel/modes/ContextTab.tsx`
- `frontend/src/components/ContextPanel/modes/ContextTab.css`
- `frontend/src/components/ContextPanel/sections/TaskSpecPreview.tsx`
- `frontend/src/components/ContextPanel/sections/FilesModified.tsx`
- `frontend/src/components/ContextPanel/sections/RelatedSpecs.tsx`
- `frontend/src/components/ContextPanel/sections/ComplianceHints.tsx`

### 6. Clean up ContextPanel.css

Remove `.ctx-tab-*` rules from `ContextPanel.css` if any leaked there (check for dead selectors after ContextTab removal).

## Files to modify

- `frontend/src/components/ContextPanel/modes/AgentContext.tsx` — rewrite (absorb ContextTab logic)
- `frontend/src/components/ContextPanel/modes/AgentContext.css` — create (BEM styles)
- `frontend/src/components/ContextPanel/ContextPanel.tsx` — remove Ctx pin button + import
- `frontend/src/components/ContextPanel/utils.ts` — add `fmtTokens`, `shortPath`

## Files to delete

- `frontend/src/components/ContextPanel/modes/ContextTab.tsx`
- `frontend/src/components/ContextPanel/modes/ContextTab.css`
- `frontend/src/components/ContextPanel/sections/TaskSpecPreview.tsx`
- `frontend/src/components/ContextPanel/sections/FilesModified.tsx`
- `frontend/src/components/ContextPanel/sections/RelatedSpecs.tsx`
- `frontend/src/components/ContextPanel/sections/ComplianceHints.tsx`

## Definition of done

- [x] Agent mode (no file focused + activeSessionId) renders utilization header + 5 collapsible sections
- [x] All 5 sections use shared `CollapsibleSection` with count badges where applicable
- [x] CSS uses BEM `.agent-context__*` naming (no `ctx-tab-*` remains anywhere)
- [x] "Ctx" pin button removed from ContextPanel header
- [x] 📊 Dashboard pin still works
- [x] Empty state shows "No active session" when no session active
- [x] Files Accessed entries are clickable → loadPreview
- [x] No dead imports or orphaned files remain
- [x] App builds without errors (`npm run build`)

**Priority:** high
**Started:** 2026-03-12
