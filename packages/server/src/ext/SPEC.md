---
id: submodule-server-ext
type: submodule-design
status: active
title: ext — UI extension host core
parent: module-server
depends-on: [module-contracts, module-ext-sdk]
tags: [extensions]
---

## Responsibility

Discovers, validates, loads, and hot-swaps ThinkRail UI extensions, and runs their host halves
in-process with full rights (pi's trust model: local extension code is trusted, no sandbox;
manifest `permissions[]` is a display label only). Owns the registries behind the `Tr` API from
[[module-ext-sdk]]: pi-event observers, pi extension factories, channels with last-value snapshots,
actions, the per-extension JSON store, timers, and logs.

## Discovery and trust

- User extensions: `<dataDir>/extensions/<name>/` (`dataDir` honours `THINKRAIL_DATA_DIR`).
- Project extensions: `<projectPath>/.thinkrail/extensions/<name>/`, only for projects the host passes
  as trusted roots. A cloned repo never runs code before the user trusts the project. A trust change
  rescans: a newly trusted root loads, an untrusted root's extensions unload. Rescans run one at a
  time in call order, so the last `setProjectRoots` wins.
- A directory is a candidate when it holds `extension.json`. Names are unique: the first candidate wins
  (user before project); a later duplicate is skipped with a warning.

## Manifest

`extension.json` is validated with typebox: `name` (`^[a-z][a-z0-9-]*$`, must equal the directory
name), optional `title`, `surfaces[]` (`id` same pattern, `slot` in `SURFACE_SLOTS`, optional `title`;
`toolCard` requires `tool`, `message` requires `customType`; ids unique), optional `permissions[]`.
Each surface needs `<id>.tsx` beside the manifest, and the extension needs `index.ts`. Errors are
actionable one-liners with a JSON-ish path, e.g.
`surfaces[1].slot "pannel" unknown; allowed: tab, panel, status, toolCard, message`.

## Generations (hot swap)

- A load builds a **new generation**: validate manifest, build every view (see "View build"), jiti-import `index.ts` (`moduleCache: false`,
  virtual modules for `@thinkrail/ext`, `@earendil-works/pi-coding-agent`, `typebox`), run the default
  export with a `Tr` bound to that generation.
- Only on success does the generation become current; then the old generation is disposed. A failure
  disposes the candidate, keeps the old generation running, and records the error (`status: "error"`,
  `generation` still the old one).
- A generation's registrations are staged until it becomes current: observers, actions, and pi factories
  are only consulted on the current generation; `every` timers start on activation; `publish` calls
  made during the factory are buffered and flushed on activation; a disposed generation's `publish` is
  ignored. Disposal runs every tracked `Off` plus the factory's returned `Disposer`.
- Loads of one extension are serialized. Generation numbers are host-global and increase per load.
- `reload(name)` of an unknown name rescans first, so a newly written extension loads without a
  restart; `reload` of a known extension whose `extension.json` is gone rescans too, which unloads it, and
  then throws `not found`.
- Unloading an extension (removed from disk, root untrusted) disposes its generation and drops its
  channel snapshots. A swap also drops the old generation's snapshots before the new one's buffered
  publishes flush, so a key the new code no longer publishes disappears.

## View build

Each surface's `<id>.tsx` is bundled with `Bun.build` into one self-contained ESM file: browser target,
no code splitting, production JSX (`react/jsx-runtime`), inline source map, and images/fonts inlined as
data URLs. A single file means the browser never makes a relative request that lacks the launch token.

- **Runtime-global plugin.** `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom` and
  `@thinkrail/ext/view` (contracts' `EXT_RUNTIME_MODULES`) resolve to virtual shims that read
  `globalThis[EXT_RUNTIME_GLOBAL][specifier]` and re-export its members. React's named-export lists come
  from enumerating the host's own `react` / `react-dom` (the root catalog pins the browser's version too);
  the view list is contracts' `EXT_VIEW_EXPORTS`. Extension-local deps (the extension's own
  `node_modules`) bundle normally, and their `react` imports hit the same shims, so one React instance runs.
- **CSS (Tailwind v4).** The host compiles one stylesheet per surface with the `tailwindcss` compiler
  against Tailwind's theme plus the app's `@theme` blocks (`appTheme.generated.ts`, produced by
  `bun run --filter @thinkrail/server ext-theme:generate` from `apps/web`'s CSS; `appTheme.test.ts`
  fails when stale), so
  extension utilities resolve to the same semantic tokens as the app. Candidates are every class-like
  token in the bundled JS. No preflight: the app already ships it. CSS a view imports is appended. Results
  are cached in memory by a hash of the candidate set.
- **Build id.** A generation's assets carry a content hash (`ExtensionInfo.build`, 16 hex) over every
  surface's JS and CSS. It is the URL segment, so an immutable cache entry can never serve stale code,
  even though generation numbers restart every boot.
- **Assets.** Images and fonts (`png`, `jpg`, `gif`, `webp`, `svg`, `woff`, `woff2`, `ttf`, `otf`) inline
  as data URLs, both when TSX imports them and when imported CSS names them in `url()`. Resolution goes by
  the realpath of the extension dir, so error positions stay relative behind a symlink.
