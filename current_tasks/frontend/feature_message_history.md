# Implement Message History Navigation

> Global message history dropdown with Ctrl+R and button trigger for quick re-sending

**Status:** Done
**Priority:** Medium
**Depends on:** `feature_chat_ui`, `feature_state_management`

## Summary

Add a message history popup to the InputArea, allowing users to quickly access and
resend previously typed messages across all sessions. Triggered via Ctrl+R or a
history button in the input area. History is stored globally using Zustand persist
middleware (localStorage) and survives page reloads.

## Files Created

- `frontend/src/store/messageHistoryStore.ts` — Zustand store with `persist`
  middleware, deduplication, and 50-message cap
- `frontend/src/components/ChatStream/MessageHistory.tsx` — Dropdown popup with
  filter input, keyboard navigation, and click-to-select

## Files Modified

- `frontend/src/components/ChatStream/InputArea.tsx` — Ctrl+R handler, history
  button, showHistory state, mutual exclusion with autocomplete
- `frontend/src/components/SessionPanel/SessionPanel.tsx` — Record sent messages
  into messageHistoryStore
- `frontend/src/components/ChatStream/ChatStream.css` — History popup styles
  (reuse input-autocomplete pattern)

## Key Implementation Details

### Triggers
| Trigger | Action |
|---------|--------|
| Ctrl+R (textarea or filter focused) | Toggle history popup |
| History button (near Send) | Toggle history popup |
| Escape (filter focused) | Close popup |

### History Store
- Zustand with `persist` middleware (key: `bonsai-message-history`)
- Global across all sessions
- Deduplicated (most recent occurrence wins, placed first)
- Capped at 50 entries

### Popup Behavior
- Positioned absolutely above input (same as `.input-autocomplete`)
- Filter input at top, auto-focused on open
- Arrow Up/Down for keyboard navigation within list
- Enter selects highlighted item → fills textarea
- Click on item → fills textarea
- Mutually exclusive with skill autocomplete popup
- Messages truncated to single line in list

### Focus Flow
1. Ctrl+R or button click → popup opens → filter input auto-focused
2. Navigate/filter → Enter or click → textarea filled → popup closes → textarea focused
3. Escape → popup closes → textarea focused

## Definition of Done

- [x] Ctrl+R toggles history popup when textarea or filter input is focused
- [x] History button visible near Send button, toggles popup on click
- [x] Sent messages recorded globally across all sessions
- [x] History persists across page reloads (Zustand persist / localStorage)
- [x] Filter input narrows the list as user types
- [x] Arrow keys navigate list, Enter selects highlighted item
- [x] Click on item fills input textarea
- [x] Duplicate messages deduplicated (most recent first)
- [x] History capped at 50 entries
- [x] History popup and skill autocomplete are mutually exclusive
- [x] `npm run lint` passes with no errors (pre-existing SpecHealth error excluded)
