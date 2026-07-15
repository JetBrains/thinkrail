---
id: submodule-web-chat-tools
type: submodule-design
status: active
title: tools — built-in tool renderers
parent: submodule-web-chat
depends-on: [module-contracts]
tags: [v1, chat]
---

## Responsibility

The **presentation half of every bundled tool**, joined to its server-side capability by tool name (the
extension model lives in the parent spec). `register.ts` wires everything via `registerToolRenderer` —
renderer + collapsed-header summary + chrome/prominence — as a side-effect import of `ChatView`, so
registration runs once when the chat module mounts. Unregistered tools fall back to
`DefaultToolRenderer` and are treated as **routine** (they fold into activity groups).

## What's here

- **Core pi tools** — `BashCard` (terminal block), `ReadCard`/`WriteCard` (project-relative path +
  highlighted file), `EditCard` (path + removed/added line diff). All **routine**.
- **`AskUserQuestionCard`** — the inline questionnaire for the host-owned `ask_user_question` tool
  (capability + rationale: the server's `agent/askUserQuestion` SPEC). Registered `"bare"`: it owns its
  full-width frame, never folds, and answers through the `ChatActions` context (correlated by
  `toolCallId`). Behaviors worth their invariants:
  - **Controls never stream** — while args stream it shows a stable composing placeholder and the
    complete questionnaire reveals atomically at message end (rationale in the component's jsdoc).
  - **Multi-question completion is review-gated** — every question page advances with **Next**, including
    the final question; only the synthetic **Review & submit** page exposes **Submit**. Its review entries
    show the full original question plus every option with selected markers (and custom answer / note), so
    the submission can be checked in context. Selection status is also exposed as screen-reader text —
    never by icon/color alone. A single question keeps its direct **Submit** action.
  - **Per-call UI state survives virtualization** — a module-level cache keyed by `toolCallId` (dropped
    on resolve), since react-virtuoso unmounts off-screen rows. This is the pattern the activity fold's
    expansion state reuses.
  - Awaiting an answer, the card carries a subtle primary-tinted accent ring (the "needs you" accent).
- **`visualize/`** — `VisualizationCard` dispatches on `args.type` to `DiagramCard` (mermaid → themed
  SVG via the **lazy-loaded** `mermaid`, source fallback on parse error) and `ComparisonCard` (option
  cards with pros/cons + `recommended` highlight); shared `MermaidView` re-renders on `[data-theme]`
  change and offers a full-screen pan/zoom Dialog. Registered **primary + `defaultExpanded`** — a
  visualization is output *for the user*, not plumbing: it escapes the activity fold and renders open on
  completion (while its args stream it stays a slim running row). Capability: the bundled
  `pi-visualize` extension.
- **`web/`** — search/fetch renderers for `pi-web-access`; own child spec
  ([web/SPEC.md](web/SPEC.md)). Routine.
- **Shared pieces** — `CodeBlock` (shiki), `Collapsible` ("Show all N lines" fold for long output),
  pure `toolHelpers` (arg readers, `projectRelativePath`, `resultText`).

## Boundary

- **Public surface:** the side-effect `register` import + the shared `CodeBlock`/`Collapsible`/
  `toolHelpers` for sibling renderers. No barrel (chat pulls shiki — per-file imports, as in the parent).
- **Allowed deps:** parent chat primitives (`toolRegistry`, `Markdown`, `ChatActions`); `contracts`
  (**type-only**); `components/ui`; `lib`; `lucide-react`; `mermaid` (**lazy, `visualize/` only**).
- **Forbidden:** value-importing any `pi` package; `store`/`transport` (renderers stay presentational —
  extraction-ready into a future `packages/chat-ui`).

## Get right

- **Render defensively:** a tool's `details` result shape is not a stable API — read best-effort and
  fall back to its text content (`resultText`).
- Tool names must match the capability exactly — the name is the join key.
- Token-utility styling only (no raw hex / inline `style`).
