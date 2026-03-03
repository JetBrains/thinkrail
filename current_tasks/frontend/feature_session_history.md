# Implement Session History

> Archive completed sessions with read-only replay

**Status:** Pending
**Priority:** Low
**Depends on:** `feature_chat_ui`, `feature_state_management`
**Spec reference:** `frontend/ui-specs/SESSION_HISTORY.md`

## Summary

Completed and closed agent sessions are preserved with their full event log. Users can review past conversations in read-only mode. Session data is stored in-memory for v1.

## Files to Create

- `frontend/src/components/SessionHistory/SessionHistory.tsx` — list of archived sessions in the Progress tab
- `frontend/src/components/SessionHistory/HistoryList.tsx` — paginated list (5 default + "Show more"), newest first
- `frontend/src/components/SessionHistory/HistoryItem.tsx` — card: name, skill, time, result badge, cost, turns
- `frontend/src/components/SessionHistory/ReadOnlySession.tsx` — reuses Chat UI components but disables input and interaction
- `frontend/src/components/SessionHistory/SessionSummary.tsx` — header with session metadata

## Key Implementation Details

- Sessions archived on `agent/done`, `agent/error`, or manual tab close
- Read-only mode: same chat components but questions/approvals show selected answers (non-interactive)
- Clicking a history item opens it as a read-only tab in the center panel
- In-memory storage only (v1) — lost on page refresh

## Definition of Done

- [ ] Completed sessions appear in history list
- [ ] History items show session metadata (name, result, cost, duration)
- [ ] Clicking opens read-only replay in center panel
- [ ] Read-only mode renders full event log with non-interactive cards
- [ ] Answered questions show the selected option highlighted
