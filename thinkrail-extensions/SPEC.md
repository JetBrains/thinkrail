---
id: module-thinkrail-extensions
type: module-design
status: draft
title: ThinkRail extensions (thinkrail-extensions/)
parent: architecture
depends-on: [module-pi-extensions, module-contracts]
tags: [extensions, ui-sdk]
---

## Responsibility

A **ThinkRail extension** is a workspace package `thinkrail-extensions/<name>/` (`@thinkrail/ext-<name>`,
private) that composes a pi capability — usually a [[module-pi-extensions]] package, possibly a
third-party pi package — with its ThinkRail-specific halves: what the host bundles into sessions or answers
as queries, and how the web client presents the capability's tools or panels. The host composes extensions
from **one registry file per side**. A user sees the server registry in Settings → Extensions & skills — plus
the web-only entries below — and can switch each extension off (a host-level setting keyed on the
descriptor `name`; the extension declares nothing for it); how a user would install or discover a new
extension is deliberately not designed.

A **web-only extension** has no pi capability and no `./server` (hint mode, [[module-ext-hint-mode]]). The
server catalog cannot list it, so Settings → Extensions & skills also lists every web registry entry that declares a
`title`, renders no tool, declares no panel and that the catalog lacks (a tool renderer or a panel implies a
server half, so ask-user-question's and session-insights' titles instead translate their catalog rows and
name their Settings → Keyboard areas and cheatsheet sections), with the same `disabledExtensions` switch (the host carries unknown
names through and reloads no session for them); it applies at once. A stub server extension just to get a
row was rejected: an older host would not list it either, and an extension here composes a pi capability.
**Global contributions are mounted only while enabled; tool renderers stay regardless** — a switched-off
extension's `globalOverlay` unmounts and its `shortcuts` leave the cheatsheet, while its renderers keep
drawing old transcripts; its panels show a placeholder and no entry point offers them — palette row, chat
action, rail icon or rail chord (the shell's one `openableExtensionPanels` rule, [[submodule-web-shell]]).

The first extension (`visualize`, [[module-ext-visualize]]) ships both halves; the host composes them from
the two registry files below ([[submodule-server-extensions]], [[submodule-web-extensions]]). **Per-extension
settings** exist for booleans: a descriptor declares `settings`, Settings → Extensions & skills shows each as a nested
switch under its extension (copy from locale keys; disabled while the extension is off; hidden for an older
host), the value lives in `AppConfig.extensionSettings`, and a change reloads open chats when their current
turn ends — ask-user-question's `richPreviews` was the first consumer. **Queries and panels**
exist too, with session insights ([[module-ext-session-insights]]) as their first consumer, and **side
tools** — an extension's singleton rail tool —, **status items** (topbar readouts) and **layout presets**
(a mode the window enters and leaves) with the board ([[module-ext-board]]). Install UX,
marketplace, other setting types, a per-workspace on/off override and store contributions are explicit
deferrals, not gaps. The on/off switch covers everything an
extension contributes — its factories, its tools in live sessions, the skills of its `skillPackages`,
its queries and host actions (refused while off), its host service (stopped while off, its events
dropped) and its panels and side tools (a placeholder while off, the layout kept) — the way removing a package in
pi drops its extensions and skills together.

## Shape — two entrypoints, no root barrel

- `./server` — default export `defineServerExtension({ name, title?, description?, extensions, sessionExtensions?, interactiveTools?, settings?, childExtensions?, skillPackages?, supersedesPackages?, apiVersion?, queries?, hostService? })`
  (`title` / `description` are Settings display copy; `supersedesPackages` names vanilla pi packages the
  extension replaces, whose user-installed extensions the host leaves out of its sessions while the
  extension is on — a switch reloads the open chats that load such a package once their turn ends, and
  Settings → pi packages marks its row replaced while the extension is on).
  `extensions` / `childExtensions` are pi `ExtensionFactory`s the host composes into every parent session /
  the curated child set, registered as named `InlineExtension`s so pi diagnostics keep an identity.
  `sessionExtensions(session)` returns further parent factories built from one session's host services;
  `interactiveTools` names the tools whose calls wait for the person and, optionally, how a late response
  reads to the model ([[module-extension-api]]).
  `skillPackages` are **package specifiers** whose `pi.skills` directories the host stages — explicit module
  identity for the build step, never inferred from a function.
  `queries(host: ExtensionHostServices)` returns the extension's queries (reads, and writes only to the
  extension's own data folder or the workspace's Artifacts) by name, answered through the generic
  `extension.query` ([[module-contracts]]). Building them is side-effect free — the host calls it lazily
  on the first query and again on the first one after a switch-off and back on; the catalog lists only
  `apiVersion` — and each
  method validates its own `params` (wire data is untrusted) and returns JSON-serializable data whose
  shape `apiVersion` versions, independently of the protocol. The host refuses a disabled extension
  (`EXTENSION_DISABLED`) and an unknown extension or method (`UNKNOWN_EXTENSION_QUERY`). The `host`
  argument carries host facts and file locations, never parsed pi data ([[module-extension-api]]), plus
  the table's `signal`: switching the extension off aborts it and drops the table, so its background
  work stops at its next yield and its memory is released.
  **Queries read; actions write through named host actions:** anything an extension changes outside its
  data folder and the Artifacts goes through `host.actions` — create a workspace with a kickoff, message or
  stop a chat, open a PR, run one program by argv in a worktree — each refused while the extension is
  off. `hostService(host)` is the host-lifetime half: started once the host's publishers are wired,
  stopped and restarted with the extension's switch and stopped with the host (each run gets its own
  `signal`, aborted once it stopped); it listens through
  `host.events` (session state, workspace created / updated / removed, `agent.settled`, container changes)
  and talks to its web half through `host.publish` → `extension.event`, filtered by extension on the web
  side ([[module-contracts]]).
  Server-only; may value-import pi.
