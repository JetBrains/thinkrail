# Implement RPC EventBus: Multi-Client Notification Routing

> Central pub/sub with ring buffers, replay, dead-connection sweep

**Status:** Done
**Priority:** High
**Started:** 2026-04-12
**Spec reference:** `backend/app/rpc/README.md`

## Files

- `backend/app/rpc/bus.py` — EventBus singleton
- `backend/app/rpc/connections.py` — ClientConnection dataclass + `current_conn_id` context var
- `backend/app/rpc/auth.py` — Token-based authentication
- `backend/app/rpc/methods/auth.py` — Auth RPC handlers (`auth/createToken`, `auth/listUsers`, `connection/list`)
- `backend/tests/rpc/test_bus.py` — EventBus unit tests
- `backend/tests/rpc/test_auth.py` — Auth unit tests

## Summary

The EventBus replaces the old `current_notify` module-level singleton with a proper pub/sub system supporting multiple simultaneous WebSocket clients. All server→client notifications flow through the bus. Services publish events to topics; the bus fans out to subscribed connections.

## Architecture

### Topics
- `project:{path}` — file changes, spec updates, vis state, board changes, connection presence
- `session:{bonsai_sid}` — agent streaming events, interactive requests, multi-client sync

### EventBus (`bus.py`)
Module-level singleton (`bus = EventBus()`), imported everywhere.

**Connection lifecycle:**
- `register(conn)` / `unregister(conn_id)` — add/remove connections
- `get_connection(conn_id)` / `connections_for_project(path)` — lookups

**Subscriptions:**
- `subscribe(conn_id, topic)` / `unsubscribe(conn_id, topic)` — manage per-connection subscriptions
- `subscribers(topic)` — return set of subscribed conn_ids

**Publishing:**
- `publish(topic, method, params, request_id?, source_user?)` — fan out to all subscribers
- `publish_to_project(path, method, params)` — convenience for project topic
- `publish_to_session(sid, method, params, ...)` — convenience for session topic

**Ring buffer replay:**
- Per-topic `deque(maxlen=200)` stores recent events
- `replay(conn_id, topic, since)` — replay events newer than timestamp to a single connection
- `cleanup_topic(topic)` — remove buffer and subscriptions when session ends

**Dead-connection sweep:**
- Background asyncio task runs every 60s
- Checks `WebSocketState.CONNECTED`; removes dead connections via `unregister()`
- `start_sweep()` / `stop_sweep()` control the task

### ClientConnection (`connections.py`)
Dataclass tracking a single WebSocket connection:
- `conn_id`, `user_id`, `display_name`, `ws`, `notify`, `project_path`, `connected_at`, `subscriptions`

### `current_conn_id` context var
Set during RPC dispatch in `server.py` so handlers can identify the calling connection without changing method signatures.

### Authentication (`auth.py`)
- `generate_token()` — creates `bns_*` tokens
- `load_users(project_path)` — reads `.bonsai/users.json`
- `authenticate(project_path, token)` — returns `Identity` or `None`
- `ANONYMOUS` sentinel for unauthenticated access (when `allowAnonymous: true` or no users file)

## Multi-Client Sync Events

| Event | Topic | Description |
|-------|-------|-------------|
| `connection/didJoin` | project | New client connected |
| `connection/didLeave` | project | Client disconnected |
| `session/didCreate` | project | New session created (by any client) |
| `session/userMessage` | session | User sent a message (from another client) |
| `agent/requestResolved` | session | Interactive request resolved (first-responder-wins) |

## Phase 1 Design Decisions

| Decision | Rationale |
|----------|-----------|
| Broadcast-all (no per-client filtering) | Simplest model for Phase 1; Phase 3 adds explicit subscriptions |
| Module-level singleton | Single import, no DI needed; testable via `bus._connections.clear()` |
| Ring buffer (200 events/topic) | Bounded memory; handles reconnect gaps; events also persisted to disk |
| `current_conn_id` ContextVar | No signature changes needed in RPC handlers |
| First-responder-wins | `asyncio.Future.set_result()` once-only; second responder gets `-32013` |

## Test Coverage (`test_bus.py`)

- Registration & lifecycle (3 tests)
- Subscriptions (4 tests)
- Publishing & fan-out (7 tests)
- Buffering & replay (6 tests)
- Dead-connection sweep (2 tests)
- Multi-client scenarios (3 tests)

## Definition of Done

- All unit tests pass (`test_bus.py`, `test_auth.py`)
- Multiple clients receive events simultaneously
- Ring buffer replay works on reconnect
- Dead connections cleaned up automatically
