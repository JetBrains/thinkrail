# Implement RPC notifications.py

> `make_notify` factory for per-connection WebSocket callables

**Status:** Done
**Priority:** High
**Started:** 2026-02-27
**Updated:** 2026-04-12 (multi-client EventBus refactor)
**Spec reference:** `backend/app/rpc/README.md`

## Files

- `backend/app/rpc/notifications.py`

## Summary

`notifications.py` provides the `make_notify` factory that creates per-connection notify callables bound to a WebSocket. These callables are stored on each `ClientConnection` and used internally by the EventBus to deliver messages to individual clients.

**Note:** The `current_notify` module-level singleton was **removed** during the EventBus refactor. All notification routing now flows through `bus.py` pub/sub. `make_notify` remains as an internal helper — it is called once per connection in `server.py` when creating a `ClientConnection`.

## Public Interface

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `make_notify` | `(websocket: WebSocket) → NotifyCallable` | Create a notify callable bound to the given WebSocket |
| `NotifyCallable` | `Callable[[str, dict, str \| None], Awaitable[None]]` | Type alias for notify callables |

### Notify Callable Signature

```python
async def notify(method: str, params: dict, request_id: str | None = None) -> None
```

- `request_id=None` → send JSON-RPC notification (no "id" field)
- `request_id` set → send JSON-RPC request (includes "id" field; `request_id` appears as both JSON-RPC id and in `params.requestId`)

## Definition of Done

- All unit tests pass
- `make_notify` creates correct JSON-RPC notification/request messages
- No module-level `current_notify` state — all routing via EventBus
