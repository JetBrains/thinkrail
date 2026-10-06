---
id: submodule-web-extensions
type: submodule-design
status: draft
title: Web extension composition registry
parent: module-web
depends-on: [module-extension-api, module-ext-visualize]
references: [submodule-web-chat, module-thinkrail-extensions]
---

## Responsibility

The static composition point for web extensions. `registry.ts` owns their ordered list; `ChatView`
invokes registration at module load, after the app-local tool registrations. Each descriptor's tool
entries feed the existing chat registry in order, preserving its last-registration-wins behavior and
fallback renderer. Re-registering the same list replaces entries rather than accumulating them.

## Boundary

`index.ts` exports `webExtensions` and `registerWebExtensions` only. Imports reach public extension
`./web` entries, the web SDK contract, and chat's registration function; never `ChatView`, stores,
transport, extension internals or server halves. The registry Map remains owned by chat, so this module
creates no parallel state owner or runtime extension loader. Direct component consumers such as
Markdown use the extension's named public exports independently of tool registration.
