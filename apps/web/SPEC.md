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
| `auth` | in-app provider login: the presentational OAuth dialog + its client-side state reducer | yes | [auth/SPEC.md](src/auth/SPEC.md) |
| `shell` | the responsive frame + composition of panels | no | [shell/SPEC.md](src/shell/SPEC.md) |
| `components` | the app's single `ErrorBoundary` primitive (contains the `ui/` sub-module) | no | [components/SPEC.md](src/components/SPEC.md) |
| `components/ui` | shadcn primitives, themed with our tokens | no | [components/ui/SPEC.md](src/components/ui/SPEC.md) |
| `lib` | `cn()` (clsx + tailwind-merge) | yes | [lib/SPEC.md](src/lib/SPEC.md) |

Leaf utilities without their own spec: `constants/` (branding), `utils/` (font scaling + `theme` — the
`applyTheme(id)` `[data-theme]` swap, the `THEMES` picker list, and the localStorage first-paint hint),
`styles/` (the CSS token theme contract — see Styling & theming). `main.tsx` is the entry/composition
root — it applies the font scale + the cached theme hint pre-React, then wraps `<Shell />` in
`components/ErrorBoundary` as the last-resort boundary (a crash escaping every region shows a reload
screen, not a blank root).

### Dependency graph

- `shell` → `panels`, `store`, `transport`, `components/ui`, `components` (`ErrorBoundary` around each mounted region), `constants`, `utils` (`theme` — the single owner of the `applyTheme` DOM effect, driven by `store.theme`)
- `panels` → `store`, `transport`, `components/ui`, `components` (`ErrorBoundary` — `CenterTabs`'s per-tab boundary), `lib`, `contracts`, `constants` (`WelcomePanel`'s wordmark), `chat` (`CenterTabs` lazy-mounts `chat/ChatView`; `NewWorkspaceDialog` eagerly reuses `chat/ModelSelector`+`ThinkingSelector` — these are shiki-free, so the eager import stays split-safe), `auth` (`ProvidersSettings` mounts `auth/LoginDialog`), `utils` (`AppearanceSettings`'s theme picker uses `theme`'s `THEMES`)
- `chat` → `contracts` (pi message types, **type-only**), `components/ui`, `lib`; `store` + `transport` (**`ChatView` only** — the renderers are store-free)
- `auth` → `components/ui` (the dialog is store/transport-free — the panel integrates it; the state types need no imports)
- `store` → `transport` (**type-only** — `ConnectionStatus`), `chat` (**type-only** — `ChatTurn`/`ToolResultState`), `auth` (**type-only** — `LoginState`; the `foldLoginFrame` reducer lives in `store`, like `reduceExtUi`), `contracts`
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
  theme swap = changing the token block via `[data-theme="…"]` on `<html>` (`utils/theme` `applyTheme(id)`)
  — nothing in components changes. `@theme inline` keeps utilities pointing at the live `var(--token)`, so
  the swap re-themes everything. **Ships four themes** — **Dark** (default, under `:root`), **Light**,
  classic IntelliJ **Darcula**, and **Gruvbox** (the vim classic — warm retro darks; the one theme that
  swaps the interactive accent to gruvbox orange with dark-on-accent text, so a `[data-theme]` block MAY
  override the accent family when the palette demands it). Theme blocks override only the semantic
  surface/text/status tokens + `color-scheme` (+ `--ansi-*`/`--code-*`/accent where the theme calls for
  it); type scale, spacing, radii, fonts stay shared in `:root`. The choice is **server-synced** (`AppConfig.theme`, host-owned): it arrives in
  `server.welcome`, is set from the store's `theme` (fed by transport), applied by the shell's one theme
  effect, and cached in `localStorage` only as a **first-paint hint** (`main.tsx` applies it pre-React so
  the initial paint matches, before the welcome reconciles it). Changed via `settings.update`, converged on
  the `settings.changed` broadcast. The token vocabulary also carries the code surfaces: **`--ansi-*`**
  (the 16 xterm colors — light overrides them, dark-tuned brights wash out on white) and optional
  **`--code-*`** syntax colors (set by Darcula, whose identity is its syntax palette; unset elsewhere).
  Code surfaces that own their own theming track the swap: **xterm** and **Monaco** observe
  `[data-theme]` and rebuild from the tokens (Monaco also picks its `vs`/`vs-dark` base from it, and
  derives token rules from `--code-*`); **shiki** renders the tri palette (dark+light+darcula, the
  darcula registration in `lib/shikiTheme.ts`) as CSS vars, flipped by the `[data-theme]` rules in
  `global.css`; **mermaid** re-derives from the tokens. **Reading color tokens from JS goes through
  `lib.cssColorToHex`** — the built CSS is minified, so `getComputedStyle` can return any equivalent form
  (`#fff`, `gray`), which strict consumers (Monaco, xterm) reject. Text/status token values hold a contrast floor (body ≥
  4.5:1, `--muted` ≥ 4.5:1 on its worst surface, `--hint` ≥ 3:1 — see the note in `tokens.css`).
  Structured for N (pibun's theme engine, lifted at V2).
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
