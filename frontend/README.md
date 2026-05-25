---
id: frontend-module
type: module-design
status: active
title: Frontend Module
parent: design-doc
depends-on:
- goal-and-requirements
covers:
- frontend/
tags:
- frontend
- module
- react
- typescript
---
# Frontend Module — Design Specification

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-02

## Table of Contents
1. [Purpose](#purpose)
2. [Internal Architecture](#internal-architecture)
3. [File Organization](#file-organization)
4. [Public Interface](#public-interface)
5. [Design Decisions](#design-decisions)
6. [Dependencies](#dependencies)
7. [Known Limitations](#known-limitations)
8. [Sub-Specifications](#sub-specifications)
9. [Related Specs](#related-specs)

## Purpose

The Frontend module is a React/TypeScript single-page application that provides the Bonsai web workspace. It communicates with the Python backend over a single WebSocket (JSON-RPC 2.0), renders agent sessions as a custom Chat UI, visualizes the spec hierarchy, and provides tools for spec-driven development.

## Internal Architecture

**Pattern:** Layered — transport (API client) → state (Zustand stores) → presentation (React components). React Router handles navigation. All components reference CSS custom properties for theming.

```
┌──────────────────────────────────────────────────────────┐
│  Presentation Layer (React Components)                    │
│    AppShell · ChatStream · GraphView · SessionPanel       │
│    CommandPalette · Notifications · DiffViewer · Console  │
│    SessionManager · SpecView · CodeView                   │
├──────────────────────────────────────────────────────────┤
│  State Layer (Zustand)                                    │
│    specStore · sessionStore · uiStore                     │
│    costStore · notificationStore                          │
├──────────────────────────────────────────────────────────┤
│  Transport Layer (API Client)                             │
│    RpcClient (WebSocket + JSON-RPC 2.0)                   │
│    Method wrappers · React hooks · Event subscriptions    │
├──────────────────────────────────────────────────────────┤
│  Routing (React Router)                                   │
│    /workspace · /workspace/spec/:id · /workspace/session/:id │
└──────────────────────────────────────────────────────────┘
         │
         │ WebSocket (JSON-RPC 2.0)
         ▼
    FastAPI Backend (/ws)
```

## File Organization

| Directory | Responsibility | Spec |
| --- | --- | --- |
| `src/api/` | WebSocket/JSON-RPC client, typed method wrappers, React hooks | [API_CLIENT](src/api/README.md) |
| `src/store/` | Zustand stores (spec, session, UI, cost, notifications) | [STATE_MANAGEMENT](src/store/README.md) |
| `src/components/AppShell/` | Three-panel layout, header, status bar, resize handles | [APP_SHELL](ui-specs/APP_SHELL.md) |
| `src/components/ChatStream/` | Agent event rendering, streaming text, tool cards, SuggestionCard for session suggestions | [CHAT_UI](ui-specs/CHAT_UI.md) |
| `src/components/GraphView/` | Spec hierarchy graph, layered drill-down, breadcrumb | [GRAPH_INTERACTIONS](ui-specs/GRAPH_INTERACTIONS.md) |
| `src/components/SessionPanel/` | Session tab bar, "+ New" draft button, draft config card, active session display | [CENTER_PANEL](ui-specs/CENTER_PANEL.md) |
| `src/components/CommandPalette/` | Fuzzy search, prefix modes, action registry | [COMMAND_PALETTE](ui-specs/COMMAND_PALETTE.md) |
| `src/components/Notifications/` | Toast queue, tab badges, status bar alerts | [NOTIFICATION_SYSTEM](ui-specs/NOTIFICATION_SYSTEM.md) |
| `src/components/DiffViewer/` | Spec+code side-by-side diff, mapping files | [DIFF_VIEWER](ui-specs/DIFF_VIEWER.md) |
| `src/components/Console/` | xterm.js terminal emulator, multiple tabs | [CONSOLE](src/components/Console/README.md) |
| `src/components/FileViewer/` | Monaco Editor-based file viewer/editor with IntelliJ Darcula theme, preview/edit modes, Edit dropdown (IDE / in-place) | — |
| `src/components/FileTree/` | IntelliJ-style project file tree with indent guides, collapsible dirs, double-click to open | — |
| `src/components/SessionManager/` | Session list (active + archived from disk), continue/delete actions, status bar integration | — |
| `src/components/ProjectPicker/` | Project directory picker with text input, recent projects, create new | — |
| `src/components/SpecView/` | Markdown renderer, edit mode, agent nudge | — (in WEBVIEW.md §4.2) |
| `src/components/CodeView/` | Syntax-highlighted code viewer | — (in WEBVIEW.md §4.3) |
| `src/styles/` | CSS custom properties, dark/light themes | [THEMING](ui-specs/THEMING.md) |
| `src/types/` | Shared TypeScript interfaces (spec, agent, session, RPC). Includes **generated** `ws-events.ts` from backend Pydantic models. | — |
| `src/api/generated.ts` | **Generated** — REST API TypeScript types from backend OpenAPI schema. DO NOT EDIT. | — |
| `src/services/` | REST API clients (files, fs, project, projects, serverInfo) using generated types. `services/projects.ts` exposes the tokenless `/api/projects/known` GET/POST/DELETE for the project picker. | — |
| `src/utils/` | Formatting, markdown, keyboard shortcuts | — |

## Public Interface

The frontend exposes no programmatic API — it's an end-user web application. Its "interface" is the browser UI documented in [WEBVIEW.md](ui-specs/WEBVIEW.md).

### Entry Points

| File | Purpose |
| --- | --- |
| `src/main.tsx` | App bootstrap: mount React, init RpcClient, wire events |
| `src/App.tsx` | Root component: providers (RPC, Router) + global overlays |
| `src/routes.tsx` | React Router route definitions |
| `index.html` | Vite entry HTML |

### Build Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server (port 3000, proxies /ws and /api to backend) |
| `npm run build` | Production build → `dist/` (auto-runs `generate` via prebuild hook) |
| `npm run generate` | Regenerate all TypeScript types from backend Pydantic models |
| `npm run generate:schema` | Export OpenAPI schema from FastAPI → `openapi.json` |
| `npm run generate:api` | `openapi.json` → `src/api/generated.ts` (via openapi-typescript) |
| `npm run generate:ws-schema` | Export WS event JSON Schema → `ws-events.json` |
| `npm run generate:ws-types` | `ws-events.json` → `src/types/ws-events.ts` (via json2ts) |
| `npm run test` | Run Vitest |
| `npm run lint` | TypeScript + ESLint check |

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Framework | React 19 | Specified in GOAL&REQUIREMENTS.md. Mature ecosystem, wide adoption. |
| State management | Zustand (5 stores) | 1KB, hook-based, no boilerplate. Stores split by domain for isolation. |
| Routing | React Router 7 | Deep linking support. URL reflects selected spec/session. Browser history integration. |
| Build tool | Vite 6 | Fast HMR, native ESM, simple config. Production builds via Rollup. |
| Graph visualization | No library (DOM + SVG) | Layered view shows ≤15 nodes. Libraries (D3/React Flow/Cytoscape) add 80-170KB for no benefit. |
| Terminal emulator | xterm.js | Industry standard. Separate WebSocket for data stream. Lazy-loaded. |
| CSS approach | CSS custom properties | No CSS-in-JS. Variables for theming. Global styles in `src/styles/`. Component styles colocated. |
| API client | Custom (no library) | JSON-RPC 2.0 is simple enough (~100 lines). No need for external RPC library. |

## Dependencies

| Package | Size (gzipped) | Purpose |
| --- | --- | --- |
| `react` + `react-dom` | ~45KB | UI framework |
| `react-router-dom` | ~15KB | Client-side routing |
| `zustand` | ~1KB | State management |
| `@xterm/xterm` + addons | ~105KB | Terminal emulator (lazy-loaded) |
| `@monaco-editor/react` | ~2-5MB (lazy) | Code editor (VS Code engine, CDN-loaded) |
| `react-markdown` + `remark-gfm` | ~15KB | Markdown preview rendering (GFM) |
| `remark-frontmatter` | ~2KB | YAML frontmatter parsing for markdown preview (collapsible card) |
| `mermaid` | ~200KB | Diagram rendering in markdown (flowcharts, sequence, class, etc.) |
| **Total** | **~387KB** + Monaco (lazy) | |

Dev dependencies: `vite`, `typescript`, `vitest`, `@testing-library/react`, `eslint`.

## Known Limitations

- **Single WebSocket connection:** Matches backend constraint. No multi-tab support (opening a second browser tab would disconnect the first).
- **No offline support:** App requires live backend connection. All data fetched from server; no service worker or offline cache.
- **No SSR:** Client-side rendered SPA only. No server-side rendering or static generation.
- **Session history in-memory (v1):** Archived sessions lost on page refresh. Backend persistence planned for v2.
- **No i18n:** English only. No internationalization framework.

## Sub-Specifications

### Infrastructure (co-located with code)

| Spec | Path | Purpose |
| --- | --- | --- |
| API Client | [src/api/README.md](src/api/README.md) | WebSocket/JSON-RPC client, reconnection, typed wrappers |
| State Management | [src/store/README.md](src/store/README.md) | Zustand stores, event wiring, persistence |
| Console | [src/components/Console/README.md](src/components/Console/README.md) | xterm.js integration, terminal lifecycle |

### UI Specifications (in ui-specs/)

| Spec | Path | Purpose |
| --- | --- | --- |
| Web View (top-level UI) | [ui-specs/WEBVIEW.md](ui-specs/WEBVIEW.md) | Three-panel layout, all views, keyboard shortcuts |
| Chat UI Rendering | [ui-specs/CHAT_UI.md](ui-specs/CHAT_UI.md) | Agent event → component mapping, streaming |
| Graph Interactions | [ui-specs/GRAPH_INTERACTIONS.md](ui-specs/GRAPH_INTERACTIONS.md) | Layered drill-down, layout, edges |
| Center Panel | [ui-specs/CENTER_PANEL.md](ui-specs/CENTER_PANEL.md) | Tab bar, "+ New" draft, session/file viewer |
| Command Palette | [ui-specs/COMMAND_PALETTE.md](ui-specs/COMMAND_PALETTE.md) | Fuzzy search, prefix modes |
| Notification System | [ui-specs/NOTIFICATION_SYSTEM.md](ui-specs/NOTIFICATION_SYSTEM.md) | Toasts, badges, sound |
| Diff Viewer | [ui-specs/DIFF_VIEWER.md](ui-specs/DIFF_VIEWER.md) | Spec-to-code mapping, side-by-side |
| Theming | [ui-specs/THEMING.md](ui-specs/THEMING.md) | CSS variables, dark/light mode |
| Responsive Behavior | [ui-specs/RESPONSIVE_BEHAVIOR.md](ui-specs/RESPONSIVE_BEHAVIOR.md) | Breakpoints, panel collapse |
| App Shell | [ui-specs/APP_SHELL.md](ui-specs/APP_SHELL.md) | Component tree, routing, bootstrap |
| Context Panel | [ui-specs/CONTEXT_PANEL.md](ui-specs/CONTEXT_PANEL.md) | Context-aware right panel, auto-switching modes |

## Related Specs

- **Parent:** [Architecture Design](../DESIGN_DOC.md)
- **Depends on:** [Goal & Requirements](../GOAL&REQUIREMENTS.md)
- **Consumes:** [RPC Module](../backend/app/rpc/README.md) (WebSocket API)
- **Consumes:** [Spec Module](../backend/app/spec/README.md) (data model)
- **Consumes:** [Agent Module](../backend/app/agent/README.md) (session events)