- `./web` — default export `defineWebExtension({ name, title?, description?, toolRenderers?, globalOverlay?,
  commands?, shortcuts?, panels?, sideTools? })`: `toolRenderers` keyed by tool name; `title` / `description` locale
  keys for a web-only Settings row; `globalOverlay` a component the host mounts once in `Shell` while the
  extension is enabled, handed host helpers as props (`isTextEntry`, `activeLayer`, `platform`, the command
  channel) because the half cannot import the app; `commands` the rebindable keybindings, global or — with
  a `scope` — local to the extension's element, which matches them through `@thinkrail/ui/local-keys`;
  both are listed and rebound in Settings → Keyboard, ids and scopes prefixed `<name>.`
  ([[module-extension-api]]); `shortcuts` display rows (with physical `code`s) for the keys it keeps
  locked, which the cheatsheet lists, with its commands, in the extension's own section while enabled.
  `panels` are keyed by panel id, each a title key, optional translated `keywords`, icon, scopes, optional
  entry points and a lazy `load()`; the shell renders a panel in a generic `extension` center tab with one
  palette command per panel while it is openable, and a placeholder while the extension is off, missing,
  or the host is too old ([[submodule-web-shell]]). The entry points are generic seams: a `chatAction`
  opens the panel for a chat (the chat header's link, the chat's tab menu, the Chats list and recently
  closed menus) and a `rail` puts its icon in the left rail's footer, its `command` naming one of the
  extension's global `commands` as the rebindable chord that opens it ([[module-extension-api]]). `sideTools`
  are keyed by tool id, each a title key, icon, `defaultSide` and lazy `load()`: the shell makes each the
  singleton rail tool `ext:<name>:<id>`, placed, moved and carried by presets like Files, whose body is a
  `PanelProps` component scoped to the active workspace and its project. A panel or side tool receives
  `PanelProps { host, params }` and reaches the host only through that `PanelHost` — queries, chats, panels,
  files, `openWorkspace`, `peek` (its own panels, or files, in Peek) and `onEvent` (its server half's
  `extension.event`s) —, never the store or transport. **Plus named exports** for
  components the host uses directly (visualize exports `MermaidView` for fenced mermaid in chat
  markdown). Browser-only; never value-imports pi; heavy renderers and panels stay lazy.

The `define*` objects and the named `./web` exports are the whole contract: named `./web` exports are
components the host renders directly. `./server` has no named exports the host consumes — everything the
host needs for a capability's lifecycle is declared on the descriptor (`interactiveTools`), so the core
never imports an extension outside its two registry files and an extension can be deleted without touching
the core.

