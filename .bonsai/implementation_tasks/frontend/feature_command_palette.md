---
id: task-fe-command-palette
type: task-spec
status: done
title: Implement Command Palette
depends-on:
- task-fe-app-shell
implements:
- command-palette
covers:
- frontend/src/components/CommandPalette/
tags:
- medium
- new-feature
- frontend
---
# Implement Command Palette

> Fuzzy search across specs, sessions, files, and actions (Mod+K)

**Status:** Done
**Priority:** Medium
**Depends on:** `feature_app_shell`, `feature_state_management`
**Spec reference:** `frontend/ui-specs/COMMAND_PALETTE.md`

## Summary

A floating search modal triggered by `Mod+K`. Supports prefix modes for filtered search (`/` actions, `#` specs, `@` sessions), fuzzy matching with scoring, result grouping by category, and keyboard navigation.

## Files to Create

- `frontend/src/components/CommandPalette/CommandPalette.tsx` — modal overlay, mode detection, keyboard handling
- `frontend/src/components/CommandPalette/PaletteInput.tsx` — search input with mode indicator badge
- `frontend/src/components/CommandPalette/PaletteResults.tsx` — grouped result list with category headers and type badges
- `frontend/src/components/CommandPalette/PaletteFooter.tsx` — mode hints and keyboard shortcut legend

## Key Implementation Details

- Prefix modes: none (all categories), `/` (actions only), `#` (specs only), `@` (sessions only)
- Fuzzy matching with priority: exact prefix > word-boundary > substring
- Empty query shows recent items
- Arrow keys navigate, Enter selects, Tab cycles modes, Escape dismisses
- Actions: new session, toggle panels, focus graph, etc.

## Definition of Done

- [ ] Mod+K opens palette, Escape closes
- [ ] Prefix modes filter results by category
- [ ] Fuzzy search matches specs, sessions, and actions
- [ ] Keyboard navigation works (arrows, Enter, Tab)
- [ ] Recent items shown on empty query
- [ ] Selecting a spec updates the right panel
- [ ] Selecting a session switches to that tab
