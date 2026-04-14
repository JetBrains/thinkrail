# Task: Remove Text Mode, Add Split-Pane Preview to InputArea

> Status: **Done** | Created: 2026-03-12

## Summary

Simplify InputArea from dual-mode (text + markdown) to always-markdown. Replace the tab-based Write/Preview switching with a side-by-side split-pane preview that appears alongside the textarea when toggled on. The toolbar is always visible. All format shortcuts (Mod+B/I/K) work unconditionally.

## Covers

- `frontend/src/components/ChatStream/InputArea.tsx`
- `frontend/src/components/ChatStream/ChatStream.css`

## Acceptance Criteria

- [x] `InputMode` type and `inputMode` state removed — no text/markdown toggle
- [x] `Md` button and `Mod+Shift+M` shortcut removed
- [x] Toolbar with Preview toggle + 10 format buttons always visible
- [x] `Write` tab removed — textarea always visible
- [x] Preview toggle shows side-by-side split pane (textarea left, rendered preview right)
- [x] Draggable divider between textarea and preview, clamped 20%–80%
- [x] Mod+B, Mod+I, Mod+K shortcuts work unconditionally (no `isMd` guard)
- [x] Messages always sent as markdown (`onSend(trimmed, true)`)
- [x] Old non-markdown messages still render as plain text (backward-compatible)
- [x] Vertical panel resize (drag handle) still works with split pane
- [x] Double-click handle resets height
- [x] Mod+Enter sends from preview pane
- [x] TypeScript compiles cleanly

## Design Reference

- Feature design: [.bonsai/design_docs/DUAL_MODE_INPUT_DESIGN.md](../design_docs/DUAL_MODE_INPUT_DESIGN.md)

## Supersedes

- [feature_dual_mode_input.md](./feature_dual_mode_input.md) — original dual-mode implementation
