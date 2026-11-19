---
id: submodule-web-extensions
type: submodule-design
status: draft
title: Web extension composition registry and installed-extension runtime
parent: module-web
depends-on: [module-extension-api, module-ext-visualize, module-ext-ask-user-question, module-ext-hint-mode]
references: [submodule-web-chat, submodule-web-shell, module-thinkrail-extensions, module-resource-renderers, module-ui]
tags: [public-surface-checked]
---

## Responsibility

The one place web extensions reach the chat tool registry — built-in ones composed statically, installed
ones loaded at runtime ([[module-thinkrail-extensions]] § Installed extensions).

- **Built-in:** `registry.ts` owns their ordered list; `registerWebExtensions()` feeds each descriptor's
  tool entries into chat's registry in order, preserving its last-registration-wins behavior and fallback
  renderer. Re-registering the same list replaces entries rather than accumulating them. The app-local
  registrations (`chat/tools/register`) arrive later with `ChatView`'s lazy chunk and name other tools.
- **Host object:** `host.ts` exposes the app's own modules to installed web halves on one frozen
  `globalThis.__thinkrailExtensionHost = { api, modules }`, keyed by the specifier an author imports.
  The object's name, `api` and keys are `EXTENSION_HOST_OBJECT`, `EXTENSION_API_VERSION` and
  `SHARED_SPECIFIERS` from `@thinkrail/extension-api/installed` ([[module-extension-api]]). Each value
  is **not** the live module namespace but a frozen object holding only the names
  `SHARED_MODULE_EXPORTS` allow-lists for that specifier (`allowed(namespace, names)`, typed so a name
  the module does not export fails `tsc`), so an installed bundle cannot reach — and the app cannot
  accidentally promise — anything outside extension API v1. A React specifier has no `default`: the
  SDK's stub falls back to the picked object itself. Every module in it is already in the initial
  graph, so eager exposure costs only the picked objects and the allow-list's strings: moving to the
  eight-specifier allow-list grew the production entry chunk by 1.1 KB raw (0.5 KB gzip) and the whole
  initial set by 0.4 KB raw (<0.1 KB gzip), with the same chunks in the initial set. `host.test.ts` pins
  the keys, the frozen objects, each module's exact name set and the app's own values.
- **Loader:** `loader.ts` turns host-provided descriptors `{ name, url, styles? }` into registered tool
  renderers and back.
- **Following the host:** `follow.ts` keeps the loaded set in step with the host's `extension.list` for the
  life of the page and gives bootstrap its bounded pre-render wait (§ Following the host).
- **API fit:** `compatibility.ts` applies the extension API rule of `@thinkrail/extension-api/installed` to
  an `api` string for Settings (`extensionApiFit`: `compatible`, `needsNewerApp`, `builtForOlderApp`,
  `unknown`), so panels never import that entry themselves.

Registration ignores the host's extension on/off setting: a web extension's renderers stay registered while
its server half is disabled, so a transcript that already contains its tool calls keeps rendering them. The
switch only decides what the host gives the agent next — and which **global contributions** run:
`enabledWebExtensions(disabled)` is the list `Shell` mounts `globalOverlay`s from and the cheatsheet takes
`shortcuts` from ([[submodule-web-shell]]), so switching one off unmounts it at once.
`webExtensionCommands(disabled)` lists the `commands` of **every** registered extension in registry order
with an `enabled` flag — the input `shell` resolves keybindings from ([[submodule-web-keybindings]]): a
switched-off extension's commands stay listed (Settings → Keyboard shows and rebinds them) but neither
match nor conflict, and registry order decides between two extensions' defaults. A command with a
`scope` is local and reaches the resolver's per-scope table as it is; the resolver drops one whose id or
scope lacks the extension's `name.` prefix, and the tests pin that every bundled command has it.
`webOnlyExtensions(serverNames)` is the titled entries without tool renderers that the server catalog lacks; Settings → Extensions & skills
lists them under the same switch ([[module-thinkrail-extensions]]).
Composer suggestions are the one *tool-registered* affordance the switch hides: each registration carries
its extension's `name` (an installed one's is its descriptor `name`), so the chat hides a switched-off
extension's chips while its past rows keep rendering ([[submodule-web-chat]]). Removing an installed
extension unregisters its renderers.

