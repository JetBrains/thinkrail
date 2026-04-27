---
id: task-fe-api-client
type: task-spec
status: done
title: Implement API Client
depends-on:
- task-fe-project-setup
implements:
- api-client
covers:
- frontend/src/api/
tags:
- critical
- new-feature
- frontend
---
# Implement API Client

> WebSocket connection, JSON-RPC 2.0 protocol, typed method wrappers, React hooks

**Status:** Done
**Priority:** Critical
**Depends on:** `feature_project_setup`
**Spec reference:** `frontend/src/api/README.md`

## Summary

The API client is the frontend's communication layer. It manages a WebSocket connection to the backend (`/ws`), sends/receives JSON-RPC 2.0 messages, provides typed method wrappers for all `spec/*` and `agent/*` operations, and exposes React hooks for components. It also handles reconnection, event subscriptions, and error mapping.

## Files to Create

- `frontend/src/api/client.ts` — `RpcClient` class: WebSocket lifecycle, JSON-RPC message framing, request/response correlation, notification dispatch, auto-reconnection (exponential backoff, 3 attempts)
- `frontend/src/api/methods/specs.ts` — typed wrappers: `listSpecs()`, `getSpec(id)`, `createSpec(...)`, `updateSpec(...)`, `deleteSpec(id)`, `getGraph()`
- `frontend/src/api/methods/agents.ts` — typed wrappers: `runAgent(specIds, config)`, `getAgentStatus(taskId)`, `listAgents()`, `interruptAgent(taskId)`, `respondAgent(taskId, requestId, response)`
- `frontend/src/api/hooks/useRpc.ts` — `RpcProvider` context + `useRpc()` hook for accessing client
- `frontend/src/api/hooks/useSpecs.ts` — `useSpecs()`, `useSpec(id)`, `useGraph()` — auto-fetch + cache
- `frontend/src/api/hooks/useSession.ts` — `useSession(taskId)` — event stream subscription
- `frontend/src/api/types.ts` — RPC message types, error codes
- `frontend/src/api/errors.ts` — `RpcError` class, error code → message mapping (9 domain error codes)
- `frontend/src/api/index.ts` — re-exports

## Key Implementation Details

### Connection States
`disconnected` → `connecting` → `connected` → `reconnecting` → `failed`

### Server-Initiated Requests
The backend can send requests TO the client (e.g., `agent/askUserQuestion`). The client must register handlers via `onRequest(method, handler)` and send back responses with matching `id`.

### Notification Subscriptions
Components subscribe to notifications via `on(method, handler)`. Returns an unsubscribe function. Multiple handlers per method supported.

## Definition of Done

- [ ] `RpcClient` connects to backend WebSocket at `/ws`
- [ ] Outgoing requests get correlated responses (with timeout)
- [ ] Server notifications dispatched to registered handlers
- [ ] Server-initiated requests handled and responded to
- [ ] Auto-reconnection with exponential backoff works
- [ ] All `spec/*` and `agent/*` method wrappers are typed
- [ ] React hooks provide reactive data access
- [ ] Error codes mapped to meaningful messages
