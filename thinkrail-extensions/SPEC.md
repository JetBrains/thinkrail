---
id: module-thinkrail-extensions
type: module-design
status: draft
title: ThinkRail extensions (thinkrail-extensions/)
parent: architecture
depends-on: [module-pi-extensions, module-contracts]
tags: [extensions, ui-sdk]
references: [module-extension-api, module-extension-sdk, module-extension-examples, submodule-web-extensions, submodule-server-extensions-installed, submodule-server-extension-catalog, submodule-web-panels]
---

## Responsibility

A **ThinkRail extension** is a workspace package `thinkrail-extensions/<name>/` (`@thinkrail/ext-<name>`,
private) that composes a pi capability — usually a [[module-pi-extensions]] package, possibly a
third-party pi package — with its ThinkRail-specific halves: what the host bundles into sessions and how
the web client presents the capability's tools. The host composes extensions from **one registry file per
side**. A user sees the server registry in Settings → Extensions — plus the web-only entries below — and can
switch each extension off (a host-level setting keyed on the descriptor `name`; the extension declares
nothing for it). Extensions authored outside this repository are installed and loaded at runtime under the
contract in § Installed extensions; everything else in this spec describes the built-in extensions.

A **web-only extension** has no pi capability and no `./server` (hint mode, [[module-ext-hint-mode]]). The
server catalog cannot list it, so Settings → Extensions also lists every web registry entry that declares a
`title`, renders no tool and that the catalog lacks (a tool renderer implies a server half, so ask-user-question's
title only names its Settings → Keyboard section), with the same `disabledExtensions` switch (the host carries unknown
names through and reloads no session for them); it applies at once. A stub server extension just to get a
row was rejected: an older host would not list it either, and an extension here composes a pi capability.
**Global contributions are mounted only while enabled; tool renderers stay regardless** — a switched-off
extension's `globalOverlay` unmounts and its `shortcuts` leave the cheatsheet, while its renderers keep
drawing old transcripts.

The first extension (`visualize`, [[module-ext-visualize]]) ships both halves; the host composes them from
the two registry files below ([[submodule-server-extensions]], [[submodule-web-extensions]]). **Per-extension
settings** exist for booleans: a descriptor declares `settings`, Settings → Extensions shows each as a nested
switch under its extension (copy from locale keys; disabled while the extension is off; hidden for an older
host), the value lives in `AppConfig.extensionSettings`, and a change reloads open chats when their current
turn ends — ask-user-question's `richPreviews` was the first consumer. Other setting types, a per-workspace
on/off override, extension-contributed wire methods, panels and store contributions are explicit deferrals,
not gaps. The on/off switch covers everything an
extension contributes — its factories, its tools in live sessions, and the skills of its `skillPackages`
— the way removing a package in pi drops its extensions and skills together.

## Shape — two entrypoints, no root barrel

- `./server` — default export `defineServerExtension({ name, title?, description?, extensions, sessionExtensions?, interactiveTools?, settings?, childExtensions?, skillPackages? })`
  (`title` / `description` are Settings display copy).
  `extensions` / `childExtensions` are pi `ExtensionFactory`s the host composes into every parent session /
  the curated child set, registered as named `InlineExtension`s so pi diagnostics keep an identity.
  `sessionExtensions(session)` returns further parent factories built from one session's host services;
  `interactiveTools` names the tools whose calls wait for the person and, optionally, how a late response
  reads to the model ([[module-extension-api]]).
  `skillPackages` are **package specifiers** whose `pi.skills` directories the host stages — explicit module
  identity for the build step, never inferred from a function. Server-only; may value-import pi.
