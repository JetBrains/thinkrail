---
id: submodule-web-chat-tools
type: submodule-design
status: active
title: tools — built-in tool renderers
parent: submodule-web-chat
depends-on: [module-contracts]
tags: [chat]
---

## Responsibility

The **app-local presentation halves of bundled tools**, joined to server-side capabilities by tool name
(the extension model lives in the parent spec). `register.ts` wires these renderers via
`registerToolRenderer` (and, for `mcp__*` alone, `registerToolRendererPrefix`) — renderer +
collapsed-header summary + chrome/prominence — as a side-effect import of `ChatView`. Extracted extension
renderers are registered by the host's `extensions/registry.ts`. Unregistered tools fall back to
`DefaultToolRenderer` and are treated as **routine** (they fold into activity groups).

## What's here

- **Core pi tools** — `BashCard` (terminal block), `ReadCard`/`WriteCard` (project-relative path +
  highlighted textual file), `EditCard` (path + removed/added line diff). All **routine**. A settled `read`
  (success or error) and a successful `write`/`edit` use the shared structured file-link primitive when the
  path belongs to the active worktree, opening the shell's preview slot; a running/failed mutation or foreign
  path stays text. Image content
  returned by `read` is previewed by the parent chat module's common result-content layer, the same path as
  every other image-producing tool; `ReadCard` does not special-case image payloads.
- **`ResolveCommentCard`** — the compact receipt for the host-owned `resolve_comment` review tool
  (capability: the server's `agent` module + `reviews` seam; see [[submodule-server-reviews]]): a ✓ +
  the resolved comment id/note. **Routine** — the review sidebar is where resolution state lives; the
  card is just the in-transcript trace.
- **`RequestReviewCard`** — the verdict card for the host-owned `request_review` tool (capability: the
  server's `agent`/`host` request-review seam, which spawns a read-only review subagent). Reads the
  structured `PlanReviewResult` from the tool result's `details` (defensively, via
  `isPlanReviewResult`), shows an approve/request-changes indicator + the reviewer's one-paragraph
  summary, and renders findings as the shared fold-out `ReviewPackageComments` (comment→item mapping
  and the row primitive both live in `reviewPackage.ts` + `ReviewPackageComments.tsx`, reused by the
  `reviewFix`/review-package renderers). Registered `primary` + `defaultExpanded`; `data-verdict` +
  `data-testid="request-review-card"` are the test hooks.
- **Ask user question** is owned by [[module-ext-ask-user-question]], outside this module. Its card
  registers bare and `interactive` through the public web entrypoint; the plan page renders it through the
  registry.
- **Visualize** is owned by [[module-ext-visualize]], outside this module. Its primary/default-expanded
  registration and named `MermaidView` reach chat through the public web entrypoint.
- **Spec-graph tools** — one defensive `SpecToolCard` registered for all seven `spec_*` names. Each keeps
  the capability's readable text, folds long output, replaces redundant args JSON with a meaningful
  activity summary, and turns only exact standalone worktree-path tokens obtained from known successful
  result `details` shapes into preview actions; a shorter known path never links a suffix inside another
  path. `spec_delete` never links its successful deleted path. Routine.
- **`web/`** — search/fetch/stored-content renderers for `pi-web-access`; own child spec
  ([web/SPEC.md](web/SPEC.md)). Routine.
- **`mcp/`** — pi's built-in MCP tools: the `mcp__*` card (server / tool, key/value args, ordered text,
  collapsed JSON tree of the host's structured-content summary, Full output, sign-in action), the
  resource listing/read cards and `tool_search`; own child spec ([mcp/SPEC.md](mcp/SPEC.md)). Routine.
- **The five `todo_*` tools** deliberately keep routine fallback receipts: their connected product surface
  is the chat plan, not a second renderer system in this module.
- **`subagent/`** — delegation renderers for `pi-subagents`: `AgentCard` (the `Agent` tool — **primary**;
  also registered for `get_subagent_result`, routine) and the pure `runDetails` readers/formatters (the
  parent chat's background result row reuses them); own child spec ([subagent/SPEC.md](subagent/SPEC.md)).
- **Shared pieces** — `CodeBlock` (shiki), `Collapsible` ("Show all N lines" fold for long output;
  callers supply a stable tool-call-derived id so state and geometry anchoring survive virtualization),
  `ToolFileLink` + exact-reference linked text backed by the parent chat module's shared
  `workspaceFileTarget` + `lib`'s `projectRelativePath`. Pure `toolHelpers` (arg readers, `resultText`,
  `languageFromPath`) and canonical `toolResultContent` parsing live in `@thinkrail/extension-api/web`,
  so extension text extraction and chat's common image layer cannot disagree about valid content.

## Boundary

- **Public surface:** the side-effect `register` import + shared `CodeBlock`/`Collapsible` for sibling
  renderers. No barrel (chat pulls shiki — per-file imports, as in the parent).
- **Allowed deps:** parent chat primitives (`toolRegistry`, `Markdown`, `ChatActions`, `interactionState`,
  `fileTargets`, `foldState`);
  `contracts` (types and pure guards); `@thinkrail/ui/*` (including
  `attention-line`, the "Your input is needed" line shared with extension prompts);
  `@thinkrail/extension-api/web`; `lib`; `@remixicon/react`.
- **Forbidden:** value-importing any `pi` package; `store`/`transport` (renderers stay presentational —
  extraction-ready into a future `packages/chat-ui`).

## Get right

- **Render defensively:** a tool's `details` result shape is not a stable API — read best-effort and
  fall back to its text content (`resultText`). Missing structured references remove links, never prose.
- File actions come only from explicit args/details and only through `ToolRenderProps.onOpenFile` (open) or
  the chat's resource scope and host (render a `ResourcePreview`, open in tab); never infer them from arbitrary result
  text or import app integration into a renderer.
- Tool names must match the capability exactly — the name is the join key. The one sanctioned exception
  is the `mcp__` prefix: pi names MCP tools `mcp__<server>__<tool>`, so the registry resolves an exact
  name first and the longest registered prefix second, through **one** resolver shared by renderer,
  summary, chrome and prominence. Prefix renderers never load code from a server; they render pi's result
  ([mcp/SPEC.md](mcp/SPEC.md)). The three resource tools and `tool_search` register exactly.
- Token-utility styling only (no raw hex / inline `style`).
