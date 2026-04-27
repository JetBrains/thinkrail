---
id: ui-context-panel-spec-mode
type: submodule-design
status: active
title: Spec Context Sections Design
parent: ui-context-panel
covers:
- frontend/src/components/ContextPanel/modes/SpecContext.tsx
- frontend/src/components/ContextPanel/sections/ConnectedSpecs.tsx
- frontend/src/components/ContextPanel/sections/LinkedTasks.tsx
- frontend/src/components/ContextPanel/sections/CoveredFiles.tsx
- frontend/src/components/ContextPanel/sections/SpecHealth.tsx
tags:
- frontend
- ui-spec
---
# Spec Context Sections — Sub-Module Design

> Parent: [CONTEXT_PANEL.md](../CONTEXT_PANEL.md) | Status: **Active** | Created: 2026-03-06

## Overview

The Spec Context mode activates when a spec file is open/previewed or `selectedSpecId` is set with no file focused. It renders 4 collapsible sections — SpecHealth first (collapsed by default), then connected specs, linked tasks, and covered files.

**Files:** `frontend/src/components/ContextPanel/modes/SpecContext.tsx` and `sections/{ConnectedSpecs,LinkedTasks,CoveredFiles,SpecHealth}.tsx`

---

## Selected Spec Resolution

All sections need to know which spec is selected. Extract this into a shared hook.

**Hook:** `useSelectedSpec(): RegistryEntry | null`

**File:** `frontend/src/components/ContextPanel/useSelectedSpec.ts`

```typescript
export function useSelectedSpec(): RegistryEntry | null {
  const focusedFile = previewFilePath ?? activeFilePath;
  const specs = useSpecStore(s => s.specs);
  const selectedSpecId = useSpecStore(s => s.selectedSpecId);

  if (focusedFile && isSpecFile(focusedFile)) {
    // Match by path suffix (specs store relative paths, fileStore may have absolute)
    return specs.find(s => focusedFile === s.path || focusedFile.endsWith(`/${s.path}`)) ?? null;
  }
  if (selectedSpecId) {
    return specs.find(s => s.id === selectedSpecId) ?? null;
  }
  return null;
}
```

**Consumed by:** `ConnectedSpecs`, `LinkedTasks`, `CoveredFiles`, `SpecHealth`

---

## Section 1: ConnectedSpecs

**Purpose:** Show specs linked to the selected spec, grouped by relationship type.

**Current state:** Renders full `<GraphView />` at 280px height. **Replace** with a grouped list of linked specs.

### Data Algorithm

```
Input:  selectedSpec.id, graph.edges[], graph.nodes[]
Output: Map<groupLabel, RegistryEntry[]>

1. Filter graph.edges where from === specId OR to === specId
2. For each edge, determine:
   - direction: "outgoing" (from === specId) or "incoming" (to === specId)
   - the OTHER spec id (the one that isn't selectedSpec)
3. Classify into groups:
   - "Parent":     edge.type === "parent" AND direction === "outgoing"
   - "Children":   edge.type === "parent" AND direction === "incoming"
   - "Implements": edge.type === "implements" AND direction === "outgoing"
   - "Depends on": edge.type === "depends-on" AND direction === "outgoing"
   - "Depended by": edge.type === "depends-on" AND direction === "incoming"
   - (skip "Implemented by" — LinkedTasks covers this relationship)
4. Resolve other spec IDs to RegistryEntry via graph.nodes[]
5. Omit empty groups
```

### Props & Rendering

```
CollapsibleSection
  title: "Connected Specs"
  count: total linked specs across all groups
  expandToCenter: () => { /* TODO: open graph in center */ }

  For each non-empty group:
    <div className="connected-group">
      <div className="connected-group__label">{groupLabel} ({count})</div>
      {entries.map(entry =>
        <button className="connected-item" onClick={() => selectSpec(entry.id)}>
          {entry.title}
        </button>
      )}
    </div>
```

### CSS Classes

| Class | Description |
|---|---|
| `.connected-group` | Group container (margin-bottom) |
| `.connected-group__label` | Group heading (10px, uppercase, muted, letter-spacing) |
| `.connected-item` | Clickable spec link (12px, full-width, text-align left, hover highlight) |

### Store Dependencies

- `useSpecStore` → `graph` (edges + nodes), `selectSpec`
- `useSelectedSpec()` → resolved spec entry

---

## Section 2: LinkedTasks

**Purpose:** Show task specs that implement or relate to the selected spec.

### Data Algorithm

```
Input:  selectedSpec.id, graph.edges[], specs[]
Output: RegistryEntry[] (task specs only)

1. Filter graph.edges where:
   - edge.type === "implements" AND edge.to === specId
   (tasks that implement this spec)
2. Collect the "from" IDs (these are the task spec IDs)
3. Resolve to RegistryEntry via specs[]
4. Filter: only entries where type starts with "task"
5. Sort by status (active first, then draft, then done)
```

### Props & Rendering

```
CollapsibleSection
  title: "Tasks"
  count: number of linked tasks

  {tasks.map(task =>
    <button className="linked-task" onClick={() => selectSpec(task.id)}>
      <span className="linked-task__status" data-status={task.status} />
      <span className="linked-task__title">{task.title}</span>
    </button>
  )}

  If no tasks: "No tasks linked to this spec"
```

### Status Badge Colors

| Status | Color |
|---|---|
| `active` | `var(--blue)` |
| `draft` | `var(--muted)` |
| `done` | `var(--green)` |
| `blocked` | `var(--gold)` |

### CSS Classes