- `./web` — default export `defineWebExtension({ name, title?, description?, toolRenderers?, globalOverlay?,
  commands?, shortcuts? })`: `toolRenderers` keyed by tool name; `title` / `description` locale keys for a web-only
  Settings row; `globalOverlay` a component the host mounts once in `Shell` while the extension is enabled,
  handed host helpers as props (`isTextEntry`, `activeLayer`, `platform`, the command channel) because the
  half cannot import the app; `commands` the rebindable keybindings, global or — with a `scope` — local to
  the extension's element, which matches them through `@thinkrail/ui/local-keys`; both are listed and
  rebound in Settings → Keyboard, ids and scopes prefixed `<name>.` ([[module-extension-api]]);
  `shortcuts` display rows (with physical `code`s) for the keys it keeps locked, which the cheatsheet's
  General section lists while enabled. **Plus named exports** for components the host uses directly (visualize exports `MermaidView`
  for fenced mermaid in chat markdown). Browser-only; never value-imports pi; heavy renderers stay lazy.

The `define*` objects and the named `./web` exports are the whole contract: named `./web` exports are
components the host renders directly. `./server` has no named exports the host consumes — everything the
host needs for a capability's lifecycle is declared on the descriptor (`interactiveTools`), so the core
never imports an extension outside its two registry files and an extension can be deleted without touching
the core.

Future capabilities (wire methods, panels, settings) are added to these objects when a real consumer needs
them.

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
  `ExtensionShortcutKey`, `defineWebExtension`,
  and the pure renderer helpers (`toolHelpers`, `toolResultContent`).
  `./server`: `ServerExtension`, `defineServerExtension`. Its own package because server pi types would
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
  OAuth/Bedrock/trash registration) is unchanged by this.
- **Web:** `apps/web/src/extensions/registry.ts` exports the ordered web extensions;
  `registerWebExtensions()` feeds their `toolRenderers` into the chat tool registry, ignoring the switch,
  and tags each registration with its extension's `name` (the chat hides a switched-off extension's
  composer suggestions). `Shell` mounts the `globalOverlay` of each extension not in `disabledExtensions`,
  and the cheatsheet adds their `shortcuts` ([[submodule-web-extensions]]). App-local tool registrations
  retain their side-effect imports; extension descriptors need none.

## Boundary rules (enforced by `scripts/check-module-boundaries.ts`, with negative tests)

- Discovery of `pi-extensions/*` and `thinkrail-extensions/*` as workspace roots.
- **Source halves:** inside every extension, `web/**` and `server/**` never import each other, including
  by relative path.
- **Public subpaths:** `apps/web` may import only `@thinkrail/ext-*/web`; `packages/server` only
  `@thinkrail/ext-*/server`. `@thinkrail/extension-api/installed` is imported only by the two
  installed-extension runtimes (`apps/web/src/extensions`, `packages/server/src/extensions/installed`),
  never by an extension half.
- Edges: `extension-api → contracts`; `ui → contracts`; `resource-renderers → contracts, ui`;
  `ext-*/web → ui, extension-api, resource-renderers, contracts` plus **type-only** imports of its own pi
  package (the argument/result shapes belong to the package; the existing browser rule still rejects a
  value import of any pi package);
  `ext-*/server → extension-api, its pi package`;
  `apps/web → contracts, ui, extension-api, resource-renderers, ext-*/web`;
  `packages/server → extension-api, ext-*/server` (and no longer directly on pi packages an extension owns).

## Delivery template (every extension of ours, every PR user-invisible)

1. **New pi package beside the old one**, published; old package and host wiring untouched.
2. **Web half moves** into `thinkrail-extensions/<name>/web`, registered from the web registry; the server
   still runs the old package — both register the same tool name, so rendering is unchanged.
3. **Server half + wiring**: `./server` composes the new package, the server registry picks it up, the
   old package is deleted.

PRs 1 and 2 are independent; PR 3 depends on both. A *new* extension without a web half renders through
the default tool renderer until step 2 — never visualize, whose renderer exists before and after.

**Wrapping a third-party pi package** has no step 1 (nothing of ours to publish). Its server half lands
alone, composing the package unchanged plus any ThinkRail policy, while app-local renderers keep rendering
the same tool names; the web half follows when its renderers' dependencies are in the SDK. A package
without types the repo's strict `tsc` accepts (raw `.ts` that fails it, or untyped compiled JavaScript) is
imported through a declaration-paired JavaScript re-export (`piWebAccess.js` + `.d.ts`): bundlers and Bun
follow the `.js`, `tsc` stops at the declaration.

