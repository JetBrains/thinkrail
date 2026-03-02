# Implement RPC methods/agents.py: run_agent Handler

> `run_agent` handler with notify capture and async launch

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `feature_rpc_methods_agents_basic` (file + error decorator exist)
**Spec reference:** `backend/app/rpc/README.md` (lines 34, 205-219)

## Summary

Add the `run_agent` handler to `methods/agents.py`. This is the most complex handler because it captures the current WebSocket notify callable at call time, passes it to `AgentService.run_task`, and returns immediately with the `taskId`. The actual agent run proceeds asynchronously in the background; streaming events are pushed to the client via the notify callable.

## Handler

| Handler | RPC Method | Params | Returns |
|---------|------------|--------|---------|
| `run_agent` | `agent/run` | `{ specIds: list[str], config: AgentConfig }` | `{ "taskId": task.id }` |

### Steps

1. Import `notifications.current_notify`
2. If `current_notify` is None, raise error (no active connection)
3. Build `AgentConfig` from `params["config"]` dict
4. Call `agent_service.run_task(spec_ids, config, current_notify)`
5. Return `{ "taskId": task.id }`

### Error Paths

- Missing `specIds`/`config` → `KeyError` → `-32602`
- No active connection (`current_notify` is None) → `-32603`

## Plan

1. Add `run_agent` handler to `backend/app/rpc/methods/agents.py`
2. Import notifications module for `current_notify` access
3. Validate `specIds` and `config` from params
4. Construct `AgentConfig` from config dict (Pydantic handles validation)
5. Capture `current_notify`, guard against None
6. Call `agent_service.run_task(spec_ids, config, notify)` → `AgentTask`
7. Return `{"taskId": task.id}`
8. Write unit tests: mock AgentService + current_notify, test happy path and error cases (missing params, no connection)

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/methods/agents.py` | Modify | Add run_agent |
| `backend/tests/rpc/test_methods_agents.py` | Modify | Add run_agent tests |

## Definition of Done

- All unit tests pass
- `run_agent` correctly captures and passes notify callable
- Returns `taskId` immediately without blocking
