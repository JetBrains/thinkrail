# API Client — Module Specification

> Parent: [Frontend Module](../../README.md) | Status: **Active** | Created: 2026-03-02

## Purpose

The API client is the frontend's communication layer with the backend. It manages a WebSocket connection, sends/receives JSON-RPC 2.0 messages, and provides a typed method interface for all `spec/*` and `agent/*` operations. It also handles reconnection, event subscriptions, and error mapping.

## Internal Architecture

```
┌────────────────────────────────────────────────────────┐
│  React Components                                       │
│    useSpecs()  useSessions()  useGraph()  ...           │
├────────────────────────────────────────────────────────┤
│  RPC Method Layer (typed wrappers)                      │
│    specApi.list()  agentApi.run()  costApi.summary()   │
├────────────────────────────────────────────────────────┤
│  RpcClient (core transport)                             │
│    send()  subscribe()  request()                       │
├────────────────────────────────────────────────────────┤
│  WebSocket + JSON-RPC 2.0 protocol                      │
│    connect()  reconnect()  heartbeat                    │
└────────────────────────────────────────────────────────┘
```

Three layers:
1. **RpcClient** — low-level WebSocket transport + JSON-RPC message handling
2. **Method wrappers** — typed functions per RPC method (specApi, agentApi, costApi)
3. **React hooks** — subscribe to events and call methods from components

## File Organization

```
frontend/src/api/
├── client.ts            # RpcClient class — WebSocket + JSON-RPC core
├── methods/
│   ├── specs.ts         # spec/list, spec/get, spec/create, etc.
│   ├── agents.ts        # agent/run, agent/status, agent/respond, etc.
│   ├── cost.ts          # cost/summary, cost/setBudget, cost/reset
│   ├── diff.ts          # diff/mappings, diff/commit, diff/scan
│   └── terminal.ts      # terminal/create, terminal WebSocket
├── hooks/
│   ├── useRpc.ts        # Core hook: provides RpcClient instance
│   ├── useSpecs.ts      # spec/list cache + spec/did* subscriptions
│   ├── useGraph.ts      # spec/graph cache + registry/didUpdate
│   ├── useSession.ts    # agent/* event subscriptions per session
│   └── useCost.ts       # cost/summary polling + budget state
├── types.ts             # Request/response TypeScript interfaces
└── errors.ts            # Error classes and mapping
```

## RpcClient

### Constructor

```typescript
class RpcClient {
  constructor(url: string, options?: RpcClientOptions);
}

interface RpcClientOptions {
  autoReconnect: boolean;        // default: true
  maxReconnectAttempts: number;  // default: 3
  reconnectBackoff: number[];    // default: [1000, 2000, 4000] (ms)
  requestTimeout: number;        // default: 30000 (ms)
}
```

### Connection Lifecycle

```
DISCONNECTED → CONNECTING → CONNECTED → DISCONNECTED
                    ↑                        │
                    └── RECONNECTING ←───────┘ (auto, up to 3 times)
                            │
                            └── FAILED (show manual reconnect)
```

| State | Description |
| --- | --- |
| `disconnected` | No connection. Initial state or after manual disconnect. |
| `connecting` | WebSocket handshake in progress. |
| `connected` | Ready to send/receive messages. |
| `reconnecting` | Auto-reconnecting after unexpected close. Attempt N of 3. |
| `failed` | All auto-reconnect attempts exhausted. Manual intervention required. |

### Reconnection Strategy

**Auto + manual fallback:**

1. On unexpected WebSocket close → attempt auto-reconnect
2. Exponential backoff: 1s, 2s, 4s (configurable via `reconnectBackoff`)
3. Max 3 auto-attempts
4. After 3 failures → transition to `failed` state
5. UI shows "Disconnected" banner with "Reconnect" button
6. User clicks → resets attempt counter, starts fresh connection

**On reconnect success:**
- Re-subscribe to all active event listeners
- Fetch fresh data (`spec/list`, `spec/graph`, `agent/list`)
- Resume any pending requests with timeout errors

### Public Interface

```typescript
class RpcClient {
  // Connection
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;

  // State
  readonly state: ConnectionState;
  onStateChange(callback: (state: ConnectionState) => void): Unsubscribe;

  // JSON-RPC requests (client → server)
  request<T>(method: string, params?: Record<string, any>): Promise<T>;

  // JSON-RPC notifications (client → server, no response)
  notify(method: string, params?: Record<string, any>): void;

  // Subscribe to server → client notifications
  on(method: string, handler: (params: any) => void): Unsubscribe;

  // Subscribe to server → client requests (agent/askUserQuestion, etc.)
  onRequest(method: string, handler: (params: any) => Promise<any>): Unsubscribe;
}
```

### Message Handling

**Outgoing requests:**

```typescript
async request<T>(method: string, params?: object): Promise<T> {
  const id = generateId();  // incrementing integer or UUID
  const message = { jsonrpc: "2.0", id, method, params: params ?? {} };

  return new Promise((resolve, reject) => {
    // Store pending request
    this.pending.set(id, { resolve, reject, timer: setTimeout(() => {
      this.pending.delete(id);
      reject(new RpcTimeoutError(method));
    }, this.options.requestTimeout) });

    this.ws.send(JSON.stringify(message));
  });
}
```

**Incoming message dispatch:**

