# Implement State Management

> Zustand stores for specs, sessions, UI, cost, and notifications

**Status:** Done
**Priority:** Critical
**Depends on:** `feature_api_client`
**Spec reference:** `frontend/src/store/README.md`

## Summary

Five independent Zustand stores manage all persistent frontend state. Each store is domain-scoped and connects to the API client for data fetching and event wiring. Ephemeral state (hover, focus, animation) stays in component-local React state.

## Files to Create

- `frontend/src/store/specStore.ts` — registry entries, graph data, spec content cache. Actions: `fetchSpecs()`, `fetchGraph()`, `fetchSpec(id)`. Wired to `spec/did*` and `registry/didUpdate` notifications.
- `frontend/src/store/sessionStore.ts` — active sessions, event logs, archived sessions. Actions: `startSession(taskId, name, specIds)`, `appendEvent(taskId, event)`, `archiveSession(taskId)`. Wired to all `agent/*` notifications.
- `frontend/src/store/uiStore.ts` — panel visibility, active tabs, viewport state, graph state, modal/palette open. Actions: `toggleLeftPanel()`, `toggleRightPanel()`, `setActiveSessionTab(taskId)`, `setRightTab(tab)`.
- `frontend/src/store/costStore.ts` — session/project cost, budget. Actions: `updateCost(taskId, cost)`, `setBudget(amount)`. Derived from `agent/done` events.
- `frontend/src/store/notificationStore.ts` — toast queue (max 5), tab badges, pending input count. Actions: `addToast(toast)`, `dismissToast(id)`, `setBadge(taskId, badge)`.
- `frontend/src/store/index.ts` — re-exports all stores

## Key Implementation Details

### Event Wiring
A `wireEvents(rpcClient)` function (called once at app bootstrap) subscribes to RPC notifications and dispatches to the appropriate store actions. This is the single place where backend events connect to frontend state.

### Session Events
`sessionStore` maintains a `Session` object per active task with an `events: AgentEvent[]` array. The Chat UI reads from this array to render the event stream.

### Persistence
- `uiStore` panel state persisted to `localStorage` (restored on reload)
- `costStore` fetches from backend on connect
- `sessionStore` is in-memory only (v1)

## Definition of Done

- [ ] All 5 stores created with typed state and actions
- [ ] Event wiring connects RPC notifications to store updates
- [ ] `specStore` auto-refreshes on `spec/did*` notifications
- [ ] `sessionStore` tracks events per active session
- [ ] `uiStore` persists panel state to localStorage
- [ ] `notificationStore` manages toast queue with auto-dismiss
- [ ] All stores are independently importable via hooks
