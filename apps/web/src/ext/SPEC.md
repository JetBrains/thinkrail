---
id: submodule-web-ext
type: submodule-design
status: active
title: ext — web runtime and slots for UI extensions
parent: module-web
depends-on: [module-contracts]
references: [submodule-server-ext, module-ext-sdk]
tags: [extensions, ui, public-surface-checked]
---

## Responsibility

Mounts extension view files (built and served by [[submodule-server-ext]]) inside the shell. Owns the
runtime global that view bundles read React and the view API from, the per-surface mount with its error
boundary, the view hooks, the extension state store, and the five slot adapters. The shell decides where
a slot sits; this module decides what renders there.

## State

`extStore.ts` is a separate Zustand store (`useExtStore`), not a slice of `appStore`: nothing outside this
module reads extension state, and `appStore` is already far over the file budget.

- `hydration`: `idle` until the first `ext.list` + `ext.snapshot` pair of a connection installs; `failed`
  when that read fails (pushes still apply, surfaces with no pushed extension show an error); `unsupported`
  when the host's protocol is older than `EXT_PROTOCOL_VERSION` (every extension and channel clears).
- `extensions` by name, `channels` by full key (`<name>:<key>`), `params` by `<name>:<surface>` (the last
  `openSurface` params, in memory only).
- Every push has one atomic action: `applyChanged`, `applyRemoved` (also drops that extension's channel
  keys), `applyChannel`, `dropChannels` (`ext.channelsDropped`), `install`. Derived lists come from pure
  selectors (`selectSurfaces`, `selectSurface`, `surfaceTitle`) called in `useMemo` over the `extensions`
  record, never from a selector that returns a fresh array.

