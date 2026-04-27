---
id: task-session-models-tracker
type: task-spec
status: done
title: Update models.py and tracker.py for conversational sessions
depends-on:
- task-agent-models
- task-agent-tracker
implements:
- module-agent
covers:
- backend/app/agent/models.py
- backend/app/agent/tracker.py
tags:
- high
- new-feature
---
# Update models.py and tracker.py for conversational sessions

> Infrastructure changes: idle state, new event types, message queue

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `task-agent-models`, `task-agent-tracker` (existing implementations)
**Spec reference:** `backend/app/agent/README.md` — Session Lifecycle, Models, Conversation Loop

## Files to Modify

- `backend/app/agent/models.py`
- `backend/app/agent/tracker.py`

## Summary

Update the agent infrastructure layer to support persistent conversational sessions. `models.py` needs the new `idle` task state and two new event types (`turn_complete`, `interrupted`). `tracker.py` needs an `asyncio.Queue` per session for message delivery, updated state transitions to include `idle`, and a mechanism for the runner to wait for user messages.

## Changes

### models.py

| Change | Detail |
|--------|--------|
| `TaskStatus` | Add `"idle"` to the Literal type |
| `EventType` | Add `"turn_complete"` and `"interrupted"` to the Literal type |

### tracker.py

| Change | Detail |
|--------|--------|
| State transitions | Update `_VALID_TRANSITIONS`: `pending → {idle}`, `idle → {running, done}`, `running → {idle, done, error}` |
| Message queue | Add `_queues: dict[str, asyncio.Queue]` storage. Create queue in `create_task()`. |
| `enqueue_message` | New method: `(task_id: str, text: str) → None` — push a user message onto the session's queue |
| `enqueue_end_signal` | New method: `(task_id: str) → None` — push a sentinel `END_SIGNAL` onto the queue |
| `get_next_message` | New method: `async (task_id: str) → str \| END_SIGNAL` — await the next item from the queue. Blocks until `agent/send` or `agent/end` is called. |
| `cancel_futures` | Keep existing behavior but do NOT change task state (interrupt keeps session alive) |

### END_SIGNAL

Define a sentinel object (e.g. `END_SIGNAL = object()`) that `enqueue_end_signal` pushes and `get_next_message` returns to signal session close.

## Plan

1. Add `"idle"` to `TaskStatus` in models.py
2. Add `"turn_complete"` and `"interrupted"` to `EventType` in models.py
3. Update `_VALID_TRANSITIONS` in tracker.py to include idle state
4. Add `_queues` dict to `Tracker.__init__`
5. Create queue in `create_task()`
6. Implement `enqueue_message(task_id, text)`
7. Implement `enqueue_end_signal(task_id)`
8. Implement `get_next_message(task_id)` — async, awaits queue.get()
9. Define `END_SIGNAL` sentinel
10. Update existing tests for new transitions
11. Write new tests for queue operations

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/agent/models.py` | Update | Add idle state, new event types |
| `backend/app/agent/tracker.py` | Update | Add Queue, transitions, message methods |
| `backend/tests/agent/test_tracker.py` | Update | Test new transitions and queue operations |

## Definition of Done

- All unit tests pass
- `TaskStatus` includes `idle`; `EventType` includes `turn_complete` and `interrupted`
- Tracker supports `enqueue_message`, `enqueue_end_signal`, `get_next_message`
- State transitions match the lifecycle in `backend/app/agent/README.md`
