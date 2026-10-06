---
id: submodule-server-extensions
type: submodule-design
status: active
title: extensions — the server registry of ThinkRail extensions
parent: module-server
depends-on: [module-extension-api, module-thinkrail-extensions]
tags: [extensions]
---

## Responsibility

The one place the host lists the ThinkRail extensions it composes ([[module-thinkrail-extensions]]
§ Composition). `registry.ts` statically imports every `@thinkrail/ext-*/server` and exports ordered
entries `{ specifier, extension }` — the `defineServerExtension` descriptor **and** its public server
specifier as a string. The static imports carry the factories into the compiled CLI binary and the
desktop server-runtime bundle through the normal server graph, so the packagers generate no factory
list for registry extensions.

## Boundary

- **Owns:** `serverExtensions` (the ordered entries), `registryInlineExtensions(kind)` (flattens
  `extensions` / `childExtensions` into pi `InlineExtension`s named after the extension — one factory keeps
  the bare name, several get `name#n` — so pi diagnostics show `<inline:visualize>` instead of a
  position), and `resolveExtensionSkillRoots(entry)` (the owner-scoped skill resolver: the extension's
  entry file from `specifier`, then each `skillPackages` manifest via `createRequire(extensionEntry)`,
  returning its `pi.skills` directories; a named package with no skills fails loudly). The specifier is kept
  as a string precisely because a descriptor holds functions, which yield no module identity.
- **Public surface (barrel):** `serverExtensions`, `ServerExtensionEntry`, `registryInlineExtensions`,
  `RegistryExtensionKind`, `resolveExtensionSkillRoots`.
- **Allowed deps:** `@thinkrail/extension-api/server` (types), every `@thinkrail/ext-*/server`,
  `@earendil-works/pi-coding-agent` (the `InlineExtension` type), Node `module`/`fs`/`path`.
- **Forbidden:** `host`; sibling features; resolving extension-owned packages from the host's own
  `createRequire` (the host does not depend on the pi packages an extension composes, so that resolution
  breaks in isolated layouts).

## Consumers

`agent/extensions.ts` composes the flattened parent set into every resource loader and the child set
into the curated hidden-child extensions in dev and bundled mode alike; `buildSupport.ts` stages the
flattened skill roots for both packagers; unbundled dev resolves the same roots at runtime, and the
bundled runtime uses only the launcher-staged root.
