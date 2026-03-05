# Component Tree & App Shell — Module Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) | Status: **Active** | Created: 2026-03-02

## Purpose

Defines the overall frontend project structure, component tree, React Router configuration, and application bootstrap sequence. This is the "skeleton" that all component specs (Chat UI, Graph, Modal, etc.) plug into.

## Tech Stack

| Technology | Version | Purpose |
| --- | --- | --- |
| React | 19.x | UI framework |
| TypeScript | 5.x | Type safety |
| Vite | 6.x | Build tool, dev server, HMR |
| React Router | 7.x | Client-side routing |
| Zustand | 5.x | State management (see STATE_MANAGEMENT.md) |
| xterm.js | 5.x | Terminal emulator (Console component) |

## Project Structure

```
frontend/
├── index.html                 # Vite entry HTML
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx               # App entry: mount React, init client
│   ├── App.tsx                # Root component: providers + router
│   ├── routes.tsx             # React Router route definitions
│   │
│   ├── api/                   # API client layer (see API_CLIENT.md)
│   │   ├── client.ts
│   │   ├── methods/
│   │   ├── hooks/
│   │   ├── types.ts
│   │   └── errors.ts
│   │
│   ├── store/                 # Zustand stores (see STATE_MANAGEMENT.md)
│   │   ├── index.ts
│   │   ├── specStore.ts
│   │   ├── sessionStore.ts
│   │   ├── uiStore.ts
│   │   ├── costStore.ts
│   │   └── notificationStore.ts
│   │
│   ├── components/            # UI components (one folder per spec)
│   │   ├── AppShell/          # Three-panel layout shell
│   │   │   ├── AppShell.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── ResizeHandle.tsx
│   │   │
│   │   ├── LeftPanel/         # Left panel container + tabs
│   │   │   ├── LeftPanel.tsx
│   │   │   ├── SpecTree.tsx
│   │   │   ├── RequirementsList.tsx
│   │   │   ├── FileTree.tsx
│   │   │   └── ProgressTab/   # (see PROGRESS_TRACKER.md)
│   │   │
│   │   ├── CenterPanel/       # Session container + tabs
│   │   │   └── CenterPanel.tsx
│   │   │
│   │   ├── RightPanel/        # Right panel container + tabs
│   │   │   └── RightPanel.tsx
│   │   │
│   │   ├── ChatStream/        # (see CHAT_UI.md)
│   │   ├── GraphView/         # (see GRAPH_INTERACTIONS.md)
│   │   ├── SpecView/          # Markdown renderer + edit mode
│   │   ├── CodeView/          # Code viewer with syntax highlighting
│   │   ├── DiffViewer/        # (see DIFF_VIEWER.md)
│   │   ├── Console/           # (see CONSOLE.md)
│   │   ├── NewSessionModal/   # (see NEW_SESSION_MODAL.md)
│   │   ├── CommandPalette/    # (see COMMAND_PALETTE.md)
│   │   ├── Notifications/     # (see NOTIFICATION_SYSTEM.md)
│   │   └── SessionHistory/    # (see SESSION_HISTORY.md)
│   │
│   ├── styles/                # (see THEMING.md)
│   │   ├── tokens.css
│   │   ├── theme-dark.css
│   │   ├── theme-light.css
│   │   └── global.css
│   │
│   ├── types/                 # Shared TypeScript interfaces
│   │   ├── spec.ts            # RegistryEntry, Link, SpecGraph, SpecDetail
│   │   ├── agent.ts           # AgentTask, AgentConfig, AgentEvent
│   │   ├── session.ts         # Session, ArchivedSession, SessionMetrics
│   │   └── rpc.ts             # JSON-RPC message types
│   │
│   └── utils/                 # Shared utilities
│       ├── format.ts          # Duration, cost, token count formatting
│       ├── markdown.ts        # Markdown rendering helpers
│       └── keyboard.ts        # Global keyboard shortcut registration
```

## Component Tree

```
<StrictMode>
  <RpcProvider url="ws://localhost:8000/ws">
    <BrowserRouter>
      <App>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate to="/workspace" />} />
            <Route path="workspace" element={<WorkspaceLayout />}>
              <Route index />
              <Route path="spec/:specId" />
              <Route path="session/:taskId" />
              <Route path="graph" />
            </Route>
          </Route>
        </Routes>
        <NewSessionModal />       {/* global, rendered via portal */}
        <CommandPalette />        {/* global, rendered via portal */}
        <Notifications />         {/* global, fixed position */}
        <ConnectionBanner />      {/* reconnect UI */}
      </App>
    </BrowserRouter>
  </RpcProvider>
</StrictMode>
```

## Routing

### Route Structure

| Route | Purpose | Effect |
| --- | --- | --- |
| `/` | Redirect | → `/workspace` |
| `/workspace` | Default view | Three-panel layout, no specific selection |
| `/workspace/spec/:specId` | Spec focused | Right panel shows spec, graph highlights it |
| `/workspace/session/:taskId` | Session focused | Center panel activates that session tab |
| `/workspace/graph` | Graph focused | Right panel switches to graph tab |

### Route ↔ State Sync

Routes are the **source of truth** for navigation-level state. Zustand stores handle app-level state.

```typescript
// On route change → update stores:
useEffect(() => {
  if (params.specId) specStore.selectSpec(params.specId);
  if (params.taskId) sessionStore.switchSession(params.taskId);
}, [params]);

// On store action → update route:
function selectSpec(id: string) {
  specStore.selectSpec(id);
  navigate(`/workspace/spec/${id}`);
}
```

