---
id: task-fe-console
type: task-spec
status: done
title: Implement Console
depends-on:
- task-fe-app-shell
implements:
- console
covers:
- frontend/src/components/Console/
tags:
- medium
- new-feature
- frontend
---
# Implement Console

> xterm.js terminal emulator with multiple tabs in the right panel

**Status:** Done
**Priority:** Medium
**Depends on:** `feature_app_shell`, `feature_project_setup`
**Spec reference:** `frontend/src/components/Console/README.md`

## Summary

The Console is a right-panel tab providing multiple terminal emulator instances via xterm.js. It connects to the backend via separate WebSocket connections (one per terminal, not JSON-RPC). Independent of agent sessions — used for manual commands, logs, and shell interaction.

## Files to Create

### Frontend
- `frontend/src/components/Console/ConsoleView.tsx` — container with tab bar and active terminal
- `frontend/src/components/Console/ConsoleTabBar.tsx` — terminal tabs with add/close buttons (max 5)
- `frontend/src/components/Console/TerminalContainer.tsx` — xterm.js instance, WebSocket data stream, resize handling
- `frontend/src/api/hooks/useTerminal.ts` — hook for terminal lifecycle (create, connect, resize, kill)

### Backend (new endpoints — requires new FastAPI router)
- Backend REST endpoints: `POST /terminal/create`, `DELETE /terminal/{id}/kill`
- Backend WebSocket: `/terminal/{id}/ws` — raw PTY data stream
- Backend resize: `POST /terminal/{id}/resize` — `{ cols, rows }`

## Key Implementation Details

- xterm.js 5.x with addons: addon-fit, addon-web-links, addon-search
- Lazy-loaded (dynamic import) to avoid 105KB bundle impact on initial load
- Shell: user's `$SHELL`, CWD: project root
- Theme colors mapped from CSS custom properties
- Resize: debounce 100ms, sync cols/rows to backend

## Definition of Done

- [ ] Console tab available in right panel
- [ ] New terminal tab creates a shell session
- [ ] Terminal renders correctly with theme colors
- [ ] Multiple terminal tabs (max 5, tabbed UI)
- [ ] Resize syncs between frontend and backend
- [ ] Terminal closes cleanly on tab close
- [ ] Lazy-loaded — not in initial bundle
