# State Management — Module Specification

> Parent: [Frontend Module](../../README.md) | Status: **Active** | Created: 2026-03-02

## Purpose

Centralized state management for the Bonsai frontend using **Zustand**. Defines the global state shape, store organization, and data flow patterns. All persistent UI state lives in Zustand stores; ephemeral state (hover, focus, animation) stays in component-local React state.

## Library Choice: Zustand

| Factor | Assessment |
| --- | --- |
| Bundle size | ~1KB gzipped |
| Boilerplate | Minimal — no providers, reducers, or action creators |
| React integration | Hook-based: `useStore(selector)` with automatic re-render optimization |
| DevTools | Zustand devtools middleware for inspection |
| Middleware | Built-in: persist (localStorage), devtools, immer |
| Learning curve | Very low — plain functions mutating state |

## File Organization

```
frontend/src/store/
├── index.ts               # Re-exports all stores
├── specStore.ts           # Spec data, graph, registry
├── sessionStore.ts        # Sessions, events, history
├── uiStore.ts             # Panel visibility, active tabs, modal state
├── costStore.ts           # Cost tracking, budget
├── notificationStore.ts   # Toast queue, tab badges
├── fileStore.ts           # Open files, editor state, dirty tracking
└── middleware/
    ├── persist.ts         # localStorage persistence config
    └── devtools.ts        # DevTools middleware wrapper
```

## Store Architecture

```
┌─────────────────────────────────────────────────┐
│  React Components                                │
│    useSpecStore()  useSessionStore()  useUiStore()│
├─────────────────────────────────────────────────┤
│  Zustand Stores (5 stores)                       │
│    specStore  sessionStore  uiStore              │
│    costStore  notificationStore                  │
├─────────────────────────────────────────────────┤
│  API Client (data source)                        │
│    RPC responses → store.setState()              │
│    RPC events → store actions                    │
└─────────────────────────────────────────────────┘
```

**Data flow:**
1. Component calls store action (e.g., `sessionStore.startSession(params)`)
2. Action calls RPC method via API client (e.g., `agentApi.run(params)`)
3. RPC response updates store state
4. Streaming events (via `client.on()`) call store actions to update state
5. Components re-render via Zustand selectors

## Store Definitions

### 1. specStore

Spec data, graph, and registry cache.

```typescript
interface SpecStore {
  // Data
  specs: RegistryEntry[];
  graph: SpecGraph | null;
  specContent: Map<string, string>;    // id → markdown content cache
  loading: boolean;
  error: string | null;

  // Selection
  selectedSpecId: string | null;

  // Actions
  fetchSpecs: () => Promise<void>;
  fetchGraph: () => Promise<void>;
  fetchSpecContent: (id: string) => Promise<string>;
  selectSpec: (id: string | null) => void;

  // Event handlers (called by API client subscriptions)
  onSpecChanged: (id: string) => void;
  onSpecCreated: (id: string, path: string) => void;
  onSpecDeleted: (id: string) => void;
  onRegistryUpdated: () => void;
}
```

**Persistence:** None (fetched fresh from backend on connect).

### 2. sessionStore

Active sessions, event logs, and session history.

```typescript
interface SessionStore {
  // Active sessions
  sessions: Map<string, Session>;
  activeSessionId: string | null;

  // History
  archivedSessions: ArchivedSession[];

  // Actions
  startSession: (params: NewSessionParams) => Promise<string>;  // returns taskId
  switchSession: (taskId: string) => void;
  closeSession: (taskId: string) => void;
  interruptSession: (taskId: string) => Promise<void>;
  respondToQuestion: (taskId: string, requestId: string, response: any) => Promise<void>;
  respondToApproval: (taskId: string, requestId: string, decision: string) => Promise<void>;

  // Event handlers
  onSessionStart: (params: SessionStartParams) => void;
  onTextDelta: (params: TextDeltaParams) => void;
  onToolCallStart: (params: ToolCallStartParams) => void;
  onToolCallEnd: (params: ToolCallEndParams) => void;
  onSubagentStart: (params: SubagentStartParams) => void;
  onSubagentEnd: (params: SubagentEndParams) => void;
  onAskQuestion: (params: AskQuestionParams) => void;
  onConfirmAction: (params: ConfirmActionParams) => void;
  onSessionDone: (params: SessionDoneParams) => void;
  onSessionError: (params: SessionErrorParams) => void;
  onCompact: (params: CompactParams) => void;
  onNotification: (params: NotificationParams) => void;
  onPermissionDenied: (params: PermissionDeniedParams) => void;
  onProgress: (params: ProgressParams) => void;
}

interface Session {
  taskId: string;
  name: string;
  skillId: string | null;
  specIds: string[];
  status: "running" | "done" | "error" | "interrupted";
  model: string;
  startedAt: number;
  events: AgentEvent[];          // full event log
  metrics: SessionMetrics;       // derived: cost, turns, tool calls, context
  pendingRequest: PendingRequest | null;  // question or approval awaiting response
}

interface SessionMetrics {
  costUsd: number;
  turns: number;
  toolCalls: number;
  contextTokens: number;
  contextMax: number;
  durationMs: number;
  filesChanged: Map<string, "created" | "modified" | "deleted">;
}
```

