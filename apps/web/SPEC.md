---
id: module-web
type: module-design
status: active
title: Web UI client
parent: architecture
depends-on: [module-contracts]
tags: [v1, ui]
---

## Responsibility

The mobile-first React UI. Ships as static assets and dials an engine host over the wire. Renders `pi`'s
event stream as a chat-centric, multi-session IDE shell.

## Boundary

- **Owns:** the browser UI — transport client, store, panels, the responsive shell, branding tokens.
- **Public surface:** the built static bundle (`dist/`) — a deployable artifact that dials a host.
- **Allowed deps:** `@thinkrail/contracts` (types + WS constants) ONLY; React / Zustand / Vite / etc.
- **Forbidden:** importing `server` / `shared` / any `pi` package (value or type). Kept clean by type-only
  imports + `verbatimModuleSyntax` (a `dist/` build shows no provider SDK / `node:fs`).

## Internal modules

Each is a bounded sub-module; `transport`/`store`/`lib` expose an `index.ts` **barrel** (their only public
surface). `panels`/`components/ui`/`chat` are imported **per-file by design** — barreling them would pull
the lazily-loaded Monaco/shiki/xterm chunks into the eager bundle and break the shadcn per-primitive
convention; their boundary is held by convention + spec. Sibling edges live here, not in the leaves.

| module | owns | barrel | spec |
| --- | --- | --- | --- |
| `transport` | the WS client + its singleton/store wiring | yes | [transport/SPEC.md](src/transport/SPEC.md) |
| `store` | Zustand: connection, projects/workspaces, workspace-scoped tabs + terminals | yes | [store/SPEC.md](src/store/SPEC.md) |
| `panels` | layout-agnostic, store-driven feature views | no | [panels/SPEC.md](src/panels/SPEC.md) |
| `chat` | pi conversation UI primitives: content-block renderers + the tool-renderer registry | no | [chat/SPEC.md](src/chat/SPEC.md) |
| `shell` | the responsive frame + composition of panels | no | [shell/SPEC.md](src/shell/SPEC.md) |
| `components` | the app's single `ErrorBoundary` primitive (contains the `ui/` sub-module) | no | [components/SPEC.md](src/components/SPEC.md) |
| `components/ui` | shadcn primitives, themed with our tokens | no | [components/ui/SPEC.md](src/components/ui/SPEC.md) |
| `lib` | `cn()` (clsx + tailwind-merge) | yes | [lib/SPEC.md](src/lib/SPEC.md) |

Leaf utilities without their own spec: `constants/` (branding), `utils/` (font scaling), `styles/` (the
CSS token theme contract — see Styling & theming). `main.tsx` is the entry/composition root — it wraps
`<Shell />` in `components/ErrorBoundary` as the last-resort boundary (a crash escaping every region
shows a reload screen, not a blank root).

### Dependency graph

- `shell` → `panels`, `store`, `transport`, `components/ui`, `components` (`ErrorBoundary` around each mounted region), `constants`
- `panels` → `store`, `transport`, `components/ui`, `components` (`ErrorBoundary` — `CenterTabs`'s per-tab boundary), `lib`, `contracts`, `constants` (`WelcomePanel`'s wordmark), `chat` (`CenterTabs` lazy-mounts `chat/ChatView`; `NewWorkspaceDialog` eagerly reuses `chat/ModelSelector`+`ThinkingSelector` — these are shiki-free, so the eager import stays split-safe)
- `chat` → `contracts` (pi message types, **type-only**), `components/ui`, `lib`; `store` + `transport` (**`ChatView` only** — the renderers are store-free)
- `store` → `transport` (**type-only** — `ConnectionStatus`), `chat` (**type-only** — `ChatTurn`/`ToolResultState`), `contracts`
- `transport` → `contracts`, `store` (welcome routing; the `store → transport` back-edge is type-only, so
  the runtime graph is acyclic)
- `components` (`ErrorBoundary`) → none internal (React + `lucide-react` only, so any region can wrap in it); `components/ui` → `lib`
- leaves (`lib`, `constants`, `utils`, `styles`) → none internal

Rules: a panel never imports another panel sideways; nothing imports `shell` (it's the composition root).

The module set: `transport` / `store` / branded `shell`; `ProjectTree`; `FileTree` + `RightPanel`;
`CenterTabs` + lazy `MonacoEditor`; `ChangesPanel` + lazy `DiffViewer`; `TerminalsPanel` + lazy
`TerminalInstance`. The `chat` module — `ChatView` + content-block renderers + the tool-renderer registry
— plus the full `Composer` (model/effort/@-mentions).

## Styling & theming

- **Tailwind v4 utilities, mapped to the design tokens** (`src/index.css` `@theme inline`). Components
  use utilities (`bg-bg-dark`, `text-primary`, `border-border`, `px-lg`, `text-lg`) — **never inline
  `style` objects, never raw hex.** Responsive (`md:` …) and states (`hover:` / `focus-visible:`) come
  from Tailwind (inline styles can't express them, and the responsive shell needs them).
- **`src/styles/tokens.css` is the theme contract.** A *theme* is one set of CSS custom properties; a
  theme swap = changing the token block via `[data-theme="…"]` on `<html>` (`applyTheme(id)`) — nothing
  in components changes. `@theme inline` keeps utilities pointing at the live `var(--token)`, so the swap
  re-themes everything. V1 ships one dark theme, structured for N (pibun's theme engine, lifted at V2).
- Token names that collide with Tailwind namespaces (`--font-mono`, `--font-accent`, `--radius-*`) are
  used as token arbitrary values (`font-[var(--font-accent)]`), not `@theme` mappings.
- **Icons: `lucide-react`. Components: shadcn/ui** (Radix primitives), copy-in under `src/components/ui/`
  and themed with our token utilities (`cn()` in `src/lib/utils.ts`) — never shadcn's default oklch
  palette. Use these for accessible menus / dialogs / tooltips.

## Get right

- **`apps/web` depends on `packages/contracts` only.** Never value-import `pi`; never import `server`/`shared`.
- Streaming invariant: `text_delta` / `thinking_delta` **APPEND**; `tool_execution_update.partialResult`
  **REPLACE**.
- Panels stay arrangement-agnostic so the mobile shell is an additive layer, not a rewrite.

## Later

The mobile single-view shell and PWA packaging (installable, offline shell) ride on this split without
touching panels or store.
