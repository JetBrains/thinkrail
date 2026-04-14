# Implement RPC server.py

> WebSocket endpoint, JSON-RPC dispatch, multi-client EventBus, watcher integration

**Status:** Done
**Priority:** High
**Started:** 2026-02-27
**Updated:** 2026-04-12 (multi-client EventBus refactor)
**Depends on:** `feature_rpc_notifications`, `feature_rpc_methods_specs`, `feature_rpc_event_bus`
**Spec reference:** `backend/app/rpc/README.md`

## Files

- `backend/app/rpc/server.py`

## Summary

`server.py` is the main entry point for the RPC module. It registers a `/ws` WebSocket endpoint on the FastAPI app, supports **multiple simultaneous client connections** via the EventBus pub/sub system, dispatches incoming JSON-RPC messages via jsonrpcserver, and manages per-project filesystem watchers with reference counting.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `register_routes` | `(app: FastAPI) → None` | Register the `/ws` WebSocket endpoint on the FastAPI app |

## Internal Components

### METHODS dict
Mapping from JSON-RPC method names to handler coroutines. Includes `spec/*`, `agent/*`, `session/*`, `vis/*`, `board/*`, `trash/*`, `settings/*`, `models/*`, `skills/*`, `auth/*`, and `connection/*` handlers.

### Per-project caches
- `_agent_services` / `_vis_services` / `_board_services` / `_model_registries` — keyed by project path, survive WebSocket reconnects
- `_project_watchers` — maps project_path → `(WatchHandle, ref_count)` for per-project reference-counted watchers

### WebSocket Handler (`ws_endpoint`)
- **On connect:**
  1. Validate `?project=` query param, check `.bonsai/registry.json` exists
  2. Authenticate via `?token=` query param using `auth.authenticate()`; close with 4003 if invalid
  3. Load/reuse per-project services (`AgentService`, `VisService`, `BoardService`, `ModelRegistry`)
  4. Accept WebSocket, create `ClientConnection` with `uuid4` conn_id
  5. Register connection with `bus.register(conn)`, start sweep task
  6. Publish `connection/didJoin` to existing subscribers on `project:{path}` topic
  7. Subscribe new connection to `project:{path}` topic
  8. Auto-subscribe to all active session topics (Phase 1: broadcast-all)
  9. Replay missed events if `?last_seen=` timestamp is provided
- **Dispatch loop:** receive text → set `current_conn_id` context var → `async_dispatch` → send response → reset context var
- **On disconnect:** publish `connection/didLeave`, `bus.unregister(conn_id)`, release watcher ref

### `_on_file_change(changes)`
Watcher callback. Routes by file type:
- `.bonsai/registry.json` → publish `registry/didUpdate` via `bus.publish(project_topic, ...)`
- Spec files (`*.md` or `*.json` per registry) → `spec/didChange`, `spec/didCreate`, or `spec/didDelete` via bus
- Any added/deleted files → `files/treeChanged` via bus
- Modified files → `file/didChange` via bus
- `.md`/`.json` changes → trigger `vis_service.recompute()`

### Watcher lifecycle (`_acquire_watcher` / `_release_watcher`)
- First connection to a project starts the watcher
- Subsequent connections increment the ref count
- On disconnect, ref count decrements; watcher stops when count reaches 0

### Dependencies
- `fastapi` (WebSocket endpoint)
- `jsonrpcserver` (async_dispatch)
- `rpc/bus` (EventBus singleton)
- `rpc/connections` (ClientConnection, current_conn_id)
- `rpc/auth` (authenticate, ANONYMOUS)
- `rpc/notifications` (make_notify — creates per-connection callable)
- `rpc/methods/*` (all handler modules)
- `core/watcher` (watch, stop, WatchHandle)
- `core/config` (AppConfig, load_config)

## Definition of Done

- All unit tests pass
- Implementation matches the interface in `backend/app/rpc/README.md`
- Multiple clients can connect simultaneously to the same project
- File watcher starts/stops correctly with reference counting
