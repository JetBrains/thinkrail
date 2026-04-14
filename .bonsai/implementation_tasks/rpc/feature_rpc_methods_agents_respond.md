# Implement RPC methods/agents.py: respond + interrupt Handlers

> `respond_agent` and `interrupt_agent` handlers

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `feature_rpc_methods_agents_basic` (file + error decorator exist)
**Spec reference:** `backend/app/rpc/README.md` (lines 37-38, 72-81, 205-217)

## Files to Modify

- `backend/app/rpc/methods/agents.py`

## Summary

Add the `respond_agent` and `interrupt_agent` handlers to `methods/agents.py`. These complete the `agent/*` method set.

`respond_agent` routes client responses (from `agent/askUserQuestion` and `agent/confirmAction` server requests) back to the pending `asyncio.Future` in `tracker.py` via `AgentService.respond()`. The response can be either an `AskUserQuestionResponse` or a `ToolApprovalResponse` — it is passed as a raw dict to `service.respond()` which resolves the Future.

`interrupt_agent` cancels a running agent task, clearing pending futures and cancelling the background `asyncio.Task`.

## Handlers

| Handler | RPC Method | Params | Delegates to |
|---------|------------|--------|--------------|
| `respond_agent` | `agent/respond` | `{ taskId: str, requestId: str, response: dict }` | `agent_service.respond(task_id, request_id, response)` |
| `interrupt_agent` | `agent/interrupt` | `{ taskId: str }` | `agent_service.interrupt_task(task_id)` |

### Error Mapping

- `TaskNotFoundError` → `-32011`
- `FutureNotFoundError` → `-32012`

## Plan

1. Add `respond_agent` handler: extract `taskId`, `requestId`, `response` from params
2. Call `agent_service.respond(task_id, request_id, response)`
3. Add `interrupt_agent` handler: extract `taskId` from params
4. Call `agent_service.interrupt_task(task_id)`
5. Write unit tests: mock AgentService, test happy paths and error cases (missing params, TaskNotFoundError, FutureNotFoundError)

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/methods/agents.py` | Modify | Add respond + interrupt |
| `backend/tests/rpc/test_methods_agents.py` | Modify | Add tests |

## Definition of Done

- All unit tests pass
- `respond_agent` correctly routes responses to `service.respond()`
- `interrupt_agent` correctly delegates to `service.interrupt_task()`
- Error codes match spec mapping table