These global contributions — `globalOverlay`, `commands`, `shortcuts`, and a web-only `title` — are read
from the built-in list only. An installed web half contributes its tool renderers (with their registration
options, `composerSuggestions` included) and nothing else: the loader requires `toolRenderers` and ignores
the other fields, so an installed extension cannot bind keys or mount an overlay yet.

## Loader

- **Import by absolute URL.** A descriptor's `url` / `styles` are host-relative; the loader resolves them
  against the transport's HTTP base and imports with `import(/* @vite-ignore */ absoluteUrl)`. A relative
  variable import breaks in Vite dev (rewritten to `?import`, then 500 for a file Vite does not own).
- **All or nothing per extension.** The bundle and its stylesheet load in parallel (the `<link>` is awaited
  so a card never paints unstyled); the default export must have the `WebExtension` shape — a string
  `name` and `toolRenderers` whose entries carry a `renderer` the chat can render as `<Renderer {...props} />`
  — a function or a React `memo` / `forwardRef` / `lazy` object, recognised by its `$$typeof` symbol
  without React internals (`ToolRenderer`'s call signature already admits them in TypeScript) — and
  optional object `options` with optional functions `summary` and `composerSuggestions`, which the chat
  calls directly. Only then are the renderers registered, under the descriptor's `name`
  (the npm identity, not the author's `defineWebExtension` name), in the precedence slot reserved when its
  load started — the descriptor order of the host's list — so a contested tool name goes to the
  extension the server runs, not to the bundle that loaded first. Any failure removes the stylesheet,
  registers nothing, **keeps the slot** (empty, so a retry regains its place ahead of later extensions)
  and yields `{ status: "failed", reason, message }` with `reason` one of `import` (network, syntax or a
  throwing top level — the browser does not tell them apart), `export` or `styles`. One extension's
  failure never touches another's or the app.
- **Accepted window for a contested name.** Precedence among installed extensions is by host-list order
  among the renderers currently registered. While the first-listed bundle is still loading, or after it
  failed, a later extension's card is drawn for a tool name both declare — over a result the server
  produced with the first one's tool. Accepted rather than solved: it needs two installed extensions
  contesting one name and lasts until the first loads (normally milliseconds, from the host's own
  origin); closing it would need the server descriptor to carry tool names for a reserved slot to claim.
  The server half's precedence is unaffected. `loader.test.tsx` pins it.
- **Reporting** is a classifier: `clientErrorReport("rejection", error, "extension-load:<reason>")`;
  the message reaches the caller's result only, never error tracking.
- **Before first render, bounded.** `PRE_RENDER_WAIT_MS` (1000 ms) caps how long bootstrap holds the
  first render for the set (§ Following the host); a slow or hung bundle keeps loading and registers late
  through the subscribable registry. Rationale: the host serves the files from its own origin, so a
  healthy set loads in milliseconds and the cap only bounds the blank page a broken one costs.
- **Later loads and updates.** `loadWebExtensions` loads a set and resolves with every result. Loading a
  name again is an update: the new bundle replaces the previous registration and stylesheet atomically
  once it has loaded; a failed update keeps nothing of either version. A stale load that finishes after a
  newer load or an unload of the same name is discarded and resolves with the newer outcome
  (`{ status: "unloaded" }` after an unload).
- **Unload.** `unloadWebExtension(name)` unregisters the extension's renderers and removes its stylesheet.
- **State.** `webExtensionLoads()` / `subscribeWebExtensionLoads` / `useWebExtensionLoads()` give the
  latest result per name (`loading`, `loaded` with its tool names, `failed` with reason and message) for
  a Settings row; an unloaded name has no entry.
- **Tests** inject a `LoaderEnvironment` (base URL, stylesheet linking, reporting) through the
  module-internal `setLoaderEnvironment`; imports stay real, against hand-written ESM fixtures in
  `fixtures/` that read the host object the way an SDK-built bundle does.
- **Version.** The host's version rule (manifest `api`) runs server-side before a descriptor is listed;
  the bundle's generated shim re-checks the API major against `__thinkrailExtensionHost.api` at
  evaluation, which surfaces as an `import` failure. The loader adds no third check.
- **Dev hot updates** keep everything: chat's registry and the loader's state live in
  `import.meta.hot.data`, so a hot update of either module neither drops runtime-loaded renderers nor
  orphans their stylesheets.

## Following the host

- **One set, converged.** `syncWebExtensions(descriptors)` is the only writer bootstrap uses: it unloads
  every name it loaded that the host no longer lists (removal — past calls fall back to the default row),
  loads names it has not loaded and names whose `url`/`styles` changed (an update reinstalled under a new
  token), and leaves the rest untouched. A failed load is retried only when its URL changes or the page
  reloads; Settings shows the failure meanwhile. New names get precedence slots after the ones already
  held, so a newly installed extension listed before an older one wins a contested name only after a reload
  — the same accepted window as above.
- **The source is injected.** `followInstalledWebExtensions(source, waitMs)` subscribes to an
  `InstalledWebExtensionSource` (`current()` — the set, or `null` while unknown; `unreachable()`;
  `subscribe`) and calls `syncWebExtensions` whenever the set may have changed. `main.tsx` wires it to the
  store's `selectInstalledWebHalves` and fires only when `extensionCatalog`, `protocolVersion` or the
  connection status change, so a streaming chat never runs the diff. This module still reads no store.
- **Bootstrap waits only when it expects cards, bounded.** The source also remembers, per host, whether
  the last set it listed had any web half (`rememberedAny` / `remember`, written by the follower only when
  that changes). `main.tsx` keeps it as the `installed-web-halves` preference through `shell`'s
  `preferenceStorage` — the native stable adapter (scoped per backend profile), else `localStorage`
  qualified by the host's HTTP base; UX state, not analytics. When nothing is remembered (a first run)
  or the last set was empty, the promise settles at once and the page renders without waiting; an
  extension installed elsewhere in the meantime registers late through the reactive registry, as any
  later install does. Otherwise it settles when the first known set has loaded, when the source is
  unreachable (the connection dropped or the list failed), or after `PRE_RENDER_WAIT_MS` counted from
  bootstrap — connection, list and load together — whichever comes first. The transport is usually not
  connected yet when bootstrap runs, so a host with cards installed holds the first render for the
  welcome (milliseconds on the host's own origin). The promise never rejects: a throw while following
  (the source, the store or a sync) is reported as a client error (boundary `extension-follow`) and
  settles it, and `main.tsx` renders in `finally`, so a follower fault never leaves a blank page. A host older than
  `INSTALLED_EXTENSIONS_PROTOCOL_VERSION` yields the empty set at once: nothing is requested and the page
  renders as before; reconnecting to such a host unloads every installed web half, and reconnecting to a
  different host converges on that host's list.
- Switched-off extensions are in the set (the host lists their `web` while off), so past transcripts keep
  their cards; only a removal or a host that no longer lists them unloads them.

## Boundary

- **Public surface:** `webExtensions`, `registerWebExtensions`, `enabledWebExtensions`,
  `webExtensionCommands`, `webOnlyExtensions`, `installExtensionHost`, `followInstalledWebExtensions`,
  `useWebExtensionLoads`, `WebExtensionLoadResult`, `extensionApiFit`, `EXTENSION_API_VERSION`.
- The barrel carries only what other modules import. The loader's set-level functions
  (`loadWebExtensions`, `syncWebExtensions`, `unloadWebExtension`, `webExtensionLoads`) are reached only
  through the follower and the hook; tests import them from `loader.ts`.
- **Imports:** public extension `./web` entries, the web SDK contract, `@thinkrail/extension-api/installed`
  (the host object's constants), chat's registration functions, `transport` (`getTransport().httpBase()`
  and the client error reports — the loader's and follower's only reach into app integration), and, for the host object
  only, the shared module set. Never `ChatView`, stores, extension internals or server halves. The
  registry Map remains owned by chat; the loader owns only its per-name load state and stylesheet links.
- **Bootstrap order** (`main.tsx`): `installExtensionHost()` → `registerWebExtensions()` →
  `followInstalledWebExtensions(store-backed source)` (bounded, and only when cards are expected) → first
  render. Interaction state and the
  plan/review glances derive from the registry's `interactive` registrations, so the built-in set must be
  complete before any lazy view reads a transcript; installed ones that land later re-derive through the
  registry's snapshot hooks ([[submodule-web-chat]]).
- Direct component consumers use an extension's named public exports independently of tool registration:
  Markdown renders `MermaidView`. The plan page reaches the questionnaire card through the registry, not by
  name.
- Tests also pin that the bundled extensions' default chords conflict with nothing (the resolver with no
  overrides reports no conflict on any platform) and that plain F is free in the app table and in the
  catalog's feature keys.