- A build error fails the load like any other load error (old generation stays). Messages name the file
  and position: `main.tsx:3:9: Could not resolve "x"`.
- `Bun.build` and the Tailwind compiler both run inside the compiled binary (`bun build --compile`); the
  Tailwind theme is text-imported, so no file on disk is read.

## Serving

`asset(name, build, file)` returns the current generation's `<surface>.js` or `<surface>.css` body and
content type, or `undefined` for an unknown name, stale build, or unknown file. HTTP framing, launch
auth, and caching headers are `host`'s job.

## `tr.pi` and live sessions

`piFactories()` returns the current generations' pi factories. The composition root feeds it to the
agent's host-extension bridge, one factory injected into every top-level session's resource loader
(never delegated children). When a swap or unload changes any pi factory set, the host calls
`onPiFactoriesChanged`; the agent reloads idle sessions at once and streaming ones after
`agent_settled`. One extension's pi factory failing is logged to that extension and never blocks the rest.

## Validation (dry load)

`validate(name)` runs the same steps as a load (manifest, every view build, jiti import, factory run in a
throwaway generation) and then disposes that generation. It never swaps, never publishes, never touches
the running generation, and does not write load errors to the log. A name the host does not know yet is
looked up on disk (user dir, then trusted project roots) without registering it. Result:
`{ ok: true, surfaces, build }` or `{ ok: false, errors }` with the same actionable one-liners a load reports.

## File watcher

With `watchDebounceMs` set, the host watches the user extensions dir and every trusted project's
`.thinkrail/extensions` recursively. A change under `<root>/<name>/` (ignoring any `node_modules` or `.git`
segment) reloads `<name>` after `watchDebounceMs` of quiet, per name; `reload` rescans, so a new directory
loads and a deleted one unloads. Watches are re-armed after every scan: a root that does not exist yet is
not watched until a later scan finds it (an `ext_reload` of a new extension rescans). The user root is created on
start so it is always watched. `dispose()` closes every watch and pending timer.

## Agent dev loop

`createExtDevTools({ host, docsPath })` returns one pi extension factory, installed by
the composition root ahead of the `tr.pi` factories in the host-extension bridge, so top-level sessions get
it and delegated children never do. It registers:

- `ext_validate(name)`: `validate` as text; errors are the actionable one-liners.
- `ext_reload(name)`: `validate`, then (only when valid) `reload`; returns the resulting status, generation,
  build, and error. An invalid extension is not reloaded, so its old generation keeps running.
- `ext_logs(name, since?)`: the extension's log ring (`tr.log`, load/build errors, view errors from
  `ext.reportError`) at or after `since` (epoch ms), passed through `redactLaunchToken`.

A tool error (unknown name, invalid extension) sets `isError`. A `before_agent_start` hook adds a short
system-prompt section naming the guide at `docsPath` (the SDK README), the extension roots (`host.roots()`), and the three
tools; it never inlines the guide.

## Other registries

- `tr.on(type, fn)`: the composition root forwards every projected session event (`observe`) —
  the same payloads as the `pi.event` channel, top-level sessions only. Handler errors go to the
  extension's log.
- Channels: key `<name>:<key>`; `snapshot(keys?)` returns last values; `onChannel` fires per publish;
  `onChannelsDropped(name, keys)` fires when a swap or unload drops keys, so clients clear them.
- Actions: `invokeAction({ ext, id, payload, ctx })` runs the current generation's handler; unknown
  extension or id throws. A duplicate id within one generation throws at registration.
- Store: `<dataDir>/ext-store/<name>.json`, loaded lazily, writes serialized per extension and
  atomic (temp file + rename). The store survives reloads and unloads.
- Logs: in-memory ring (500 entries) per extension, fed by `tr.log`, handler errors, load and build
  failures, and view errors the web reports (`recordError`); `logs(name, since?)`.
- `tr.sessions`: read-only projections injected by the composition root; stats are pi's, never
  recomputed.

## Boundary

- **Public surface (barrel):** `createExtHost(options)` → `ExtHost` (incl. `asset`, `validate`); types
  `ExtHost`, `ExtHostOptions`, `ExtLogEntry`, `ProjectRoot`; `parseManifest` + `ExtensionManifest`
  (validation reuse); `buildSurface` (one view's JS + CSS, for validation reuse); `createExtDevTools`
  (the agent dev-loop pi factory) + `EXT_SDK_GUIDE` (the SDK README text, text-imported); `projectExtensionsDir`; type `ExtValidation`.
- **Allowed deps:** `@thinkrail/ext` (types + the module object handed to jiti), `@thinkrail/contracts`
  (types, `SURFACE_SLOTS`, runtime-module names, `redactLaunchToken`), `@thinkrail/shared/paths`, `typebox`, `jiti`,
  pi-coding-agent (types, and the module object handed to jiti), `node:fs` `watch`, `react` + `react-dom` (export-name
  enumeration only), `tailwindcss` (compiler + `theme.css` text), `Bun.build`.
- **Forbidden:** `host`; `agent`, `persistence`, `log`, and every other feature module. Sessions, trust,
  directories, warnings, and publishing are injected by the composition root, which keeps this module testable against a fixture directory.
