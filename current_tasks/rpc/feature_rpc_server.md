# Implement RPC server.py

> WebSocket endpoint, JSON-RPC dispatch, watcher integration

**Status:** Done
**Priority:** High
**Started:** 2026-02-27
**Depends on:** `feature_rpc_notifications`, `feature_rpc_methods_specs`
**Spec reference:** `backend/app/rpc/README.md` (lines 153-166, 218-255)

## Files to Modify

- `backend/app/rpc/server.py`

## Summary

`server.py` is the main entry point for the RPC module. It registers a `/ws` WebSocket endpoint on the FastAPI app, manages the connection lifecycle (single active connection), dispatches incoming JSON-RPC messages via jsonrpcserver, and starts/stops the filesystem watcher. For this spec-only phase, the METHODS dict registers only `spec/*` handlers (agent/* deferred).

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `register_routes` | `(app: FastAPI) → None` | Register the `/ws` WebSocket endpoint on the FastAPI app |
| `start_watcher` | `() → WatchHandle` | Start `core/watcher` watching the project directory |
| `stop_watcher` | `(handle: WatchHandle) → None` | Stop the file watcher |

## Internal Components

### METHODS dict
Mapping from JSON-RPC method names to handler coroutines. Assembled from `methods/specs.py` functions. Spec-only phase includes: `spec/list`, `spec/get`, `spec/create`, `spec/update`, `spec/delete`, `spec/graph`.

### WebSocket Handler
- **On connect:** create `notify = make_notify(ws)`, set `current_notify`
- If another client is connected, close the previous connection
- **Dispatch loop:** receive text → `jsonrpcserver.async_dispatch` → send response
- **On disconnect:** set `current_notify = None`

### `_on_file_change(path, change_type)`
Watcher callback. Routes by file type:
- `.specs/registry.json` → send `registry/didUpdate` via `current_notify`
- Spec files (`*.md` or `*.json` per registry) → call `spec/service` to validate/postprocess → send `spec/didChange`, `spec/didCreate`, or `spec/didDelete` via `current_notify`
- If `current_notify` is None: drop silently

### Dependencies
- `fastapi` (WebSocket endpoint)
- `jsonrpcserver` (async_dispatch)
- `rpc/methods/specs` (spec handler functions)
- `rpc/notifications` (make_notify, current_notify)
- `spec/service` (watcher postprocessing)
- `core/watcher` (watch, WatchHandle)
- `core/config` (project root path)

## Plan

1. Assemble METHODS dict from `methods/specs.py` handlers
2. Implement WebSocket handler — connect, dispatch loop, disconnect
3. Implement connection management — track active connection, replace on second connect
4. Implement `register_routes` — add `/ws` endpoint to FastAPI app
5. Implement `_on_file_change` callback — route by file type, send notifications via `current_notify`
6. Implement `start_watcher` / `stop_watcher` using `core/watcher`
7. Update `rpc/__init__.py` with server exports
8. Write unit tests — mock WebSocket, jsonrpcserver, watcher, spec/service

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/rpc/server.py` | Create | WebSocket + dispatch + watcher |
| `backend/app/rpc/__init__.py` | Update | Add server exports |
| `backend/tests/rpc/test_server.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the interface in `backend/app/rpc/README.md`
- METHODS dict includes only `spec/*` methods (agent/* deferred)