**Persistence:** `archivedSessions` persisted to localStorage via Zustand persist middleware (v1). Session event logs can be large — persist only metadata for old sessions if localStorage quota is a concern.

### 3. uiStore

Panel visibility, active tabs, viewport state.

```typescript
interface UiStore {
  // Panel visibility
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftDrawerOpen: boolean;       // mobile drawer mode
  rightDrawerOpen: boolean;

  // Left panel
  leftActiveTab: "specs" | "reqs" | "files" | "progress";

  // Right panel
  rightActiveTab: "graph" | "spec" | "code" | "diff" | "console";

  // Graph state
  graphState: GraphState;        // from GRAPH_INTERACTIONS.md §15

  // Modal
  modalOpen: boolean;
  modalPrefill: ModalPrefill | null;

  // Command palette
  paletteOpen: boolean;

  // Viewport
  viewportWidth: number;
  breakpoint: "desktop" | "laptop" | "below-min";

  // Actions
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftTab: (tab: string) => void;
  setRightTab: (tab: string) => void;
  openModal: (prefill?: ModalPrefill) => void;
  closeModal: () => void;
  togglePalette: () => void;
  updateViewport: (width: number) => void;
}
```

**Persistence:** `leftPanelCollapsed`, `rightPanelCollapsed`, `leftActiveTab`, `rightActiveTab` persisted to localStorage. Restored on page load.

### 4. costStore

Cost tracking and budget management.

```typescript
interface CostStore {
  summary: CostSummary | null;
  loading: boolean;

  // Actions
  fetchSummary: () => Promise<void>;
  setBudget: (budget: CostBudget) => Promise<void>;
  resetSessionCost: () => Promise<void>;

  // Polling
  startPolling: () => void;
  stopPolling: () => void;
}
```

**Persistence:** None (backend owns cost data in `.specs/cost.json`).

### 5. notificationStore

Toast queue and alert badges.

```typescript
interface NotificationStore {
  toasts: Toast[];
  tabBadges: Map<string, TabBadge>;
  pendingInputCount: number;
  soundEnabled: boolean;

  // Actions
  addToast: (toast: Omit<Toast, "id" | "createdAt">) => void;
  dismissToast: (id: string) => void;
  clearBadge: (taskId: string) => void;
  setBadge: (taskId: string, badge: TabBadge) => void;
  toggleSound: () => void;
}
```

**Persistence:** `soundEnabled` persisted to localStorage.

## Event Wiring

On app startup, the API client subscribes to all server events and routes them to store actions:

```typescript
function wireEvents(client: RpcClient, stores: AllStores) {
  // Spec events
  client.on("spec/didChange", (p) => stores.spec.onSpecChanged(p.id));
  client.on("spec/didCreate", (p) => stores.spec.onSpecCreated(p.id, p.path));
  client.on("spec/didDelete", (p) => stores.spec.onSpecDeleted(p.id));
  client.on("registry/didUpdate", () => stores.spec.onRegistryUpdated());

  // Agent events (routed by taskId to sessionStore)
  client.on("agent/sessionStart", (p) => stores.session.onSessionStart(p));
  client.on("agent/textDelta", (p) => stores.session.onTextDelta(p));
  client.on("agent/toolCallStart", (p) => stores.session.onToolCallStart(p));
  client.on("agent/toolCallEnd", (p) => stores.session.onToolCallEnd(p));
  client.on("agent/subagentStart", (p) => stores.session.onSubagentStart(p));
  client.on("agent/subagentEnd", (p) => stores.session.onSubagentEnd(p));
  client.on("agent/done", (p) => stores.session.onSessionDone(p));
  client.on("agent/error", (p) => stores.session.onSessionError(p));
  client.on("agent/compact", (p) => stores.session.onCompact(p));
  client.on("agent/notification", (p) => stores.session.onNotification(p));
  client.on("agent/permissionDenied", (p) => stores.session.onPermissionDenied(p));
  client.on("agent/progress", (p) => stores.session.onProgress(p));

  // Server-initiated requests (need response)
  client.onRequest("agent/askUserQuestion", async (p) => {
    stores.session.onAskQuestion(p);
    stores.notification.addToast({ taskId: p.taskId, eventType: "question", ... });
    // Response is sent later via sessionStore.respondToQuestion()
    // Return a promise that resolves when user responds
    return stores.session.waitForResponse(p.taskId, p.requestId);
  });

  client.onRequest("agent/confirmAction", async (p) => {
    stores.session.onConfirmAction(p);
    stores.notification.addToast({ taskId: p.taskId, eventType: "approval", ... });
    return stores.session.waitForResponse(p.taskId, p.requestId);
  });
}
```

