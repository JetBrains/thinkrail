# Wire single-click preview in SpecTree and FileTree

Single-clicking a file in FileTree or a spec in SpecTree should open a preview tab. This task updates both tree components to call `previewFile()` on click.

## Context

Currently:
- **SpecTree**: click calls `selectSpec(id)` only — no file preview
- **FileTree**: click sets local `selected` state + toggles dirs — no file preview or store update

After this change, single-click in both trees will open a preview tab and trigger context panel updates. See [CENTER_PANEL.md](../../frontend/ui-specs/CENTER_PANEL.md#preview-tabs).

## Plan

1. Update `SpecTree.tsx`:
   - On click: keep `selectSpec(id)`, add `useFileStore.getState().previewFile(node.path)`
   - On double-click: change from `openFile(path)` to `pinPreview()` if preview exists, else `openFile(path)`

2. Update `FileTree.tsx`:
   - On single-click (non-directory): call `useFileStore.getState().previewFile(entry.path)` in addition to local selection
   - On single-click (directory): keep current toggle behavior, no preview
   - On double-click: keep current `openFile(entry.path)` behavior (pins directly)

## Files to modify
- `frontend/src/components/SpecTree/SpecTree.tsx` — update `handleClick` to call `previewFile`, update `handleDoubleClick`
- `frontend/src/components/FileTree/FileTree.tsx` — add `previewFile` call on file click

## Dependencies
- `feature_preview_tab_store` — needs `previewFile()` and `pinPreview()` in fileStore

## Definition of done
- Single-click file in FileTree opens preview tab in center panel
- Single-click spec in SpecTree opens preview tab + selects spec
- Single-click on directory in FileTree only toggles expand (no preview)
- Double-click still pins/opens file as before
- Context panel updates immediately on single-click
- `npm run lint` passes

**Priority:** High
**Type:** New feature
**Spec:** [CENTER_PANEL.md](../../frontend/ui-specs/CENTER_PANEL.md#preview-tabs)
