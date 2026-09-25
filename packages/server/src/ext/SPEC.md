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
  rescans: a newly trusted root loads, an untrusted root's extensions unload.
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

- A load builds a **new generation**: validate manifest, jiti-import `index.ts` (`moduleCache: false`,
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
- Unloading an extension (removed from disk, root untrusted) disposes its generation and drops its
  channel snapshots.

## `tr.pi` and live sessions

`piFactories()` returns the current generations' pi factories. The composition root feeds it to the
agent's host-extension bridge, one factory injected into every top-level session's resource loader
(never delegated children). When a swap or unload changes any pi factory set, the host calls
`onPiFactoriesChanged`; the agent reloads idle sessions at once and streaming ones after
`agent_settled`. One extension's pi factory failing is logged to that extension and never blocks the rest.

## Other registries

- `tr.on(type, fn)`: the composition root forwards every projected session event (`observe`) —
  the same payloads as the `pi.event` channel, top-level sessions only. Handler errors go to the
  extension's log.
- Channels: key `<name>:<key>`; `snapshot(keys?)` returns last values; `onChannel` fires per publish.
- Actions: `invokeAction({ ext, id, payload, ctx })` runs the current generation's handler; unknown
  extension or id throws. A duplicate id within one generation throws at registration.
- Store: `<dataDir>/ext-store/<name>.json`, loaded lazily, writes serialized per extension and
  atomic (temp file + rename). The store survives reloads and unloads.
- Logs: in-memory ring (500 entries) per extension, fed by `tr.log`, handler errors, and load failures;
  `logs(name, since?)`.
- `tr.sessions`: read-only projections injected by the composition root; stats are pi's, never
  recomputed.

## Boundary

- **Public surface (barrel):** `createExtHost(options)` → `ExtHost`; types `ExtHost`, `ExtHostOptions`,
  `ExtLogEntry`, `ProjectRoot`; `parseManifest` + `ExtensionManifest` (validation reuse).
- **Allowed deps:** `persistence` (`dataDir`), `log`; `@thinkrail/ext` (types + the module object handed
  to jiti), `@thinkrail/contracts` (types, `SURFACE_SLOTS`), `@thinkrail/shared/paths`, `typebox`,
  `jiti`, pi-coding-agent (types, and the module object handed to jiti).
- **Forbidden:** `host`; `agent` and every other feature module. Sessions, trust, and publishing are
  injected by the composition root, which keeps this module testable against a fixture directory.
