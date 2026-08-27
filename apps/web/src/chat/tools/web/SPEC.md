---
id: submodule-web-chat-tools-web
type: submodule-design
status: active
title: web tool renderers (search / fetch / stored content)
parent: submodule-web-chat-tools
depends-on: [module-contracts]
tags: [v1, chat, web-tools]
---

## Responsibility

Presentational renderers for all three tools exposed by the pinned **`pi-web-access`** extension, joined to
that capability by **tool name**: `WebSearchCard` (`web_search`), `WebFetchCard` (`fetch_content`), and
`WebStoredContentCard` (`get_search_content`). `register.ts` wires all three via `registerToolRenderer`
(+ collapsed-header summaries) and is imported for its side effect by the parent `tools/register`.

## Boundary

- **Owns:** `WebSearchCard` (query + provider + synthesized answer/sources), `WebFetchCard` (fetched URL or
  local-video path + extracted content), `WebStoredContentCard` (response id + selected query/URL + recovered
  full content), their shared folded Markdown result body, and registration.
- **Public surface:** none beyond the side-effect `register` (no barrel — chat pulls shiki; per-file like
  its siblings).
- **Allowed deps:** sibling/parent chat primitives (`toolRegistry`, `toolHelpers`, `ToolFileLink`,
  `Collapsible`, `Markdown`); `@remixicon/react`.
- **Forbidden:** value-importing any `pi` package or `pi-web-access`; `store`/`transport` (renderers stay
  presentational — extraction-ready into `packages/chat-ui`).

## Get right

- **Render defensively.** `pi-web-access`'s `details` shape is not a stable public API, so read `result`
  best-effort (provider name via optional chaining) and otherwise render the tool's **text content**
  (`resultText`) — never hard-depend on a `details` field. Args drive headers/summaries: first query for
  search; first URL/local path for fetch; selected query/URL then response id for stored content.
- Successful text content is folded and rendered as Markdown, so synthesized citations and fetched links
  are real safe new-tab links rather than highlighted Markdown source. Error text remains plain.
- `fetch_content` treats only HTTP(S) as an external anchor. Any other input is a structured local-path
  candidate and uses the parent's worktree gate; a foreign absolute path stays inert instead of becoming a
  broken same-origin link.
- Token-utility styling only (no raw hex / inline `style`).
- Tool names `web_search` / `fetch_content` / `get_search_content` must match the extension exactly.
