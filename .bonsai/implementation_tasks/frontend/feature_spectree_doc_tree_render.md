---
id: task-spectree-doc-tree-render
type: task-spec
status: done
title: Update SpecTree.tsx with tree rendering for unmanaged docs
parent: unmanaged-docs-filtering
implements:
  - unmanaged-docs-filtering
depends-on:
  - task-build-doc-tree
  - task-spectree-doc-css
covers:
  - frontend/src/components/SpecTree/SpecTree.tsx
tags:
  - frontend
  - ui
  - component
---

# Update SpecTree.tsx with Tree Rendering for Unmanaged Docs

> Replace the flat document list with a collapsible file tree using `buildDocTree()`.

**Priority:** High (main user-visible change)
**Spec reference:** [UNMANAGED_DOCS_FILTERING.md](../../design_docs/UNMANAGED_DOCS_FILTERING.md#frontend-tree-building)

## Files to Modify

- `frontend/src/components/SpecTree/SpecTree.tsx`

## Changes

1. **Replace flat rendering** — current `graph.documents.map(doc => ...)` becomes `buildDocTree(graph.documents)` + depth-based rendering with visibility filtering

2. **Add local state** — `docCollapsed: Set<string>` for directory expand/collapse (separate from the spec tree's `collapsed` state)

3. **Directory rows** — render with `📁` icon, expand/collapse arrow (`▸`/`▾`), `st-doc-dir` class. Click toggles collapse.

4. **File rows** — keep existing muted style (`st-doc-row`), `📄` icon. Click → preview, double-click → pin.

5. **Visibility filtering** — same ancestor-check pattern as the spec tree: hide nodes whose any ancestor dir is in `docCollapsed`

## Interactions

| Action | Target | Behavior |
|--------|--------|----------|
| Click | Directory row | Toggle dir in `docCollapsed` Set |
| Click | File row | `loadPreview(path)` |
| Double-click | File row | `handleDoubleClick(path)` → pin |

## Success Criteria

- Unmanaged docs render as collapsible tree with directory grouping
- Empty intermediate dirs are visually collapsed
- Click/double-click behavior preserved for files
- Directory expand/collapse works independently from spec tree collapse
- Section still collapsed by default (`docsCollapsed` state)

## Verification

- Manual: `npm run dev`, expand "Unmanaged Documents", verify tree renders with dirs
- Automated: component test verifying tree structure renders from mock data
