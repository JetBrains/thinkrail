---
id: submodule-web-chat-tools-subagent
type: submodule-design
status: draft
title: subagent renderers (Agent / get_subagent_result / completion card)
parent: submodule-web-chat-tools
depends-on: [module-contracts]
references: [task-subagent-support]
tags: [v1, chat, subagents]
---

## Responsibility

Presentational renderers for the **`pi-subagents`** capability, joined by tool name / custom-message
type: `AgentCard` (the `Agent` tool — also registered for `get_subagent_result`, whose result carries
the same `DelegationRunDetails`), `SubagentCompletionCard` (the `subagent-completion` custom message a
detached run injects — rendered by `turns.tsx` as its own `subagentCompletion` row, not through the tool
registry), and the pure `runDetails` module (defensive `DelegationRunDetails` readers, token/cost/
duration formatters, the collapsed-header summary line, and `delegationRunStatus` — a child run's
current status derived from a chat runtime, which `ChatView` uses to decide transcript polling).

## The rendering convention (user-settled, 2026-08, research-backed)

Surveyed: Claude Code (collapsed one-liner whose row ticks live — `Running… 45s · 12 tool uses · 30k
tokens` → `Done (…)`; detail opt-in), Codex (pinned live runtime panel + short completion notices),
OpenCode (compact clickable box → opens the child session; one-line background-completion notice).
Adopted:

- **`Agent` is a primary, stock `ToolCard` — collapsed by default, but its header summary IS the live
  line**: `role · N turns · X tok · $c · elapsed · current-step`, re-derived from each
  `partialResult.details` REPLACE snapshot. Expanded: task, live activity line, model/usage detail,
  Open-transcript action, and the final report behind a fold once terminal. Errors auto-expand
  (existing chrome).
- **A background run's tool card freezes at its ack** (pi ignores `onUpdate` after the tool promise
  settles) — deliberate: the card says "started in the background", and the **completion card** is the
  terminal signal (OpenCode's notice pattern), carrying the final details + report fold + transcript
  link.
- `get_subagent_result` stays **routine** (folds into activity) with the same body + summary.

## Boundary

- **Owns:** `AgentCard`, `SubagentCompletionCard`, `runDetails` (pure, unit-tested), and their
  registration (`register.ts`, side-effect imported by the parent `tools/register`).
- **Public surface:** the side-effect `register`; `SubagentCompletionCard` (imported by the parent
  chat's `turns.tsx`); `runDetails`'s pure helpers (`ChatView` uses `delegationRunStatus`).
- **Allowed deps:** parent chat primitives (`toolRegistry`, `ChatActions`, `Markdown`, `foldState`,
  chat `types`); sibling `toolHelpers`/`Collapsible`; `contracts` (type-only + the
  `SUBAGENT_COMPLETION_CUSTOM_TYPE` guard family); `lucide-react`; `lib`.
- **Forbidden:** value-importing any `pi` package, `pi-subagents`, or `pi-delegation`; `store`/
  `transport` (renderers stay presentational — the transcript dialog lives in `chat/` as an
  integration file, reached only through `ChatActions.openSubagentTranscript`).

## Get right

- **Render defensively:** `DelegationRunDetails` arrives as untyped `result.details` — narrow via
  `readRunDetails` (childSessionId/status/task present), never trust the shape; fall back to `args`
  (`subagent_type`, `task`) before the first update lands.
- `partialResult` is **REPLACE** — every snapshot is complete; nothing accumulates renderer-side.
- Tool names `Agent` / `get_subagent_result` and the `subagent-completion` customType must match the
  `pi-subagents` capability exactly — the name is the join key.
- Token-utility styling only (no raw hex / inline `style`).
