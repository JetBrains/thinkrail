# API Client — Module Specification

> Parent: [Frontend Module](../../README.md) | Status: **Active** | Created: 2026-03-02 | Updated: 2026-03-05

## Purpose

The API client is the frontend's communication layer with the backend. It manages a WebSocket connection, sends/receives JSON-RPC 2.0 messages, and provides a typed method interface for all `spec/*`, `agent/*`, and `session/*` operations. It also handles reconnection, event subscriptions, and error mapping.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  React Components                                       │
│    useSpecs()  useSpec()  useGraph()  useSession()  ... │
├────────────────────────────────────────────────────────┤
│  RPC Method Layer (typed factory functions)             │
│    createSpecApi()  createAgentApi()  createSessionApi()│
├────────────────────────────────────────────────────────┤
│  RpcClient (core transport)                             │
│    request()  notify()  on()  onRequest()               │
├────────────────────────────────────────────────────────┤
│  WebSocket + JSON-RPC 2.0 protocol                      │
└────────────────────────────────────────────────────────┘
```

## File Organization

```
frontend/src/api/
├── client.ts            # RpcClient class — WebSocket + JSON-RPC core
├── errors.ts            # RpcError, RpcTimeoutError, RpcConnectionError, toRpcError
├── types.ts             # Request/response TypeScript interfaces, Unsubscribe type
├── index.ts             # Barrel export + singleton getClient/setClient
├── methods/
│   ├── index.ts         # Re-exports all method factories
│   ├── specs.ts         # spec/* methods
│   ├── agents.ts        # agent/* methods
│   └── sessions.ts      # session/* methods
└── hooks/
    ├── useRpc.tsx        # RpcProvider, useRpc(), useConnectionState()
    ├── useSpecs.ts       # useSpecs(), useSpec(), useGraph()
    ├── useSession.ts     # useSession() — per-session live event stream
    └── useCost.ts        # useCost() — stub
```

**Not implemented:** `methods/cost.ts`, `methods/diff.ts`, `methods/terminal.ts`, separate `hooks/useGraph.ts`

## Singleton Accessor (index.ts)

```typescript
setClient(client: RpcClient): void;  // set once at app startup
getClient(): RpcClient;              // throws if not set
```

Used by `wireEvents` and non-React code.

## RpcClient

### Constructor

```typescript
class RpcClient {
  constructor(url: string, options?: Partial<RpcClientOptions>);
}

interface RpcClientOptions {
  autoReconnect: boolean;        // default: true
  maxReconnectAttempts: number;  // default: 3
  reconnectBackoff: number[];    // default: [1000, 2000, 4000]
  requestTimeout: number;        // default: 30000
}
```

### Connection States

```typescript
type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
```

Auto-reconnect: exponential backoff (1s, 2s, 4s), max 3 attempts. Close code 4000 (replaced by another client) skips auto-reconnect. After exhaustion → `failed` state.

### Public Interface

```typescript
class RpcClient {
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;

  readonly state: ConnectionState;
  onStateChange(callback: (state: ConnectionState) => void): Unsubscribe;