## Installed extensions

The contract for an extension authored outside this repository. It adds no capability: an installed
extension contributes what a built-in one can through the tool path (agent tools, skills, boolean
settings, interactive tools, artifact tools, tool cards with their registration options such as composer
suggestions). The web shell's contributions — a `globalOverlay`, `commands`, `shortcuts` and a web-only
Settings row — stay built-in only: an installed web half contributes its tool renderers and nothing else
([[submodule-web-extensions]]). The **ThinkRail extension is the unit**; a pi package is an optional dependency its
server half composes, because a UI-only extension has none and the agent backend may change.

**Where it is built**

- Host runtime (`extensions.json`, install root, loader, status file, web-half URLs):
  [[submodule-server-extensions-installed]]; web runtime (shared modules, loader, tool registry):
  [[submodule-web-extensions]].
- Settings → Extensions rows, the install dialog and Browse: [[submodule-web-panels]]; the catalog read
  behind Browse: [[submodule-server-extension-catalog]].
- The agent's `making-thinkrail-extensions` skill: [[submodule-server-extensions-installed]] § Decisions,
  "The agent's path in".

**Decisions and their reasons**

- **Installing is the consent.** The UI half loads once the extension is installed, with no extra prompt
  and no isolation: the server half can already run anything on the machine, so a second gate adds a
  prompt, not protection. Scope is **global only** — a repository cannot bring an extension into a
  teammate's app.
- **One install flow, one list.** The existing Install package dialog and Installed list hold extensions
  and plain pi packages side by side; the fetched `package.json` decides the kind. A `thinkrail` manifest
  wins over a `pi` manifest in the same package: it is declared in ThinkRail's file, never in pi's
  settings, so its pi resources reach sessions only through its server half — one registration per tool.
- **All-or-nothing versioning.** An extension built for an API the host does not support stays installed
  and is not loaded; its row says why. Nothing of it runs, in either direction (too new or too old).
- **Contributions are stated in code**, by the same descriptors built-ins export. Rejected: declaring
  them in the manifest (a second contract beside the built-ins').
- **Text is the author's own, untranslated** (translations: issue #1423). A declared setting therefore
  carries its own `title` and `description`.
- **The agent may install what it writes**, by editing the declarations file, as it edits `mcp.json`,
  with no confirmation click: the user asked for it.

**Manifest** — in the package's `package.json`; the npm package `name` is the extension's identity (the
key for the on/off switch and its settings) and must not equal a built-in's `name`.

```json
{
  "keywords": ["thinkrail-extension"],
  "thinkrail": {
    "api": "1.0",
    "server": "./server/index.ts",
    "web": "./dist/web.js",
    "styles": "./dist/web.css",
    "title": "Weather",
    "image": "https://example.com/preview.png"
  }
}
```

- `api` is `major.minor`. The host loads an extension whose major equals its own and whose minor is not
  newer. At least one of `server` / `web`; `styles` only with `web`; every path is relative and stays
  inside the package, with no `..` segment. `title` falls back to the package name; description, author
  and version are the package's own fields.
- `server` is a TypeScript (or JavaScript) module whose default export is a `defineServerExtension`
  descriptor whose `name` is the package name, else the row fails. `web` is a pre-built ESM file (`.js` /
  `.mjs`) whose default export is a `defineWebExtension` descriptor, registered under the package name:
  the host never bundles. `styles` is a `.css` file; the fixed suffixes let the host serve both with a
  fixed content type.
- **One reader, guarded copies.** The reader, `EXTENSION_API_VERSION`, the host object's name and the
  shared-specifier list live in `@thinkrail/extension-api/installed` ([[module-extension-api]] owns the
  exact rules), never in `./web`, which an installed web half receives as extension API. The SDK's build
  and the website, which may not import it at runtime, keep copies that run its table of manifest cases
  in their tests; only the SDK is stricter, in one rule (below).

**Server half**

- Sources are declared in `<data dir>/extensions.json` as `{ "extensions": ["<source>", …] }` in pi's
  source syntax (`npm:name`, a git URL, an absolute folder). The host watches the file and reconciles:
  installs what is missing, loads, and publishes the result.
- Packages install under `<data dir>/extensions/` with pi's installer pointed at that root, so the pi
  config folder never holds them and pi's own loader never sees them. **Each installed version has its
  own folder**: Bun keeps the first evaluation of an extension's plain-JavaScript dependencies, and its
  folder listings, for the life of the process. A folder source is loaded in place.
- **pi and typebox are kept out of an extension's `node_modules`.** A copy there is what a
  plain-JavaScript dependency of the extension binds to instead of the host's. A folder source's own
  `node_modules` is never pruned; that matters only when the extension has such a dependency
  ([[submodule-server-extensions-installed]] § Known limitations).
- The descriptor is imported through pi's public loader by a host-written shim, so the extension's pi
  imports are the host's single instance in every launcher ([[pi-compatibility]] registers the seam;
  [[submodule-server-extensions-installed]] owns the mechanism); every load also checks that the shim's
  `createAgentSession` and `Type` are the host's own. The version check runs before any extension code.
