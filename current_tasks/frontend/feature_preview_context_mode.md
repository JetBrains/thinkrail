# Update useContextMode to react to preview tabs

The context panel should update immediately when a preview tab opens. This requires `useContextMode` to read `previewFilePath` in addition to `activeFilePath`.

## Context

Currently `useContextMode` derives the context mode from `activeSessionId`, `activeFilePath`, and `selectedSpecId`. With preview tabs, the "effective file" for context derivation should be `previewFilePath ?? activeFilePath` — preview takes priority so context updates on single-click. See [CONTEXT_PANEL.md](../../frontend/ui-specs/CONTEXT_PANEL.md#mode-derivation).

## Plan

1. Update `useContextMode` hook:
   - Read `previewFilePath` from `fileStore` in addition to `activeFilePath`
   - Compute `effectiveFile = previewFilePath ?? activeFilePath`
   - Use `effectiveFile` in the mode derivation chain instead of `activeFilePath`

## Files to modify
- `frontend/src/components/ContextPanel/useContextMode.ts` — read `previewFilePath`, compute effective file

## Dependencies
- `feature_preview_tab_store` — needs `previewFilePath` in fileStore

## Definition of done
- Single-click preview of a spec file triggers Spec Context mode
- Single-click preview of a code file triggers Code Context mode
- When preview is cleared, context falls back to `activeFilePath` or empty
- `npm run lint` passes

**Priority:** High
**Type:** New feature
**Spec:** [CONTEXT_PANEL.md](../../frontend/ui-specs/CONTEXT_PANEL.md#mode-derivation)
