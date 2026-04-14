# Add preview tab state to fileStore

Single-click browsing in SpecTree and FileTree should open an ephemeral "preview tab" in the center panel and update the context panel instantly. This task adds the store-level state and actions needed to support preview tabs.

## Context

Currently `fileStore` only supports fully-opened (pinned) files via `openFile()` and `activeFilePath`. The new preview tab feature (see [CENTER_PANEL.md](../../frontend/ui-specs/CENTER_PANEL.md#preview-tabs)) requires a separate `previewFilePath` state that:
- Is set by single-click in trees
- Is cleared when navigating to a pinned tab or session
- Can be "pinned" (promoted to a fully-opened file)

## Plan

1. Add state to `fileStore`:
   - `previewFilePath: string | null` — path of currently previewed file
   - `previewContent: OpenFile | null` — loaded content for preview (reuses `OpenFile` interface)

2. Add actions to `fileStore`:
   - `previewFile(path: string)` — loads file content (reuse fetch logic from `openFile`), sets `previewFilePath` and `previewContent`. If file is already in `openFiles`, just set `previewFilePath` to point at it (no re-fetch).
   - `clearPreview()` — sets `previewFilePath` to `null`, clears `previewContent`
   - `pinPreview()` — if a preview exists, moves it into `openFiles` map, sets `activeFilePath` to that path, then calls `clearPreview()`

3. Update existing actions:
   - `activateFile(path)` — add `clearPreview()` call (switching to a pinned tab closes preview)
   - `closeFile(path)` — no change needed (preview is separate from openFiles)

4. Wire session switching:
   - In `SessionPanel.handleSwitchSession`, call `useFileStore.getState().clearPreview()` alongside clearing `activeFilePath`

## Files to modify
- `frontend/src/store/fileStore.ts` — add `previewFilePath`, `previewContent`, `previewFile()`, `clearPreview()`, `pinPreview()`, update `activateFile()`
- `frontend/src/components/SessionPanel/SessionPanel.tsx` — call `clearPreview()` in `handleSwitchSession`

## Definition of done
- `previewFile(path)` loads content and sets `previewFilePath`
- `clearPreview()` clears preview state
- `pinPreview()` converts preview to a pinned open file
- `activateFile()` auto-clears preview
- Switching sessions auto-clears preview
- `npm run lint` (tsc --noEmit) passes

**Priority:** High
**Type:** New feature
**Spec:** [CENTER_PANEL.md](../../frontend/ui-specs/CENTER_PANEL.md#preview-tabs), [store/README.md](../../frontend/src/store/README.md)