  request<T>(method: string, params?: object): Promise<T>;
  notify(method: string, params?: object): void;
  on(method: string, handler: (params: unknown) => void): Unsubscribe;
  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): Unsubscribe;
}
```

- `request()` rejects with `RpcConnectionError` if not connected
- `notify()` is a no-op if not connected
- Outgoing requests use auto-incrementing integer IDs

### Message Dispatch

1. **Response (has id, result)** → resolve pending request
2. **Error response (has id, error)** → reject with `toRpcError(error)`
3. **Server request (has id AND method)** → call `onRequest` handler if registered; else fall through to `on()` handlers
4. **Notification (method only)** → dispatch to `on()` handlers

**Note:** `agent/askUserQuestion` and `agent/confirmAction` arrive as server requests (with `id`), but no `onRequest` handler is registered. They fall through to `on()` handlers in `wireEvents`. Responses are sent via `agent/respond` RPC method.

## Method Wrappers

### specs.ts

```typescript
createSpecApi(client: RpcClient) => {
  list: () => Promise<RegistryEntry[]>;        // "spec/list"
  get: (id: string) => Promise<SpecDetail>;    // "spec/get"
  create: (params) => Promise<SpecDetail>;     // "spec/create"
  update: (id, content) => Promise<SpecDetail>;// "spec/update"
  delete: (id: string) => Promise<null>;       // "spec/delete"
  graph: () => Promise<SpecGraph>;             // "spec/graph"
}
```

### agents.ts

```typescript
createAgentApi(client: RpcClient) => {
  run: (params) => Promise<{ taskId: string }>; // "agent/run"
  status: (taskId) => Promise<AgentTask>;        // "agent/status"
  list: () => Promise<AgentTask[]>;              // "agent/list"
  send: (taskId, text) => Promise<null>;         // "agent/send"
  end: (taskId) => Promise<null>;                // "agent/end"
  interrupt: (taskId) => Promise<null>;          // "agent/interrupt"
  respond: (taskId, requestId, response) => Promise<null>;  // "agent/respond"
  updateConfig: (taskId, config) => Promise<{ model, permissionMode }>;  // "agent/updateConfig"
}
```

### sessions.ts

```typescript
createSessionApi(client: RpcClient) => {
  list: () => Promise<SessionSummary[]>;                  // "session/list"
  get: (taskId) => Promise<SessionData | null>;          // "session/get"
  continue: (taskId) => Promise<{ taskId: string }>;     // "session/continue"
  delete: (taskId) => Promise<boolean>;                  // "session/delete"
}
```

`SessionSummary` and `SessionData` types are defined locally in `methods/sessions.ts`.

## Error Handling

```typescript
class RpcError extends Error { code: number; data?: unknown; }
class RpcTimeoutError extends RpcError {}     // code: -32000
class RpcConnectionError extends RpcError {}  // code: -32001
```

### Error Code Mapping

| Code | Message |
|---|---|
| -32700 | Protocol error: invalid JSON |
| -32601 | Unknown method |
| -32602 | Invalid request parameters |
| -32603 | Server error |
| -32001 | Spec not found |
| -32002 | Registry error |
| -32003 | Validation error |
| -32011 | Agent task not found |
| -32012 | No pending request |

## React Hooks

### useRpc (hooks/useRpc.tsx)

```typescript
function RpcProvider(props: { url, options?, children }): JSX.Element;
function useRpc(): RpcClient;
function useConnectionState(): ConnectionState;
```

`RpcProvider` creates client once via `useRef`, connects on mount. Does not disconnect on cleanup (long-lived).

### useSpecs (hooks/useSpecs.ts)

```typescript
function useSpecs(): { specs, loading, error, refetch };
function useSpec(id: string | null): { spec, loading, error };
function useGraph(): { graph, loading, error, refetch };
```

- `useSpecs` and `useGraph` subscribe to `spec/didChange`, `spec/didCreate`, `spec/didDelete`, `registry/didUpdate` and re-fetch on any notification
- `useSpec` fetches once per `id` change — no reactive update on spec changes

### useSession (hooks/useSession.ts)

```typescript
function useSession(taskId: string | null): { events, status, metrics };
```

Subscribes to streaming `agent/*` events filtered by `taskId`. Does **not** handle `askUserQuestion`, `confirmAction`, `interrupted`, `turnComplete`, `configChanged` — those go through `wireEvents`.

### useCost (hooks/useCost.ts) — Stub

Returns `{ summary: null, loading: false }`. No RPC calls.

## Known Limitations

- **Single connection** — close code 4000 signals server-side replacement
- **No request queuing during reconnect** — requests fail immediately
- **No message compression**
- **`useSpec` has no live update** — fetches once, doesn't re-fetch on changes
- **cost/*, diff/*, terminal/* not implemented**

## Related Specs

- **Parent:** [Frontend Module](../../README.md)
- **Depends on:** [RPC Module](../../../backend/app/rpc/README.md) (protocol, methods, error codes)
- **Related:** [State Management](../store/README.md) (wireEvents wires RPC events to stores)
