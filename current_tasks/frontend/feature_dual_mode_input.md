# Task: Dual-Mode Message Input

> Status: **Done** | Created: 2026-03-11

## Summary

Implement dual-mode (text + markdown) message input with formatting toolbar, Write/Preview tabs, live preview, drag-to-resize panel, and markdown rendering in chat bubbles.

## Covers

- `frontend/src/components/ChatStream/InputArea.tsx`
- `frontend/src/components/ChatStream/ChatStream.tsx`
- `frontend/src/components/ChatStream/ChatStream.css`
- `frontend/src/components/SessionPanel/SessionPanel.tsx`
- `frontend/src/store/sessionStore.ts`
- `frontend/src/api/methods/agents.ts`
- `backend/app/rpc/methods/agents.py`
- `backend/app/agent/service.py`

## Acceptance Criteria

- [x] Md toggle button switches between text and markdown mode
- [x] Mod+Shift+M keyboard shortcut toggles mode from either mode
- [x] Write/Preview tabs appear in markdown mode toolbar
- [x] 10 formatting buttons insert correct markdown syntax (bold, italic, code, link, heading, bullet, numbered, blockquote, hr, code block)
- [x] Mod+B, Mod+I, Mod+K shortcuts insert bold, italic, link markers in markdown mode
- [x] Preview tab renders live markdown via ChatMarkdown
- [x] Drag-to-resize handle controls panel height; double-click resets to auto-size
- [x] `isMarkdown` flag threaded through store → RPC → backend → persistence
- [x] UserMessageBubble renders markdown messages with ChatMarkdown
- [x] Raw/rendered toggle button appears on hover over markdown user bubbles
- [x] Mod+Enter sends message from preview pane
- [x] Existing features preserved (autocomplete, voice input, message history)

## Design Reference

- Feature design: [features/DUAL_MODE_INPUT_DESIGN.md](../../features/DUAL_MODE_INPUT_DESIGN.md)
