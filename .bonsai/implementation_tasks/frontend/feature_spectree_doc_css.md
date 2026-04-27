---
id: task-spectree-doc-css
type: task-spec
status: done
title: CSS for unmanaged doc directory rows
parent: unmanaged-docs-filtering
implements:
  - unmanaged-docs-filtering
covers:
  - frontend/src/components/SpecTree/SpecTree.css
tags:
  - frontend
  - ui
  - styling
---

# CSS for Unmanaged Doc Directory Rows

> Add `.st-doc-dir` styles for directory rows in the unmanaged documents tree section.

**Priority:** Medium (needed before SpecTree rendering task)
**Spec reference:** [SpecTree README](../../../../frontend/src/components/SpecTree/README.md#unmanaged-documents-section)

## Files to Modify

- `frontend/src/components/SpecTree/SpecTree.css`

## Changes

### New class: `.st-doc-dir`

- Same base layout as `.st-doc-row` (flex, aligned, cursor pointer)
- Folder icon (`📁`) styling consistent with FileTree's dir icon color
- Expand/collapse arrow in same position as spec tree arrows
- Indent guides at each depth level (matching existing `paddingLeft` pattern)
- Hover highlight (`--hover` background)
- Muted color (`--hint`) matching existing doc rows

### Existing classes

- `.st-doc-row` — no changes needed, continue working for file rows
- `.st-doc-header` — no changes needed

## Success Criteria

- Dir rows visually match FileTree's directory row styling
- Indent guides align correctly at all depth levels
- Hover/focus states consistent with existing tree rows
- No visual regressions on existing spec tree or doc rows

## Verification

Visual inspection in dev server at multiple nesting depths.
