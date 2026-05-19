---
id: task-agent-tracker
type: task-spec
status: done
title: Implement Agent tracker.py
depends-on:
- task-agent-models
implements:
- module-agent
covers:
- backend/app/agent/tracker.py
tags:
- high
- new-feature
---
# Implement Agent tracker.py

> Task lifecycle and asyncio.Future map for pending requests

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `feature_agent_models`
**Spec reference:** `backend/app/agent/README.md` (lines 41, 121-128)

## Files to Modify

- `backend/app/agent/tracker.py`

## Summary

`tracker.py` manages the lifecycle of agent tasks (pending/running/done/error) and maintains a registry of in-flight `asyncio.Future` objects keyed by `requestId`. This enables the suspension mechanism where `runner.py` awaits a Future while the frontend responds to a question or tool approval request.

## Public Interface

### Task Lifecycle

| Function | Signature | Description |
|----------|-----------|-------------|
| `create_task` | `(spec_ids, config) → AgentTask` | Create a new task in pending status with a generated id |
| `get_task` | `(task_id) → AgentTask` | Retrieve task by id. Raise if not found |
| `list_tasks` | `() → list[AgentTask]` | Return all tasks |
| `set_status` | `(task_id, status) → None` | Update task status and updated timestamp |
| `set_session_id` | `(task_id, session_id) → None` | Set the SDK session id once available |

### Future Management

| Function | Signature | Description |
|----------|-----------|-------------|
| `register_future` | `(task_id, request_id) → asyncio.Future` | Create and store a Future for a pending request. Awaited indefinitely until `resolve_future` or `cancel_futures`. |
| `resolve_future` | `(task_id, request_id, response) → None` | Resolve the Future with the given response dict. Raise if no pending future found |
| `cancel_futures` | `(task_id) → None` | Cancel all pending futures for a task (used on interrupt/error) |

## Plan

1. Define internal storage: `_tasks` dict, `_futures` dict (`task_id → {request_id → Future}`)
2. Implement `create_task` — generate uuid4 id, build AgentTask, store
3. Implement `get_task`, `list_tasks`
4. Implement `set_status` — validate transitions, update timestamp
5. Implement `set_session_id`
6. Implement `register_future` — create Future, store; no timer (futures wait indefinitely)
7. Implement `resolve_future` — pop Future, `set_result`
8. Implement `cancel_futures` — cancel all Futures for a task
9. Write unit tests — lifecycle transitions, future resolution, cancellation

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/agent/tracker.py` | Create | Task state + future management |
| `backend/app/agent/__init__.py` | Update | Add tracker exports |
| `backend/tests/agent/test_tracker.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the interface in `backend/app/agent/README.md`
