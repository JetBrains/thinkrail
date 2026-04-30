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

> Parent: [Runtime Abstraction](../README.md) | Status: **Active** | Created: 2026-04-29

## Overview

`runtime/claude/` implements `IAgentRuntime` for the Claude Agent SDK.
It owns the conversational loop, drives the SDK client, maps SDK
messages onto bonsai's unified event stream, and runs the per-session
subagent / PreCompact correlation logic.

The body of `run_session` was migrated verbatim from the legacy
`app/agent/runner.py` in plan 02; the module is the *only* place under
`runtime/` that imports from `claude_agent_sdk`.

## File organisation

| File | Responsibility |
|------|----------------|
| `__init__.py` | Re-exports `ClaudeRuntime` |
| `runtime.py` | `class ClaudeRuntime` — IAgentRuntime impl. Owns SDK lifecycle, conversation loop, tool-result serialization, cost-iteration tracking, mode-change tracking, 1M-context beta auto-injection |
| `hooks.py` | `class SubagentHooks` — per-session subagent / PreCompact correlation (Task-tool ↔ SubagentStart) |
| `adapter.py` | Pure event-shape builders — `agent/toolCallStart` / `agent/toolCallEnd` param construction. Boundary plan 05's diff-parity tests enforce against |

## Public interface

```python
from app.agent.runtime.claude import ClaudeRuntime

runtime = ClaudeRuntime(
    tracker=...,
    app_config=...,
    plugin_dir=...,
    model_registry=...,
    spec_service=...,
    coordinator=...,
)
result = await runtime.run_session(task, exec_config, handler)
await runtime.interrupt(task, tracker)
```

- `runtime_type = "claude"`, `display_name = "Claude Code"` (class
  attrs).
- Constructor takes shared dependencies; `AgentService` builds one
  instance per service lifetime via `_make_runtime()`.

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
`SubagentStart` / `SubagentStop` hooks. Bonsai needs to:

1. Emit `agent/subagentStart` / `agent/subagentEnd` events to the
   frontend so subagent blocks render.
2. Group streamed assistant / tool messages from the child under the
   right subagent in the chat tree.

`SubagentHooks` owns the correlation state for one session:

- `_active_subagent_ids: set[str]` — subagents whose Start fired but
  whose Stop hasn't. Used to emit synthetic `agent/subagentEnd` on
  interrupt.
- `_parent_to_agent: dict[str, str]` — maps SDK
  `parent_tool_use_id` → bonsai `agent_id`. Streamed events from the
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

## Special-case behaviours preserved from legacy `runner.py`

These six behaviours were called out in plan 02's Risks section and
must remain intact:

1. **1M-context beta auto-injection** (`runtime.py:155-162`) —
   `context-1m-2025-08-07` is appended to `betas` for any model with
   `contextWindow > 200_000`.
2. **`CLAUDECODE` env stripping** (`runtime.py:178`) — when bonsai runs
   inside a Claude Code terminal during development, the SDK's bundled
   CLI rejects nested sessions. Strip `CLAUDECODE` and
   `CLAUDE_CODE_EXECPATH` before spawning.
3. **Per-iteration cost tracking** — each API call within a turn gets
   its own `iterations[]` entry. Last iteration's `total_tokens`
   determines context-window occupancy; sum across iterations drives
   cost estimation.
4. **`ExitPlanMode` / `EnterPlanMode` mode-change tracking** — when the
   model invokes one of these tools, capture the requested new mode in
   `_mode_change_tools` (keyed by tool_use_id) so the runtime can emit
   a `agent/permissionModeChanged` after the SDK's
   `permission_mode_changed` event arrives.
5. **`_previousContent` injection for `Write` tool** — the SDK's `Write`
   tool input lacks the file's previous content; runtime reads it from
   disk and injects it into the tool input before approval so the
   diff-rendering UI has both sides.
6. **MCP `_serialize_tool_content`** (`runtime.py:53`) — MCP tool
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
client = tracker.get_client(task.bonsai_sid)
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
| `backend/tests/agent/runtime/claude/test_hooks.py` | `SubagentHooks` correlation — Task-tool / SubagentStart ordering, orphan close on interrupt, `parent_to_agent` mapping |
| `backend/tests/agent/runtime/claude/test_adapter.py` (post-extraction) | Event-shape builder unit tests; locks the `agent/toolCallStart` / `agent/toolCallEnd` payload shape so plan 05's Codex adapter can mirror it |

## Module boundary

`runtime/claude/` imports from:

- `claude_agent_sdk` — SDK proper (only here)
- `app.agent.{models, permissions, pricing, tools, tracker}`
- `app.agent.runtime.{events, types}`
- `app.core.config` — for `AppConfig` typing
- stdlib

The SDK leak is contained to this directory. Verified by:

```
grep -r claude_agent_sdk backend/app/agent/runtime/
# only matches: backend/app/agent/runtime/claude/runtime.py
```
