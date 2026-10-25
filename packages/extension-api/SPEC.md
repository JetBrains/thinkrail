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
- `ToolRenderProps.interaction` is optional. The host fills it only for tool calls it blocks on for the
  person's response; today that is only `ask_user_question`. It carries:
  - `state`: a `response` delivered outside the tool result (after a host restart), plus `superseded`
    and `ended`;
  - `respond(response)`;
  - the chat's `focusScope`, so the card claims attention focus once per chat mount;
  - `prepareLayoutChange`, which keeps the reader's place when the card changes size;
  - `revealElement(element, ToolRevealOptions)` and `cancelAutomaticReveal()`;
  - `focusComposer()`.

  Without it, a renderer shows the call read-only from `result`, as in a subagent transcript. The
  renderer stays props-driven: it never reaches the chat's contexts, store or transport. The shape is
  generic over the response type, but support is per tool and lives in the host. Its DOM-typed members
  are the reason the package's `lib` includes `DOM`; the package still never touches the DOM.
- `WebExtension` is `{ name, toolRenderers }`, with each tool-name entry carrying a `renderer` and
  optional `ToolRegistrationOptions` under `options`. `defineWebExtension` is a typed identity helper:
  it preserves the descriptor and its inferred tool keys without registration or default injection.
- `./server` exposes `ServerExtension` and `defineServerExtension`, with pi `ExtensionFactory` types
  only. Descriptors carry `name` (the identity — the Settings on/off switch and `disabledExtensions` key
  on it), optional display copy `title` / `description` for the Settings catalog, `extensions`, optional
  `sessionExtensions`, optional `childExtensions` and optional `skillPackages` specifiers. Its identity
  helper preserves factories, order and optional-field absence; loading and skill resolution remain host
  responsibilities.
- `sessionExtensions(session: ExtensionSessionServices) => ExtensionFactory[]` is how an extension uses
  per-session state the host owns: the host calls it once per parent session with that session's
  services. Today the services are `awaitToolResponse(toolCallId, signal)`, which resolves a
  `ToolResponse`: `{kind: "response", value}`, `{kind: "deferred"}` or `{kind: "abandoned"}`.
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

Package tests exercise descriptors through their public entries, pure argument/result helpers and
browser bundling of both the root and `./web`. Browser bundles permit only contracts at runtime and
reject React, pi, host and server imports; `./server` separately verifies its pi dependency is erased.
The app's registry and common-image-layer tests retain coverage of the host-owned rendering behavior.
