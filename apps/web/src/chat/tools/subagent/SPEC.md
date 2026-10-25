---
id: submodule-web-chat-tools-subagent
type: submodule-design
status: active
title: subagent renderers (Agent / get_subagent_result) and run-detail helpers
parent: submodule-web-chat-tools
depends-on: [module-contracts]
references: [module-pi-subagents]
tags: [chat, subagents]
---

## Responsibility

Presentational renderers for the **`pi-subagents`** capability, joined by tool name: `AgentCard` (the
`Agent` tool — also registered for `get_subagent_result`, whose result carries the same
`DelegationRunDetails`), and the pure `runDetails` module (defensive `DelegationRunDetails` readers,
usage/token/cost/duration formatters, the collapsed-header summary line, and the completion-report
helpers). The `subagent-completion` custom message a detached run injects is **not** rendered here: it is
a background result row owned by the parent chat (`BackgroundResult.tsx` over `resources`' `ResultRow`,
see [[submodule-web-chat]]), which consumes `usageCounters`, `completionReport` and `reportTeaser`. Run *liveness* is deliberately not
derived here: the transcript dialog reads the host's registry `status` off each
`subagent.getTranscript` response (rationale: the parent chat SPEC's transcript-view seam).

## The rendering convention (user-settled, 2026-08, research-backed)

Surveyed: Claude Code (collapsed one-liner whose row ticks live — `Running… 45s · 12 tool uses · 30k
tokens` → `Done (…)`; detail opt-in), Codex (pinned live runtime panel + short completion notices),
OpenCode (compact clickable box → opens the child session; one-line background-completion notice).
Adopted:

- **`Agent` is a primary, stock `ToolCard` — collapsed by default, but its header summary IS the live
  line**: `role · N turns · X tok · $c · elapsed · current-step`, re-derived from each
  `partialResult.details` REPLACE snapshot. Expanded: task, live activity line, the run's model label
  (`RunModelLabel`: catalog name + effort, raw `provider/id` tooltip) beside the usage counters,
  Open-transcript action, and the final report behind a fold once terminal. Errors auto-expand
  (existing chrome). **Failed runs keep the transcript action**: an error outcome's thrown tool
  result still carries the run's final details — `pi-subagents` re-injects them via its
  `tool_result` override (its SPEC, PR #304 review finding) — so the `details.childSessionId` gate
  lights on both the live and hydrated paths (hydrate-pinned).
- **A background run's tool card freezes at its ack** (pi ignores `onUpdate` after the tool promise
  settles) — deliberate: the card says "started in the background", the Resources dock carries the live
  phase, and the parent chat's **result row** is the terminal signal (OpenCode's notice pattern). Its
  state uses the Resources vocabulary — an aborted (e.g. turn-capped) run reads Stopped, never success
  (PR #304 review finding).
- `completionReport` strips pi-subagents' `Subagent "<role>" (<id>) <status>:` header (the join on that
  exact content format is deliberate; an unmatched text passes through whole); `reportTeaser` is the
  report's first readable line with Markdown block markers and emphasis removed.
- `get_subagent_result` stays **routine** (folds into activity) with the same body + summary.

## Boundary

- **Owns:** `AgentCard`, `runDetails` (pure, unit-tested), and their registration (`register.ts`,
  side-effect imported by the parent `tools/register`).
- **Public surface:** the side-effect `register`; `runDetails`'s pure helpers (the parent chat's
  `BackgroundResult` reads the usage and report helpers).
- **Allowed deps:** parent chat primitives (`toolRegistry`, `ChatActions`, `Markdown`, `foldState`,
  `ModelEffortLabel`);
  sibling `Collapsible`; `@thinkrail/extension-api/web` (render contracts + pure helpers);
  `contracts` (type-only + the `SUBAGENT_COMPLETION_CUSTOM_TYPE` guard family); `@remixicon/react`; `lib`.
- **Forbidden:** value-importing any `pi` package, `pi-subagents`, or `pi-delegation`; `store`/
  `transport` (renderers stay presentational — the transcript dialog lives in `chat/` as an
  integration file, reached only through `ChatActions.openSubagentTranscript`).

## Get right

- **Render defensively:** `DelegationRunDetails` arrives as untyped `result.details` — narrow via
  `readRunDetails` (childSessionId/status/task present), never trust the shape; fall back to `args`
  (`subagent_type`, `task`) before the first update lands.
- `partialResult` is **REPLACE** — every snapshot is complete; nothing accumulates renderer-side.
- Tool names `Agent` / `get_subagent_result` must match the `pi-subagents` capability exactly {D} the
  name is the join key.
- Token-utility styling only (no raw hex / inline `style`).
