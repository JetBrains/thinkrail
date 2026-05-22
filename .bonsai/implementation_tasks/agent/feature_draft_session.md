---
id: task-draft-session
type: task-spec
status: done
title: Implement Draft Session (Pre-Start Config View)
implements:
- draft-session-design
covers:
- backend/app/agent/service.py
- backend/app/agent/models.py
- backend/app/rpc/methods/agents.py
- frontend/src/components/ChatStream/DraftConfigCard.tsx
- frontend/src/store/sessionStore.ts
tags:
- high
- new-feature
- session
---
# Implement Draft Session (Pre-Start Config View)

**Status:** Done
**Priority:** High
**Spec reference:** `.bonsai/design_docs/DRAFT_SESSION_DESIGN.md`
**Depends on:** —
**Started:** 2026-03-28

Add a two-phase session lifecycle so users can review and adjust the assembled system prompt before starting a session. Clicking `+ New` in the Sessions tab bar creates a "draft" session, which displays an editable config card (`DraftConfigCard`) with live system prompt preview. The user can adjust specs, skill, model, permissions, effort, and betas, then start the session.

## Plan

### 1. Backend: Add "draft" to `TaskStatus` and `system_prompt` to `AgentTask`

- `backend/app/agent/models.py` — Add `"draft"` as first value in `TaskStatus`. Add `system_prompt: str | None = None` field.
- `backend/app/agent/tracker.py` — Add `"draft"` to `_VALID_TRANSITIONS` (can transition to `initializing`, `done`, `error`).

### 2. Backend: Implement `prepare_task`, `update_draft`, `start_draft` in `AgentService`

- `prepare_task()` — Creates task in "draft" status, builds system prompt via `_build_context_for()`, stores on task, persists to disk. Does not start runner.
- `update_draft()` — Validates draft status, applies field changes, rebuilds system prompt. Uses Ellipsis sentinel for optional nullable fields (`skill_id`, `session_prompt`).
- `start_draft()` — Validates draft status, transitions to "initializing", launches `_run_background()`. Optionally enqueues first message.
- `end_session()` — Updated to handle draft cleanup (transition directly to done, remove from tracker).
- `_attach_to_ticket()` — Extracted helper for meta-ticket attachment logic.
- `_save_task()` — Updated to include `systemPrompt` in persisted data.
- `list_all_sessions()` — Updated to include full config + prompt for draft entries.

### 3. Backend: Persistence and RPC

- `backend/app/agent/persistence.py` — Include `config`, `systemPrompt`, `sessionPrompt` in `list_sessions()` for draft entries.
- `backend/app/rpc/methods/agents.py` — Add `prepare_agent`, `update_draft`, `start_draft` RPC handlers.
- `backend/app/rpc/server.py` — Register new methods in `METHODS` dict.

### 4. Frontend: Types, API, and Store

- `frontend/src/types/session.ts` — Add `"draft"` to `SessionStatus`.
- `frontend/src/api/methods/agents.ts` — Add `prepare()`, `updateDraft()`, `startDraft()` calls. Add `DraftUpdateParams`.
- `frontend/src/api/methods/sessions.ts` — Add draft fields to `SessionSummary`.
- `frontend/src/store/sessionStore.ts` — Add `createDraft()`, `updateDraft()`, `startDraft()`. Modify `sendMessage()` for auto-start. Update `loadActiveSessions()`.

### 5. Frontend: `DraftConfigCard` component

- `frontend/src/components/ChatStream/DraftConfigCard.tsx` — Stacked card with editable skill/spec/config rows, system prompt preview, Start/Discard buttons. Reuses `SkillGrid` and `SpecSelector` as popovers.
- `frontend/src/components/ChatStream/DraftConfigCard.css` — Styles with Bonsai CSS variables. Gold left-border.

### 6. Frontend: Integration

- `ChatStream.tsx` — Render `DraftConfigCard` when `session.status === "draft"`.
- `SessionStatusLine.tsx` — Add `"draft"` case to `statusInfo()`.
- `NewSessionModal.tsx` — "Create Session" button calls `createDraft()`.
- `SessionPanel.tsx` — Add `"draft"` to `handleSend` guard. Hide StatusLine for drafts. Draft placeholder text.
- `SessionTabBar.tsx` — Gold dot for draft status.

## Files modified

| File | Change |
|------|--------|
| `backend/app/agent/models.py` | Add "draft" status, `system_prompt` field |
| `backend/app/agent/tracker.py` | Add "draft" to valid transitions |
| `backend/app/agent/service.py` | Add `prepare_task`, `update_draft`, `start_draft`, `_attach_to_ticket`; update `_save_task`, `list_all_sessions`, `end_session` |
| `backend/app/agent/persistence.py` | Include draft-specific fields in `list_sessions` |
| `backend/app/rpc/methods/agents.py` | Add 3 new RPC handlers |
| `backend/app/rpc/server.py` | Register 3 new methods |
| `backend/tests/rpc/test_server.py` | Update expected methods set |
| `frontend/src/types/session.ts` | Add "draft" to `SessionStatus` |
| `frontend/src/api/methods/agents.ts` | Add 3 API calls + `DraftUpdateParams` |
| `frontend/src/api/methods/sessions.ts` | Add draft fields to `SessionSummary` |
| `frontend/src/store/sessionStore.ts` | Add 3 store actions; modify `sendMessage`, `loadActiveSessions` |
| `frontend/src/components/ChatStream/DraftConfigCard.tsx` | **New** |
| `frontend/src/components/ChatStream/DraftConfigCard.css` | **New** |
| `frontend/src/components/ChatStream/ChatStream.tsx` | Render DraftConfigCard |
| `frontend/src/components/ChatStream/SessionStatusLine.tsx` | Add draft case |
| `frontend/src/components/NewSessionModal/NewSessionModal.tsx` | Create Session + createDraft |
| `frontend/src/components/SessionPanel/SessionPanel.tsx` | Draft handling |
| `frontend/src/components/SessionPanel/SessionTabBar.tsx` | Gold dot |

## Definition of done

- `agent/prepare` creates a draft task with assembled system prompt
- `agent/updateDraft` changes config and rebuilds prompt
- `agent/startDraft` transitions to initializing and launches runner
- `agent/run` still works as one-step shortcut (backward compatible)
- NewSessionModal creates drafts; session tab opens with `DraftConfigCard`
- Adding/removing specs refreshes system prompt preview
- Changing model/permissions/effort/betas updates config
- "Start Session" button starts the session normally
- Typing a message in InputArea auto-starts the draft
- "Discard" deletes the draft and closes the tab
- Draft sessions survive page refresh (loaded from disk)
- All existing backend tests pass (`uv run pytest`)

## Out of scope

- Server restart draft re-registration (drafts on disk are not re-loaded into `Tracker`)
- Draft cleanup/expiry for stale drafts
- Refactoring `run_task()` to use `prepare_task()` + `start_draft()` internally
- Suggested sessions / meta-ticket flows going through draft phase (they use `agent/run`)
