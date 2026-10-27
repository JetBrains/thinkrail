---
id: submodule-web-extensions
type: submodule-design
status: draft
title: Web extension composition registry
parent: module-web
depends-on: [module-extension-api, module-ext-visualize, module-ext-ask-user-question]
references: [submodule-web-chat, module-thinkrail-extensions]
---

## Responsibility

The static composition point for web extensions. `registry.ts` owns their ordered list; `ChatView`
invokes registration at module load, after the app-local tool registrations. Each descriptor's tool
entries feed the existing chat registry in order, preserving its last-registration-wins behavior and
fallback renderer. Re-registering the same list replaces entries rather than accumulating them.

Registration ignores the host's extension on/off setting: a web extension's renderers stay registered while
its server half is disabled, so a transcript that already contains its tool calls keeps rendering them. The
switch only decides what the host gives the agent next.

## Boundary

`index.ts` exports `webExtensions` and `registerWebExtensions` only. Imports reach public extension
`./web` entries, the web SDK contract, and chat's registration function; never `ChatView`, stores,
transport, extension internals or server halves. The registry Map remains owned by chat, so this module
creates no parallel state owner or runtime extension loader. `registerWebExtensions()` runs once at app
bootstrap (`main.tsx`): interaction state and the plan/review glances are derived from the registry's
`interactive` registrations, so it must be complete before any lazy view reads a transcript. Direct
component consumers use an extension's named public exports independently of tool registration: Markdown
renders `MermaidView`. The plan page reaches the questionnaire card through the registry, not by name.
