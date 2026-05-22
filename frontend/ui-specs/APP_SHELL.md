---
id: app-shell
type: submodule-design
status: active
title: Component Tree & App Shell
parent: webview
depends-on:
- state-management
- api-client
covers:
- frontend/src/components/AppShell/
tags:
- frontend
- ui
- routing
- layout
---
# Component Tree & App Shell — Module Specification

> Parent: [WEBVIEW.md](WEBVIEW.md) | Status: **Active** | Created: 2026-03-02

## Table of Contents
1. [Purpose](#purpose)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Component Tree](#component-tree)
5. [Routing](#routing)
6. [AppShell Component](#appshell-component)
7. [Bootstrap Sequence](#bootstrap-sequence)
8. [Global Keyboard Shortcuts](#global-keyboard-shortcuts)
9. [Naming Conventions](#naming-conventions)
10. [Build Configuration](#build-configuration)
11. [Testing Strategy](#testing-strategy-overview)
12. [Dependencies Summary](#dependencies-summary)
13. [Known Limitations](#known-limitations)
14. [Related Specs](#related-specs)

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
| Monaco Editor | 0.55.x | Code viewer / editor (`@monaco-editor/react`) |
| Mermaid | 11.x | Diagram rendering |
| react-markdown | 10.x | Markdown rendering (with `remark-gfm`) |

## Project Structure

```
frontend/
├── index.html                 # Vite entry HTML
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx               # App entry: theme init, Root component, mount
│   ├── App.tsx                # Providers, keyboard shortcuts, event wiring
│   ├── routes.tsx             # React Router route definitions
│   │
│   ├── api/                   # API client layer (see API_CLIENT.md)
│   │   ├── client.ts
│   │   ├── index.ts
│   │   ├── methods/
│   │   │   ├── index.ts
│   │   │   ├── specs.ts
│   │   │   ├── agents.ts
│   │   │   └── sessions.ts
│   │   ├── hooks/
│   │   │   ├── useSpecs.ts
│   │   │   ├── useSession.ts
│   │   │   └── useCost.ts
│   │   ├── types.ts
│   │   └── errors.ts
│   │
│   ├── store/                 # Zustand stores (see STATE_MANAGEMENT.md)
│   │   ├── index.ts
│   │   ├── specStore.ts
│   │   ├── sessionStore.ts
│   │   ├── uiStore.ts
│   │   ├── costStore.ts
│   │   ├── fileStore.ts
│   │   ├── notificationStore.ts
│   │   └── wireEvents.ts
│   │
│   ├── constants/             # Shared constants
│   │   └── skills.ts
│   │
│   ├── components/            # UI components (one folder per spec)
│   │   ├── AppShell/          # Three-panel layout shell
│   │   │   ├── AppShell.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   ├── LeftPanel.tsx
│   │   │   ├── PanelCollapseButton.tsx
│   │   │   ├── ResizeHandle.tsx
│   │   │   ├── SettingsModal.tsx     # Themes / Session Defaults / Server Info / Settings tabs
│   │   │   ├── SettingsModal.css
│   │   │   └── AppShell.css
│   │   │
│   │   ├── ContextPanel/      # Context-aware right sidebar (see CONTEXT_PANEL.md)
│   │   ├── ChatStream/        # (see CHAT_UI.md)
│   │   ├── GraphView/         # (see GRAPH_INTERACTIONS.md)
│   │   ├── FileViewer/        # File viewer with Monaco + markdown preview
│   │   ├── DiffViewer/        # (see DIFF_VIEWER.md)
│   │   ├── Console/           # (see CONSOLE.md)
│   │   ├── CommandPalette/    # (see COMMAND_PALETTE.md)
│   │   ├── Notifications/     # Toast notifications (ToastContainer)
│   │   ├── SessionHistory/    # (see SESSION_HISTORY.md)
│   │   ├── SessionPanel/      # Session tab bar + active session display, + New button (see CENTER_PANEL.md)
│   │   ├── SessionManager/    # Full session management view
│   │   ├── FileTree/          # File tree navigation
│   │   ├── SpecTree/          # Spec tree navigation
│   │   ├── ProgressTab/       # Progress tracking + activity timeline
│   │   └── ProjectPicker/     # Project selection modal
│   │
│   ├── styles/                # (see THEMING.md)
│   │   ├── tokens.css
│   │   ├── theme-dark.css
│   │   ├── theme-light.css
│   │   └── global.css
│   │
│   ├── types/                 # Shared TypeScript interfaces
│   │   ├── index.ts
│   │   ├── spec.ts            # RegistryEntry, Link, SpecGraph, SpecDetail
│   │   ├── agent.ts           # AgentTask, AgentConfig, AgentEvent
│   │   ├── session.ts         # Session, ArchivedSession, SessionMetrics
│   │   └── rpc.ts             # JSON-RPC message types
│   │
│   └── utils/                 # Shared utilities
│       ├── theme.ts           # Theme preference storage and application
│       └── keyboard.ts        # Global keyboard shortcut registration
```

## Component Tree

```
<StrictMode>
  <Root>                                {/* manages projectPath state + picker */}
    <ProjectPicker />                   {/* full-screen if no project selected */}
    <RpcProvider url={wsUrl} key={projectPath}>
      <App projectPath={...} onSwitchProject={...}>
        <BrowserRouter>
          <AppRoutes onSwitchProject={...}>
            <Routes>
              <Route path="/" element={<AppShell onSwitchProject={...} />}>
                <Route index element={<Navigate to="/workspace" />} />
                <Route path="workspace">
                  <Route index />
                  <Route path="spec/:specId" />
                  <Route path="session/:taskId" />
                  <Route path="graph" />
                </Route>
              </Route>
            </Routes>
          </AppRoutes>
          <CommandPalette />            {/* global, rendered via portal */}
          <ToastContainer />            {/* global, fixed position */}
        </BrowserRouter>
      </App>
    </RpcProvider>
    {showPicker && <ProjectPicker onSelect={...} onClose={...} />}
  </Root>
</StrictMode>
```

**Key points:**
- `Root` (in `main.tsx`) owns project selection state and renders `ProjectPicker` full-screen until a project is chosen.
- `RpcProvider` is keyed on `projectPath` so the WebSocket reconnects on project switch.
- `BrowserRouter` lives inside `App`, not outside it.
- `App` receives `projectPath` and `onSwitchProject` props from `Root`.

## Routing

### Route Structure

| Route | Purpose | Effect |
| --- | --- | --- |
| `/` | Redirect | `<Navigate to="/workspace" replace />` |
| `/workspace` | Default view | Three-panel layout, no specific selection |
| `/workspace/spec/:specId` | Spec focused | Right panel shows spec, graph highlights it |
| `/workspace/session/:taskId` | Session focused | Center panel activates that session tab |
| `/workspace/graph` | Graph focused | Right panel switches to graph tab |

All workspace child routes render `element={null}` -- the `AppShell` reads route params via hooks and delegates to appropriate panels through `<Outlet />`.

### Route <-> State Sync

Routes are the **source of truth** for navigation-level state. Zustand stores handle app-level state.

```typescript
// On route change -> update stores:
useEffect(() => {
  if (params.specId) specStore.selectSpec(params.specId);
  if (params.taskId) sessionStore.switchSession(params.taskId);
}, [params]);

// On store action -> update route:
function selectSpec(id: string) {
  specStore.selectSpec(id);
  navigate(`/workspace/spec/${id}`);
}
```

### Deep Linking

URLs are shareable within a session:
- `/workspace/spec/module-spec` -- opens the app with Spec Module selected
- `/workspace/session/abc123` -- opens with that session active
- Browser back/forward navigates between spec/session selections

## AppShell Component

The three-panel layout wrapper. Receives `onSwitchProject` prop from the route tree and passes it to `Header`.

```tsx
const LEFT_DEFAULT = 260;
const RIGHT_DEFAULT = 380;

function AppShell({ onSwitchProject }: { onSwitchProject: () => void }) {
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const toggleLeft = useUiStore((s) => s.toggleLeftPanel);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);

  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);   // 260px default
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT); // 380px default
  const [showSessionManager, setShowSessionManager] = useState(false);

  return (
    <div className="app-shell">
      <Header onSwitchProject={onSwitchProject} />
      <div className="layout">
        {leftCollapsed ? (
          <button className="left-collapse-btn" onClick={toggleLeft}
            title="Open left panel (Mod+B)">&#9654;</button>
        ) : (
          <>
            <div style={{ width: leftWidth }}>
              <LeftPanel />
            </div>
            <ResizeHandle
              side="left"
              panelWidth={leftWidth}
              onResize={handleLeftResize}
              onCollapse={toggleLeft}
              min={140}
              collapseThreshold={100}
            />
          </>
        )}
        <div className="center-panel">
          <Outlet />
          {showSessionManager ? (
            <SessionManager onClose={handleCloseSessionManager} />
          ) : (
            <SessionPanel />
          )}
        </div>
        {rightCollapsed ? (
          <button className="right-collapse-btn" onClick={toggleRight}
            title="Open context panel (Mod+J)">&#9664;</button>
        ) : (
          <>
            <ResizeHandle
              side="right"
              panelWidth={rightWidth}
              onResize={handleRightResize}
              onCollapse={toggleRight}
              min={200}
              collapseThreshold={150}
            />
            <div style={{ width: rightWidth }}>
              <ContextPanel />
            </div>
          </>
        )}
      </div>
      <StatusBar onOpenSessionManager={handleOpenSessionManager} />
    </div>
  );
}
```

### ResizeHandle Interface

```typescript
interface ResizeHandleProps {
  side: "left" | "right";             // Which side of the layout
  panelWidth: number;                 // Current width of the adjacent panel
  onResize: (width: number) => void;  // Called on drag with new width
  onCollapse: () => void;             // Called when dragged below collapseThreshold
  min: number;                        // Minimum allowed width in px
  max?: number;                       // Optional maximum width in px
  collapseThreshold: number;          // Width below which panel auto-collapses
}
```

The handle is a 4px-wide vertical bar using `cursor: col-resize`. It highlights with `var(--blue)` on hover. Drag logic attaches `mousemove`/`mouseup` listeners to `document` for reliable tracking outside the handle element.

### Resize Width Constraints

Each resize callback constrains the panel width to prevent overlapping with the opposite panel:

```typescript
const handleLeftResize = useCallback((w: number) => {
  const rightSpace = rightCollapsed ? 20 : rightWidth + 4;
  const maxLeft = window.innerWidth - rightSpace - 300 - 4;
  setLeftWidth(Math.min(w, maxLeft));
}, [rightCollapsed, rightWidth]);
```

The center panel has `min-width: 300px` enforced via CSS (`.center-panel`).

### Header Component

```tsx
function Header({ onSwitchProject }: { onSwitchProject: () => void }) {
  // Left side:
  //   - Logo text "Bonsai" (purple, font-weight 600)
  //   - Project button (calls onSwitchProject, shows projectName from uiStore)
  //   - Board / Sessions view-switcher tablist
  //   - Multi-client presence indicator (hidden when only one client connected)
  // Right side:
  //   - `.header-settings-btn` gear icon -> opens <SettingsModal />
}
```

The gear button is the only right-side affordance. It opens `SettingsModal`,
which has four nav tabs:

| Tab | Renders | Source of truth |
|-----|---------|-----------------|
| Themes | `THEMES` from `utils/theme.ts`, applies via `applyTheme()` | `localStorage` |
| Session Defaults | Model / permission mode / effort / max-turns form | AppStore (`session_defaults`) via RPC |
| Server Info | Hostname, version, port; "copy URL" affordances | `serverInfoStore` |
| Settings | Inline editor for `.bonsai/settings.json` | Project file |

Theme switching, server info, and session-default editing all live inside this
modal — there are no standalone header buttons for them.

### StatusBar Component

```typescript
interface StatusBarProps {
  onOpenSessionManager: () => void;
}

function StatusBar({ onOpenSessionManager }: StatusBarProps) {
  // Left side: spec counts (total, done, pending), clickable session count,
  //            pending attention count (gold, from notificationStore)
  // Right side: keyboard shortcut hints (Mod+T, Mod+B, Mod+J, Mod+K)
}
```

Clicking the session count in the status bar triggers `onOpenSessionManager`, which toggles the center panel between `SessionPanel` and `SessionManager`.

### SessionPanel / SessionManager Toggling

The center panel below `<Outlet />` switches between two views:

- **SessionPanel** (default): Shows the session tab bar and active chat stream
- **SessionManager**: Full session management view with a "Back to sessions" button

The toggle state is local to AppShell (`showSessionManager` via `useState`). The `StatusBar` session count button opens the manager; the back button in the manager header closes it.

## Bootstrap Sequence

What happens on app load (`main.tsx` and `App.tsx`):

```
1. Apply theme from localStorage (before React mount, avoids flash):
   applyTheme(getThemePreference())
2. Construct backend address dynamically:
   - DEV:  BACKEND = "localhost:8000", WS_PROTO = "ws:"
   - PROD: BACKEND = location.host,    WS_PROTO matches page protocol
3. Mount React app (<StrictMode> -> <Root>)
4. Show ProjectPicker full-screen (no close button, no project yet)
5. On project selection:
   a. Build WebSocket URL: ws[s]://<BACKEND>/ws?project=<encodedPath>
   b. Create RpcProvider keyed on projectPath
   c. Render App component (BrowserRouter, keyboard shortcuts, viewport tracking)
6. On WebSocket "connected" state:
   a. Wire event subscriptions: wireEvents(client)
   b. Set project in uiStore: setProject(projectPath)
   c. Fetch initial data:
      - spec/list  -> specStore.fetchSpecs()
      - spec/graph -> specStore.fetchGraph()
7. UI state restoration is automatic via Zustand persist middleware
   (panel visibility, active tabs restored from localStorage)
8. Render AppShell via route match
```

### Reconnection

When `connectionState` transitions to `"disconnected"` or `"failed"`, the `wiredRef` flag resets. On reconnection (state returns to `"connected"`), events are re-wired and initial data is re-fetched automatically.

## Global Keyboard Shortcuts

Registered once at the app level (`utils/keyboard.ts`), via `useEffect(() => registerKeyboardShortcuts(), [])` in `App.tsx`:

**Modifier key:** `Mod` = Ctrl on macOS, Alt on Linux/Windows.

| Shortcut | Action | Handler |
| --- | --- | --- |
| `Mod+K` | Open command palette | `uiStore.togglePalette()` |
| `Mod+T` | New session modal | `uiStore.openModal()` |
| `Mod+J` | Toggle right panel | `uiStore.toggleRightPanel()` |
| `Mod+B` | Toggle left panel | `uiStore.toggleLeftPanel()` |
| `Escape` | Close modal/palette | Closes topmost: palette first, then modal |

**Implementation:** Single `keydown` listener on `document`, routing to actions based on key combos. All shortcuts except `Escape` are disabled when a text input (`<input>`, `<textarea>`, or `contentEditable`) is focused. The `Mod+B` handler checks the platform-appropriate modifier (Ctrl on macOS, Alt on Linux/Windows) to avoid conflicts with the browser bold shortcut.

## Naming Conventions

| Element | Convention | Example |
| --- | --- | --- |
| Component files | PascalCase | `ChatStream.tsx` |
| Component folders | PascalCase | `ChatStream/` |
| Store files | camelCase | `sessionStore.ts` |
| Utility files | camelCase | `theme.ts` |
| Type files | camelCase | `spec.ts` |
| CSS classes | kebab-case | `.chat-stream` |
| CSS variables | kebab-case with `--` prefix | `--bg`, `--blue` |
| Zustand hooks | `use{Store}Store` | `useSessionStore` |
| API methods | `{domain}Api.{method}` | `specApi.list()` |

## Build Configuration

### Vite

```typescript
// vite.config.ts
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/ws": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
      "/terminal": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
```

- Dev server on port 3000, proxies WebSocket paths to backend on 8000
- `resolve.alias` maps `@/` to `src/` for clean imports
- Proxy target uses `http://` (not `ws://`) with `changeOrigin: true`
- No custom `build` section -- Vite defaults apply

### TypeScript

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

`baseUrl` is `.` (project root), not `src`. Path alias `@/` maps to `src/` for clean imports: `import { useSpecs } from "@/api/hooks/useSpecs"`.

## Testing Strategy (Overview)

| Layer | Tool | Pattern |
| --- | --- | --- |
| Unit tests | Vitest | Store actions, utility functions, API method wrappers |
| Component tests | Vitest + Testing Library | Render components with mocked stores, assert DOM |
| Integration tests | Vitest + MSW | Mock WebSocket, test full event flows |
| E2E tests | Playwright (future) | Full app with real backend |

Test files colocated with source: `ChatStream.test.tsx` next to `ChatStream.tsx`.

## Dependencies Summary

| Package | Purpose |
| --- | --- |
| `react` + `react-dom` | UI framework |
| `react-router-dom` | Client-side routing |
| `zustand` | State management |
| `@monaco-editor/react` + `monaco-editor` | Code viewer / editor (FileViewer) |
| `react-markdown` + `remark-gfm` | Markdown rendering |
| `mermaid` | Diagram rendering |

Dev dependencies: `@vitejs/plugin-react`, `typescript`, `vite`, `vitest`, `eslint`, `@testing-library/react`, `@types/react`, `@types/react-dom`.

No CSS framework -- intentionally minimal. Monaco and Mermaid are the heaviest runtime dependencies.

## Known Limitations

- **No multi-window:** Cannot pop out panels into separate browser windows
- **Panel widths not persisted:** Resize widths (`leftWidth`/`rightWidth`) are local component state and reset on reload; only panel collapsed/expanded state and active tabs are persisted via Zustand persist middleware
- **Single WebSocket per project:** Opening a second browser tab for the same project creates a separate connection

## Related Specs

- **Parent:** [Web View](WEBVIEW.md)
- **Depends on:** [State Management](../src/store/README.md) (uiStore), [API Client](../src/api/README.md) (bootstrap sequence)
- **Related:** [Responsive Behavior](RESPONSIVE_BEHAVIOR.md) (breakpoints, panel collapse), [Theming](THEMING.md) (CSS variables)