```typescript
// On WebSocket message:
const msg = JSON.parse(data);

if (msg.id !== undefined && msg.result !== undefined) {
  // Response to our request
  const pending = this.pending.get(msg.id);
  if (pending) { clearTimeout(pending.timer); pending.resolve(msg.result); }
} else if (msg.id !== undefined && msg.error !== undefined) {
  // Error response to our request
  const pending = this.pending.get(msg.id);
  if (pending) { clearTimeout(pending.timer); pending.reject(toRpcError(msg.error)); }
} else if (msg.id !== undefined && msg.method !== undefined) {
  // Server-initiated request (agent/askUserQuestion, etc.)
  const handler = this.requestHandlers.get(msg.method);
  if (handler) {
    const result = await handler(msg.params);
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
  }
} else if (msg.method !== undefined) {
  // Server notification (agent/textDelta, spec/didChange, etc.)
  const handlers = this.notificationHandlers.get(msg.method);
  handlers?.forEach(h => h(msg.params));
}
```

## Method Wrappers

Typed functions that call `client.request()` with correct types:

### specs.ts

```typescript
export function createSpecApi(client: RpcClient) {
  return {
    list: () => client.request<RegistryEntry[]>("spec/list"),
    get: (id: string) => client.request<SpecDetail>("spec/get", { id }),
    create: (params: CreateSpecParams) => client.request<SpecDetail>("spec/create", params),
    update: (id: string, content: string) => client.request<SpecDetail>("spec/update", { id, content }),
    delete: (id: string) => client.request<null>("spec/delete", { id }),
    graph: () => client.request<SpecGraph>("spec/graph"),
  };
}
```

### agents.ts

```typescript
export function createAgentApi(client: RpcClient) {
  return {
    run: (params: AgentRunParams) => client.request<{ taskId: string }>("agent/run", params),
    status: (taskId: string) => client.request<AgentTask>("agent/status", { taskId }),
    list: () => client.request<AgentTask[]>("agent/list"),
    interrupt: (taskId: string) => client.request<null>("agent/interrupt", { taskId }),
    respond: (taskId: string, requestId: string, response: any) =>
      client.request<null>("agent/respond", { taskId, requestId, response }),
  };
}
```

## Error Handling

### Error Classes

```typescript
class RpcError extends Error {
  code: number;
  data?: any;
}

class RpcTimeoutError extends RpcError {
  constructor(method: string) { super(`Request timeout: ${method}`); this.code = -32000; }
}

class RpcConnectionError extends RpcError {
  constructor() { super("Not connected"); this.code = -32001; }
}
```

### Error Code Mapping

| Backend Code | Frontend Error | User Message |
| --- | --- | --- |
| -32001 | `SpecNotFoundError` | "Spec not found" |
| -32002 | `RegistryError` | "Registry error" |
| -32003 | `ValidationError` | "Validation error" |
| -32011 | `AgentTaskNotFoundError` | "Agent task not found" |
| -32602 | `InvalidParamsError` | "Invalid request" |
| -32603 | `InternalError` | "Server error" |
| -32700 | `ParseError` | "Protocol error" |
| -32601 | `MethodNotFoundError` | "Unknown method" |

### Connection Error UI

| State | UI Element |
| --- | --- |
| `connecting` | Subtle "Connecting..." in status bar |
| `reconnecting` | Yellow banner: "Reconnecting... (attempt N/3)" |
| `failed` | Red banner: "Disconnected — [Reconnect]" |

## React Hooks

### useRpc

Provides the RpcClient instance via React Context:

```typescript
function useRpc(): RpcClient;

// Provider at app root:
<RpcProvider url="ws://localhost:8000/ws">
  <App />
</RpcProvider>
```

### useSpecs

Cached spec list with live updates:

```typescript
function useSpecs(): {
  specs: RegistryEntry[];
  loading: boolean;
  error: RpcError | null;
  refetch: () => void;
};
```

- Fetches `spec/list` on mount
- Subscribes to `spec/didChange`, `spec/didCreate`, `spec/didDelete`, `registry/didUpdate`
- Re-fetches on any notification
- Returns cached data between fetches

### useSession

Per-session event stream:

```typescript
function useSession(taskId: string): {
  events: AgentEvent[];
  status: SessionStatus;
  metrics: SessionMetrics;
};
```

- Subscribes to all `agent/*` events filtered by `taskId`
- Accumulates events in order
- Computes derived metrics (tool call count, cost, context usage)

## Dependencies

| Dependency | Usage |
| --- | --- |
| None (built-in WebSocket) | Transport layer |
| React (Context API) | Provider pattern for RpcClient |
| Zustand (via store layer) | Event accumulation, caching |

No external JSON-RPC library needed — the protocol is simple enough to implement in ~100 lines.

## Known Limitations

- **Single connection:** Matches backend constraint (one WebSocket at a time)
- **No request queuing during reconnect:** Requests made while disconnected fail immediately with `RpcConnectionError`
- **No message compression:** JSON messages sent as plain text (sufficient for localhost)
- **Request timeout is global:** Same timeout for all methods; long-running operations (agent/run) return immediately with taskId, so this is fine

## Related Specs

- **Parent:** [Frontend Module](../../README.md)
- **Depends on:** [RPC Module](../../../backend/app/rpc/README.md) (protocol, methods, error codes)
- **Related:** [State Management](../store/README.md) (event wiring), [Chat UI](../../ui-specs/CHAT_UI.md) (consumes agent events)
