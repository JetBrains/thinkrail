---
id: module-extension-api
type: module-design
status: draft
title: Host extension contracts and pure renderer helpers
parent: architecture
depends-on: [module-contracts, module-locales]
references: [module-thinkrail-extensions]
---

## Responsibility

The source-only host extension contract, independent of presentation components and host state. The
browser and server descriptors compose capabilities without importing either application's internals.
The host retains registration, lifecycle and ordering; `define*` helpers preserve the supplied descriptor.

## Boundary

- `./web` exposes `ToolStatus`, `ToolRenderProps`, `ToolRenderer`, `ToolSummary`, `ToolChrome`,
  `ToolProminence`, `ToolRegistrationOptions`, `ToolInteraction`, `ToolInteractionState`,
  `ToolRevealOptions`, `WebExtension`, `defineWebExtension`, and the pure argument/result readers from
  `toolHelpers` and `toolResultContent`.
- **Interactive tools.** A tool whose `execute` waits for the person's response is *interactive*. The
  contract is tool-agnostic on both sides and keyed by `toolCallId`; the host learns a tool's name only
  from the two declarations below:
  - server: `ServerExtension.interactiveTools?: Record<toolName, InteractiveTool>` names the tools whose
    calls wait, so the host can repair a call left dangling by a restart (it writes the pending marker,
    not an error) and derive needs-input from a transcript it is not live on.
    `InteractiveTool.describeResponse?(args, response)` returns the model-facing text for a response
    delivered **after a host restart** (the only path where the tool's own `execute` is gone); `undefined`
    or no hook ⇒ the host writes a generic preface plus the response as JSON. Live responses never pass
    through it: the tool formats its own result.
  - web: `ToolRegistrationOptions.interactive: true` asks the host to fill `ToolRenderProps.interaction`
    for that renderer.
  - **Pending marker.** A result whose `details` is `{ kind: "ack" }` on an interactive call means "the
    response is still pending": the host writes it on restart repair, and a tool returns it (with
    `terminate: true`) when `awaitToolResponse` resolves `deferred`. It is the one shape both sides read
    (`contracts`: `isToolResponsePending`); a tool must not use it for a real result.
