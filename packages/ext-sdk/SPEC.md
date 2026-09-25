---
id: module-ext-sdk
type: module-design
status: active
title: ext-sdk — the authoring API for ThinkRail UI extensions
parent: architecture
depends-on: [module-contracts]
references: [submodule-server-ext]
tags: [extensions]
---

## Responsibility

`@thinkrail/ext` is what an extension author imports. It owns the **types** of the host-half API
(`Tr`) and the identity helper `defineExtension`. The runtime behind those types lives in
[[submodule-server-ext]]; this package holds no host logic.

An extension is a directory: `extension.json` (manifest), `index.ts` (host half, runs in-process in the
host), and one `<surfaceId>.tsx` per declared surface (view files, shipped to the browser).

## Public surface

- `.` (`src/index.ts`, host half, Node-side only):
  - `defineExtension(factory)` — identity; gives the factory its `Tr` parameter type.
  - `ThinkRailExtension` — `(tr: Tr) => Disposer | undefined | Promise<Disposer | undefined>`. A returned
    `Disposer` runs when the generation is disposed (close watchers, sockets, …).
  - `Tr`, `Off`, `Disposer`, `SessionRef`, `ActionCtx`, `ActionHandler`, `ExtStore`, `PiEventName`,
    `PiEventOf<E>`, `PiExtensionFactory` (pi's `ExtensionFactory`, type-only).
- `./view` (`src/view.ts`, browser side): `SurfaceProps`, `HostContext` (from contracts), and
  **declared** (type-only, no body) runtime values named by contracts' `EXT_VIEW_EXPORTS`: `useChannel`,
  `useAction`, `useHostContext`, `openSurface`, `ui`, `cn`. The file emits nothing; the host's view
  builder resolves this specifier to a shim over the web's runtime global, so the declarations only
  type-check authoring code.

## Host-half contract (`Tr`)

- Every registration returns `Off` and is owned by the **generation** that made it. Disposing the
  generation releases every registration it still holds, so a factory never needs its own teardown for
  `tr.*` calls.
- The factory must be side-effect free outside `tr.*` and a returned `Disposer` (pi's rule for its own
  extension factories): the host may run it again on every reload.
- `publish(key, value)` keys are auto-prefixed `<name>:`; the host keeps the last value per key.
- `store` persists JSON per extension; values must survive `JSON.stringify`.
- `sessions.stats` is pi's `getSessionStats()` as ThinkRail already projects it; never recomputed.

## Boundary

- **Allowed deps:** `@thinkrail/contracts` (types), `@earendil-works/pi-coding-agent` (**types only**,
  and only from `.`).
- **Forbidden:** any value import; any `@thinkrail/server`/`shared` import; any pi import from `./view`
  (it is browser-bundled).
