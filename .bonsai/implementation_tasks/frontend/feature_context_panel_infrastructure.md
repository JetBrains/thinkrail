---
id: task-context-panel-infrastructure
type: task-spec
status: done
title: 'Create Context Panel infrastructure: useContextMode + CollapsibleSection'
implements:
- ui-context-panel
covers:
- frontend/src/components/ContextPanel/
tags:
- high
- feature
- frontend
---
# Create Context Panel infrastructure: useContextMode hook and CollapsibleSection component

The right panel is being redesigned from a tab-based interface to a context-aware sidebar (see [CONTEXT_PANEL.md](../../frontend/ui-specs/CONTEXT_PANEL.md)). This task creates the foundational pieces that all other Context Panel components depend on.

## Context

The current `RightPanel.tsx` uses manual tabs (`Graph | Spec | Code | Diff | Console`). The new design auto-switches between 4 modes based on center panel state. This task builds the mode derivation hook and the shared section wrapper that every mode uses.

## Plan

1. Create `useContextMode.ts` hook in `frontend/src/components/ContextPanel/`
   - Reads `sessionStore.activeSessionId`, `fileStore.activeFilePath`, `specStore.selectedSpecId`
   - Returns `ContextMode: 'spec' | 'agent' | 'code' | 'empty'`
   - Priority: active session > spec file > code file > selected spec > empty
   - Add `isSpecFile(path: string)` helper — check if path matches a registry spec path or is inside `.bonsai/`

2. Create `CollapsibleSection.tsx` component in `frontend/src/components/ContextPanel/`
   - Props: `title`, `count?`, `defaultExpanded?`, `expandToCenter?`, `summary?`, `children`
   - Click header to expand/collapse
   - Persist collapsed state per section key in `localStorage`
   - Show `[⇱]` button when `expandToCenter` callback is provided
   - Show count badge in header when `count` is set
   - CSS animation for expand/collapse (max-height transition)

3. Create `CollapsibleSection.css` with styles matching existing panel aesthetic
   - Use existing CSS custom properties (`--bg`, `--border`, etc.)
   - Section header: clickable, shows chevron + title + optional count + optional expand button
   - Section body: collapsible with smooth transition

4. Create `ContextPanel.css` for panel-level styles

## Files to create
- `frontend/src/components/ContextPanel/useContextMode.ts` (hook + isSpecFile helper)
- `frontend/src/components/ContextPanel/CollapsibleSection.tsx` (shared section wrapper)
- `frontend/src/components/ContextPanel/CollapsibleSection.css` (section styles)
- `frontend/src/components/ContextPanel/ContextPanel.css` (panel-level styles)

## Files to read (for reference)
- `frontend/src/store/specStore.ts` — selectedSpecId, specs array
- `frontend/src/store/sessionStore.ts` — activeSessionId
- `frontend/src/store/fileStore.ts` — activeFilePath
- `frontend/src/components/AppShell/RightPanel.tsx` — existing panel styles to match
- `frontend/src/styles/` — CSS custom properties

## Definition of done
- `useContextMode()` returns correct mode for each scenario (session active, spec file open, code file open, nothing selected)
- `CollapsibleSection` renders with expand/collapse, persists state, shows count badge and expand button
- Components are importable and render without errors
- Follows existing code style and CSS variable conventions

**Priority:** High
**Started:** 2026-03-04
