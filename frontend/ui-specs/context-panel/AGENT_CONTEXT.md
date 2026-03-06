# Agent Context Sections — Sub-Module Design

> Parent: [CONTEXT_PANEL.md](../CONTEXT_PANEL.md) | Status: **Active** | Created: 2026-03-06

## Overview

The Agent Context mode activates when `activeSessionId` is set and no file is focused in the center panel. It renders 4 collapsible sections showing the active agent session's driving spec, modified files, related specs, and compliance hints.

**Files:** `frontend/src/components/ContextPanel/modes/AgentContext.tsx` and `sections/{TaskSpecPreview,FilesModified,RelatedSpecs,ComplianceHints}.tsx`

---

## Active Session Hook

All sections need the active session. Extract into a shared hook.

**Hook:** `useActiveSession(): Session | null`

**File:** `frontend/src/components/ContextPanel/useActiveSession.ts`

```typescript
export function useActiveSession(): Session | null {
  const activeSessionId = useSessionStore(s => s.activeSessionId);
  const sessions = useSessionStore(s => s.sessions);
  if (!activeSessionId) return null;
  return sessions.get(activeSessionId) ?? null;
}
```

**Consumed by:** `TaskSpecPreview`, `FilesModified`, `RelatedSpecs`, `ComplianceHints`

---

## Section 1: TaskSpecPreview

**Purpose:** Show a rendered markdown preview of the task spec driving the active session.

### Data Algorithm

```
Input:  session.specIds[], specStore
Output: { spec: RegistryEntry, content: string } | null

1. Take session.specIds[0] as the primary task spec ID
2. Find matching RegistryEntry in specStore.specs
3. Fetch content via specStore.fetchSpecContent(specId)
4. If no specIds or spec not found → show "No task spec assigned"
```

### Rendering

```
CollapsibleSection
  title: "Task Spec"
  summary: spec.title (shown when collapsed)
  expandToCenter: () => fileStore.loadPreview(spec.path)

  <div className="task-spec-preview">
    {loading ? <div className="section-placeholder">Loading...</div> :
     content ? <MarkdownPreview content={content} /> :
     <div className="section-placeholder">No task spec assigned to this session</div>
    }
  </div>
```

### Constraints

- Reuse existing `MarkdownPreview` from `components/FileViewer/MarkdownPreview.tsx`
- Container has `max-height: 400px` with `overflow-y: auto` to prevent the section from dominating the panel
- Content is fetched once when the section mounts (or session changes), cached in `specStore.specContent`

### CSS Classes

| Class | Description |
|---|---|
| `.task-spec-preview` | Container (max-height 400px, overflow-y auto, padding) |

### Store Dependencies

- `useActiveSession()` → session.specIds
- `useSpecStore` → `specs`, `fetchSpecContent`
- `useFileStore` → `loadPreview` (for expandToCenter)

---

## Section 2: FilesModified

**Purpose:** List files the agent has created, modified, or deleted during the session.

### Data Algorithm

```
Input:  session.metrics.filesChanged: Record<string, "created" | "modified" | "deleted">
Output: { created: string[], modified: string[], deleted: string[] }

1. Read session.metrics.filesChanged
2. Group entries by change type
3. Sort each group alphabetically
4. If empty → show "No files modified yet"
```

### Rendering

```
CollapsibleSection
  title: "Files Modified"
  count: total number of files across all groups

  For each non-empty group (created, modified, deleted):
    <div className="files-group">
      <div className="files-group__label">
        <span className="files-group__badge" data-change={type}>{badge}</span>
        {label} ({count})
      </div>
      {files.map(path =>
        <button className="files-item" onClick={() => fileStore.loadPreview(path)}>
          {fileName(path)}
          <span className="files-item__dir">{dirName(path)}</span>
        </button>
      )}
    </div>
```

### Change Type Badges

| Type | Badge | Color |
|---|---|---|
| `created` | `C` | `var(--success)` (green) |
| `modified` | `M` | `var(--accent)` (blue) |
| `deleted` | `D` | `var(--error)` (red) |

### CSS Classes

| Class | Description |
|---|---|
| `.files-group` | Group container (margin-bottom) |
| `.files-group__label` | Group heading (10px, uppercase, muted) |
| `.files-group__badge` | Change type letter badge (10px, mono, colored by data-change) |
| `.files-item` | Clickable file row (12px, full-width, text-align left, hover highlight) |
| `.files-item__dir` | Directory path suffix (10px, muted) |

### Helper Functions

```typescript
function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function dirName(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}
```

**File:** `frontend/src/components/ContextPanel/utils.ts` (add to shared utils)

### Store Dependencies

- `useActiveSession()` → session.metrics.filesChanged
- `useFileStore` → `loadPreview` (click to open file)

---

## Section 3: RelatedSpecs

