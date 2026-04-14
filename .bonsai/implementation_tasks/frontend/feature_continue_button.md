# Task: Continue Button

> Status: **Done** | Created: 2026-03-11

## Summary

Add a "Continue" button to InputArea that lets users resume an idle session without typing a message. Handles both question-pending and idle/interrupted states.

## Covers

- `frontend/src/components/ChatStream/InputArea.tsx`
- `frontend/src/components/SessionPanel/SessionPanel.tsx`

## Acceptance Criteria

- [x] Continue button visible when: input enabled, agent not running, session has events
- [x] When question pending: resolves with `{ text: "continue" }`
- [x] When idle/interrupted: sends `sendMessage(sessionId, "continue")`
- [x] Button styled as `.input-continue`
- [x] Button hidden when input is disabled or session is running

## Design Reference

- Chat UI spec: [frontend/ui-specs/CHAT_UI.md](../../frontend/ui-specs/CHAT_UI.md)