Future capabilities are added to these objects when a real consumer needs them, the way settings, queries
and panels were.

**The property fixed now so later extensions never force a rewrite — runtime/lifecycle ownership:**
separate server and browser entrypoints; no imports of host internals; host-owned scoped state
(per-session owners such as subagents and background commands, per-workspace services) is supplied through
explicit seams and never created by an extension. Per-session owners therefore stay in the host's
session manager. An extension reaches their services only through `sessionExtensions(session)`, the
explicit per-session seam. The descriptor itself stays static.

## Host UI SDK

What a `./web` half may import:

- `@thinkrail/extension-api` ([[module-extension-api]]) — types and `define*` helpers only, no React
  components. `./web`: `ToolRenderProps`, `ToolRenderer`, `ToolRegistrationOptions`, `ToolStatus`,
  `WebExtension`, `GlobalOverlayProps`, `ExtensionCommand`, `ExtensionChord`, `ExtensionShortcut`,
  `ExtensionShortcutKey`, `defineWebExtension`, the panel contract (`PanelDeclaration` with its
  `PanelChatAction` and `PanelRail` entry points, `PanelProps`, `PanelHost` — `query`, `openChat` with an optional anchor, `openPanel`, `renderToolCall`, `openFile`,
  `openArtifacts`, `openWorkspace`, `peek`, `onEvent` —, `PanelChatTarget`, `PanelChatAnchor`, `PanelToolCall`, `PanelHostScope`,
  `PanelScope`, `PanelWorkspaceTarget`, `PanelPeekEntry`, `PanelEventListener`), `SideToolDeclaration`, and the pure renderer helpers (`toolHelpers`, `toolResultContent`). `./server`:
  `ServerExtension`, `defineServerExtension`, `ExtensionHostServices` with its value types (actions,
  events, facts), `ExtensionHostService`, and the contracts types those carry, re-exported. Its own
  package because server pi types would
  contaminate the wire boundary in `contracts`, and the server contract in `ui` would give the host a
  presentation dependency.
- `@thinkrail/ui` ([[module-ui]]) — the owned shadcn/Radix primitives moved whole, `cn`, the
  `onThemeSwap` function only (not the theme catalog/preferences runtime), `./keyboard`'s chord helpers,
  `./keycaps` and `./local-keys` (`useLocalKeys`, how a card matches its local commands). Per-file imports
  (`@thinkrail/ui/dialog`) are retained for code-splitting. Design tokens stay in `apps/web/src/styles`;
  the SDK and extension web halves use token utility classes only, and the app's CSS `@source` and
  color/spacing/typography checks cover `packages/ui` and `thinkrail-extensions/*/web`.
- `@thinkrail/resource-renderers` ([[module-resource-renderers]]) — the host's file and diff renderers:
  `ResourcePreview` shows a workspace file (or a before/after of two) with the same renderers and review
  comments as diff review; `useResourceScope` gives the chat's workspace and session, and
  `useOptionalResourceHost` the host's tab actions. The
  extension never loads files or saves comments itself; the host supplies both through the provider.
- `@thinkrail/locales/react` ([[module-locales]]) — `useT` / `<T>` / `t` over the one shared i18next
  instance; an extension's UI text is keys in `packages/locales/en.json` under its own prefix
  (`visualize.*`), held by `check:i18n` like the app.
- **Voice input needs nothing from an extension.**
  - The host's dictation layer ([[submodule-web-speech]]) serves every text input, textarea and
    contenteditable an extension renders.
  - It writes through a native `input` event, so a React-controlled field sees an ordinary `onChange`.
  - A field that should hold its own submit button while listening can listen for the bubbling
    `thinkrail:dictation` event (`detail.listening`) on the field.
- **Not in the SDK (yet):** the highlighted `CodeBlock` and the chat highlighter — not dependency-closed
  (highlighter → theme barrel). They move together with the generic CSS-variable Pierre token table
  (`THINKRAIL_PIERRE_THEME`) when a second
  extension needs highlighting.

## Composition — the registry files

