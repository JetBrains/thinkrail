---
id: submodule-web-chat-tools-mcp
type: submodule-design
status: active
title: mcp renderers (mcp__* calls, resource tools, tool_search)
parent: submodule-web-chat-tools
depends-on: [module-contracts]
tags: [chat, mcp]
---

## Responsibility

Presentational renderers for pi's built-in MCP engine, joined by tool name: `McpToolCard` for every
`mcp__<server>__<tool>` call (the registry's one prefix registration), `McpResourceListCard`
(`list_mcp_resources`, `list_mcp_resource_templates`), `McpReadResourceCard` (`read_mcp_resource`),
`ToolSearchCard` (`tool_search`), and the pure `mcpResult` readers. `register.ts` wires them as routine
card-chrome tools, imported for its side effect by the parent `tools/register`.

## What a card reads

- A finalized result keeps only `content`, `details` and `isError`. Cards render the `content` text blocks
  in order, joined by newlines as pi does: pi already turned resource links, embedded resources, audio and
  saved blobs into text lines. A card never draws image blocks — the parent's common result-content layer
  appends the one image strip after every renderer.
- `details` carries pi's `McpToolDetails` and the host's `details.thinkrail` `McpResultSummary`. Every
  field passes a guard; anything missing or malformed renders the way an older transcript does (title from
  the name, text from `content`). The summary's `blocks` are not drawn, since pi's text already carries
  them; cards read `structuredContent`, `structuredContentTruncated` and `isError`.
- The title is `details.server` / `details.tool` (pi's unsanitized names), else the tool name split at the
  first `__` after `mcp__` — a thrown call carries `details: {}`. A hash-shortened name parses best-effort.
- Arguments are one key/value list (strings raw, other values as indented JSON, pi's expanded form); the
  collapsed summary is pi's `key=JSON` one-liner, cut at 100 characters.
- Structured content is a collapsible JSON tree only; a tabular view is deferred. It sits collapsed under
  one disclosure. Opened, a tree of at most 40 nodes expands fully, a larger one only its top level, and a
  branch lists 100 children before "Show all". Every disclosure records in the shared fold cache under a
  JSON-pointer id, so state survives virtualization. `structuredContentTruncated` reads "Structured content
  too large to keep."
- A failed call (`status: "error"`, or the summary's `isError`) paints its output like other tool errors.

## Actions

Both arrive through `ChatActions` (never store/transport). A `null` provider (the subagent transcript, a
standalone render) or a host older than MCP hides them.

- **Full output** appears when `details.fullOutputPath` is recorded and the provider offers
  `readMcpOutput`; `ChatView` implements it as `mcp.readOutput({ workspaceId, sessionId, toolCallId })`.
  The card never sends or links the path — the host reads exactly the file the result recorded. The text
  opens in a dialog sized to content (up to 85vh) instead of inline, because up to 1 MiB in a row would
  distort the virtualized transcript's geometry. States: loading, text (noting host truncation),
  *expired* (pi's temporary file is gone), *unavailable*, and a request failure with Try again. A loaded
  answer is kept while the card stays mounted; a failure re-reads on the next open. Like the shared image
  preview, the dialog belongs to the card's row rather than `ChatView` (unlike the subagent transcript, it
  needs no integration state), so a run that scrolls the row out of the virtualized range closes it.
- **Sign in / Open MCP settings** replaces pi's CLI-oriented instructions (`requires sign-in`,
  `needs sign-in`, `mcp login`, `Run /mcp …`) with one button calling `openMcpSettings`, which opens
  Settings › MCP servers; when the button is offered, the shown failure text (call output and a listing's
  per-server error alike) drops the `Run /mcp …` / `pi mcp login …` sentence (`stripMcpCliInstruction`,
  through `useMcpFailureText`) and keeps the server's message, while a standalone render without
  `ChatActions` keeps pi's text verbatim. Sign-in phrases win over a bare `/mcp` instruction. Detection runs only on a
  failed result and on a listing's per-server `errors`, which is where pi emits those phrases; successful
  server output that merely mentions sign-in stays text.

## Resource and tool_search cards

- **Listings** name the server, or "All servers" for a list-all call, which pi reports with
  `details.server: ""`. Rows come from the host's structured payload (the whole listing up to 64 KiB) and
  otherwise from the JSON text. pi middle-truncates text past 20 KB, so text that does not parse falls back
  to the raw output with Full output. A list-all adds a server column; 20 rows show before "Show all";
  `nextCursor` says more exist; per-server `errors` render as error lines carrying the sign-in action.
- **Read** shows the server and URI, then the content text; images go through the shared strip.
- **`tool_search`** shows the query (and limit), then `details.loaded` with the one-line descriptions from
  pi's `- name: description` lines. No match or unknown details show pi's text verbatim.

## Boundary

- **Owns:** these renderers, the `mcpResult` readers, and their registration.
- **Public surface:** the side-effect `register` only (per-file imports, as in the parent).
- **Allowed deps:** parent chat primitives (`toolRegistry`, `ChatActions`, `foldState`), sibling
  `Collapsible`; `@thinkrail/extension-api/web`; `contracts` (type-only — `McpToolDetails`,
  `McpResultSummary`, `McpContentBlockSummary`, `McpReadOutputResult`); `@thinkrail/ui/*`;
  `@remixicon/react`.
- **Forbidden:** value-importing pi or any MCP package; `store`/`transport`. Listing rows are local parse
  views of pi's text JSON, not a wire contract.

## Get right

- MCP calls stay **routine** like any other tool: a needs-sign-in failure folds into the activity run,
  and the chat resources attention marker remains the at-a-glance signal.
- `tool_search` and the three resource tools are exact registrations; only `mcp__` resolves by prefix.
- Token-utility styling only (no raw hex / inline `style`).
