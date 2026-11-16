---
id: submodule-web-extensions
type: submodule-design
status: draft
title: Web extension composition registry
parent: module-web
depends-on: [module-extension-api, module-ext-visualize, module-ext-ask-user-question, module-ext-hint-mode]
references: [submodule-web-chat, submodule-web-shell, module-thinkrail-extensions]
---

## Responsibility

The static composition point for web extensions. `registry.ts` owns their ordered list.
`registerWebExtensions()` runs once at app bootstrap (`main.tsx`), not from `ChatView`: interaction state
and the plan/review glances are derived from the registry's `interactive` registrations, so it must be
complete before any lazy view reads a transcript. The app-local registrations (`chat/tools/register`) arrive
later with `ChatView`'s lazy chunk and name other tools. Each descriptor's tool entries feed the existing
chat registry in order, preserving its last-registration-wins behavior and fallback renderer.
Re-registering the same list replaces entries rather than accumulating them.

Registration ignores the host's extension on/off setting: a web extension's renderers stay registered while
its server half is disabled, so a transcript that already contains its tool calls keeps rendering them. The
switch only decides what the host gives the agent next — and which **global contributions** run:
`enabledWebExtensions(disabled)` is the list `Shell` mounts `globalOverlay`s from and the cheatsheet takes
`shortcuts` from ([[submodule-web-shell]]), so switching one off unmounts it at once.
`webExtensionCommands(disabled)` lists the `commands` of **every** registered extension in registry order
with an `enabled` flag — the input `shell` resolves keybindings from ([[submodule-web-keybindings]]): a
switched-off extension's commands stay listed (Settings → Keyboard shows and rebinds them) but neither
match nor conflict, and registry order decides between two extensions' defaults. A command with a
`scope` is local and reaches the resolver's per-scope table as it is; the resolver drops one whose id or
scope lacks the extension's `name.` prefix, and the tests pin that every bundled command has it.
`webOnlyExtensions(serverNames)` is the titled entries the server catalog lacks; Settings → Extensions
lists them under the same switch ([[module-thinkrail-extensions]]).

## Boundary

`index.ts` exports `webExtensions`, `registerWebExtensions`, `enabledWebExtensions`,
`webExtensionCommands` (with its `WebExtensionCommands` type) and `webOnlyExtensions` only. Imports reach public extension `./web` entries, the web SDK contract, and chat's
registration function; never `ChatView`, stores, transport, extension internals or server halves. The
registry Map remains owned by chat, so this module creates no parallel state owner or runtime extension
loader. Direct component consumers use an extension's named public exports independently of tool
registration: Markdown renders `MermaidView`. The plan page reaches the questionnaire card through the
registry, not by name. Its tests also pin that the bundled extensions' default chords conflict with
nothing (the resolver with no overrides reports no conflict on any platform) and that plain F is free in
the app table and in the catalog's feature keys.
