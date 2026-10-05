---
id: module-thinkrail-extensions
type: module-design
status: draft
title: ThinkRail extensions (thinkrail-extensions/)
parent: architecture
depends-on: [module-pi-extensions, module-contracts]
tags: [extensions, ui-sdk]
---

## Responsibility

A **ThinkRail extension** is a workspace package `thinkrail-extensions/<name>/` (`@thinkrail/ext-<name>`,
private) that composes a pi capability — usually a [[module-pi-extensions]] package, possibly a
third-party pi package — with its ThinkRail-specific halves: what the host bundles into sessions and how
the web client presents the capability's tools. The host composes extensions from **one registry file per
side**; how a user would install, enable or discover an extension is deliberately not designed.

Status: decided in planning; the first extension (`visualize`) arrives with PR 2 (`./web`) and PR 3
(`./server`) of the extensions pilot. Install UX, marketplace, per-extension settings, wire methods,
panels and store contributions are explicit deferrals, not gaps.

## Shape — two entrypoints, no root barrel

- `./server` — default export `defineServerExtension({ name, extensions, childExtensions?, skillPackages? })`.
  `extensions` / `childExtensions` are pi `ExtensionFactory`s the host composes into every parent session /
  the curated child set, registered as named `InlineExtension`s so pi diagnostics keep an identity.
  `skillPackages` are **package specifiers** whose `pi.skills` directories the host stages — explicit module
  identity for the build step, never inferred from a function. Server-only; may value-import pi.
- `./web` — default export `defineWebExtension({ name, toolRenderers })` keyed by tool name, **plus named
  exports** for components the host uses directly (visualize exports `MermaidView` for fenced mermaid in
  chat markdown). Browser-only; never value-imports pi; heavy renderers stay lazy.

The `define*` objects and the named web exports are the whole contract. Future capabilities (wire methods,
panels, settings) are added to these objects when a real consumer needs them.

**The property fixed now so later extensions never force a rewrite — runtime/lifecycle ownership:**
separate server and browser entrypoints; no imports of host internals; host-owned scoped state
(per-session owners such as subagents and background commands, per-workspace services) is supplied through
explicit seams and never created by an extension. Per-session owners therefore stay in the host's
session manager, outside the static registry.

## Host UI SDK

What a `./web` half may import, extracted from `apps/web` in PR 2:

- `@thinkrail/extension-api` (`packages/extension-api`) — types and `define*` helpers only, no React
  components. `./web`: `ToolRenderProps`, `ToolRenderer`, `ToolRegistrationOptions`, `ToolStatus`,
  `WebExtension`, `defineWebExtension`, and the pure renderer helpers (`toolHelpers`, `toolResultContent`).
  `./server`: `ServerExtension`, `defineServerExtension`. Its own package because server pi types would
  contaminate the wire boundary in `contracts`, and the server contract in `ui` would give the host a
  presentation dependency.
- `@thinkrail/ui` (`packages/ui`) — the owned shadcn/Radix primitives moved whole, `cn`, and the
  `onThemeSwap` function only (not the theme catalog/preferences runtime). Per-file imports
  (`@thinkrail/ui/dialog`) are retained for code-splitting. Design tokens stay in `apps/web/src/styles`;
  the SDK and extension web halves use token utility classes only, and the app's CSS `@source` and
  color/spacing/typography checks cover `packages/ui` and `thinkrail-extensions/*/web`.
- **Not in the SDK (yet):** the highlighted `CodeBlock` and the shiki highlighter — not dependency-closed
  (highlighter → theme barrel). They move together with the generic CSS-variable shiki map when a second
  extension needs highlighting.

## Composition — the registry files

- **Server:** `packages/server/src/extensions/registry.ts` statically imports every
  `@thinkrail/ext-*/server` and exports entries `{ specifier, extension }` — the descriptor **and its public
  server specifier as a string**. Static imports put the factories into the compiled CLI binary and the
  desktop bundle through the normal server graph, so the packagers generate no factory lists for them.
  The resource loader flattens `extensions` / `childExtensions` into named inline extensions in dev and
  bundled mode alike. **Skill resolution is owner-scoped:** one shared resolver resolves the extension's
  entry from `specifier`, then each `skillPackages` manifest via `createRequire(extensionEntry)` — build
  support stages the flattened roots, unbundled dev resolves at runtime, the bundled runtime uses only the
  injected staged root. The launcher infrastructure (desktop's bundled server runtime, `startDesktopHost`,
  `registerBundledRuntime`'s OAuth/Bedrock/trash registration, the generated-module isolation of
  `pi-web-access`) is unchanged by this.
- **Web:** `apps/web/src/extensions/registry.ts` exports the ordered web extensions;
  `registerWebExtensions()` feeds their `toolRenderers` into the chat tool registry, replacing side-effect
  `register.ts` imports.

## Boundary rules (enforced by `scripts/check-module-boundaries.ts`, with negative tests)

- Discovery of `pi-extensions/*` and `thinkrail-extensions/*` as workspace roots.
- **Source halves:** inside every extension, `web/**` and `server/**` never import each other, including
  by relative path.
- **Public subpaths:** `apps/web` may import only `@thinkrail/ext-*/web`; `packages/server` only
  `@thinkrail/ext-*/server`.
- Edges: `extension-api → contracts`; `ui → contracts`; `ext-*/web → ui, extension-api, contracts`;
  `ext-*/server → extension-api, its pi package`; `apps/web → contracts, ui, extension-api, ext-*/web`;
  `packages/server → extension-api, ext-*/server` (and no longer directly on pi packages an extension owns).

## Delivery template (every extension, every PR user-invisible)

1. **New pi package beside the old one**, published; old package and host wiring untouched.
2. **Web half moves** into `thinkrail-extensions/<name>/web`, registered from the web registry; the server
   still runs the old package — both register the same tool name, so rendering is unchanged.
3. **Server half + wiring**: `./server` composes the new package, the server registry picks it up, the
   old package is deleted.

PRs 1 and 2 are independent; PR 3 depends on both. A *new* extension without a web half renders through
the default tool renderer until step 2 — never visualize, whose renderer exists before and after.

## Members

| extension | pi capability | notes |
| --- | --- | --- |
| `visualize` | `@thinkrail.ai/pi-visualize` | `./server` injects the **strict** mermaid validator (`mermaid` at the web renderer's catalog version, initialised through `linkedom` — required: DOMPurify needs a real `document` for flowchart/class/state/gantt/mindmap, verified under Bun). `./web` carries the diagram/comparison cards and exports `MermaidView`. The guarantee is syntax parsing, not SVG/layout success; the browser renderer keeps its fallback. |
| `web-access` | third-party `pi-web-access` | planned next: wraps the npm package with the existing renderers and `headlessSearchPolicy`, removing the last packager special case. |
