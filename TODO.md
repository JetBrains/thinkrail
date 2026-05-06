# TODO: Multi-Client Spec Alignment

Post-implementation alignment items from the multi-client EventBus refactor (2026-04-12).
All three phases are implemented and tested. These items track spec/doc alignment and polish.

> **Historical note (2026-05-04):** Several items below describe the token-based auth layer (`bonsai_token`, `TokenDialog`, mobile `?token=` parameter, token-rejection tests). That entire layer was **removed** by the auth-removal cleanup (`mt_a939c33a`). The checked-off items are kept as a log of what was once built; do not implement against them.

## Spec Alignment (stale docs referencing old single-client patterns)

- [x] **`.bonsai/implementation_tasks/rpc/feature_rpc_server.md`** — Updated to describe multi-client EventBus, per-project watcher, ClientConnection registration.
- [x] **`.bonsai/implementation_tasks/rpc/feature_rpc_methods_agents_run.md`** — Updated to show EventBus-based publishing, no notify param.
- [x] **`.bonsai/implementation_tasks/rpc/feature_rpc_notifications.md`** — Updated to note `current_notify` removal, `make_notify` is internal to EventBus.
- [x] **`.bonsai/design_docs/DRAFT_SESSION_DESIGN.md`** — Updated `run_task()` note to mention EventBus routing.

## Agent Module Spec

- [x] **`backend/app/agent/README.md`** — Removed `rebind_notify`, updated `run_task`/`continue_session`/`restart_session` signatures, added multi-client note. (DONE)

## RPC Module Spec

- [x] **`backend/app/rpc/README.md`** — Updated architecture diagrams, connection management, watcher, methods, notifications, design decisions, known limitations. (DONE)

## Registry & Task Specs

- [x] Created task spec `.bonsai/implementation_tasks/rpc/feature_rpc_event_bus.md` documenting EventBus, connections, auth
- [x] Registry check — task specs are not tracked in `.bonsai/registry.json` (only module-level specs). No update needed.

## Frontend Alignment

- [x] Mobile KMP `RpcClient.kt` passes `?token=` parameter on connect
- [x] Token management UI added to web frontend (TokenDialog in Header, localStorage persistence, token appended to WS URL)
- [x] Token field added to mobile Connect screen (input, storage, threading through navigation)
- [x] `session/subscribe` / `session/unsubscribe` called from mobile SessionDetailComponentImpl lifecycle

## Testing Gaps

- [x] Integration test: two WebSocket connections to same project, verify both register and can make RPC calls
- [x] Integration test: token auth rejection (invalid token with `allowAnonymous: false` closes WebSocket)
- [x] Frontend vitest: `connectionStore` presence tracking (onClientJoin/Leave, dedup, unknown leave)
- [x] Frontend vitest: `onRemoteSessionCreated` populates session correctly (new + update)
- [x] Frontend vitest: `onRemoteUserMessage` dedup logic (same text skipped, different text appended)

## Polish & Edge Cases

- [x] `connection/didLeave` timing — already correct: published before `bus.unregister()`, so remaining clients receive it first
- [x] Added `session/didEnd` notification on project topic when session reaches done/error (published from AgentService, wired in frontend wireEvents)
- [x] Presence indicator on tab close — already correct: browser WebSocket disconnect triggers server-side cleanup
- [x] Reconnect during running agent — already supported via ring buffer replay with `?last_seen=` query param
- [x] `createdBy` persisted to session metadata on disk (added `created_by` field to AgentTask, set from connection identity, saved in `_save_task`)
