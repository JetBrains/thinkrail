---
id: module-agent-runtime-claude
type: module-design
parent: module-agent-runtime
status: active
title: Claude Runtime
covers:
- backend/app/agent/runtime/claude/
tags:
- backend
- agent
- runtime
- claude
---
# `app.agent.runtime.claude` — Claude SDK Runtime

> Parent: [Runtime Abstraction](../README.md) | Status: **Active** | Created: 2026-04-29 | Last updated: 2026-05-25 (hardcoded model catalog)

## Overview

`runtime/claude/` implements `IAgentRuntime` for the Claude Agent SDK.
It owns the conversational loop, drives the SDK client, maps SDK
messages onto thinkrail's unified event stream, serves the static Claude
model catalog shipped with the package, and runs the per-session
subagent / PreCompact correlation logic.

The body of `run_session` was migrated verbatim from the legacy
`app/agent/runner.py`; the module is the only place under `runtime/`
that imports from `claude_agent_sdk`.

## File organisation

| File | Responsibility |
|------|----------------|
| `__init__.py` | Re-exports `ClaudeRuntime` |
| `runtime.py` | `class ClaudeRuntime` — IAgentRuntime impl. Owns SDK lifecycle, conversation loop, tool-result serialization, cost-iteration tracking, mode-change tracking. `capabilities()` projects the permission/effort/flag module constants plus `self._models.list_options()` (the `context1m` flag gates the 1M-context beta); delegates `list_skills()` to `ClaudeSkillRegistry` |
| `models.py` | `class ClaudeModelRegistry` — loads `models.json` shipped with the package via `importlib.resources` and serves `list_options()`. No fetch, no cache, no refresh |
| `models.json` | Curated catalog of Claude models (`[{id, label}]`) exposed to the picker. Edit-and-ship to add or change a model |
| `skills.py` | `class ClaudeSkillRegistry` — multi-source skill discovery (user / project / plugin / command / builtin) with first-wins dedup and a process-lifetime mtime cache. See [Skill catalog](#skill-catalog--multi-source-scan) |
| `hooks.py` | `class SubagentHooks` — per-session subagent / PreCompact correlation (Task-tool ↔ SubagentStart) |
| `adapter.py` | Pure event-shape builders — `agent/toolCallStart` / `agent/toolCallEnd` param construction. Locks the payload shape as the wire contract any runtime adapter must mirror |

## Public interface

```python
from app.agent.runtime.claude import ClaudeRuntime

runtime = ClaudeRuntime(
    app_config=...,           # required
    tracker=...,
    plugin_dir=...,
    spec_service=...,
    coordinator=...,
)
caps = runtime.capabilities()                            # RuntimeCapabilities
result = await runtime.run_session(task, exec_config, handler)
await runtime.interrupt(task, tracker)
```

- `runtime_type = "claude"`, `display_name = "Claude Code"` (class
  attrs).
- `app_config` is required: the runtime builds its `ClaudeSkillRegistry`
  rooted at `app_config.project_root` and threads the config into the
  conversation loop. The `ClaudeModelRegistry` is owned internally and
  takes no arguments — no `model_registry` parameter.
- Constructor takes shared dependencies; `ProjectContext.runtime_registry`
  builds one instance per project and registers it. The `AgentService`
  retrieves it via `runtime_registry.get(task.config.runtime)`.

## Conversational loop

```
run_session:
  set_tool_context(...)              # MCP tool handlers can resolve session state
  open ClaudeSDKClient(options)      # SDK lifecycle bound to `with` block
  emit agent/ready
  while True:
      message = tracker.get_next_message(sid)
      if message is END_SIGNAL: break
      tracker.set_status("running")
      emit agent/statusChanged(running)
      client.query(message)
      async for sdk_event in client.receive_response():
          dispatch:
            SystemMessage(init)   → agent/sessionStart
            AssistantMessage      → agent/textDelta / agent/toolCallStart
            UserMessage(tool_res) → agent/toolCallEnd
            ResultMessage         → agent/turnComplete (or interrupted)
            StreamEvent           → agent/streamText (when streaming enabled)
      emit agent/turnComplete or agent/interrupted
```

The loop terminates on `END_SIGNAL` (graceful end_session), interrupt
(SDK `ResultMessage` with `interrupted=True`), or fatal error.

## SubagentHooks correlation

The Claude SDK's `Task` tool spawns a child agent and emits
`SubagentStart` / `SubagentStop` hooks. ThinkRail needs to:

1. Emit `agent/subagentStart` / `agent/subagentEnd` events to the
   frontend so subagent blocks render.
2. Group streamed assistant / tool messages from the child under the
   right subagent in the chat tree.

`SubagentHooks` owns the correlation state for one session:

- `_active_subagent_ids: set[str]` — subagents whose Start fired but
  whose Stop hasn't. Used to emit synthetic `agent/subagentEnd` on
  interrupt.
- `_parent_to_agent: dict[str, str]` — maps SDK
  `parent_tool_use_id` → thinkrail `agent_id`. Streamed events from the
  child carry the parent id; the runtime resolves the agent id via
  `hooks.resolve_agent_id`.
- `_pending_task_tool_ids: list[str]` — queue of `Task` tool-use ids
  awaiting their Start hook. Each Task tool call triggers exactly one
  Start in order; the runtime calls `hooks.record_task_tool_call` to
  enqueue.

**Lifecycle quirk:** the SDK's `SubagentStop` is not guaranteed to fire
on interrupt. The runtime's interrupted branch calls
`hooks.close_orphaned_subagents()` to emit synthetic `subagentEnd`
events for everything still in `_active_subagent_ids`.

## Model catalog — static

`ClaudeModelRegistry` is a one-shot JSON loader:

- Constructor reads `models.json` from the package via
  `importlib.resources.files(__package__).joinpath("models.json")` —
  path-stable across source checkout, wheel install, and zipapp.
- Each entry is an `{id, label}` pair, projected to
  `LabeledOption(value=id, label=label)` at load time and kept in a
  frozen tuple.
- No fetch, no cache, no refresh, no fallback. Adding or changing a
  model is an edit to `models.json` shipped in a normal release.
- `list_options()` returns the projected `LabeledOption` list, in
  declared order; `ClaudeRuntime.capabilities()` surfaces it as the
  `models` capability.

## Capabilities

`ClaudeRuntime.capabilities()` returns a `RuntimeCapabilities` built from
these sources:

- `permission_modes` ← `get_args(PermissionMode)` from the SDK; the value
  doubles as the display label.
- `effort_levels` ← `get_args(EffortLevel)` from the SDK, with ThinkRail's `auto`
  prepended.
- `models` ← `self._models.list_options()`.
- `flags` ← module constant `_CLAUDE_FLAGS` — runtime-declared option toggles
  surfaced in settings (currently the `context1m` boolean, default on).

Sourcing the permission/effort values from the SDK's own literals keeps the
picker from drifting out of what the runtime accepts — the offered sets follow
the installed SDK rather than a hand-maintained list. Position 0 of each list
is the runtime default (`default` / `auto`). The SDK has no token for "no
explicit effort" (its default `effort=None`), so `auto` represents it and is
translated back to `effort=None` at the runtime boundary.

The model's context-window size is not in the catalog — it is read from
the live SDK via `ClaudeSDKClient.get_context_usage().rawMaxTokens`
(cached per model, fetched at turn-start) and streamed as `contextMax`
on turn-end events.

The `context1m` flag (on by default) gates the `context-1m-2025-08-07` beta:
when set, the runtime requests the 1M window, so models that support it (Fable
5, Opus 4.8, Sonnet 4.6) report 1M and models that don't (Haiku) ignore the
beta and report their default 200K. Turning the flag off caps the session at 200K.
Because `contextMax` comes from `get_context_usage()`, the bar reflects
whichever window the model actually granted — no per-model `supports1M` table.

## Skill catalog — multi-source scan

`ClaudeRuntime.list_skills()` exposes the slash-command-style skills
the user can invoke from inside a Claude Code session — so the chat
composer can surface them in its slash autocomplete alongside ThinkRail's
bundled skills.  The runtime is a thin one-line delegate; all discovery
logic lives in `ClaudeSkillRegistry` (`skills.py`).

**Scan order (first-wins dedup by `id`):**

| Order | Root path | `source` | `id` derivation |
|---|---|---|---|
| 1 | `~/.claude/skills/*/SKILL.md` | `user` | directory name |
| 2 | `<project_root>/.claude/skills/*/SKILL.md` | `project` | directory name |
| 3 | `~/.claude/plugins/marketplaces/*/plugins/*/skills/*/SKILL.md` | `plugin` | `<plugin>:<skill-dir>` (namespaced) |
| 4 | `~/.claude/commands/*.md` | `command` | filename stem |
| 5 | Static built-in list (`init`, `review`, `security-review`, …) | `builtin` | id literal |

Project root comes from `app_config.project_root` (the same `AppConfig`
the runtime is constructed with). Frontmatter (`name`,
`description`) is parsed via the existing `_parse_frontmatter` helper
extracted from `app/agent/context.py` — no duplicate parser.

**Caching strategy.** Process-lifetime cache keyed by
`(root_dir, root_dir_mtime)`. Each call stats every root; if any
root's mtime differs from the cached snapshot, the cache is dropped and
the affected roots are re-scanned. mtime stat is cheap enough that the
cache effectively eliminates SKILL.md parsing in steady state. No
periodic refresh, no protocol-level lifecycle — same philosophy as the
model catalog.

**Robustness.**

- Missing roots (e.g. no `~/.claude/`) → skipped silently.
- Malformed `SKILL.md` → `logger.warning(..., exc_info=True)`, skipped
  (mirrors the existing pattern in `scan_skill_frontmatter`).
- Any unexpected error in `list_skills` itself → caught, returns `[]`.
  Drives the frontend's "ThinkRail-only silent fallback" UX rule (the
  runtime section just disappears, no toast).