- The server registry is a runtime list — built-ins first, then installed — and the existing composition
  is reused: named inline factories, per-session services, interactive tools, owner-scoped skill roots
  resolved from the installed entry, the on/off switch, boolean settings, built-in tool-name precedence.
  A change reaches open chats when their current turn ends.
- A load failure (syntax error, throwing top level, missing dependency) is a row state, never a host
  failure. Extensions load individually.

**Web half**

- At bootstrap the app exposes its own modules on one frozen object,
  `globalThis.__thinkrailExtensionHost = { api, modules }`, keyed by the specifier an author imports:
  `react`, `react/jsx-runtime`, `react-dom`, `@thinkrail/extension-sdk/web`,
  `@thinkrail/extension-sdk/resources`, and `@thinkrail/extension-sdk/ui/<m>` for `attention-line`,
  `button`, `dialog`, `fonts`, `keyboard`, `textarea`, `theme`, `utils`. That list — what the built-in cards
  import today — is extension API v1. Rejected: the whole UI kit (every primitive becomes a promise) and
  self-contained cards (no app components, a second contract).
- An extension's bundle contains none of those modules: the SDK's build resolves each shared specifier,
  including imports made from inside the extension's own `node_modules`, to a generated module that reads
  the host object, checks the API major and re-exports the names in a manifest of export names.
- **An extension's stylesheet uses its own Tailwind prefix** and is built against a theme file the SDK
  ships, so it emits only its own utilities and they point at the app's runtime variables. Unprefixed, a
  sheet loaded after the app's reorders the app's own utilities.
- The host serves each web half at a versioned URL on its own origin
  (`/extensions/<name>/<version>-<hash of the files' stats>/<file>`, listed in `extension.list`); the app imports it by absolute URL
  and links its stylesheet. Web halves installed at start load before the first render, with a bounded
  wait; later ones register through the subscribable tool registry ([[submodule-web-extensions]]).
- Every tool renderer, built-in or installed, sits in its own error boundary that falls back to the
  default renderer for that row. Removing an extension unregisters its renderers; switching it off does
  not, so past transcripts keep their cards. A contested tool name renders as the server runs it: a
  built-in keeps it over an installed extension, and between installed ones the extension listed first
  keeps it (pi gives a tool name to its first registration), whichever bundle finishes loading first.
  The web client applies that order among the bundles currently registered: while the first-listed one
  is loading or has failed, the next one's card is drawn — an accepted window
  ([[submodule-web-extensions]]).
- **What v1 promises beyond the module list:** the components' props and variants, the `TooltipProvider`
  at the app root, the locale store behind `useT`, portals to `<body>`, `html[data-theme]`, the semantic
  colour variables and utility names, the spacing and radius scales, the typography classes, Tailwind's
  major and layer order, and the React major. Breaking any of them is API v2.