- **Server:** `packages/server/src/extensions/registry.ts` statically imports every
  `@thinkrail/ext-*/server` and exports entries `{ specifier, extension }` — the descriptor **and its public
  server specifier as a string**. Static imports put the factories into the compiled CLI binary and the
  desktop bundle through the normal server graph, so the packagers generate no factory lists for them
  (the generated lists remain only for `pi-spec-graph`, `pi-thinkrail-workflow` and `pi-todos`, not yet
  wrapped as extensions). The resource
  loader flattens `extensions` / `childExtensions` into named inline extensions in dev and bundled mode
  alike — one composition mode, no path-based dev loading. **Skill resolution is owner-scoped:** one
  shared resolver resolves the extension's entry from `specifier`, then each `skillPackages` manifest via
  `createRequire(extensionEntry)` — unbundled dev resolves at runtime; build support stages an
  extension's roots under `skills/extensions/<name>/` beside the host's under `skills/host/` (pi discovers
  skills recursively), and the bundled runtime maps an extension to that folder of the injected staged root, so
  **ownership survives flattening** and the switch can drop exactly that extension's skills. The launcher
  infrastructure (desktop's bundled server runtime, `startDesktopHost`, `registerBundledRuntime`'s
  OAuth/Bedrock/trash registration) is unchanged by this. The same entries feed each extension's
  `queries` to `host`'s `extension.query` dispatcher ([[submodule-server-extensions]]).
