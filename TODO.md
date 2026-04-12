# TODO: Multi-Client Spec Alignment

Post-implementation alignment items from the multi-client EventBus refactor (2026-04-12).
All three phases are implemented and tested. These items track spec/doc alignment and polish.

## Spec Alignment (stale docs referencing old single-client patterns)

- [ ] **`current_tasks/rpc/feature_rpc_server.md`** — References "single active connection", `current_notify`, "replace on second connect". Update to describe multi-client EventBus, per-project watcher, ClientConnection registration. (HIGH)
- [ ] **`current_tasks/rpc/feature_rpc_methods_agents_run.md`** — Documents old `run_task(notify)` signature and `current_notify` capture. Update to show EventBus-based publishing, no notify param. (HIGH)
- [ ] **`current_tasks/rpc/feature_rpc_notifications.md`** — Documents `current_notify` module variable as if it still exists. Update to note removal, `make_notify` is now internal to EventBus. (MEDIUM)
- [ ] **`features/DRAFT_SESSION_DESIGN.md`** — Line 238 references old `run_task()` signature indirectly. Minor update. (LOW)

## Agent Module Spec

- [x] **`backend/app/agent/README.md`** — Removed `rebind_notify`, updated `run_task`/`continue_session`/`restart_session` signatures, added multi-client note. (DONE)

## RPC Module Spec

- [x] **`backend/app/rpc/README.md`** — Updated architecture diagrams, connection management, watcher, methods, notifications, design decisions, known limitations. (DONE)

## Registry & Task Specs

- [ ] Create task spec for multi-client feature in `current_tasks/rpc/` following existing pattern
- [ ] Update `.bonsai/registry.json` if multi-client specs should be tracked

## Frontend Alignment

- [ ] Verify mobile KMP `RpcClient.kt` can pass `?token=` parameter on connect
- [ ] Add token management UI to web frontend settings page (token input, localStorage persistence)
- [ ] Add token field to mobile Connect screen
- [ ] Test `session/subscribe` / `session/unsubscribe` from mobile navigation lifecycle

## Testing Gaps

- [ ] Integration test: two WebSocket connections to same project, verify both receive events
- [ ] Integration test: token auth rejection (invalid token with `allowAnonymous: false`)
- [ ] Frontend vitest: `connectionStore` presence tracking (onClientJoin/Leave)
- [ ] Frontend vitest: `onRemoteSessionCreated` populates session correctly
- [ ] Frontend vitest: `onRemoteUserMessage` dedup logic

## Polish & Edge Cases

- [ ] Handle `connection/didLeave` notification reaching clients after the leaving client's events stop (timing)
- [ ] Consider adding `session/didEnd` notification on project topic when session reaches done/error
- [ ] Verify presence indicator updates correctly when a tab is closed (not just refresh)
- [ ] Test behavior when all clients disconnect and reconnect during a running agent session
- [ ] Consider persisting `createdBy` to session metadata on disk (`.bonsai/sessions/*.json`)
