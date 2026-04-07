# State Management — Module Specification

> Parent: [Frontend Module](../../README.md) | Status: **Active** | Created: 2026-03-02 | Updated: 2026-03-05

## Purpose

Centralized state management for the Bonsai frontend using **Zustand**. Defines the global state shape, store organization, and data flow patterns. All persistent UI state lives in Zustand stores; ephemeral state (hover, focus, animation) stays in component-local React state.

## Library Choice: Zustand

| Factor | Assessment |
|---|---|
| Bundle size | ~1KB gzipped |
| Boilerplate | Minimal — no providers, reducers, or action creators |
| React integration | Hook-based: `useStore(selector)` with automatic re-render optimization |
| Middleware | `persist` from `zustand/middleware` used in `uiStore` and `notificationStore` |
| DevTools | Not currently used (plain `create()` calls) |

## File Organization

```
frontend/src/store/
├── index.ts               # Re-exports all stores and wireEvents
├── specStore.ts           # Spec data, graph, registry
├── sessionStore.ts        # Active sessions, events, archived sessions
├── uiStore.ts             # Panel visibility, active tabs, modal state
├── costStore.ts           # Cost tracking stub (backend not implemented)
├── notificationStore.ts   # Toast queue, tab badges, pending input count
├── fileStore.ts           # Open file tabs, preview tab, editor state
└── wireEvents.ts          # RPC event → store action wiring
```

**Note:** `fileStore.ts` exists and is implemented, but is not re-exported from `index.ts`. It must be imported directly.

## Store Architecture

```
┌─────────────────────────────────────────────────┐
│  React Components                                │
│   useSpecStore()  useSessionStore()  useUiStore() │
│   useNotificationStore()  useFileStore()          │
│   useCostStore() (stub)                           │
├─────────────────────────────────────────────────┤
│  Zustand Stores (6 stores)                       │
│    specStore  sessionStore  uiStore              │
│    costStore  notificationStore  fileStore       │
├─────────────────────────────────────────────────┤
│  API Client (data source)                        │
│    RPC responses → store actions                 │
│    RPC events (via wireEvents) → store actions   │
│    REST fetch (fileStore) → /api/file/*          │
└─────────────────────────────────────────────────┘
```

## Type Definitions

### From `frontend/src/types/agent.ts`

```typescript
export type TaskStatus = "idle" | "running" | "done" | "error";

export type EventType =
  | "sessionStart" | "textDelta" | "toolCallStart" | "toolCallEnd"
  | "turnComplete" | "interrupted" | "subagentStart" | "subagentEnd"
  | "notification" | "compact" | "progress" | "done" | "error"
  | "permissionDenied" | "askUserQuestion" | "confirmAction"
  | "suggestSession" | "userMessage";

export interface AgentConfig {
  model: string;
  maxTurns: number;
  permissionMode: string;
  streamText: boolean;
}

export interface AgentEvent {
  bonsaiSid: string;
  sessionId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
}
```

### From `frontend/src/types/session.ts`

