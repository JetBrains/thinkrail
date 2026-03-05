# Add preview tab rendering to SessionTabBar

The tab bar needs to display the preview tab with italic styling, handle auto-close behavior, and allow pinning via double-click. This task adds the UI layer for preview tabs.

## Context

After `fileStore` has `previewFilePath` and `previewContent` (task: `feature_preview_tab_store`), the `SessionTabBar` and `SessionPanel` need to render the preview tab and its content. See [CENTER_PANEL.md](../../frontend/ui-specs/CENTER_PANEL.md#preview-tabs) for the full spec.

## Plan

1. Update `SessionTabBar` props and rendering:
   - Accept `previewFile: OpenFile | null` and `previewFilePath: string | null` props
   - Render preview tab after file tabs (or as the only file-area tab)
   - Preview tab has italic title via CSS class `.file-tab-preview`
   - Preview tab shows close button (calls `clearPreview()`)
   - Double-click on preview tab calls `pinPreview()`
   - Preview tab is active when `previewFilePath` matches and no pinned file is active

2. Add CSS for preview tab:
   - `.file-tab-preview .session-tab-name` — `font-style: italic`
   - Active state uses same highlight as pinned tabs

3. Update `SessionPanel` to show preview content:
   - Read `previewFilePath` and `previewContent` from `fileStore`
   - When `previewFilePath` is set and no pinned file is active, render `<FileViewer file={previewContent} />`
   - Pass preview props to `SessionTabBar`

4. Handle auto-close:
   - Clicking a pinned file tab: `activateFile()` already calls `clearPreview()`
   - Clicking a session tab: `handleSwitchSession` already calls `clearPreview()` (from store task)

## Files to modify
- `frontend/src/components/SessionPanel/SessionTabBar.tsx` — add preview tab rendering, italic style, double-click to pin
- `frontend/src/components/SessionPanel/SessionPanel.tsx` — read preview state, pass to TabBar, render preview content
- `frontend/src/components/SessionPanel/SessionPanel.css` (or inline styles) — `.file-tab-preview` italic styling

## Dependencies
- `feature_preview_tab_store` — needs `previewFilePath`, `previewContent`, `clearPreview()`, `pinPreview()`

## Definition of done
- Preview tab renders with italic title in the tab bar
- Preview tab content displays in FileViewer
- Double-clicking preview tab pins it (title becomes bold, tab persists)
- Clicking a pinned tab or session tab auto-closes preview
- Close button on preview tab works
- `npm run lint` passes

**Priority:** High
**Type:** New feature
**Spec:** [CENTER_PANEL.md](../../frontend/ui-specs/CENTER_PANEL.md#preview-tabs)
