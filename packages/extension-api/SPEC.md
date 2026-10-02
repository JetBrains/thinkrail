---
id: module-extension-api
type: module-design
status: draft
title: Host extension contracts and pure renderer helpers
parent: architecture
depends-on: [module-contracts]
references: [module-thinkrail-extensions]
---

## Responsibility

The source-only host extension contract, independent of presentation components and host state. The
browser and server descriptors compose capabilities without importing either application's internals.
The host retains registration, lifecycle and ordering; `define*` helpers preserve the supplied descriptor.

## Boundary

- `./web` exposes `ToolStatus`, `ToolRenderProps`, `ToolRenderer`, `ToolSummary`, `ToolChrome`,
  `ToolProminence`, `ToolRegistrationOptions`, `WebExtension`, `defineWebExtension`, and the pure
  argument/result readers from `toolHelpers` and `toolResultContent`.
- `./server` exposes `ServerExtension` and `defineServerExtension`, with pi `ExtensionFactory` types
  only. Descriptors carry a name, parent factories, optional child factories and optional skill-package
  specifiers; loading and skill resolution remain host responsibilities.
- The root is browser-safe and exposes only the web contract; it never re-exports the server half.
- The only workspace dependency is `contracts`. React and pi are type-only contract dependencies;
  there are no React components, registry, DOM access, host imports, or pi runtime values.

Canonical tool-result parsing remains shared by renderer text extraction and the host's common image
layer: accept only well-formed supported image blocks, preserve text-block order, and fall back to
readable values for noncanonical results. Props-driven renderers receive optional file navigation from
the host, never acquire it from a store or transport. Extension composition rules live in
[[module-thinkrail-extensions]].
