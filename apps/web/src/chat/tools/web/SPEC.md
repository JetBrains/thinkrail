---
id: submodule-web-chat-tools-web
type: submodule-design
status: draft
title: web tool renderers (web_search / fetch_content)
parent: submodule-web-chat
depends-on: [module-contracts]
tags: [v1, chat, web-tools]
---

## Responsibility

Presentational renderers for the bundled **`pi-web-access`** extension's tools, joined to the capability by
**tool name**: `WebSearchCard` (`web_search`) and `WebFetchCard` (`fetch_content`). `register.ts` wires
both via `registerToolRenderer` (+ a collapsed-header summary) and is imported for its side effect by the
parent `tools/register`.

## Boundary

- **Owns:** `WebSearchCard` (query + provider + synthesized answer/sources) and `WebFetchCard` (fetched URL
  + extracted content), both via the shared `CodeBlock`/`Collapsible`, and their registration.
- **Public surface:** none beyond the side-effect `register` (no barrel — chat pulls shiki; per-file like
  its siblings).
- **Allowed deps:** sibling chat primitives (`toolRegistry`, `toolHelpers`, `CodeBlock`, `Collapsible`);
  `lucide-react`.
- **Forbidden:** value-importing any `pi` package or `pi-web-access`; `store`/`transport` (renderers stay
  presentational — extraction-ready into `packages/chat-ui`).

## Get right

- **Render defensively.** `pi-web-access`'s `details` shape is not a stable public API, so read `result`
  best-effort (provider name via optional chaining) and otherwise render the tool's **text content**
  (`resultText`) — never hard-depend on a `details` field. `args` (`query`/`queries[0]`, `url`/`urls[0]`)
  drive the header + collapsed summary.
- Token-utility styling only (no raw hex / inline `style`).
- Tool names `web_search` / `fetch_content` must match the extension exactly.
