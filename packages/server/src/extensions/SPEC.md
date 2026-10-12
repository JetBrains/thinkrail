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

- **Owns:** `serverExtensions` (the ordered entries), `registryInlineExtensions(kind, isDisabled?)` (flattens
  `extensions` / `childExtensions` into pi `InlineExtension`s named after the extension — one factory keeps
  the bare name, several get `name#n` — so pi diagnostics show `<inline:visualize>` instead of a
  position; each factory asks `isDisabled(name)` **when pi loads it**, so a reload re-decides membership
  without rebuilding the loader), `omitDisabledRegistryExtensions(result, isDisabled)` (drops a disabled
  extension's `<inline:…>` entries from a pi `LoadExtensionsResult`, for the parent loader's
  `extensionsOverride`, so a disabled extension is absent rather than present-and-empty),
  `listExtensionCatalog(disabled)` (the Settings catalog: per entry `name`, `title` — falling back to
  `name` — optional `description`, `hasChildExtensions`, `enabled = !disabled.has(name)`, and the tool names
  its **parent** factories register against a recording stub `ExtensionAPI` whose every other member is
  inert; computed once per process, never from a live session, and a factory that throws against the stub
  keeps the tools it recorded before throwing), and `resolveExtensionSkillRoots(entry)` (the owner-scoped skill resolver: the extension's
  entry file from `specifier`, then each `skillPackages` manifest via `createRequire(extensionEntry)`,
  returning its `pi.skills` directories; a named package with no skills fails loudly). The specifier is kept
  as a string precisely because a descriptor holds functions, which yield no module identity.
- **Public surface (barrel):** `serverExtensions`, `ServerExtensionEntry`, `registryInlineExtensions`,
  `RegistryExtensionKind`, `ExtensionDisabled`, `omitDisabledRegistryExtensions`, `listExtensionCatalog`,
  `resolveExtensionSkillRoots`.
- **Allowed deps:** `@thinkrail/extension-api/server` (types), every `@thinkrail/ext-*/server`,
  `@earendil-works/pi-coding-agent` (types only), `@thinkrail/contracts` (the `ExtensionCatalogEntry` type),
  Node `module`/`fs`/`path`.
- **Forbidden:** `host`; `settings` (the disabled set arrives as a parameter); sibling features; resolving extension-owned packages from the host's own
  `createRequire` (the host does not depend on the pi packages an extension composes, so that resolution
  breaks in isolated layouts).

## Consumers

`host` answers `extension.list` with `listExtensionCatalog` over the `disabledExtensions` setting.
`agent/extensions.ts` composes the flattened parent set into every resource loader and the child set
into the curated hidden-child extensions in dev and bundled mode alike; `buildSupport.ts` stages the
flattened skill roots for both packagers; unbundled dev resolves the same roots at runtime, and the
bundled runtime uses only the launcher-staged root.
