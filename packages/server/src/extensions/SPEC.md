---
id: submodule-server-extensions
type: submodule-design
status: active
title: extensions — the server registry of ThinkRail extensions
parent: module-server
depends-on: [module-extension-api, module-thinkrail-extensions]
tags: [extensions, public-surface-checked]
---

## Responsibility

The one place the host lists the ThinkRail extensions it composes ([[module-thinkrail-extensions]]
§ Composition). `registry.ts` statically imports every `@thinkrail/ext-*/server` and exports ordered
entries `{ specifier, extension }` — the `defineServerExtension` descriptor **and** its public server
specifier as a string. The static imports carry the factories into the compiled CLI binary and the
desktop server-runtime bundle through the normal server graph, so the packagers generate no factory
list for registry extensions.

## Boundary

- **Owns:** `serverExtensions` (the ordered entries), `registryInlineExtensions(kind, isDisabled?,
  entries?, session?)` (flattens `extensions` / `childExtensions` into pi `InlineExtension`s named after
  the extension — one factory keeps the bare name, several get `name#n` — so pi diagnostics show
  `<inline:visualize>` instead of a position; each factory asks `isDisabled(name)` **when pi loads it**, so
  a reload re-decides membership without rebuilding the loader. A parent flatten given a `session` appends
  `sessionExtensions(session)` after the static factories under the same naming; it calls it once per
  flatten, so every parent session's factories close over its own services. Without a session, and in the
  child set, session factories are absent), `omitDisabledRegistryExtensions(result, isDisabled)` (drops a disabled
  extension's `<inline:…>` entries from a pi `LoadExtensionsResult`, for the parent loader's
  `extensionsOverride`, so a disabled extension is absent rather than present-and-empty),
  `preferRegistryTools(result)` (also composed into that override, after the disabled filter). It moves a
  registry extension directly ahead of the first non-registry extension that registers one of its tool
  names, so a user-installed same-name package never takes over a tool whose host UI and lifecycle key on
  the name — `ask_user_question` is the reason. The other package's other tools, commands and hooks stay
  loaded. pi's own conflict diagnostic stays in the loader result, unreported, as before. The pi facts it
  relies on are registered in [[pi-compatibility]]),
  `registryExtensionName(path)` (maps an `<inline:name>` / `<inline:name#n>` path — an extension's or its
  tools' `sourceInfo.path` — back to the registry extension that owns it by name, `undefined` otherwise;
  matching by name rather than by recomputed names keeps it independent of how many per-session factories
  a session got),
  `listExtensionCatalog(disabled)` (the Settings catalog: per entry `name`, `title` — falling back to
  `name` — optional `description`, `hasChildExtensions`, `enabled = !disabled.has(name)`, and the tool names
  its **parent** factories register against a recording stub `ExtensionAPI` whose every other member is
  inert. Per-session factories are built for this with an inert session whose `awaitToolResponse`
  rejects. The tools are computed once per process, never from a live session, and a factory that throws against the stub
  keeps the tools it recorded before throwing), and `resolveExtensionSkillRoots(entry)` (the owner-scoped skill resolver: the extension's
  entry file from `specifier`, then each `skillPackages` manifest via `createRequire(extensionEntry)`,
  returning its `pi.skills` directories; a named package with no skills fails loudly),
  `stagedExtensionSkillRoute(name)` (`extensions/<name>` — the folder of a staged skills root an extension's
  roots are staged under, shared by build support and the runtime) and `extensionSkillRoots(entry,
  stagedSkillsDir?)` (the roots that own an extension's skills: the resolved source roots without a
  staged dir, that owner folder with one, nothing for an extension without `skillPackages`). The specifier is kept
  as a string precisely because a descriptor holds functions, which yield no module identity.
- **Public surface (barrel):** `serverExtensions`, `ServerExtensionEntry`, `registryInlineExtensions`,
  `RegistryExtensionKind`, `ExtensionDisabled`, `omitDisabledRegistryExtensions`, `preferRegistryTools`,
  `registryExtensionName`,
  `listExtensionCatalog`,
  `resolveExtensionSkillRoots`, `stagedExtensionSkillRoute`, `extensionSkillRoots`, `interactiveTools`, `InteractiveTools`, `ExtensionSessionServices`,
  `InteractiveTool`, `ToolResponse`.
- **Session-seam types:** `ExtensionSessionServices`, `InteractiveTool` and `ToolResponse` are re-exported
  from `extension-api/server` so that `agent` can type the services it builds through this barrel.
- **Interactive tools (`interactive.ts`):** `interactiveTools(isDisabled)` folds the enabled registry
  extensions' `interactiveTools` declarations into one name → `InteractiveTool` map (first declaration of a
  name wins). It is the only tool knowledge `agent` holds for restart repair, transcript-derived
  needs-input and late-response wording; nothing in `packages/server` names a tool or imports an extension
  outside `registry.ts`.
- **Allowed deps:** `@thinkrail/extension-api/server` (types), every `@thinkrail/ext-*/server`,
  `@earendil-works/pi-coding-agent` (types only), `@thinkrail/contracts` (the `ExtensionCatalogEntry` type),
  Node `module`/`fs`/`path`.
- **Forbidden:** `host`; `settings` (the disabled set arrives as a parameter); sibling features; resolving extension-owned packages from the host's own
  `createRequire` (the host does not depend on the pi packages an extension composes, so that resolution
  breaks in isolated layouts).

## Consumers

`host` answers `extension.list` with `listExtensionCatalog` over the `disabledExtensions` setting.
`agent/extensions.ts` composes the flattened parent set into every resource loader and the child set
into the curated hidden-child extensions in dev and bundled mode alike, and drops a disabled extension's
skills through `extensionSkillRoots`; `buildSupport.ts` hands both packagers each extension's skill roots
with their `stagedExtensionSkillRoute`; unbundled dev resolves the same roots at runtime, and the bundled
runtime uses only the launcher-staged root.