| Class | Description |
|---|---|
| `.linked-task` | Clickable task row (12px, full-width, hover highlight) |
| `.linked-task__status` | Status dot (8px circle, colored by data-status) |
| `.linked-task__title` | Task title text |

### Store Dependencies

- `useSpecStore` → `graph.edges`, `specs`, `selectSpec`
- `useSelectedSpec()` → resolved spec entry

---

## Section 3: CoveredFiles

**Purpose:** Show the `covers[]` patterns from the selected spec as a clickable list.

**Status:** Implemented. Renders patterns directly from `RegistryEntry.covers` (no backend resolution needed).

### Data

```
Input:  selectedSpec.covers: string[]
Output: List of cover patterns (file paths or directory patterns)

- Patterns ending in "/" are treated as directories (folder icon, not clickable)
- Other patterns are treated as files (file icon, clickable to preview/open)
```

### Props & Rendering

```
CollapsibleSection
  title: "Covered Files"
  count: covers.length

  {covers.map(pattern =>
    <button className="covered-files__item"
      onClick={() => isDir ? noop : loadPreview(pattern)}
      onDoubleClick={() => isDir ? noop : openFile(pattern)}>
      <span className="covered-files__icon">{isDir ? "📁" : "📄"}</span>
      <span className="covered-files__path">{pattern}</span>
    </button>
  )}

  If no covers: "No coverage patterns defined"
  If no spec selected: "Select a spec to see covered files"
```

### CSS Classes

| Class | Description |
|---|---|
| `.covered-files__item` | Clickable pattern row (11px, mono font, flex, hover highlight) |
| `.covered-files__icon` | Icon (folder or file emoji, flex-shrink 0) |
| `.covered-files__path` | Pattern text (ellipsis overflow) |

### Store Dependencies

- `useFileStore` → `openFile`, `loadPreview`
- `useSelectedSpec()` → resolved spec entry (has `covers` field)

---

## Section 4: SpecHealth

**Purpose:** Show a quick health summary of the selected spec.

### Data (pure frontend — no backend call)

```
Input:  selectedSpec: RegistryEntry
Output: { status, updatedDate, coversCount, type }

status:       selectedSpec.status ("draft" | "active" | "stale" | etc.)
updatedDate:  selectedSpec.updated (ISO date string → relative "2 days ago")
coversCount:  selectedSpec.covers.length
type:         selectedSpec.type ("module-design" | "task-spec" | etc.)
```

### Props & Rendering

```
CollapsibleSection
  title: "Spec Health"
  defaultExpanded: false
  summary: <StatusBadge status={spec.status} />  (shown when collapsed)

  <div className="spec-health">
    <div className="spec-health__row">
      <span className="spec-health__label">Status</span>
      <StatusBadge status={spec.status} />
    </div>
    <div className="spec-health__row">
      <span className="spec-health__label">Last Updated</span>
      <span>{relativeDate(spec.updated)}</span>
    </div>
    <div className="spec-health__row">
      <span className="spec-health__label">Covers</span>
      <span>{spec.covers.length} pattern(s)</span>
    </div>
    <div className="spec-health__row">
      <span className="spec-health__label">Type</span>
      <span>{spec.type}</span>
    </div>
  </div>
```

### StatusBadge

Inline component or utility — renders a small colored pill with the status text.

| Status | Background | Text |
|---|---|---|
| `active` | `color-mix(green 15%)` | `var(--green)` |
| `draft` | `var(--elevated)` | `var(--muted)` |
| `stale` | `color-mix(gold 15%)` | `var(--gold)` |
| `done` | `color-mix(green 15%)` | `var(--green)` |
| `blocked` | `color-mix(gold 15%)` | `var(--gold)` |

### relativeDate Helper

```typescript
function relativeDate(iso: string): string {
  // "2026-03-04" → "2 days ago"
  // Use simple day-diff calculation, no library needed
}
```

**File:** `frontend/src/components/ContextPanel/utils.ts` (shared by other sections too)

### CSS Classes

| Class | Description |
|---|---|
| `.spec-health` | Container (padding) |
| `.spec-health__row` | Key-value row (flex, justify-between, 12px, border-bottom dotted) |
| `.spec-health__label` | Label (muted, 11px) |
| `.status-badge` | Status pill (inline, 10px, uppercase, border-radius, padding 1px 6px) |

### Store Dependencies

- `useSelectedSpec()` → resolved spec entry (has all needed fields)

---

## Shared Utilities

**File:** `frontend/src/components/ContextPanel/utils.ts`

| Export | Purpose |
|---|---|
| `relativeDate(iso: string): string` | ISO date → "2 days ago" / "today" / "3 weeks ago" |
| `StatusBadge({ status: string })` | Colored pill component for spec status |

---

## File Layout

| File | Responsibility |
|---|---|
| `useSelectedSpec.ts` | Hook: resolve focused file/selectedSpecId → RegistryEntry |
| `utils.ts` | Shared helpers: `relativeDate`, `StatusBadge` |
| `modes/SpecContext.tsx` | Composes 4 sections (unchanged) |
| `sections/ConnectedSpecs.tsx` | Grouped list of linked specs (rewrite from GraphView) |
| `sections/LinkedTasks.tsx` | Task specs implementing this spec |
| `sections/CoveredFiles.tsx` | Clickable list of covers[] patterns |
| `sections/SpecHealth.tsx` | Status badge, date, covers count, type |

---

## Dependencies

- **Parent spec:** [CONTEXT_PANEL.md](../CONTEXT_PANEL.md)
- **Stores:** `specStore` (specs, graph, selectSpec), `fileStore` (activeFilePath, previewFilePath)
- **Components:** `CollapsibleSection` (shared wrapper)
- **No backend changes required**
