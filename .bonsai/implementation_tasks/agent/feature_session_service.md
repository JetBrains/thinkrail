---
id: task-session-service
type: task-spec
status: done
title: Update service.py for conversational sessions
depends-on:
- task-session-models-tracker
- task-session-runner
implements:
- module-agent
covers:
- backend/app/agent/service.py
tags:
- high
- new-feature
---
# Update service.py for conversational sessions

> Facade changes: send_message, end_session, interrupt keeps session alive

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `task-session-models-tracker`, `task-session-runner`
**Spec reference:** `backend/app/agent/README.md` — Service Layer

## Files to Modify

- `backend/app/agent/service.py`

## Summary

Update `AgentService` to expose the new conversational session API. Add `send_message()` and `end_session()` methods. Update `interrupt_task()` to cancel the current turn while keeping the session alive (idle state, not error). Update `run_task()` to create the session without requiring a prompt — the session starts idle and waits for the first `agent/send`.

## Changes

### New methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `send_message` | `(task_id: str, text: str) → None` | Validate session is idle, enqueue message via tracker |
| `end_session` | `(task_id: str) → None` | Enqueue END_SIGNAL via tracker, clean up background task reference |

### Updated methods

| Method | Change |
|--------|--------|
| `run_task` | No longer needs initial prompt. Returns task immediately in `idle` state (after SDK client init). Session waits for first `agent/send`. Return type should include `session_id`. |
| `interrupt_task` | Cancel the current SDK turn (cancel the background asyncio.Task or set a flag), but do NOT set status to `error`. Session transitions to `idle` via the runner emitting `agent/interrupted`. |

### State validation

- `send_message` should raise if session is not `idle`
- `end_session` should work from both `idle` and `running` states
- `interrupt_task` should only work when `running`

## Plan

1. Add `send_message(task_id, text)` — validate idle state, call `tracker.enqueue_message()`
2. Add `end_session(task_id)` — call `tracker.enqueue_end_signal()`, await background task completion
3. Update `interrupt_task` — cancel background asyncio.Task but don't set error status; runner handles the transition to idle
4. Update `run_task` — remove prompt dependency; session starts idle after SDK client init
5. Add state validation to `send_message` and `end_session`
6. Update existing tests
7. Write new tests for send_message, end_session, interrupt-keeps-alive

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/agent/service.py` | Update | Add send_message, end_session; update interrupt, run_task |
| `backend/tests/agent/test_service.py` | Create/Update | Test new methods and state transitions |

## Definition of Done

- All unit tests pass
- `send_message()` enqueues user text; raises if not idle
- `end_session()` closes the session gracefully
- `interrupt_task()` cancels current turn; session stays alive (idle)
- `run_task()` creates session without requiring initial prompt
