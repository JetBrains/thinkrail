---
id: module-pi-subagents
type: module-design
status: draft
title: pi-subagents — the Agent tools over the delegation core
parent: architecture
implements: [task-subagent-support]
depends-on: [module-pi-delegation]
tags: [pi-extension, subagents]
---

## Responsibility

`pi-subagents` is the **first consumer of [[module-pi-delegation]]** and the extensibility proof of
that framework: the LLM-facing subagent capability. It owns exactly what is subagent-specific —
the `Agent` + `get_subagent_result` tools, agent definitions (discovery / precedence / trust), the
definition → spawn mapping, and background-completion delivery. It contains **zero private
child-assembly code**: everything session-shaped goes through the core's `SessionOptions`. Design +
decisions: [[task-subagent-support]].

## Public surface (the barrel, `index.ts`)

- **default export** — the zero-config pure-pi extension entry (the `pi` manifest points here);
  builds its own `DelegationService` with default bindings, projecting the parent off the tool
  `ExtensionContext` at spawn time.
- `createSubagentsExtension({ service?, delegationRoot?, scope? })` — the embedder entry: ThinkRail
  passes its host-bound service (and the matching storage bindings, used for restart-loss error
  messages).
- `SUBAGENT_COMPLETION_MESSAGE` — the custom-message type the web's completion card keys on.
- Definitions: `AgentDefinition`, `discoverAgentDefinitions`, `parseAgentDefinition`,
  `BUILTIN_AGENTS`.
- Mapping: `toSpawnMapping`, `resolveModelRef`, `buildChildSystemPrompt`, `RECURSION_GUARD_TOOLS`.

## The tools

| Tool | Behavior |
| --- | --- |
| `Agent({ subagent_type, task, run_in_background? })` | Discovers definitions per call (editable mid-session), maps the named one to `SessionOptions`, spawns via `createChild` + `runQueued`. Foreground: awaits the outcome and rides the tool signal; `error` outcomes throw (tool error, reason-first). Background: **never rides the parent turn's abort signal** (a detached run survives a parent abort — core-spec semantics, test-pinned); returns `{childSessionId}` text immediately; the terminal event injects a `subagent-completion` custom message (`deliverAs: "followUp", triggerTurn: true`). Live `onUpdate` details flow to `partialResult` (REPLACE). Results bounded to 50k chars — the full text stays in the child transcript. |
| `get_subagent_result({ session_id })` | Reads the core registry via `findChild` + `collectResult`: terminal → final text + details (marks collected; an errored run reports its `errorMessage` first — core decision #24); running → status snapshot; unknown id → error naming the restart-loss case + the derived transcript path. |

Both tools register inside `session_start` (emitted by `bindExtensions`), so the `Agent`
description enumerates the definitions actually visible to that session.

## Definitions: discovery, precedence, trust

First-name-wins in trust order — **builtins → personal (`<agentDir>/agents/*.md`) → project
(`<cwd>/.pi/agents/*.md`, `<cwd>/.agents/agents/*.md`)** — so a worktree definition can never
shadow a built-in or personal name (task-spec decision 6), and project definitions load only when
`ctx.isProjectTrusted()`. Built-ins are **TS constants** (`builtins.ts`: scout / planner / worker /
reviewer — user-settled), not `.md` files, so they survive `bun build --compile` and get
typechecked; user-authored definitions keep the community `.md` + frontmatter convention
(`name`, `description`, `tools`, `model`, `thinking`, `max_turns`, `inherit_project_context`,
`skills`, `extensions`; body = system prompt). Malformed files are skipped, never fatal. All four
builtins set `extensions: true` (the embedder's curated child set — inert under pure-pi
zero-config) with the spec READ tools (`spec_grep`/`spec_get`/`spec_graph`) allowlisted for the
read-only roles and web tools (`web_search`/`fetch_content`) for the scout.

## The mapping (policy, not mechanism)

`toSpawnMapping`: definition → `SessionOptions` + `RunOptions.maxTurns`. Model refs fuzzy-resolve
against the session's available models (`provider/id` → exact id → unique prefix; ambiguous or
unknown pinned refs throw loud). Child system prompt = definition body → subagent bridge → env
block (cwd, git branch, platform) — **stable material first** for KV-cache prefix reuse. The
recursion guard (`excludeTools: ["Agent", "get_subagent_result"]`) is unconditional.
`extensions: true` passes through to the core's curated-set opt-in (core decision #25) — which
extensions that set holds is the **embedder's** choice, never this package's.

## Boundary

- **Allowed deps:** `pi-delegation` (through its barrel only); the pi SDK + `typebox` as
  **peerDependencies**; `node:*`.
- **Forbidden:** any `@thinkrail/*` package (must work under vanilla pi); `@earendil-works/pi-tui`
  (pure-pi V1 bar is default rendering); `pi-delegation/src/*` internals.
- The web card / transcript view are the *presentation* side, joined by tool name
  (`registerToolRenderer("Agent", …)`) — they live in `apps/web`, never here.
