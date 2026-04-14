# Implement RPC methods/agents.py: Basic Handlers

> `get_agent_status` and `list_agents` read handlers

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `feature_rpc_methods_specs` (establishes handler pattern)
**Spec reference:** `backend/app/rpc/README.md` (lines 205-217, 82-96)

## Files to Modify

- `backend/app/rpc/methods/agents.py`

## Summary

`methods/agents.py` contains the jsonrpcserver handler functions for all `agent/*` JSON-RPC methods. This task covers the read-only handlers: `get_agent_status` and `list_agents`. These follow the same pattern as `methods/specs.py` — each handler delegates to `AgentService` and returns domain models directly.

The file also defines the `_handle_errors` decorator for agent-specific error mapping, which all agent handlers (including those in later tasks) will reuse.

## Handlers

| Handler | RPC Method | Params | Delegates to |
|---------|------------|--------|--------------|
| `get_agent_status` | `agent/status` | `{ taskId: str }` | `agent_service.get_task(task_id)` |
| `list_agents` | `agent/list` | `{}` | `agent_service.list_tasks()` |

## Error Code Mapping (Agent-Specific)

| Exception | Code | Message |
|-----------|------|---------|
| `TaskNotFoundError` | -32011 | "Agent task not found" |
| `FutureNotFoundError` | -32012 | "No pending request" |
| `KeyError` / `TypeError` | -32602 | "Invalid params" |
| Other exceptions | -32603 | "Internal error" |

## Plan

1. Create `backend/app/rpc/methods/agents.py`
2. Implement `_handle_errors` decorator mapping agent domain exceptions to JSON-RPC error codes (include all agent codes for reuse by later tasks)
3. Implement `get_agent_status`: extract `taskId` from params, call `agent_service.get_task()`, return `model_dump()`
4. Implement `list_agents`: call `agent_service.list_tasks()`, return list of `model_dump()`
5. Write unit tests — mock AgentService, verify each handler + error mapping

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/methods/agents.py` | Create | Agent handlers |
| `backend/tests/rpc/test_methods_agents.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches interface in `backend/app/rpc/README.md`
- Error codes match mapping table in the spec