- `ToolRenderProps.interaction` is optional. The host fills it for every renderer registered
  `interactive`. It carries:
  - `state`: a `response` (`unknown` — the response delivered outside the tool result after a host
    restart, or the final result's `details` when it is not the pending marker), plus `superseded`,
    `ended`, and `accepting` — whether the host is waiting for this call's response right now (a call the
    host is not waiting on, such as a same-name tool from another package, renders but cannot respond);
  - `respond(response)` — the value travels to the tool as is; the tool validates its shape;
  - the chat's `focusScope`, so the card claims attention focus once per chat mount;
  - `prepareLayoutChange`, which keeps the reader's place when the card changes size;
  - `revealElement(element, ToolRevealOptions)` and `cancelAutomaticReveal()`;
  - `focusComposer()`;
  - `hostProtocol` — the connected host's protocol version, so a renderer can withhold an affordance an
    older host would not understand (the app's `supports*` gates, handed through tool-agnostically).

  Without it, a renderer shows the call read-only from `result`, as in a subagent transcript. The
  renderer stays props-driven: it never reaches the chat's contexts, store or transport. `state` and
  `respond` are the stable contract; the focus/layout/reveal members are the chat's own services handed
  through and may change with the chat (a renderer must tolerate their absence). Its DOM-typed members
  are the reason the package's `lib` includes `DOM`; the package still never touches the DOM.
- `WebExtension` is `{ name, toolRenderers }`, with each tool-name entry carrying a `renderer` and
  optional `ToolRegistrationOptions` under `options`. `defineWebExtension` is a typed identity helper:
  it preserves the descriptor and its inferred tool keys without registration or default injection.
- `./server` exposes `ServerExtension` and `defineServerExtension`, with pi `ExtensionFactory` types
  only. Descriptors carry `name` (the identity — the Settings on/off switch and `disabledExtensions` key
  on it), optional display copy `title` / `description` for the Settings catalog, `extensions`, optional
  `sessionExtensions`, optional `interactiveTools`, optional `settings` (declared per-extension settings —
  today only `{ type: "boolean", default, title?, description? }`; the values live in the host's config
  keyed by extension name; a built-in's Settings copy is the app's locale keys, an installed extension's
  is its own untranslated `title` / `description`, carried through the catalog), optional `childExtensions` and optional
  `skillPackages` specifiers. Its identity
  helper preserves factories, order and optional-field absence; loading and skill resolution remain host
  responsibilities.
- `sessionExtensions(session: ExtensionSessionServices) => ExtensionFactory[]` is how an extension uses
  per-session state the host owns: the host calls it once per parent session with that session's
  services: `setting(key)` (the extension's own declared setting, read inside a factory body so a pi
  reload sees a changed value), `workspaceFiles` (`check(path, cwd)` — the host's rule for which workspace
  files the UI may show — and `scratchDir`, the gitignored directory for mockups), and the interactive-tool
  mailbox:
  - `expectToolResponse(toolCallId)` announces a call the extension will execute and await, from its
    `message_end` hook, before pi runs it. The host tracks only announced calls, so a switched-off
    extension or a same-name tool from another package never becomes a host-tracked interaction.
  - `awaitToolResponse(toolCallId, signal)` resolves a `ToolResponse`: `{kind: "response", value}`,
    `{kind: "deferred"}` or `{kind: "abandoned"}`.
- `./installed` is the installed-extension contract the two runtimes read — kept off `./web` because an
  installed web half receives `./web` as `@thinkrail/extension-sdk/web`, so every name exported there is
  extension API. It has no dependencies, is browser-safe, and only `apps/web/src/extensions` and
  `packages/server/src/extensions/installed` may import it (boundary-checked). It holds the canonical:
  - `EXTENSION_API_VERSION` (`"1.0"`), `EXTENSION_HOST_OBJECT` (`"__thinkrailExtensionHost"`) and
    `SHARED_SPECIFIERS` / `SharedSpecifier` (extension API v1's shared modules, in order). The published
    SDK keeps a runtime copy of the three, which its `tools/shared.test.ts` compares with these.
  - The manifest reader (`src/manifest.ts`; the manifest is [[module-thinkrail-extensions]] § Installed
    extensions): `EXTENSION_KEYWORD`, `EXTENSION_MANIFEST_KEY` (`thinkrail`), `hasExtensionManifest` (the
    kind rule: the key is present at all), `parseExtensionManifest(packageJson, { reservedNames? })` →
    `{ ok, manifest }` or `{ ok: false, error }`, `normalizeManifestPath`, `extensionApiMismatch(api,
    host?)` (the reason an extension does not load, or `undefined`) and `isExtensionApiCompatible` (the
    same major and a minor that is not newer, compared numerically). The rules: a valid npm `name` not
    among `reservedNames`; `api` is digits `.` digits; at least one of `server` / `web`; `styles` only
    with `web`; every path relative and inside the package — no leading `/`, no `\`, NUL, URL scheme or
    drive letter, no `..` segment at all — returned normalised without `./`; `server` names a
    `.ts`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs` file, `web` a `.js`/`.mjs` and `styles` a `.css` one;
    `title` / `image` non-empty strings, trimmed (`image` is not checked further: only a catalog shows it,
    and showing only an `https:` image is the catalog's rule); `version`, `description` and `author` (a
    string or `{ name }`) are the package's own fields.
  - `src/manifestCases.json`, the one table of manifest cases with their verdicts. This package's tests,
    the SDK's `tools/` tests (expecting each valid case whose `api` is not its own to fail, its one
    stricter rule) and the website's tests (reading the file by relative path, since it may not import
    app packages) all run it, so the SDK's and the website's copies of the rules cannot drift.
- The root is browser-safe and exposes only the web contract; it never re-exports the server half.
- Workspace dependencies are `contracts` and, type-only, `@thinkrail/locales/react`'s `Translator`.
  React and pi are type-only contract dependencies; there are no React components, registry, DOM access,
  host imports, or pi runtime values.
- `ToolSummary` is `(props, t) => string`: the host passes the render-time `Translator` from `useT()`
  (`getToolSummary(t, name, props)`), so a collapsed card or routine row recomputes its summary on a
  language change; a summary translates only through that `t`, never the global translator
  (`check:i18n` flags a `summary` that reads it — [[module-locales]]).

Canonical tool-result parsing remains shared by renderer text extraction and the host's common image
layer: accept only well-formed supported image blocks, preserve text-block order, and fall back to
readable values for noncanonical results. Props-driven renderers receive optional file navigation from
the host, never acquire it from a store or transport. Extension composition rules live in
[[module-thinkrail-extensions]].

## Verification

Package tests exercise descriptors through their public entries, pure argument/result helpers, the
shared manifest cases and browser bundling of the root, `./web` and `./installed`. Browser bundles
permit only contracts at runtime (`./installed` nothing at all) and reject React, pi, host and server
imports; `./server` separately verifies its pi dependency is erased and that it exports only
`defineServerExtension`.
The app's registry and common-image-layer tests retain coverage of the host-owned rendering behavior.
