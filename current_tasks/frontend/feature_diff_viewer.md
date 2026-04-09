# Implement Diff Viewer

> Spec-to-code side-by-side diff with mapping files and commit navigation

**Status:** Done
**Priority:** Low
**Depends on:** `feature_app_shell`, `feature_state_management`
**Spec reference:** `frontend/ui-specs/DIFF_VIEWER.md`

## Summary

The Diff Viewer is a right-panel tab showing spec changes alongside corresponding code changes in a side-by-side layout. Uses mapping files (`.bonsai/mappings.json`) to link spec sections to code patches, auto-extracted from git commits.

## Files to Create

### Frontend
- `frontend/src/components/DiffViewer/DiffView.tsx` — container: mapping selection, navigation, split pane
- `frontend/src/components/DiffViewer/DiffNavBar.tsx` — commit-by-commit navigation (prev/next), commit info
- `frontend/src/components/DiffViewer/DiffSplitPane.tsx` — side-by-side layout (spec left, code right)
- `frontend/src/components/DiffViewer/DiffPane.tsx` — single diff pane with line rendering
- `frontend/src/components/DiffViewer/DiffLine.tsx` — line styling: additions green, deletions red, context gray

### Backend (new RPC methods)
- `diff/mappings` — list mappings for a spec
- `diff/commit` — get diff data for a specific mapping
- `diff/scan` — trigger mapping extraction from git history

## Definition of Done

- [ ] Diff tab shows in right panel when a spec is selected
- [ ] Side-by-side spec + code diff renders
- [ ] Commit navigation (prev/next) works
- [ ] Line additions/deletions colored correctly
- [ ] Synchronized scrolling between panes