### Deep Linking

URLs are shareable within a session:
- `/workspace/spec/module-spec` → opens the app with Spec Module selected
- `/workspace/session/abc123` → opens with that session active
- Browser back/forward navigates between spec/session selections

## AppShell Component

The three-panel layout wrapper:

```tsx
function AppShell() {
  const { leftCollapsed, rightCollapsed, toggleRight } = useUiStore();

  return (
    <div className="app-shell">
      <Header />
      <div className="layout">
        {!leftCollapsed && <LeftPanel />}
        <ResizeHandle side="left" />
        <CenterPanel />
        {rightCollapsed ? (
          <button className="right-collapse-btn" onClick={toggleRight} />
        ) : (
          <>
            <ResizeHandle side="right" />
            <ContextPanel />
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
```

## Bootstrap Sequence

What happens on app load (`main.tsx`):

```
1. Mount React app
2. Initialize RpcClient with ws://localhost:8000/ws
3. Connect WebSocket
4. Wire event subscriptions (see STATE_MANAGEMENT.md §Event Wiring)
5. Fetch initial data in parallel:
   - spec/list → specStore
   - spec/graph → specStore
   - agent/list → sessionStore (restore running sessions)
   - cost/summary → costStore
6. Apply theme from localStorage
7. Restore UI state from localStorage (panel visibility, active tabs)
8. Render AppShell
9. Start cost polling (if sessions active)
```

### Loading State

During bootstrap (steps 2-5), show a minimal loading screen:

```
┌──────────────────────────────────────┐
│                                      │
│        🌿 Bonsai                     │
│        Connecting...                 │
│                                      │
└──────────────────────────────────────┘
```

On WebSocket failure: show connection error with retry button.

## Global Keyboard Shortcuts

Registered once at the app level (`utils/keyboard.ts`):

| Shortcut | Action | Handler |
| --- | --- | --- |
| `Cmd+K` | Open command palette | `uiStore.togglePalette()` |
| `Cmd+T` | New session | `uiStore.openModal()` |
| `Cmd+1-9` | Switch session tab | `sessionStore.switchSession(n)` |
| `Cmd+Enter` | Send message | Delegated to ChatStream input |
| `Ctrl+B` | Toggle left panel | `uiStore.toggleLeftPanel()` |
| `Cmd+J` | Toggle right panel | `uiStore.toggleRightPanel()` |
| `Cmd+G` | Focus graph view | `uiStore.setRightTab("graph")` |
| `Cmd+P` | Focus spec view | `uiStore.setRightTab("spec")` |
| `Escape` | Close modal/palette | Context-dependent |

**Implementation:** Single `keydown` listener on `document`, routing to actions based on key combos. Disabled when a text input is focused (except `Cmd+Enter`, `Escape`).

## Naming Conventions

| Element | Convention | Example |
| --- | --- | --- |
| Component files | PascalCase | `ChatStream.tsx` |
| Component folders | PascalCase | `ChatStream/` |
| Store files | camelCase | `sessionStore.ts` |
| Utility files | camelCase | `format.ts` |
| Type files | camelCase | `spec.ts` |
| CSS classes | kebab-case | `.chat-stream` |
| CSS variables | kebab-case with `--` prefix | `--bg`, `--blue` |
| Zustand hooks | `use{Store}Store` | `useSessionStore` |
| API methods | `{domain}Api.{method}` | `specApi.list()` |

## Build Configuration

### Vite

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/terminal': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

- Dev server on port 3000, proxies WebSocket to backend on 8000
- Production build outputs to `dist/` — served by FastAPI as static files

### TypeScript

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": "src",
    "paths": { "@/*": ["./*"] }
  }
}
```

Path alias `@/` maps to `src/` for clean imports: `import { useSpecs } from "@/api/hooks/useSpecs"`.

## Testing Strategy (Overview)

| Layer | Tool | Pattern |
| --- | --- | --- |
| Unit tests | Vitest | Store actions, utility functions, API method wrappers |
| Component tests | Vitest + Testing Library | Render components with mocked stores, assert DOM |
| Integration tests | Vitest + MSW | Mock WebSocket, test full event flows |
| E2E tests | Playwright (future) | Full app with real backend |

Test files colocated with source: `ChatStream.test.tsx` next to `ChatStream.tsx`.

## Dependencies Summary

| Package | Size | Purpose |
| --- | --- | --- |
| `react` + `react-dom` | ~45KB | UI framework |
| `react-router-dom` | ~15KB | Routing |
| `zustand` | ~1KB | State management |
| `@xterm/xterm` | ~100KB | Terminal emulator (loaded lazily for Console) |
| `@xterm/addon-fit` | ~2KB | Terminal resize |

**Total estimated bundle:** ~165KB gzipped (excluding xterm.js which is lazy-loaded).

No graph library, no rich text editor, no CSS framework — intentionally minimal.

## Known Limitations

- **No multi-window:** Cannot pop out panels into separate browser windows
- **No workspace persistence beyond URL:** Panel widths and scroll positions are not saved (only panel visibility and active tabs)
- **Single WebSocket:** Opening a second browser tab would disconnect the first

## Related Specs

- **Parent:** [Web View](WEBVIEW.md)
- **Depends on:** [State Management](../src/store/README.md) (uiStore), [API Client](../src/api/README.md) (bootstrap sequence)
- **Related:** [Responsive Behavior](RESPONSIVE_BEHAVIOR.md) (breakpoints, panel collapse), [Theming](THEMING.md) (CSS variables)