- **Web:** `apps/web/src/extensions/registry.ts` exports the ordered web extensions;
  `registerWebExtensions()` feeds their `toolRenderers` into the chat tool registry, ignoring the switch,
  and tags each registration with its extension's `name` (the chat hides a switched-off extension's
  composer suggestions); the same list feeds their `panels` to the shell (the extension tab body, the
  palette and the panels' chat and rail entry points). `Shell` mounts the `globalOverlay` of each extension not in `disabledExtensions`, and the
  cheatsheet adds their `shortcuts` ([[submodule-web-extensions]]). App-local tool registrations retain
  their side-effect imports; extension descriptors need none.

## Boundary rules (enforced by `scripts/check-module-boundaries.ts`, with negative tests)

- Discovery of `pi-extensions/*` and `thinkrail-extensions/*` as workspace roots.
- **Source halves:** inside every extension, `web/**` and `server/**` never import each other, including
  by relative path.
- **Public subpaths:** `apps/web` may import only `@thinkrail/ext-*/web`; `packages/server` only
  `@thinkrail/ext-*/server`.
- Edges: `extension-api → contracts`; `ui → contracts`; `resource-renderers → contracts, ui`;
  `ext-*/web → ui, extension-api, resource-renderers, contracts` plus **type-only** imports of its own pi
  package (the argument/result shapes belong to the package; the existing browser rule still rejects a
  value import of any pi package);
  `ext-*/server → extension-api, its pi package`;
  `apps/web → contracts, ui, extension-api, resource-renderers, ext-*/web`;
  `packages/server → extension-api, ext-*/server` (and no longer directly on pi packages an extension owns).

## Delivery template (migrating an existing capability, every PR user-invisible)

1. **New pi package beside the old one**, published; old package and host wiring untouched.
2. **Web half moves** into `thinkrail-extensions/<name>/web`, registered from the web registry; the server
   still runs the old package — both register the same tool name, so rendering is unchanged.
3. **Server half + wiring**: `./server` composes the new package, the server registry picks it up, the
   old package is deleted.

PRs 1 and 2 are independent; PR 3 depends on both. A *new* extension without a web half renders through
the default tool renderer until step 2 — never visualize, whose renderer exists before and after.

**A new feature extension** — a capability with no predecessor to migrate — ships as visible slices
instead, each shippable on its own; an SDK addition it needs lands in the same slice as its first consumer,
never ahead of it (session insights: queries, panels and host services arrived with its session list).

**Wrapping a third-party pi package** has no step 1 (nothing of ours to publish). Its server half lands
alone, composing the package unchanged plus any ThinkRail policy, while app-local renderers keep rendering
the same tool names; the web half follows when its renderers' dependencies are in the SDK. A package
without types the repo's strict `tsc` accepts (raw `.ts` that fails it, or untyped compiled JavaScript) is
imported through a declaration-paired JavaScript re-export (`piWebAccess.js` + `.d.ts`): bundlers and Bun
follow the `.js`, `tsc` stops at the declaration.

## Members

| extension | pi capability | notes |
| --- | --- | --- |
| `visualize` | `@thinkrail/pi-visualize` | shipped. `./server` injects the **strict** mermaid validator (`mermaid` at the web renderer's catalog version, initialised through `linkedom` — required: DOMPurify needs a real `document` for flowchart/class/state/gantt/mindmap, verified under Bun). `./web` carries the diagram/comparison cards and exports `MermaidView`. The guarantee is syntax parsing, not SVG/layout success; the browser renderer keeps its fallback. |
| `ask-user-question` | `@thinkrail/pi-ask-user-question` | shipped; the first interactive tool. `./server` is session-only: `sessionExtensions` composes the portable tool with ThinkRail's wording and an asker over the host's interactive-tool mailbox (`awaitToolResponse`); `interactiveTools` declares `ask_user_question` with a `describeResponse` that renders a late answer in the package's own envelope wording. `./web` registers the questionnaire card `interactive`, fed entirely by the host through `ToolRenderProps.interaction`; the plan page renders it through the tool registry like the chat does. Its keys are local `commands` in the scope `ask-user-question.card`, rebindable in Settings → Keyboard. [[module-ext-ask-user-question]]. |
| `hint-mode` | none (web-only) | shipped; on by default. A `globalOverlay` that labels everything clickable on F (outside text entry) or Mod+; and presses a typed label; its `shortcuts` join the cheatsheet while enabled. [[module-ext-hint-mode]]. |
| `web-access` | third-party `pi-web-access` | shipped (server half). `./server` composes the package unchanged for parents and children (the host keeps its headless-search policy, which must outlive the switch) and ships its own `librarian` skill (upstream dropped it; `skillPackages` names the extension's own package); the first extension with skills. Renderers stay app-local (`apps/web/src/chat/tools/web`) until `Markdown`, `Collapsible` and `ToolFileLink` join the SDK. [[module-ext-web-access]]. |
| `next-steps` | `@thinkrail/pi-next-steps` | shipped; the first `composerSuggestions` consumer. `./server` composes the portable package for parents only, appending ThinkRail's yes/no-vs-decision rule to its guidelines (its terminal row stays off because ThinkRail binds pi as `"rpc"`); `./web` registers the routine row plus the reader whose output the chat shows as chips above the composer. [[module-ext-next-steps]]. |
| `board` | none (every tool acts on host-owned state) | shipped: a board per project in its `dataDir` (cards, settings, transition log), preset columns over fixed categories, rules over host events in its `hostService`, the board queries (with `models.list` for the Start form) and the `board_*` agent tools; enabled by default. `./web` is the first `sideTools` consumer — the Board side tool `ext:board:board`, columns when wide and one stacked list when narrow, cards with the agent's live badge dragged across columns — and its `card` panel opens in Peek through `PanelHost.peek`, refreshed by `onEvent("board.changed")`. It is also the first `statusItems` consumer (the cross-project "Needs you · N" topbar counter over the `inbox` query) and the first `layoutPresets` consumer (Board mode). Its card keys are local `commands` in `board.cards`. [[module-ext-board]]. |
| `session-insights` | `@thinkrail/pi-session-insights` (the library; its vanilla `/insights` entry is never composed) | shipped (S1–S11): the first query and panel consumer. `./server` answers the list, a session's analysis (trace, details, turns, timelines, subagents, errors, context, cost, files), the statistics across sessions (findings, usage, hotspots, action sequences, slice comparison), the step alignment of two sessions, search, the user's labels and notes (in its `dataDir`) and exports into the asking workspace's Artifacts (HTML, Chrome trace, e2e fixture) over host-injected services; `./web` is the Session insights list with its day view, statistics and search, a per-session analysis panel and a two-session comparison panel (its process map is a lazy chunk with `@xyflow/react` and `@dagrejs/dagre`). No tools and no skills, so its switch refuses its queries and placeholders its panel. Its keys are local `commands` in the scope `session-insights.panel`, rebindable in Settings → Keyboard. It supersedes the package itself (`supersedesPackages`): a user who installed the vanilla `/insights` command for pi gets it in pi, not in ThinkRail sessions, where it would read with vanilla locators. [[module-ext-session-insights]]. |