**Why dedup is first-wins.** User-scoped overrides take precedence so a
developer can locally shadow a plugin- or built-in-supplied skill by
dropping a `SKILL.md` into `~/.claude/skills/<id>/`. Project-scoped
beats plugin/built-in for the same reason. The frontend additionally
dedups runtime skills whose `id` collides with a ThinkRail bundled skill
(ThinkRail wins) — see [Runtime Skills Autocomplete design](../../../../.tr/runtime-skills-autocomplete/design-doc.md).

**Wire surface.** Exposed via the `skills/listRuntime` RPC method in
`backend/app/rpc/methods/settings.py`; see
[RPC module — methods](../../../rpc/README.md#methods).

## Special-case behaviours preserved from legacy `runner.py`

These behaviours were called out in plan 02's Risks section and must
remain intact:

1. **`CLAUDECODE` env stripping** — when thinkrail runs inside a Claude
   Code terminal during development, the SDK's bundled CLI rejects
   nested sessions. Strip `CLAUDECODE` and `CLAUDE_CODE_EXECPATH`
   before spawning.
2. **Per-iteration cost tracking** — each API call within a turn gets
   its own `iterations[]` entry. Last iteration's `total_tokens`
   determines context-window occupancy; sum across iterations drives
   cost estimation.
3. **`ExitPlanMode` / `EnterPlanMode` mode-change tracking** — when the
   model invokes one of these tools, capture the requested new mode in
   `_mode_change_tools` (keyed by tool_use_id) so the runtime can emit
   a `agent/permissionModeChanged` after the SDK's
   `permission_mode_changed` event arrives.
4. **`_previousContent` injection for `Write` tool** — the SDK's `Write`
   tool input lacks the file's previous content; runtime reads it from
   disk and injects it into the tool input before approval so the
   diff-rendering UI has both sides.
5. **MCP `_serialize_tool_content`** (`runtime.py:53`) — MCP tool
   results arrive as `[{type: "text", text: "..."}]` lists; serializer
   joins the text blocks rather than calling `str()` (which produces
   Python repr with single quotes — bad for the chat UI).

## Cost / turns semantics — SDK gotcha

The SDK's `ResultMessage` carries cumulative *and* per-turn fields with
similar names:

- `total_cost_usd` — **cumulative** session total. Assign, don't accumulate.
- `num_turns` — **per-turn** SDK turn count for this turn only. Accumulate.

Mixing these up double-counts cost / under-counts turns. The runtime
splits them at `runtime.py` cost-update lines (search for
`task.cost_usd =` vs `task.turns +=`).

## Permission integration

`run_session` installs an `_can_use_tool` callback that delegates to
`claude_can_use_tool_adapter` (the only place in the codebase that
imports Claude SDK permission types). The adapter:

1. Builds a `ToolPermissionRequest` from `(tool_name, input_data, ToolPermissionContext)`.
2. Calls `permissions.can_use_tool(...)` (runtime-neutral engine).
3. Converts the `ToolPermissionResponse` back to
   `PermissionResultAllow | PermissionResultDeny`.

Mode/category filtering happens inside `can_use_tool` (see
`MULTI_RUNTIME_DESIGN.md#permission-flow`). The runtime itself is
permission-mode-agnostic — switching mode mid-session takes effect on
the next tool call without any runtime API call.

## Cancellation

`ClaudeRuntime.interrupt(task, tracker)`:

```python
client = tracker.get_client(task.thinkrail_sid)
if client is None:
    return
try:
    await client.interrupt()
except Exception:
    logger.debug("Claude client.interrupt() failed", exc_info=True)
```

The SDK's `client.interrupt()` injects a control-protocol
`interrupt_request` message that surfaces in `receive_response()` as a
`ResultMessage` with `interrupted=True`. The conversational loop's
existing branch handles that case.

No `cancel_event`, no polling.

## Tests

| Path | What it covers |
|------|----------------|
| `backend/tests/agent/runtime/claude/test_runtime.py` | Full `run_session` lifecycle — turn complete, interrupt, multi-turn, tool approval round-trip, cost tracking, plan-mode toggle, all six preserved special-case behaviours |
| `backend/tests/agent/runtime/claude/test_skills.py` | `TestListSkills` — fixture-tree scan per source kind (user/project/plugin/command/builtin), first-wins dedup ordering, mtime cache hit + invalidation, missing-root silent skip, malformed-SKILL.md logs + skips without raising |
| `backend/tests/agent/runtime/claude/test_models.py` | `ClaudeModelRegistry` — constructor loads `models.json`, `list_options()` returns the shipped entries as `LabeledOption`s in declared order |
| `backend/tests/agent/runtime/claude/test_hooks.py` | `SubagentHooks` correlation — Task-tool / SubagentStart ordering, orphan close on interrupt, `parent_to_agent` mapping |
| `backend/tests/agent/runtime/claude/test_adapter.py` | Event-shape builder unit tests; locks the `agent/toolCallStart` / `agent/toolCallEnd` payload shape so any runtime adapter can mirror it |

## Module boundary

`runtime/claude/` imports from:

- `claude_agent_sdk` — SDK proper (only `runtime.py`)
- `app.agent.{models, permissions, pricing, tools, tracker}`
- `app.agent.runtime.{events, types}`
- `app.core.config` — for `AppConfig` typing
- stdlib

Inside `runtime/`, SDK imports are contained to this directory:

```
grep -r 'claude_agent_sdk' backend/app/agent/runtime/
# only matches under backend/app/agent/runtime/claude/
```

Note: `claude_agent_sdk` imports remain in shared code outside
`runtime/` (in `permissions.py`, `tools/*.py`, `service.update_config`,
`context.py`). Those are explicitly scoped to harness-abstraction PR 2
and PR 3 — see `harness_refactoring.md` for the per-leak migration
plan.
