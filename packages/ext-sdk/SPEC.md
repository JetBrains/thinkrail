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
    `PiEventOf<E>`, `PiExtensionFactory` (pi's `ExtensionFactory`, type-only), `SessionStats`,
    `WorkspaceRef` (`{ workspaceId, projectId, name, branch, path }`, what `tr.workspaces` returns).
- `./view` (`src/view.ts` + `src/viewUi.ts`, browser side): `SurfaceProps` (contracts'
  `ExtSurfaceProps`: `surfaceId`, `host`, optional `params` from `openSurface`, `toolCall` for a
  `toolCard` surface, `message` for a `message` surface), `HostContext`, `SessionStats` (the shape of a
  published `sessions.stats`), `ExtViewUi` + its prop types, and
  **declared** (type-only, no body) runtime values named by contracts' `EXT_VIEW_EXPORTS`: `useChannel`,
  `useAction`, `useHostContext`, `openSurface`, `startChat`, `ui`, `cn`, `remixicon`. The file emits nothing; the host's
  view builder resolves this specifier to a shim over the web's runtime global, so the declarations only
  type-check authoring code.

- `./README.md`: the authoring guide an agent reads (manifest, slots, `Tr`, view API, `ui`, Tailwind
  tokens, dev loop, where extensions live). The host text-imports it and writes it under the data dir; the
  system-prompt pointer names that copy. Keep it in step with this spec and contracts' export lists.

## View contract

- `useChannel(key)` and `useAction(id)` are scoped to the surface's own extension: `key` is the same
  unprefixed key the host half passes to `tr.publish`, `id` the one passed to `tr.action`.
- `ui` holds the app's owned primitives named by contracts' `EXT_VIEW_UI_EXPORTS`. `ExtViewUi` types each
  one by hand (this package cannot import `apps/web`); its mapped base keeps the key set equal to the
  contracts list, and the web runtime's test checks the runtime object against the same list.
- `remixicon` is the app's `@remixicon/react` module (same pinned version, from the root catalog).

## Host-half contract (`Tr`)

- Every registration returns `Off` and is owned by the **generation** that made it. Disposing the
  generation releases every registration it still holds, so a factory never needs its own teardown for
  `tr.*` calls.
- The factory must be side-effect free outside `tr.*` and a returned `Disposer` (pi's rule for its own
  extension factories): the host may run it again on every reload.
- `publish(key, value)` keys are auto-prefixed `<name>:`; the host keeps the last value per key until
  `unpublish(key)` drops it (views then read `undefined`).
- `watched()` / `onWatch(fn)` report view demand: the own keys at least one mounted view on any connected
  client reads with `useChannel`. `onWatch` fires `(key, true)` for every key already watched when the
  generation goes live (or when registered after that), then on each first-view / last-view change. A
  host half uses it to run work only while someone looks.
- `store` persists JSON per extension; values must survive `JSON.stringify`.
- `sessions.stats` is pi's `getSessionStats()` as ThinkRail already projects it; never recomputed.
- `workspaces` lists the workspaces of open projects, read-only. `path` is the checkout directory; it is
  how a host half maps a view's `ctx.workspaceId` to files on disk.
- `startChat(draft)` (view) opens a new chat in the active workspace with `draft` in the composer; it
  never sends.

## Worked example

`.thinkrail/extensions/timeline/` (repo root) is the README's second example and is written only against
this package's public entries. `typecheck` also checks it through its own `tsconfig.json`, which maps
`@thinkrail/ext`, `@thinkrail/ext/view`, and React types onto this package, so an SDK change that breaks
an author's code fails here.

`.thinkrail/extensions/railmap/` is the larger example (own dependencies, `tr.workspaces`, `tr.pi` tool and
settle hook, four slots). It is a root workspace member with its own `package.json` and `tsconfig.json`, so
turbo's `typecheck` covers it directly.

`.thinkrail/extensions/git-pulse/` (git dashboard: `tr.onWatch`, `execFile`, a `tab` and a `status` slot)
is wired the same way as railmap.

## Known limitations

The package is private to this repository. An author outside it gets the README but no installable
types; only the repo's own extensions type-check against the SDK.

## Boundary

- **Allowed deps:** `@thinkrail/contracts` (types), `@earendil-works/pi-coding-agent` (**types only**,
  and only from `.`), `@types/react` + `@remixicon/react` (**types only**, from `./view`).
- **Forbidden:** any value import; any `@thinkrail/server`/`shared` import; any pi import from `./view`
  (it is browser-bundled).
