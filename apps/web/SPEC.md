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
| `themes` | validated single-file manifests, bundled catalog + atomic token application | yes | [themes/SPEC.md](src/themes/SPEC.md) |
| `lib` | `cn()` + small shared UI/highlighting helpers | yes | [lib/SPEC.md](src/lib/SPEC.md) |

Leaf utilities without their own spec: `constants/` (branding), `utils/` (font scaling), and `styles/`
(the structural/derived CSS token contract — theme-specific values belong to `themes`). `main.tsx` is the
entry/composition root — it synchronously builds the bundled theme catalog, then applies the font scale +
the cached first-paint theme hint pre-React before wrapping `<Shell />` in
`components/ErrorBoundary` as the last-resort boundary (a crash escaping every region shows a reload
screen, not a blank root).

### Dependency graph

- `shell` → `panels`, `store`, `transport`, `components/ui`, `components` (`ErrorBoundary` around each mounted region), `constants`, `themes` (the single owner of the atomic `applyTheme` DOM effect, driven by `store.theme`)
- `panels` → `store`, `transport`, `components/ui`, `components` (`ErrorBoundary` — `CenterTabs`'s per-tab boundary), `lib`, `contracts`, `constants` (`WelcomePanel`'s wordmark), `chat` (`CenterTabs` lazy-mounts `chat/ChatView`; `NewWorkspaceDialog` eagerly reuses `chat/ModelSelector`+`ThinkingSelector` — these are shiki-free, so the eager import stays split-safe; `TemplatesSettings` reuses `chat/TemplateEditorDialog` for its New/Edit flows — see `panels/SPEC.md`'s `TemplatesSettings` paragraph), `auth` (`ProvidersSettings` mounts `auth/LoginDialog`), `themes` (`AppearanceSettings` consumes the live catalog; code surfaces consume generic theme variables/syntax mapping)
- `chat` → `contracts` (pi message types, **type-only**), `components/ui`, `lib`; `store` + `transport`
  (**`ChatView` + `useHistorySearch.ts` + `TemplateEditorDialog.tsx` only** — the renderers stay store-free)
- `auth` → `components/ui` (the dialog is store/transport-free — the panel integrates it; the state types need no imports)
- `store` → `transport` (**type-only** — `ConnectionStatus`), `chat` (**type-only** — `ChatTurn`/`ToolResultState`), `auth` (**type-only** — `LoginState`; the `foldLoginFrame` reducer lives in `store`, like `reduceExtUi`), `contracts`
- `transport` → `contracts`, `store` (welcome routing; the `store → transport` back-edge is type-only, so
  the runtime graph is acyclic)
- `components` (`ErrorBoundary`) → none internal (React + `lucide-react` only, so any region can wrap in it); `components/ui` → `lib`
- `lib` → `themes` (the lazy highlighter uses the one generic CSS-variable Shiki registration)
- `themes` → `constants` (the branding storage prefix scopes the first-paint hint)
- leaves (`constants`, `utils`, `styles`) → none internal

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
- **`src/themes` is the theme contract and catalog; `src/styles/tokens.css` is structural.** A bundled
  theme is one strict, complete `*.theme.json` manifest: appearance/contrast metadata + semantic UI
  colors + all 16 ANSI colors + a semantic syntax palette. Selected-text foreground overrides are the
  only nullable color slots (`null` retains the consumer default). A build-time glob validates the set at
  bootstrap (our files — a bad one fails loudly), so adding a theme changes only that file — never
  contracts, a label map, CSS selectors, editor imports, tests, or specs — and appears after a rebuild.
  Manifests are self-contained (no inheritance), contain canonical color data only, and cannot alter
  layout/type/motion or inject CSS/code. The engine derives repetitive tints/effects and atomically
  writes the mapped custom properties before changing `[data-theme]`; `@theme inline` keeps every utility
  pointed at the live variables, so components remain unchanged. `tokens.css` retains typography,
  spacing, radii, fonts, motion, and generic derived formulas, but no named theme blocks.
- The selected id is **server-synced** (`AppConfig.theme`, host-owned and opaque): it arrives in
  `server.welcome`, is folded into the store by transport, applied by the shell, and cached in localStorage
  only as a first-paint hint. `settings.update` converges through `settings.changed`; an unavailable id
  renders the bundled default without destructively rewriting the requested value. Themes ship with the
  app: one is added only via a source PR, and runtime registration/extension loading is deliberately not
  designed.
- **Every code surface is catalog-agnostic.** xterm and Monaco rebuild from generic variables after the
  atomic `[data-theme]` signal, including an optional selected-text foreground. Monaco chooses
  `vs`/`vs-dark` or the corresponding high-contrast base from manifest appearance/contrast metadata,
  never a theme id. Shiki uses one code-owned TextMate scope map whose colors are semantic CSS variables, so it needs
  no per-theme import/selector or re-highlight. Mermaid re-derives from the same variables. Reads for
  strict consumers still pass through `lib.cssColorToHex`. Data-driven tests enforce the existing
  contrast floor (body/muted ≥ 4.5:1 and hint ≥ 3:1 on the primary declared surfaces) for every discovered
  manifest.
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