## Selector Patterns

Use Zustand selectors for optimal re-rendering:

```typescript
// Bad: re-renders on ANY store change
const store = useSessionStore();

// Good: re-renders only when activeSession changes
const activeSession = useSessionStore((s) => s.sessions.get(s.activeSessionId));

// Good: derived data with shallow equality
const specCounts = useSpecStore(
  (s) => ({
    done: s.specs.filter(sp => sp.status === "done").length,
    active: s.specs.filter(sp => sp.status === "active").length,
    total: s.specs.length,
  }),
  shallow
);
```

## Middleware

### Persist

```typescript
import { persist } from "zustand/middleware";

const useUiStore = create(
  persist(
    (set) => ({ /* state + actions */ }),
    {
      name: "bonsai-ui",
      partialize: (state) => ({
        leftPanelCollapsed: state.leftPanelCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        leftActiveTab: state.leftActiveTab,
        rightActiveTab: state.rightActiveTab,
      }),
    }
  )
);
```

### DevTools

```typescript
import { devtools } from "zustand/middleware";

const useSessionStore = create(
  devtools(
    (set) => ({ /* state + actions */ }),
    { name: "SessionStore" }
  )
);
```

Enabled in development only. Connects to React DevTools / Redux DevTools extension.

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| 5 separate stores | Not monolithic | Each store has a clear domain. Avoids mega-store with unrelated state. Components only subscribe to what they need. |
| Events → store actions | Not direct state mutation | Keeps event handling testable. Store actions are the single entry point for state changes. |
| localStorage persist | Not backend persist (v1) | Session history and UI preferences survive page refresh without backend changes. |
| Zustand selectors | Not React.memo everywhere | Zustand's selector-based re-rendering is simpler and more performant than manual memoization. |
| Flat session events array | Not nested message tree | Events arrive as a flat stream. The Chat UI components transform them into a tree at render time (grouping subagent events, etc.). |

## Known Limitations

- **No undo/redo:** State changes are not reversible — no action history stack
- **Session events accumulate unbounded:** Long-running sessions with many events may use significant memory
- **No cross-tab sync:** Multiple browser tabs would have independent stores (but only one can connect at a time)

### 6. fileStore

Manages open file tabs and preview state. Single-click in FileTree/SpecTree creates a preview tab; double-click pins it.

```typescript
interface OpenFile {
  path: string;           // relative to project root
  name: string;           // filename
  content: string;        // current content
  originalContent: string;// for dirty detection
  mode: "preview" | "edit";
  isDirty: boolean;       // content !== originalContent
  saving: boolean;
}

interface FileStore {
  openFiles: Map<string, OpenFile>;  // keyed by relative path
  activeFilePath: string | null;
  previewFilePath: string | null;    // single-click preview path (at most one)
  previewFile: OpenFile | null;      // loaded content for preview tab

  // Pinned file operations
  openFile: (path: string) => Promise<void>;     // fetch via REST, add to open files, pin
  closeFile: (path: string) => void;
  activateFile: (path: string) => void;          // also calls clearPreview()
  setMode: (path: string, mode) => void;         // toggle preview/edit
  updateContent: (path: string, content) => void; // local edit
  saveFile: (path: string) => Promise<void>;     // POST /api/file/write
  openExternal: (path: string, editor) => Promise<void>; // POST /api/file/open-external

  // Preview tab operations
  loadPreview: (path: string) => Promise<void>;  // open as preview tab (replaces existing preview)
  clearPreview: () => void;                      // remove preview tab
  pinPreview: () => void;                        // convert preview → pinned (moves to openFiles + activeFilePath)
}
```

**Preview tab behavior:**
- `loadPreview(path)` sets `previewFilePath` immediately, then loads content async into `previewFile`. If file is already pinned in `openFiles`, activates it instead.
- Only one preview tab exists at a time — calling `loadPreview` again replaces the current one
- `activateFile(path)` (clicking a pinned tab) calls `clearPreview()` automatically
- `pinPreview()` moves the preview into `openFiles` as a permanent tab and sets it as `activeFilePath`
- Starting/switching an agent session (via sessionStore) should also call `clearPreview()`

**Data source:** REST endpoints (`/api/file/read`, `/api/file/write`, `/api/file/open-external`)
**Persistence:** None (open files are ephemeral — closed on page refresh)

## Related Specs

- **Parent:** [Frontend Module](../../README.md)
- **Depends on:** [API Client](../api/README.md) (event subscriptions, RPC calls)
- **Related:** [Chat UI](../../ui-specs/CHAT_UI.md), [Graph Interactions](../../ui-specs/GRAPH_INTERACTIONS.md), [Notification System](../../ui-specs/NOTIFICATION_SYSTEM.md) (all consume store state)