**SDK** — one published package, `@thinkrail/extension-sdk` ([[module-extension-sdk]]), versioned with the
extension API and released like the portable pi packages (Decision 20): `./server` and `./web` (the
`define*` helpers and types of [[module-extension-api]]), `./ui/*` and `./resources` (type declarations
for the shared set), the build command `thinkrail-extension build --prefix <x>` (the prefix every
utility in the extension's stylesheet carries), the manifest of shared export names and the theme file.
Its build accepts only an `api` equal to its own version, since a bundle can only rely on the export
names its SDK knew. It imports no pi value at runtime. The in-repo `extension-api`, `ui` and
`resource-renderers` packages stay private; samples built with it live in `extension-examples/`
([[module-extension-examples]]).

**Catalog** — the website publishes one file, `thinkrail.ai/extensions/catalog.json`, built from npm: every
package carrying the `thinkrail-extension` keyword whose latest `package.json` has a valid manifest.
Nothing is reviewed, hidden or marked; an extension distributed by git URL or folder installs but is not
listed. The showcase page and the app's Browse read the same file ([[module-website]]).

```json
{
  "schema": 1,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "extensions": [
    {
      "name": "thinkrail-ext-weather",
      "version": "1.2.0",
      "title": "Weather",
      "description": "Forecasts in chat.",
      "author": "Jane Doe",
      "api": "1.0",
      "halves": ["server", "web"],
      "image": "https://example.com/preview.png",
      "install": "npm:thinkrail-ext-weather",
      "npm": "https://www.npmjs.com/package/thinkrail-ext-weather",
      "repository": "https://github.com/jane/thinkrail-ext-weather",
      "publishedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

`title`, `author`, `image` and `repository` are optional. A card shows which halves exist, not tool names:
those live in code the website cannot run. The app's Browse gets the file through the host, never from
the browser, and offers Install only for a listing whose `api` this app can load; an incompatible listing
is marked and cannot be installed from Browse.

## Members

| extension | pi capability | notes |
| --- | --- | --- |
| `visualize` | `@thinkrail/pi-visualize` | shipped. `./server` injects the **strict** mermaid validator (`mermaid` at the web renderer's catalog version, initialised through `linkedom` — required: DOMPurify needs a real `document` for flowchart/class/state/gantt/mindmap, verified under Bun). `./web` carries the diagram/comparison cards and exports `MermaidView`. The guarantee is syntax parsing, not SVG/layout success; the browser renderer keeps its fallback. |
| `ask-user-question` | `@thinkrail/pi-ask-user-question` | shipped; the first interactive tool. `./server` is session-only: `sessionExtensions` composes the portable tool with ThinkRail's wording and an asker over the host's interactive-tool mailbox (`awaitToolResponse`); `interactiveTools` declares `ask_user_question` with a `describeResponse` that renders a late answer in the package's own envelope wording. `./web` registers the questionnaire card `interactive`, fed entirely by the host through `ToolRenderProps.interaction`; the plan page renders it through the tool registry like the chat does. Its keys are local `commands` in the scope `ask-user-question.card`, rebindable in Settings → Keyboard. [[module-ext-ask-user-question]]. |
| `hint-mode` | none (web-only) | shipped; on by default. A `globalOverlay` that labels everything clickable on F (outside text entry) or Mod+; and presses a typed label; its `shortcuts` join the cheatsheet while enabled. [[module-ext-hint-mode]]. |
| `web-access` | third-party `pi-web-access` | shipped (server half). `./server` composes the package unchanged for parents and children (the host keeps its headless-search policy, which must outlive the switch) and ships its own `librarian` skill (upstream dropped it; `skillPackages` names the extension's own package); the first extension with skills. Renderers stay app-local (`apps/web/src/chat/tools/web`) until `Markdown`, `Collapsible` and `ToolFileLink` join the SDK. [[module-ext-web-access]]. |
| `next-steps` | `@thinkrail/pi-next-steps` | shipped; the first `composerSuggestions` consumer. `./server` composes the portable package for parents only, appending ThinkRail's yes/no-vs-decision rule to its guidelines (its terminal row stays off because ThinkRail binds pi as `"rpc"`); `./web` registers the routine row plus the reader whose output the chat shows as chips above the composer. [[module-ext-next-steps]]. |
