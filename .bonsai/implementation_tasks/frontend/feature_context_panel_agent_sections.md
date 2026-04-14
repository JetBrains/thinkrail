# Task: Implement Agent Context Sections

> Implements: [AGENT_CONTEXT.md](../../frontend/ui-specs/context-panel/AGENT_CONTEXT.md)
> Depends on: `feature_context_panel_shared_infra`
> Status: **active** | Priority: **high** | Created: 2026-03-06

## Goal

Replace placeholder content in the three Agent Context sections with real data-driven UI. ComplianceHints remains a placeholder.

## Deliverables

### 1. TaskSpecPreview

**File:** `frontend/src/components/ContextPanel/sections/TaskSpecPreview.tsx`

- Use `useActiveSession()` to get the active session
- Take `session.specIds[0]` as primary task spec
- Find matching `RegistryEntry` in `specStore.specs`
- Fetch content via `specStore.fetchSpecContent(specId)`
- Render with `<MarkdownPreview content={content} />` (import from `FileViewer/MarkdownPreview`)
- Container: `max-height: 400px`, `overflow-y: auto`
- `expandToCenter`: `() => fileStore.loadPreview(spec.path)`
- `summary`: spec title (shown when collapsed)
- Loading state: "Loading..."
- No spec: "No task spec assigned to this session"

**New CSS classes:** `.task-spec-preview`

### 2. FilesModified

**File:** `frontend/src/components/ContextPanel/sections/FilesModified.tsx`

- Use `useActiveSession()` to get the active session
- Read `session.metrics.filesChanged`
- Group by change type: created, modified, deleted
- Sort each group alphabetically
- Render with change-type badges: `C` (green), `M` (blue), `D` (red)
- Each file clickable → `fileStore.loadPreview(path)`
- Show filename prominently, directory path in muted text
- Count badge on section header
- Empty state: "No files modified yet"

**New CSS classes:** `.files-group`, `.files-group__label`, `.files-group__badge`, `.files-item`, `.files-item__dir`

### 3. RelatedSpecs

**File:** `frontend/src/components/ContextPanel/sections/RelatedSpecs.tsx`

- Use `useActiveSession()` to get the active session
- **Group 1 "Session Specs":** Resolve `session.specIds` to `RegistryEntry[]` via `specStore.specs`
- **Group 2 "Covering Specs":** Cross-reference `metrics.filesChanged` keys against `specStore.specs[].covers[]` using `fileMatchesCovers()`. Exclude specs already in `specIds`.
- Each item: `StatusBadge` + clickable title → `specStore.selectSpec(id)`
- Count badge: total across both groups
- Empty state: "No related specs found"

**New CSS classes:** `.related-specs`, `.related-specs__group`, `.related-specs__label`, `.related-specs__item`

## Acceptance Criteria

- [ ] TaskSpecPreview renders markdown content of the driving spec
- [ ] TaskSpecPreview expandToCenter opens spec in center panel
- [ ] FilesModified lists files with correct change-type badges
- [ ] FilesModified click opens file preview in center panel
- [ ] RelatedSpecs shows two groups: session specs and covering specs
- [ ] All sections handle null/empty session gracefully
- [ ] Count badges appear on section headers

## Dependencies

- Shared infrastructure (hooks + utils) from `feature_context_panel_shared_infra`
- `MarkdownPreview` component from `components/FileViewer/MarkdownPreview.tsx`
- `specStore.fetchSpecContent` for TaskSpecPreview
