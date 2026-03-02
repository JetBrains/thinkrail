# Implement RPC server.py: Wire Agent Handlers

> Wire agent handlers into METHODS dict

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `feature_rpc_methods_agents_basic`, `feature_rpc_methods_agents_run`, `feature_rpc_methods_agents_respond`
**Spec reference:** `backend/app/rpc/README.md` (lines 153-165)

## Summary

Update `server.py` to integrate the `agent/*` handlers from `methods/agents.py` into the METHODS dispatch dict, create `AgentService` alongside `SpecService`, and update the context passing so both services are available to their respective handlers.

Currently `server.py` passes `context=service` (SpecService) to `async_dispatch`. The agent handlers need `AgentService`. The solution is to use `functools.partial` to bind each handler to its service at registration time (keeps handler signatures clean).

## Changes Required

1. Import agent handlers from `methods/agents.py`
2. Add `agent/*` entries to METHODS dict:
   - `"agent/run"`: `run_agent`
   - `"agent/status"`: `get_agent_status`
   - `"agent/list"`: `list_agents`
   - `"agent/interrupt"`: `interrupt_agent`
   - `"agent/respond"`: `respond_agent`
3. Create `AgentService` in `register_routes` (needs `AppConfig` + `SpecService`)
4. Use `functools.partial` to bind each handler to its service at registration time (Option B — no changes needed to existing `specs.py` handlers)
5. Update tests: verify agent methods are dispatched correctly

## Plan

1. Import all 5 agent handlers in `server.py`
2. Add `agent/*` entries to METHODS dict
3. Create `AgentService(config, spec_service)` in `register_routes`
4. Use `functools.partial` to bind agent handlers to `agent_service` and spec handlers to `spec_service`
5. Update `async_dispatch` call if needed
6. Write/update integration tests in `test_server.py`

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/server.py` | Modify | Imports, METHODS, service setup |
| `backend/app/rpc/methods/agents.py` | Verify | Handler signature matches |
| `backend/tests/rpc/test_server.py` | Modify | Add agent dispatch tests |

## Definition of Done

- All unit tests pass (methods + server)
- All 11 methods (6 spec + 5 agent) are in METHODS dict
- `AgentService` is created and passed to agent handlers
- Existing `spec/*` dispatch continues to work unchanged
