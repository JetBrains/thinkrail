# Implement RPC methods/agents.py: Agent Handlers

> Agent handlers using EventBus for multi-client notification routing

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Updated:** 2026-04-12 (multi-client EventBus refactor)
**Depends on:** `feature_rpc_methods_agents_basic`, `feature_rpc_event_bus`
**Spec reference:** `backend/app/rpc/README.md`

## Files

- `backend/app/rpc/methods/agents.py`

## Summary

Agent handlers in `methods/agents.py` manage session lifecycle via `AgentService`. All streaming events are routed through the **EventBus** — there is no `notify` parameter passed to service methods. The `current_conn_id` context variable identifies the calling client; `_auto_subscribe_all` ensures all project clients receive session events (Phase 1: broadcast-all).

## Key Handlers

| Handler | RPC Method | Params | Returns |
|---------|------------|--------|---------|
| `run_agent` | `agent/run` | `{ specIds, config, skillId?, prompt?, name?, metaTicketId? }` | `{ "bonsaiSid": str }` |
| `send_message` | `agent/send` | `{ bonsaiSid, text, isMarkdown? }` | `None` |
| `respond_agent` | `agent/respond` | `{ bonsaiSid, requestId, response }` | `None` |
| `prepare_agent` | `agent/prepare` | `{ specIds, config, skillId?, prompt?, name?, ... }` | `{ bonsaiSid, systemPrompt, sections, totalTokens }` |
| `start_draft` | `agent/startDraft` | `{ bonsaiSid, prompt? }` | `{ "bonsaiSid": str }` |

## Internal Components

### `_auto_subscribe_all(bonsai_sid)`
Subscribes all connections on the same project to `session:{bonsai_sid}`. Uses `current_conn_id` to find the calling connection's project, then iterates `bus.connections_for_project()`.

### Multi-client sync notifications
- `send_message` → publishes `session/userMessage` with `sentBy` to session topic
- `respond_agent` → publishes `agent/requestResolved` with `resolvedBy` to session topic (first-responder-wins)
- `prepare_agent` / `start_draft` → publishes `session/didCreate` to project topic

### `run_agent` flow
1. Build `AgentConfig` from `params["config"]`
2. Call `agent_service.run_task(spec_ids, config, ...)` — no notify param
3. `_auto_subscribe_all(task.bonsai_sid)` subscribes all project clients
4. Return `{"bonsaiSid": task.bonsai_sid}`
5. Agent service publishes streaming events via `bus.publish_to_session()` internally

### Error handling
`_handle_errors` decorator maps domain exceptions to JSON-RPC error codes:
- `TaskNotFoundError` → `-32011`
- `FutureNotFoundError` → `-32012`
- `KeyError`/`TypeError` → `-32602`
- `JsonRpcError` → re-raise (e.g. `-32013` already-resolved)
- Other → `-32603`

## Definition of Done

- All unit tests pass
- Handlers route events through EventBus, not direct notify callables
- Multi-client sync events published correctly