`sync.ts` (`initExtensions`, called once from `main.tsx` right after `initTransport`) subscribes the four
`ext.*` pushes, then hydrates on every `server.welcome` (the store's `welcomeGeneration`). During a
hydration read, pushes are buffered and replayed after the snapshot installs, and a superseded read is
ignored, so a push that races the read is never reverted. A failed read replays its buffer and marks
`hydration` `failed`; the next welcome retries.

## Runtime global

`runtime.ts` is loaded lazily (first surface mount), then sets `globalThis[EXT_RUNTIME_GLOBAL]` to one
frozen object keyed by contracts' `EXT_RUNTIME_MODULES`: the app's own `react`, `react/jsx-runtime`,
`react/jsx-dev-runtime`, `react-dom` namespaces (the production build ships production React, matching the
production JSX the host emits), and `@thinkrail/ext/view` = `{ useChannel, useAction, useHostContext,
openSurface, startChat, ui, cn, remixicon }`. `ui` is exactly contracts' `EXT_VIEW_UI_EXPORTS` from
`components/ui` (`satisfies` keeps the key set equal; `runtime.test.ts` checks it at runtime). The global
is installed once and never replaced, so every view shares one React instance.

`remixicon` is imported through the alias `@ext-runtime/remixicon` (`vite.config.ts` + `tsconfig.json`
paths, typed by `remixicon.d.ts`), which points at the package's CommonJS build. A second module identity
keeps the full icon set in the lazy runtime chunk; importing `@remixicon/react` as a namespace would retain
every icon in the eager vendor chunk the rest of the app shares.

## Surface mount

`ExtensionSurface({ name, surfaceId, layout, toolCall?, message? })`:

- Placeholders instead of drops: `Loading extensions…` before hydration, `extension <name> not loaded`
  when the store has no such extension (a restored tab or panel keeps its place), and an error card when
  the extension has no working build yet.
- The module URL is `extAssetPath` behind transport's `hostUrl` (launch token included), imported with
  `import(/* @vite-ignore */ url)`; imports are cached per URL. The build id is content-hashed, so a new
  generation is a new URL. The previous component keeps rendering until the new one resolves, so a reload
  swaps without a blank frame and without a page reload.
- The surface stylesheet is a ref-counted `<link>` per URL. A new build's stylesheet is retained and must
  load (or fail) before the component swaps, so the new view never paints unstyled; the old link is
  released only after the swap.
- A reload that failed (`status: "error"` with a build still present), or a new build that fails to import
  in the browser, keeps the old view and shows a compact banner with the error. An import failure is
  reported through `ext.reportError` once per build.
- `layout` is `fill` (tab, panel), `inline` (tool card, message: compact error card), or `status` (topbar:
  errors collapse to an icon chip with a tooltip).
- Error text is passed through contracts' `redactLaunchToken` before it is shown, reported, or put into an
  **Ask agent to fix** draft: module URLs carry the launch token.
- Each mount has its own `SurfaceErrorBoundary`: a render crash reports through `ext.reportError` (so
  `ext_logs` sees it), shows the error with **Ask agent to fix** and **Try again**, and resets when the
  build changes. **Ask agent to fix** opens a new chat in the active workspace with a draft that names
  the error and points at `ext_logs` / `ext_reload`, through the same `startChat` (`askAgent.ts`) views get.

## View hooks

A surface renders inside `SurfaceContext` (`{ name, surfaceId }`), so hooks are scoped to their own
extension: `useChannel(key)` reads `<name>:<key>` from the store (the connection snapshot, then live
`ext.channel` pushes); `useAction(id)` returns a stable function that sends `ext.action` with the current
host ids as `ctx`. `useHostContext()` is the active project/workspace, the focused chat's session id
(attention center tab, else the workspace's newest chat tab), and the theme appearance; it re-renders when any of them changes.
`openSurface(name, surfaceId, params?)` opens a `tab` surface as a center tab or reveals a `panel`
surface through the store's layout intents in the active workspace.

## Slots

| slot | adapter | placement |
| --- | --- | --- |
| `tab` | `ExtensionTabBody` | layout center tab kind `extension` (`{ extension, surface }`) |
| `panel` | `ExtensionPanelBody` | tool id `ext:<name>:<surface>` through the shell's `renderToolBody` default branch |
| `status` | `ExtensionStatusItems` | topbar, before the Central quota item |
| `toolCard` | `rendererSlots.tsx` | `registerToolRenderer(tool)` (primary, expanded when done) |
| `message` | `rendererSlots.tsx` | chat's `registerMessageRenderer(customType)` |

`toolCard` and `message` registrations follow the store: added when an extension with a build declares
them, disposed when it disappears. Two surfaces claiming one name stack; removal in any order falls back to
the newest remaining one, then the built-in or default. Chat
re-renders through its renderer-registry version.

## Extensions menu and project trust

`ExtensionMenu` (center group actions, the puzzle button) is always shown.

- It lists every `tab` and `panel` surface, grouped by scope: **User** (`~/.thinkrail/extensions`) then
  **Project**. With nothing to list it shows an empty state naming both folders and the SDK guide path.
- `selectBlocked(extensions, projectId)` gives the active project's `blocked` entries (host-reported, see
  [[submodule-server-ext]]) while the store's project is not trusted. When there are some, the first click
  opens `TrustExtensionsDialog` instead of the menu: a security warning (extensions run code with full
  access to files, network, and sessions), the extension names, **Trust project** (`project.setTrust`,
  then `applyProjectUpdated`; the host loads them live) and **Cancel**. After Cancel the button opens the
  menu for that project, with a first item that reopens the dialog. The dismissal is per mounted menu, in
  memory.
- A mounted surface of a blocked extension shows the placeholder `extension <name> is off until you trust
  this project`.

## Known limitations

- `ExtensionMenu` and a view's `openSurface` are the only ways to open a `tab` or `panel` surface; the
  command palette does not list surfaces.

## Boundary

- **Public surface (barrel):** `initExtensions`, `ExtensionMenu`, `ExtensionPanelBody`,
  `ExtensionStatusItems`, `ExtensionTabBody`.
- **Allowed deps:** `contracts`; `transport` (requests, pushes, `hostUrl`, session creation); `store`
  (welcome generation, protocol version, host ids, projects + `applyProjectUpdated`, layout intents, chat
  draft, toasts); `themes`
  (`onThemeSwap`); `chat/toolRegistry` + `chat/rendererRegistry` (registration only); `components/ui`;
  `lib`; `@remixicon/react`; React; Zustand.
- **Forbidden:** `shell`, `panels`; any `server`/`shared`/`pi` import; evaluating extension code any way
  other than the host-served module URL.
