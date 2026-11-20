---
id: submodule-web-extensions
type: submodule-design
status: draft
title: Web extension composition registry
parent: module-web
depends-on: [module-extension-api, module-ext-visualize, module-ext-ask-user-question, module-ext-hint-mode, module-ext-session-insights, module-ext-board]
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
`webOnlyExtensions(serverNames)` is the titled entries without tool renderers or panels that the server catalog lacks; Settings → Extensions & skills
lists them under the same switch ([[module-thinkrail-extensions]]). `webExtensionTitle(name)` is the
`title` key a web half declares, which translates a bundled extension's name wherever a row names it
(its catalog row, a pi package row it supersedes) over the server's English `title`.
Composer suggestions are the one *tool-registered* affordance the switch hides: each registration carries
its extension's `name`, so the chat hides a switched-off extension's chips while its past rows keep
rendering ([[submodule-web-chat]]).

The same list is the one authority on **panels** (the server catalog never lists them): `extensionPanels()`
reads every extension's declarations in registry and declaration order, and `findExtensionPanel(extension,
panel)` looks one up. Both are pure reads of the static list (computed once; an optional list argument
lets tests read a fake one) and ignore the on/off switch too; the shell decides what an off, missing or
unsupported panel shows and which panels its entry points offer (`openableExtensionPanels`,
[[submodule-web-shell]]). A panel's `rail.command` names one of its extension's global commands, which
therefore reaches the resolver through `webExtensionCommands` like any other; the tests pin that every
such command is the extension's own and unscoped.

**Side tools** read the same way: `extensionSideTools()` lists every extension's `sideTools` in registry and
declaration order as `RegisteredSideTool { extension, tool, id, declaration }`, `id` being the layout tool
`ext:<extension>:<tool>` (contracts' `extensionLayoutToolId`), and `findExtensionSideTool(id)` looks one up;
both ignore the switch, and an extension with side tools is never web-only. The shell turns them into the
layout's tool catalog and the tools' bodies ([[submodule-web-shell]] § Extension side tools).

**Status items** and **views** read the same way: `extensionStatusItems()` lists every
extension's `statusItems` as `RegisteredStatusItem { extension, item, declaration }`, which the topbar
mounts ([[submodule-web-shell]] § Extension status items); `extensionViews()` lists every `views` entry as
`RegisteredView { extension, view, id, declaration }`, `id` being the view's `<extension>:<view>` in the
window's preferences, and `findExtensionView(id)` looks one up ([[submodule-web-shell]] § Extension
views). `extensionContainerSections()` lists every `containerSections`
entry as `RegisteredContainerSection { extension, section, declaration }`, which the container overview in
Peek mounts ([[submodule-web-shell]] § Extension status items). They ignore the switch too, and an extension
with any of them is never web-only.

## Boundary

`index.ts` exports `webExtensions`, `registerWebExtensions`, `enabledWebExtensions`,
`webExtensionCommands` (with its `WebExtensionCommands` type), `webOnlyExtensions`, `webExtensionTitle`,
`extensionPanels`,
`findExtensionPanel`, the `RegisteredPanel` type, `extensionSideTools`, `findExtensionSideTool`, the
`RegisteredSideTool` type, `extensionStatusItems`, the `RegisteredStatusItem` type, `extensionContainerSections`,
the `RegisteredContainerSection` type, `extensionViews`, `findExtensionView` and the
`RegisteredView` type only. Imports reach public extension `./web` entries,
the web SDK contract, and chat's registration function; never `ChatView`, stores, transport, extension
internals or server halves. The registry Map remains owned by chat, so this module creates no parallel
state owner or runtime extension loader. `registerWebExtensions()` runs once at app bootstrap
(`main.tsx`): interaction state and the plan/review glances are derived from the registry's `interactive`
registrations, so it must be complete before any lazy view reads a transcript. Direct component consumers
use an extension's named public exports independently of tool registration: Markdown renders
`MermaidView`. The plan page reaches the questionnaire card through the registry, not by name. Its tests
also pin that the bundled extensions' default chords conflict with nothing (the resolver with no overrides
reports no conflict on any platform) and that plain F is free in the app table and in the catalog's
feature keys.