```typescript
export type SessionStatus = "draft" | "initializing" | "idle" | "running" | "waiting" | "done" | "error" | "interrupted";

/** Token usage for a single API call within a turn. */
export interface IterationUsage {
  type: "message" | "compaction";
  inputTokens: number;         // fresh (non-cached) input
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation?: {
    ephemeral5mInputTokens: number;
    ephemeral1hInputTokens: number;
  };
}

export interface TurnUsage {
  turnIndex: number;
  inputTokens: number;         // fresh input from last iteration
  outputTokens: number;        // output from last iteration
  cacheCreationTokens: number; // cache create from last iteration
  cacheReadTokens: number;     // cache read from last iteration
  totalContextTokens: number;  // last iteration total (= input + cacheRead + cacheCreate + output)
  costUsd: number;
  timestamp: number;
  sdkTurns: number;            // SDK internal turns (tool-use loops)
  iterations?: IterationUsage[];
}

export interface ContextUsage {
  contextMax: number;
  contextTokens: number;       // context window occupancy (from last iteration)
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;         // fresh input only (non-cached)
  turnHistory: TurnUsage[];
  runBoundaries: number[];     // indices where session resumed
  toolCallCounts: Record<string, number>;
  toolTokens: Record<string, { inputTokens: number; outputTokens: number }>;
  filesRead: string[];
  filesWritten: string[];
}
// Invariant: inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens == contextTokens

export interface SessionMetrics {
  costUsd: number;
  turns: number;
  toolCalls: number;
  contextTokens: number;
  contextMax: number;
  durationMs: number;
  filesChanged: Record<string, "created" | "modified" | "deleted">;
  contextUsage: ContextUsage;
}

export interface PendingRequest {
  requestId: string;
  type: "question" | "approval" | "suggestion";
  questions?: Question[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
  // SuggestSession fields (when type === "suggestion")
  skill?: string;
  specIds?: string[];
  name?: string;
  reason?: string;
}

export interface Session {
  bonsaiSid: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  filePaths: string[];             // attached file paths (relative to project root)
  status: SessionStatus;          // includes "draft" | "initializing" | "waiting"
  model: string;
  permissionMode: string;
  betas: string[];
  effort: string | null;
  maxTurns: number;
  metaTicketId?: string | null;
  startedAt: number;
  events: AgentEvent[];
  metrics: SessionMetrics;
  pendingRequest: PendingRequest | null;
  answeredRequests: Map<string, unknown>;
  systemPrompt?: string;           // full assembled prompt; restored from sessionStart event
  promptSections?: PromptSection[] | null;  // structured sections (in-memory only, not persisted)
  restored?: boolean;
}

export interface ArchivedSession {
  bonsaiSid: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  startedAt: number;
  endedAt: number;
  result: "done" | "error";
  costUsd: number;
  turns: number;
  durationMs: number;
  model: string;
  config: AgentConfig;
  events: AgentEvent[];
}
```

## Store Definitions

### 1. specStore

Spec data, graph, and registry cache. Plain Zustand, no middleware.

```typescript
interface SpecStore {
  specs: RegistryEntry[];
  graph: SpecGraph | null;
  specContent: Map<string, string>;
  loading: boolean;
  error: string | null;
  selectedSpecId: string | null;

  fetchSpecs: () => Promise<void>;
  fetchGraph: () => Promise<void>;
  fetchSpecContent: (id: string) => Promise<string>;
  selectSpec: (id: string | null) => void;

  // Event handlers (called by wireEvents)
  onSpecChanged: (id: string) => void;
  onSpecCreated: (id: string, path: string) => void;
  onSpecDeleted: (id: string) => void;
  onRegistryUpdated: () => void;
}
```

**Initial state:** `{ specs: [], graph: null, specContent: new Map(), loading: false, error: null, selectedSpecId: null }`

**Key behaviors:**
- `fetchSpecContent` checks in-memory cache first; only calls `spec/get` on miss
- `onSpecChanged` evicts cached content and calls `fetchGraph()`
- `onSpecDeleted` removes from `specs[]`, evicts cache, deselects if needed, calls `fetchGraph()`

---

### 2. sessionStore

Active sessions, streaming events, and archived history. Plain Zustand, no middleware.

```typescript
interface SessionStore {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  archivedSessions: ArchivedSession[];
  openTabs: Set<string>;  // which sessions have a visible tab

  // User-initiated actions
  startSession: (params: { specIds, config, name, skillId?, filePaths? }) => Promise<string>;
  sendMessage: (bonsaiSid: string, text: string) => Promise<void>;
  switchSession: (bonsaiSid: string) => void;
  closeSession: (bonsaiSid: string) => void;
  endSession: (bonsaiSid: string) => Promise<void>;
  interruptSession: (bonsaiSid: string) => Promise<void>;
  openTab: (bonsaiSid: string) => void;
  resolveRequest: (bonsaiSid: string, requestId: string, response: unknown) => void;
  updateConfig: (bonsaiSid: string, config: { model?, permissionMode? }) => Promise<void>;
  restoreSession: (bonsaiSid: string) => Promise<void>;

  // Event handlers (called by wireEvents)
  onSessionStart: (params) => void;
  onAgentEvent: (method: string, params) => void;
  onAskQuestion: (params) => void;
  onConfirmAction: (params) => void;
  onSuggestSession: (params: { bonsaiSid: string; skill: string; specIds: string[]; name: string; reason: string; requestId: string }) => void;
  onSessionDone: (params) => void;
  onSessionError: (params) => void;
  onConfigChanged: (params) => void;
}
```

**Initial state:** `{ sessions: new Map(), activeSessionId: null, archivedSessions: [] }`

