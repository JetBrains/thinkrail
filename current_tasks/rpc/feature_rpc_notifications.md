# Implement RPC notifications.py

> `make_notify` factory and `current_notify` state

**Status:** Done
**Priority:** High
**Started:** 2026-02-27
**Spec reference:** `backend/app/rpc/README.md` (lines 168-183)

## Files to Modify

- `backend/app/rpc/notifications.py`

## Summary

`notifications.py` provides the outgoing message interface for the RPC module. It creates per-connection notify callables bound to a WebSocket and holds a module-level reference to the active connection's callable. This decouples message sending from the WebSocket transport details.

## Public Interface

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `make_notify` | `(websocket: WebSocket) → Callable` | Create a notify callable bound to the given WebSocket |
| `current_notify` | `Callable \| None` | Module-level variable holding the active notify callable |

### Notify Callable Signature

```python
async def notify(method: str, params: dict, request_id: str | None = None) -> None
```

- `request_id=None` → send JSON-RPC notification (no "id" field)
- `request_id` set → send JSON-RPC request (includes "id" field; `request_id` appears as both JSON-RPC id and in `params.requestId`)

## Plan

1. Define `current_notify` module-level variable (initially None)
2. Implement `make_notify` — takes WebSocket, returns async notify callable
3. Notify callable: build JSON-RPC notification dict when `request_id` is None
4. Notify callable: build JSON-RPC request dict when `request_id` is set (inject `requestId` into params, use `request_id` as JSON-RPC id)
5. Send serialized JSON over the WebSocket via `websocket.send_text`
6. Create `rpc/__init__.py` with module exports
7. Write unit tests — mock WebSocket, verify message shapes for both modes

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/notifications.py` | Create | Notify factory + state |
| `backend/app/rpc/__init__.py` | Create | Module exports |
| `backend/tests/rpc/__init__.py` | Create | Test package init |
| `backend/tests/rpc/test_notifications.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the interface in `backend/app/rpc/README.md`
