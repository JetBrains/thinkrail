# Implement App Shell

> Three-panel layout, routing, header, status bar, responsive behavior

**Status:** Done
**Priority:** High
**Depends on:** `feature_state_management`, `feature_project_setup`
**Spec reference:** `frontend/ui-specs/APP_SHELL.md`, `frontend/ui-specs/RESPONSIVE_BEHAVIOR.md`

## Summary

The App Shell is the root layout component: a three-panel workspace (left nav, center sessions, right context), header bar, status bar, and React Router integration. It includes drag-to-resize handles between panels and responsive breakpoints that auto-collapse side panels on narrow viewports.

## Files to Create

- `frontend/src/routes.tsx` — React Router v7 route definitions: `/workspace`, `/workspace/spec/:specId`, `/workspace/session/:taskId`, `/workspace/graph`
- `frontend/src/components/AppShell/AppShell.tsx` — three-panel container with resize handles
- `frontend/src/components/AppShell/Header.tsx` — logo, project name, session count, toggle/new buttons
- `frontend/src/components/AppShell/StatusBar.tsx` — spec counts, keyboard hints, attention indicator
- `frontend/src/components/AppShell/ResizeHandle.tsx` — drag handle with snap-to-collapse behavior
- `frontend/src/components/AppShell/LeftPanel.tsx` — tab container (Specs, Requirements, Files, Progress)
- `frontend/src/components/AppShell/CenterPanel.tsx` — session tab bar + active session content area
- `frontend/src/components/AppShell/RightPanel.tsx` — tab container (Graph, Spec, Code, Diff, Console)
- `frontend/src/utils/keyboard.ts` — global keyboard shortcut registration (Cmd+K, Cmd+T, Cmd+1-9, Ctrl+B, Cmd+J)

Update `frontend/src/App.tsx` to wire providers (RpcProvider, BrowserRouter) and render AppShell.

## Key Implementation Details

### Panel Constraints
| Panel | Default | Min | Max |
|-------|---------|-----|-----|
| Left  | 260px   | 140px | 420px |
| Center| flex    | 300px | — |
| Right | 380px   | 200px | 600px |

### Responsive Breakpoints
- Desktop (>=1280px): all panels visible at default widths
- Laptop (1024-1279px): all panels, narrower defaults (L 200px, R 280px)
- Below-min (<1024px): side panels auto-collapsed, drawer mode with backdrop

### Bootstrap Sequence
1. Mount React → create RpcClient → connect WebSocket
2. On connect: fetch specs, sessions, cost in parallel
3. Restore UI state from localStorage
4. Render AppShell

## Definition of Done

- [ ] Three-panel layout renders with correct proportions
- [ ] Drag handles resize panels with min/max constraints
- [ ] Panels collapse/expand via keyboard shortcuts (Ctrl+B, Cmd+J)
- [ ] Header shows project name and session count
- [ ] Status bar shows spec counts
- [ ] React Router navigates between workspace views
- [ ] Responsive breakpoints trigger panel collapse
- [ ] Global keyboard shortcuts registered
