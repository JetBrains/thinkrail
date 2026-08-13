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
| `lib` | `cn()` + the shared UI/path/array primitives + highlighting | yes | [lib/SPEC.md](src/lib/SPEC.md) |

Leaf utilities without their own spec: `constants/` (branding) and `styles/` — which holds the two
design-system SOURCES (`typography.json`, `colors.json`), their generated CSS, and the structural token
contract; per-theme palettes belong to `themes`. Each system is specced beside its source:
[TYPOGRAPHY.md](src/styles/TYPOGRAPHY.md) and [COLOR.md](src/styles/COLOR.md).
Outside `src/`, **[`scripts/`](scripts/SPEC.md)** is the build-time generator module — it runs under Bun,
never ships, and turns those two JSON sources into `styles/generated/`.
`index.html` names the product and links the local, symbol-only SVG favicon derived from the same
ThinkRail artwork as the shell logo (compact enough for browser-tab sizes and light/dark browser chrome).
`main.tsx` is the entry/composition root — it synchronously builds the bundled theme catalog, then
applies the cached first-paint theme hint pre-React before wrapping `<Shell />` in
`components/ErrorBoundary` as the last-resort boundary (a crash escaping every region shows a reload
screen, not a blank root).

### Dependency graph

- `shell` → `panels`, `store`, `transport`, `contracts` (type-only), `components/ui`, `components` (`ErrorBoundary` around each mounted region), `constants`, `themes` (the single owner of the atomic `applyTheme` DOM effect, driven by `store.theme`)
- `panels` → `store`, `transport`, `components/ui`, `components` (`ErrorBoundary` — `CenterTabs`'s per-tab boundary), `lib`, `contracts`, `constants` (`WelcomePanel`'s wordmark), `chat` (`CenterTabs` lazy-mounts `chat/ChatView`; `NewWorkspaceDialog` eagerly reuses `chat/ModelSelector`+`ThinkingSelector`+`useModelCatalog` — these are shiki-free, so the eager import stays split-safe; `TemplatesSettings` reuses `chat/TemplateEditorDialog` for its New/Edit flows — see `panels/SPEC.md`'s `TemplatesSettings` paragraph), `auth` (`ProvidersSettings` mounts `auth/LoginDialog`), `themes` (`AppearanceSettings` consumes the live catalog; code surfaces consume generic theme variables/syntax mapping)
- `chat` → `contracts` (pi message types, **type-only**), `components/ui`, `lib`; `store` + `transport`
  (**app-integration files only** — the renderers stay store-free; see `chat/SPEC.md` for the current set)
- `auth` → `components/ui` (the dialog is store/transport-free — the panel integrates it; the state types need no imports)
- `store` → `transport` (**type-only** — `ConnectionStatus`), `chat` (**type-only** — `ChatTurn`/`ToolResultState`), `auth` (**type-only** — `LoginState`; the `foldLoginFrame` reducer lives in `store`, like `reduceExtUi`), `contracts`, `lib` (the shared path/array primitives — a leaf, so no cycle)
- `transport` → `contracts`, `store` (welcome routing; the `store → transport` back-edge is type-only, so
  the runtime graph is acyclic)
- `components` (`ErrorBoundary`) → `lib` only (`shallowEqualArrays` for its reset keys — a leaf, so any region can still wrap in it); `components/ui` → `lib`
- `lib` → `themes` (the lazy highlighter uses the one generic CSS-variable Shiki registration)
- `themes` → `constants` (the branding storage prefix scopes the first-paint hint)
- leaves (`constants`, `utils`, `styles`) → none internal

Rules: a panel never imports another panel sideways; nothing imports `shell` (it's the composition root).

The module set: `transport` / `store` / branded `shell`; `ProjectTree`; `FileTree` + `RightPanel`;
`CenterTabs` + lazy `MonacoEditor`/`MonacoDiff`; `ChangesPanel` (list → center diff tab); `TerminalsPanel` + lazy
`TerminalInstance`. The `chat` module — `ChatView` + content-block renderers + the tool-renderer registry
— plus the full `Composer` (model/effort/@-mentions).

## Styling & theming

- **Tailwind v4 utilities, mapped to the design tokens** (`src/index.css` `@theme inline`). Components
  use utilities for colour, spacing, borders and layout (`bg-container-header-bg`, `text-primary`,
  `border-border-default`,
  `px-lg`) and a **generated semantic typography class** for type (`tr-text-ui`, `tr-title-dialog`,
  `tr-code-text`, …) — **never inline `style` objects, never raw hex.** Responsive (`md:` …) and states (`hover:` / `focus-visible:`) come
  from Tailwind (inline styles can't express them, and the responsive shell needs them).
- **The colour and type systems are this app's, not the monorepo's.** `apps/website` keeps its own
  hardcoded stylesheet on purpose — a static page with no theming has no use for a token layer, and
  reaching across apps would couple them for nothing.
- **A colour utility names a semantic role, never a palette entry** — `bg-container-elevated-bg`, not
  `bg-[var(--elevated)]`; and a tint is a token on the four-step alpha scale, not a `/40` modifier.
  `src/styles/COLOR.md` is the system; `src/styles/colorUsage.test.ts` is the adoption guard (Tailwind
  drops an unknown utility silently, so an unpublished token renders as nothing at all).
- **`src/themes` is the theme contract and catalog; `src/styles/tokens.css` is structural.** A bundled
  theme is one strict, complete `*.theme.json` manifest: appearance/contrast metadata + semantic UI
  colors + all 16 ANSI colors + a semantic syntax palette. Selected-text foreground overrides are the
  only nullable color slots (`null` retains the consumer default). A build-time glob validates the set at
  bootstrap (our files — a bad one fails loudly), so adding a theme changes only that file — never
  contracts, a label map, CSS selectors, editor imports, tests, or specs — and appears after a rebuild.
  Manifests are self-contained (no inheritance), contain canonical color data only, and cannot alter
  layout/type/motion or inject CSS/code. The engine derives repetitive tints/effects and atomically
  writes the mapped custom properties before changing `[data-theme]`; `@theme inline` keeps every utility
  pointed at the live variables, so components remain unchanged. `tokens.css` retains the spacing basis,
  radii, motion and generic derived formulas — **no typography at all** (not a value and not an alias onto
  one; the `--font` / `--font-mono` / `--font-accent` / `--font-mono-size` / `--line-height` aliases are
  gone, because a second name for a value is what drifts) and no named theme blocks.
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
- Token names that collide with a Tailwind namespace (`--radius-*`) are used as token arbitrary values
  (`rounded-[var(--radius-md)]`), not `@theme` mappings.
- **Typography comes from `styles/typography.json` via generated semantic classes — nothing else.**
  `styles/generated/typography.css` (committed, regenerated by `bun run typography:generate`, drift-gated
  by `typography:check`) emits the primitive `--tr-*` custom properties, the `<body>` base, and one class
  per semantic style: `tr-brand-*`, `tr-heading-*`, `tr-title-*`, `tr-text-*`, `tr-code-*` plus one
  `tr-prose-<surface>` system per markdown surface (`tr-prose-chat`, `tr-prose-doc` — same element set,
  different scale, because a chat bubble and a rendered document need different heading ladders). A call
  site names exactly one class and adds its own **colour**; `italic` and `leading-*` are the only Tailwind
  utilities that may override a semantic style (the classes are emitted in `@layer components`, so a
  utility wins the single property it names, while the `<body>` base in `@layer base` loses to all of them).
- **Handwritten typography utilities must not be introduced.** No new `@utility` rule may set
  `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing` or `text-transform`, and no
  component may compose them — add a semantic style to `typography.json` instead. The former
  `text-mono` / `text-base-mono` / `text-brand` / `text-eyebrow` utilities and the
  `--text-xs|sm|base|md|lg` mappings are all gone; a generated class replaces each. `index.css` maps
  exactly two typography names — `--font-sans` / `--font-mono`, so Tailwind's *preflight* defaults for
  `html` and `code`/`pre` come from the JSON too; the `font-sans` / `font-mono` utilities that enables are
  banned at call sites. `styles/typographyUsage.test.ts` enforces all of it, including that a `tr-`
  class a component names is one the generator actually emits (an unknown class is dropped silently by
  Tailwind, so the element renders unstyled while the class list claims otherwise).
- **A primitive font family may only be named for a documented third-party integration.** Monaco
  (`panels/monacoSetup.ts`) reads the code family, `s11`, and the default line-height; xterm
  (`panels/TerminalInstance.tsx`) reads the code family + `s13` and owns its row height; mermaid
  (`chat/tools/visualize/mermaid.ts`) reads the code family. These JS-option integrations are the exhaustive
  allowlist in `styles/typographyUsage.test.ts`. Everywhere else a class is required, and
  `<pre>` / `<code>` must carry one even inside a container that has one: preflight targets those elements
  directly, and a directly-matching rule beats an inherited family. Note that the bare arbitrary value
  `font-[var(--font-mono)]` is ambiguous — Tailwind compiles it to an invalid `font-weight`, so it
  silently does nothing; the working form is `font-(family-name:--font-mono)`
  (`styles/fontClasses.test.ts` fails on the bare form).
- **Fonts ship inside the artifact.** `styles/generated/fonts.css` imports self-hosted variable faces
  (fontsource; Geist Variable + JetBrains Mono Variable, both with real italics — shared with
  `apps/website`, so their versions live in the root `workspaces.catalog`). Which packages those are is
  declared per family as `selfHosted` in `styles/typography.json`, so the stack and the bundled faces
  cannot drift; the imports are generated from it. Vite emits the woff2 files
  into `dist/assets`, and `apps/cli` embeds them. No font CDN — the host is local and often
  offline, and an external `<link>` also put first paint behind a third party and contacted it on every
  load despite the analytics opt-out. `e2e/fonts.spec.ts` pins both halves (no CDN request; the real
  faces present).
- **The typography system — `typography.json` as the single source of truth, the primitives and the
  semantic styles generated from them, the `<body>` base, the 370/400/500/600/800 weight policy,
  code-only mono, the two prose systems, and how to add or change a style — is specced in
  [src/styles/TYPOGRAPHY.md](src/styles/TYPOGRAPHY.md)** (`web-typography`); check changes against it. The
  generator that turns it into CSS is [scripts/SPEC.md](scripts/SPEC.md).
- **Icons: `lucide-react`. Components: shadcn/ui** (Radix primitives), copy-in under `src/components/ui/`
  and themed with our token utilities (`cn()` in `src/lib/utils.ts`) — never shadcn's default oklch
  palette. Use these for accessible menus / dialogs / tooltips.

## Get right

- **`apps/web` depends on `packages/contracts` only.** Never value-import `pi`; never import `server`/`shared`.
- Streaming invariant: `text_delta` / `thinking_delta` **APPEND**; `tool_execution_update.partialResult`
  **REPLACE**. Attempt-level `agent_end` never means idle; automatic work ends only at `agent_settled`.
- Panels stay arrangement-agnostic so the mobile shell is an additive layer, not a rewrite.

## Later

The mobile single-view shell and PWA packaging (installable, offline shell) ride on this split without
touching panels or store.
