---
id: submodule-web-extensions
type: submodule-design
status: draft
title: Web extension composition registry and installed-extension runtime
parent: module-web
depends-on: [module-extension-api, module-ext-visualize, module-ext-ask-user-question]
references: [submodule-web-chat, module-thinkrail-extensions, module-resource-renderers, module-ui]
tags: [public-surface-checked]
---

## Responsibility

The one place web extensions reach the chat tool registry — built-in ones composed statically, installed
ones loaded at runtime ([[module-thinkrail-extensions]] § Installed extensions).

- **Built-in:** `registry.ts` owns their ordered list; `registerWebExtensions()` feeds each descriptor's
  tool entries into chat's registry in order, preserving its last-registration-wins behavior and fallback
  renderer. Re-registering the same list replaces entries rather than accumulating them.
- **Host object:** `host.ts` exposes the app's own modules to installed web halves on one frozen
  `globalThis.__thinkrailExtensionHost = { api, modules }`, keyed by the specifier an author imports.
  `SHARED_SPECIFIERS` is the single list (extension API v1; the SDK's manifest must match it) and
  `EXTENSION_HOST_API` the API version beside it. Every module in it is already in the initial graph, so
  eager exposure costs only namespace objects (≈1.5 KB gzip measured on the production build).
- **Loader:** `loader.ts` turns host-provided descriptors `{ name, url, styles? }` into registered tool
  renderers and back.

Registration ignores the host's extension on/off setting: a web extension's renderers stay registered while
its server half is disabled, so a transcript that already contains its tool calls keeps rendering them. The
switch only decides what the host gives the agent next. Removing an installed extension unregisters its
renderers.

## Loader

- **Import by absolute URL.** A descriptor's `url` / `styles` are host-relative; the loader resolves them
  against the transport's HTTP base and imports with `import(/* @vite-ignore */ absoluteUrl)`. A relative
  variable import breaks in Vite dev (rewritten to `?import`, then 500 for a file Vite does not own).
- **All or nothing per extension.** The bundle and its stylesheet load in parallel (the `<link>` is awaited
  so a card never paints unstyled); the default export must have the `WebExtension` shape — a string
  `name` and `toolRenderers` whose entries carry a function `renderer` and optional object `options` with
  an optional function `summary`. Only then are the renderers registered, under the descriptor's `name`
  (the npm identity, not the author's `defineWebExtension` name). Any failure removes the stylesheet,
  registers nothing and yields `{ status: "failed", reason, message }` with `reason` one of `import`
  (network, syntax or a throwing top level — the browser does not tell them apart), `export` or
  `styles`. One extension's failure never touches another's or the app.
- **Reporting** is a classifier: `clientErrorReport("rejection", error, "extension-load:<reason>")`;
  the message reaches the caller's result only, never error tracking.
- **Before first render, bounded.** `loadWebExtensionsBeforeRender` waits at most
  `PRE_RENDER_WAIT_MS` (1000 ms) for the whole set, then returns; a slow or hung bundle keeps loading and
  registers late through the subscribable registry. Rationale: the host serves the files from its own
  origin, so a healthy set loads in milliseconds and the cap only bounds the blank page a broken one costs.
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

## Boundary

- **Public surface:** `webExtensions`, `registerWebExtensions`, `installExtensionHost`,
  `EXTENSION_HOST_API`, `SHARED_SPECIFIERS`, `SharedSpecifier`, `ExtensionHost`, `loadWebExtensions`,
  `loadWebExtensionsBeforeRender`, `unloadWebExtension`, `webExtensionLoads`, `subscribeWebExtensionLoads`,
  `useWebExtensionLoads`, `PRE_RENDER_WAIT_MS`, `InstalledWebExtension`, `WebExtensionLoadResult`,
  `WebExtensionLoadFailure`.
- **Imports:** public extension `./web` entries, the web SDK contract, chat's registration functions,
  `transport` (`getTransport().httpBase()` and the client error reports — the loader's only reach into
  app integration), and, for the host object only, the shared module set. Never `ChatView`, stores,
  extension internals or server halves. The registry Map remains owned by chat; the loader owns only
  its per-name load state and stylesheet links.
- **Bootstrap order** (`main.tsx`): `installExtensionHost()` → `registerWebExtensions()` → (wave 2)
  `loadWebExtensionsBeforeRender(descriptors from the host)` → first render. Interaction state and the
  plan/review glances derive from the registry's `interactive` registrations, so the built-in set must be
  complete before any lazy view reads a transcript; installed ones that land later re-derive through the
  registry's snapshot hooks ([[submodule-web-chat]]).
- Direct component consumers use an extension's named public exports independently of tool registration:
  Markdown renders `MermaidView`. The plan page reaches the questionnaire card through the registry, not by
  name.