**Key behaviors:**
- `sendMessage` optimistically appends `userMessage` event and sets status to `"running"`
- `closeSession` removes from `openTabs` (no END_SIGNAL). Live sessions stay in `sessions` map as background. Terminal sessions (done/error) get archived.
- `endSession` sends END_SIGNAL to backend, terminates the session
- `openTab` adds a session to `openTabs` and activates it (e.g., from background indicator dropdown)
- `resolveRequest` calls `agent/respond` RPC, stores in `answeredRequests`, clears `pendingRequest`
- `restoreSession` loads from backend, marks all question/approval events as answered with `{ historical: true }`, sets `status: "done"` and `restored: true`, extracts `systemPrompt` from the persisted `sessionStart` event payload
- `loadActiveSessions` similarly extracts `systemPrompt` from the `sessionStart` event (or from `entry.systemPrompt` for drafts) when building Session objects from persistence
- `onSuggestSession` stores suggestion params in `pendingRequest` as `{type: "suggestion", skill, specIds, name, reason, requestId}` and appends a `suggestSession` event
- `onAgentEvent` is the generic handler for all streaming events; increments `toolCalls` on `toolCallEnd`, updates metrics on `turnComplete`/`interrupted`. On `costEstimate` events, updates live context window from `currentContextWindow` and per-iteration breakdown (`iterInputTokens`, `iterCacheRead`, `iterCacheCreate`, `iterOutputTokens`) — not persisted, only for live UI display.
- `onSessionDone` only updates cost, status, and duration — preserves context data from the last `turnComplete` (the `agent/done` event carries no usage data)
- `onSessionError` with `subtype === "turn_error"` sets status to `"idle"` (recoverable); other subtypes set `"error"` (terminal)
- `ensureSession()` internal helper creates placeholder if events arrive before `startSession()` resolves
- `archivedSessions` is **not persisted** to localStorage — lost on page refresh

---

### 3. uiStore

Panel visibility, palette state, project identity. Uses `persist` middleware.

```typescript
type LeftTab = "specs" | "files" | "progress";
type Breakpoint = "desktop" | "laptop" | "below-min";

interface UiStore {
  projectPath: string | null;
  projectName: string;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  leftActiveTab: LeftTab;
  paletteOpen: boolean;
  viewportWidth: number;
  breakpoint: Breakpoint;

  setProject: (path: string) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftTab: (tab: LeftTab) => void;
  togglePalette: () => void;
  updateViewport: (width: number) => void;
}
```

**Persistence key:** `"bonsai-ui"`. Persisted fields: `{ leftPanelCollapsed, rightPanelCollapsed, leftActiveTab }`.

**Breakpoint thresholds:** `≥1280` → desktop, `≥1024` → laptop, else → below-min.

---

### 4. costStore

**Stub — all actions are no-ops.** Plain Zustand, no middleware.

```typescript
interface CostStore {
  summary: CostSummary | null;
  loading: boolean;

  fetchSummary: () => Promise<void>;    // no-op
  setBudget: (budget: CostBudget) => Promise<void>;  // no-op
  reset: () => Promise<void>;           // no-op
  startPolling: () => void;             // sets 5s interval
  stopPolling: () => void;
}
```

---

### 5. notificationStore

Toast queue, tab badges, pending input counter. Uses `persist` middleware.

```typescript
interface NotificationStore {
  toasts: Toast[];
  tabBadges: Map<string, TabBadge>;
  pendingInputCount: number;
  soundEnabled: boolean;

  addToast: (toast: Omit<Toast, "id" | "createdAt">) => void;
  dismissToast: (id: string) => void;
  setBadge: (bonsaiSid: string, badge: TabBadge) => void;
  clearBadge: (bonsaiSid: string) => void;
  incrementPendingInput: () => void;
  decrementPendingInput: () => void;
  toggleSound: () => void;
}
```

**Persistence key:** `"bonsai-notification-sound"`. Persisted: `{ soundEnabled }`.

**Toast behavior:** Max 5 visible (oldest dropped). Auto-dismiss: 5s normal, 8s error. Toast IDs: sequential `"toast-1"`, `"toast-2"`, etc.

---

### 6. fileStore

Open file tabs, preview tab, editor state. Plain Zustand, no middleware.

