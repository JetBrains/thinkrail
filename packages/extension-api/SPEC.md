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
  - `focusComposer()`.

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
  `sessionExtensions`, optional `interactiveTools`, optional `childExtensions` and optional
  `skillPackages` specifiers. Its identity
  helper preserves factories, order and optional-field absence; loading and skill resolution remain host
  responsibilities.
- `sessionExtensions(session: ExtensionSessionServices) => ExtensionFactory[]` is how an extension uses
  per-session state the host owns: the host calls it once per parent session with that session's
  services. The services are the interactive-tool mailbox:
  - `expectToolResponse(toolCallId)` announces a call the extension will execute and await, from its
    `message_end` hook, before pi runs it. The host tracks only announced calls, so a switched-off
    extension or a same-name tool from another package never becomes a host-tracked interaction.
  - `awaitToolResponse(toolCallId, signal)` resolves a `ToolResponse`: `{kind: "response", value}`,
    `{kind: "deferred"}` or `{kind: "abandoned"}`.
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