**Purpose:** Show specs related to the active session, in two groups: session specs and specs covering touched files.

### Data Algorithm

```
Input:  session.specIds[], session.metrics.filesChanged, specStore.specs[]
Output: { sessionSpecs: RegistryEntry[], coveringSpecs: RegistryEntry[] }

Group 1 — "Session Specs":
1. Resolve session.specIds to RegistryEntry[] via specStore.specs
2. These are the specs explicitly assigned to the session

Group 2 — "Covering Specs":
1. Collect file paths from session.metrics.filesChanged keys
2. For each spec in specStore.specs:
   a. Skip if spec.id is already in session.specIds
   b. Check if any file path starts with any of spec.covers[] patterns
   c. If match → include spec
3. Deduplicate and sort by title
```

### Covers Matching Logic

```typescript
function fileMatchesCovers(filePath: string, covers: string[]): boolean {
  return covers.some(pattern => {
    // covers patterns are directory prefixes like "backend/app/spec/"
    // or file paths like "frontend/src/store/specStore.ts"
    return filePath.startsWith(pattern) || filePath === pattern;
  });
}
```

**File:** `frontend/src/components/ContextPanel/utils.ts`

### Rendering

```
CollapsibleSection
  title: "Related Specs"
  count: sessionSpecs.length + coveringSpecs.length

  <div className="related-specs">
    {sessionSpecs.length > 0 && (
      <div className="related-specs__group">
        <div className="related-specs__label">Session Specs ({count})</div>
        {sessionSpecs.map(spec =>
          <button className="related-specs__item" onClick={() => selectSpec(spec.id)}>
            <StatusBadge status={spec.status} />
            {spec.title}
          </button>
        )}
      </div>
    )}

    {coveringSpecs.length > 0 && (
      <div className="related-specs__group">
        <div className="related-specs__label">Covering Specs ({count})</div>
        {coveringSpecs.map(spec =>
          <button className="related-specs__item" onClick={() => selectSpec(spec.id)}>
            <StatusBadge status={spec.status} />
            {spec.title}
          </button>
        )}
      </div>
    )}

    {total === 0 && <div className="section-placeholder">No related specs found</div>}
  </div>
```

### CSS Classes

| Class | Description |
|---|---|
| `.related-specs` | Container |
| `.related-specs__group` | Group wrapper (margin-bottom) |
| `.related-specs__label` | Group heading (10px, uppercase, muted) |
| `.related-specs__item` | Clickable spec row (12px, flex, gap, hover highlight) |

### Store Dependencies

- `useActiveSession()` → session.specIds, session.metrics.filesChanged
- `useSpecStore` → `specs`, `selectSpec`
- `StatusBadge` from shared utils

---

## Section 4: ComplianceHints — PLACEHOLDER

**Purpose:** Track spec compliance for the active session.

**Status:** Not implemented. Design TBD — needs further thought on what signals are useful.

**Current rendering:** Static placeholder text: *"Compliance tracking will appear here"*

**Future design notes:**
- Could flag files changed by agent that aren't covered by any spec
- Could check if session specs are stale
- Could track whether agent followed spec-driven workflow

---

## Shared Utilities (additions)

**File:** `frontend/src/components/ContextPanel/utils.ts`

| Export | Purpose |
|---|---|
| `fileName(path: string): string` | Extract filename from path |
| `dirName(path: string): string` | Extract directory from path |
| `fileMatchesCovers(filePath: string, covers: string[]): boolean` | Check if file matches spec covers patterns |

(Added to existing utils from Spec Context spec — `relativeDate`, `StatusBadge`)

---

## File Layout

| File | Responsibility |
|---|---|
| `useActiveSession.ts` | Hook: resolve activeSessionId → Session |
| `utils.ts` | Shared helpers (extended with file helpers + covers matching) |
| `modes/AgentContext.tsx` | Composes 4 sections (unchanged) |
| `sections/TaskSpecPreview.tsx` | Rendered markdown preview of driving task spec |
| `sections/FilesModified.tsx` | Files changed by agent, grouped by change type |
| `sections/RelatedSpecs.tsx` | Two-group list: session specs + covering specs |
| `sections/ComplianceHints.tsx` | Placeholder (unchanged) |

---

## Dependencies

- **Parent spec:** [CONTEXT_PANEL.md](../CONTEXT_PANEL.md)
- **Sibling spec:** [SPEC_CONTEXT.md](SPEC_CONTEXT.md) (shares utils.ts)
- **Reused component:** `MarkdownPreview` from `components/FileViewer/MarkdownPreview.tsx`
- **Stores:** `sessionStore` (sessions, activeSessionId), `specStore` (specs, fetchSpecContent, selectSpec), `fileStore` (loadPreview)
- **Components:** `CollapsibleSection` (shared wrapper), `StatusBadge` (shared util)
- **No backend changes required** (ComplianceHints deferred)
