---
id: task-rpc-session-wiring
type: task-spec
status: done
title: Wire new agent session methods into RPC layer
depends-on:
- task-session-service
implements:
- module-rpc
covers:
- backend/app/rpc/methods/agents.py
- backend/app/rpc/server.py
tags:
- high
- new-feature
---
# Wire new agent session methods into RPC layer

> Add agent/send, agent/end handlers and METHODS entries

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `task-session-service`
**Spec reference:** `backend/app/rpc/README.md` — Methods, methods/agents.py

## Files to Modify

- `backend/app/rpc/methods/agents.py`
- `backend/app/rpc/server.py`

## Summary

Add RPC handlers for the two new client→server methods (`agent/send`, `agent/end`) and wire them into the METHODS dict in `server.py`. Update `agent/run` return value to include `sessionId`. Update `agent/interrupt` behavior description (session stays alive).

## Changes

### methods/agents.py

| Handler | Method | Params | Delegates to |
|---------|--------|--------|-------------|
| `send_message` | `agent/send` | `{ taskId: str, text: str }` | `service.send_message(taskId, text)` |
| `end_session` | `agent/end` | `{ taskId: str }` | `service.end_session(taskId)` |

Update `run_agent` to return `{ taskId, sessionId }` instead of just `{ taskId }`.

Both new handlers use the existing `_handle_errors` decorator for consistent error mapping.

### server.py

Add to `METHODS` dict:
```python
"agent/send": send_message,
"agent/end": end_session,
```

Import the new handlers from `methods/agents.py`.

### Error handling

- `agent/send` when session is not idle → map to JSON-RPC error (reuse -32011 or add a new code)
- `agent/end` when session is already done → no-op or error

## Plan

1. Add `send_message` handler in `methods/agents.py`
2. Add `end_session` handler in `methods/agents.py`
3. Update `run_agent` return to include `sessionId`
4. Import new handlers in `server.py`
5. Add `"agent/send"` and `"agent/end"` to METHODS dict
6. Update `_bind_methods` if needed (new handlers are agent-prefixed, already handled)
7. Write tests for new handlers

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/methods/agents.py` | Update | Add send_message, end_session handlers; update run_agent return |
| `backend/app/rpc/server.py` | Update | Add new methods to METHODS dict and imports |
| `backend/tests/rpc/test_methods_agents.py` | Create/Update | Test new handlers |

## Definition of Done

- All unit tests pass
- `agent/send` dispatches to `service.send_message()`
- `agent/end` dispatches to `service.end_session()`
- `agent/run` returns `{ taskId, sessionId }`
- New methods appear in METHODS dict and are reachable via JSON-RPC dispatch