```typescript
interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  mode: "preview" | "edit";
  isDirty: boolean;
  saving: boolean;
  error?: string;
}

interface FileStore {
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;
  previewFilePath: string | null;
  previewFile: OpenFile | null;

  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  activateFile: (path: string) => void;
  loadPreview: (path: string) => Promise<void>;
  clearPreview: () => void;
  pinPreview: () => void;
  setMode: (path: string, mode: "preview" | "edit") => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  openExternal: (path: string, editor: string) => Promise<void>;

  // Event handler (called by wireEvents)
  onFileChanged: (path: string) => void;
}
```

**REST endpoints:** `GET /api/file/read`, `POST /api/file/write`, `POST /api/file/open-external`.

**Key behaviors:**
- `activateFile` sets `activeFilePath` and clears preview
- `loadPreview` routes to `activateFile` if path already pinned; otherwise sets preview fields and fetches content with stale-response guard
- `pinPreview` moves `previewFile` into `openFiles`, sets `activeFilePath`, clears preview
- `onFileChanged` re-fetches content from `/api/file/read` for open files (if not dirty) and preview file when the file is modified on disk

---

## Event Wiring (`wireEvents.ts`)

Called once at app startup. Returns cleanup function.

```typescript
export function wireEvents(client: RpcClient): Unsubscribe
```

### Spec notifications → specStore

| Event | Action |
|---|---|
| `spec/didChange` | `onSpecChanged(id)` |
| `spec/didCreate` | `onSpecCreated(id, path)` |
| `spec/didDelete` | `onSpecDeleted(id)` |
| `registry/didUpdate` | `onRegistryUpdated()` |

### File notifications → fileStore

| Event | Action |
|---|---|
| `file/didChange` | `onFileChanged(path)` |

### Agent streaming → sessionStore.onAgentEvent

`agent/textDelta`, `agent/toolCallStart`, `agent/toolCallEnd`, `agent/turnComplete`, `agent/interrupted`, `agent/subagentStart`, `agent/subagentEnd`, `agent/notification`, `agent/compact`, `agent/progress`, `agent/costEstimate`, `agent/permissionDenied`, `agent/ready`

`agent/costEstimate` is ephemeral — not stored in the events array but updates live metrics (cost, context window, token breakdown) for real-time UI display.

### Agent lifecycle → individual handlers

| Event | Actions |
|---|---|
| `agent/sessionStart` | `sessionStore.onSessionStart(params)` |
| `agent/done` | `sessionStore.onSessionDone(params)` + toast + badge |
| `agent/error` | `sessionStore.onSessionError(params)` + toast + badge |
| `agent/configChanged` | `sessionStore.onConfigChanged(params)` |
| `agent/askUserQuestion` | `sessionStore.onAskQuestion(params)` + `incrementPendingInput` + persistent toast + badge |
| `agent/confirmAction` | `sessionStore.onConfirmAction(params)` + `incrementPendingInput` + persistent toast + badge |
| `agent/suggestSession` | `sessionStore.onSuggestSession(params)` + `incrementPendingInput` + persistent toast + badge |

Questions, approvals, and suggestions arrive with a JSON-RPC `id` but are handled via `client.on()` (not `client.onRequest()`). Responses are sent via `agent/respond` RPC.

---

## Selector Patterns

```typescript
// Prefer: re-renders only when specific data changes
const activeSession = useSessionStore(
  (s) => s.sessions.get(s.activeSessionId ?? "") ?? null
);

// Derived data with shallow comparison
const { done, active, total } = useSpecStore(
  (s) => ({ done: s.specs.filter(...).length, ... }),
  shallow
);
```

---

## Known Limitations

- **Some UI preferences live in `localStorage`, not Zustand** — FileTree component manages `collapsed` and `showHidden` state in `localStorage` (keys: `bonsai-filetree-collapsed-{projectPath}`, `bonsai-filetree-showHidden-{projectPath}`). These are component-local, not in any Zustand store.
- **No undo/redo**
- **Session events accumulate unbounded** — no pruning for long sessions
- **No cross-tab sync** — multiple browser tabs have independent stores
- **`archivedSessions` lost on refresh** — not persisted
- **`costStore` is a stub** — all no-ops until backend implements cost endpoints
- **`fileStore` not in index barrel** — must import directly
- **No devtools middleware** — Redux DevTools not wired

## Related Specs

- **Parent:** [Frontend Module](../../README.md)
- **Depends on:** [API Client](../api/README.md) (event subscriptions, RPC calls)
- **Related:** [Chat UI](../../ui-specs/CHAT_UI.md), [Notification System](../../ui-specs/NOTIFICATION_SYSTEM.md)
