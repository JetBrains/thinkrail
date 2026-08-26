---
id: submodule-pi-next-steps-core
type: submodule-design
status: active
title: pi-next-steps core
parent: module-pi-next-steps
tags: [pi-extension, next-steps]
---

## Responsibility

Own the extension's reusable mechanics: schema constants and types, item normalization and fallback text, current-offer reconstruction, and native pi interaction. The package entrypoint composes these mechanics into the registered tool, settle handler, and command.

## Public surface

`index.ts` is the only surface available to the parent package module. It exposes the schema and constants, normalization and fallback helpers, and native presentation functions required by the root extension factory. Other implementation details remain internal to this submodule.

## Boundary

- **Allowed external deps:** `@earendil-works/pi-coding-agent` types and `typebox`.
- **Allowed parent edge:** the package-root extension entrypoint may import this module only through `src/index.ts`.
- **Forbidden:** ThinkRail packages or apps, host wire types, browser APIs, project-specific state, direct access to the server's session manager, and nested model calls.
