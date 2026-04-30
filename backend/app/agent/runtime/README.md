---
id: module-agent-runtime
type: module-design
parent: module-agent
status: active
title: Agent Runtime Abstraction
covers:
- backend/app/agent/runtime/
tags:
- backend
- agent
- runtime
---
# `app.agent.runtime` — Runtime Abstraction

> Parent: [Agent module](../README.md) | Status: **Active** | Created: 2026-04-29

## Overview

`runtime/` defines the runtime-agnostic contract that decouples
`AgentService` from any specific LLM backend. Each backend (Claude SDK
today, Codex / others later) implements `IAgentRuntime`; the service
resolves a runtime per task via `RUNTIMES[task.config.runtime]` and
delegates the conversational loop to it.

See `.bonsai/design_docs/MULTI_RUNTIME_DESIGN.md` for the cross-cutting
architecture; this module spec covers the runtime contract surface and
its lifecycle assumptions.

## Public interface

| Symbol | Defined in | Purpose |
|--------|-----------|---------|
| `IAgentRuntime` | `types.py` | Protocol every runtime implements. Methods: `run_session`, `interrupt`. Class attrs: `runtime_type`, `display_name` |
| `RuntimeType` | `types.py` | `Literal["claude", "codex"]` |
| `RuntimeExecutionConfig` | `types.py` | Per-session execution config (working_directory, model, system_prompt, resume_session_id, betas, effort, max_turns, permission_mode, stream_text). Derived from `AgentConfig` + task context inside `AgentService` |
| `RuntimeEvent` | `events.py` | Pydantic envelope `(method, params, request_id?)` — the JSON-RPC shape every runtime emits |
| `AgentEventHandler` | `events.py` | Protocol with `on_event(event)` and `on_complete(result)` |
| `make_handler_from_notify(notify)` | `events.py` | Adapter that wraps `_persisting_notify` into an `AgentEventHandler`. Forwards `request_id` for confirmAction/askUserQuestion to round-trip correctly |
| `ToolPermissionRequest` | `permissions.py` | Runtime-neutral permission-check input |
| `ToolPermissionResponse` | `permissions.py` | Runtime-neutral allow/deny decision |
| `ToolCategory` | `permissions.py` | `Literal["read", "net", "edit", "bash", "mcp"]` |

## File organisation

| File | Responsibility |
|------|----------------|
| `__init__.py` | Public re-exports |
| `types.py` | `IAgentRuntime` Protocol, `RuntimeType`, `RuntimeExecutionConfig` |
| `events.py` | `RuntimeEvent`, `AgentEventHandler`, `make_handler_from_notify` |
| `permissions.py` | Neutral permission types — request/response, category type alias |
| `claude/` | First implementation — see [`claude/README.md`](claude/README.md) |
| `codex/` | Second implementation, planned in plans 04–08 |

## Lifecycle assumptions

- **One runtime instance per `AgentService`.** Built once at service
  startup with shared dependencies (tracker, app_config, plugin_dir,
  model_registry, spec_service, coordinator). Re-used across every
  session that the service handles.
- **Per-session state stays in `run_session`.** Subagent correlation
  maps, iteration cost-tracking, mode-change records, MCP context
  registration — all created fresh per call.
- **`run_session` owns the conversational loop.** No
  open/send/close split. The loop reads from `tracker.get_next_message`,
  drives the SDK / wire protocol, and exits on `END_SIGNAL` or fatal
  error. Cancellation enters via `interrupt(task, tracker)`; the loop
  itself never polls a cancel flag.

## Naming distinction — `RuntimeEvent` vs `AgentEvent`

Two different types, easy to confuse:

- **`RuntimeEvent`** (this module, `events.py`) — the *runtime-layer
  envelope* `(method, params, request_id)`. Lives in memory, flows from
  runtime → handler → WebSocket / persistence.
- **`AgentEvent`** (`app/agent/models.py`) — the *persisted
  discriminated union* — `MessageEvent`, `ToolCallStartEvent`,
  `TurnCompleteEvent`, etc. Lives on disk in `.events.jsonl`. Replayed
  on resume.

`make_handler_from_notify` bridges them: a `RuntimeEvent` flows into the
handler, the persisting `notify` calls `append_event(method, params)`
which converts to the appropriate `AgentEvent` subtype on write.

## Permission flow (cross-references)

Mode/category filtering and the `(mode, category)` decision table live
in `app/agent/permissions.py`, not here. See
`MULTI_RUNTIME_DESIGN.md#permission-flow` for the full diagram. This
module only owns the *types* (`ToolPermissionRequest`, `Response`,
`ToolCategory`); the *engine* (`can_use_tool`,
`claude_can_use_tool_adapter`, `categorize`, `evaluate_mode`) lives one
level up so that runtime-specific shims (e.g. `claude_can_use_tool_adapter`)
can sit alongside the engine.

## Planned implementations

| Runtime | Status | Module | Plan |
|---------|--------|--------|------|
| Claude (SDK in-process) | ✅ shipped | `runtime/claude/` | 02 |
| Codex (subprocess JSON-RPC) | pending | `runtime/codex/` | 04–08 |

## Cancellation invariant

`IAgentRuntime.interrupt` is the single entry point for cancellation. It
runs **alongside** the running `run_session` (not from inside it) — when
`AgentService.interrupt_task` fires, both happen:

1. `tracker.set_interrupted(sid)` — bonsai-internal flag
2. `tracker.interrupt_futures(sid)` — resolves any pending user-prompt futures with deny+interrupt
3. `runtime.interrupt(task, tracker)` — runtime-specific cancel
   (Claude calls `client.interrupt()`; Codex sends `turn/interrupt` then
   kills the subprocess after a grace period)

The conversational loop in `run_session` never checks a cancel flag.
It exits naturally when its message stream terminates or when
`tracker.get_next_message` returns `END_SIGNAL`.

This mirrors the reference's `AbortSignal.addEventListener('abort', …)`
pattern at `codex-agent.ts:252-260` — same semantics, different surface.

## Tests

| Path | What it covers |
|------|----------------|
| `backend/tests/agent/runtime/test_types.py` | `RuntimeExecutionConfig` validation, `IAgentRuntime` protocol shape |
| `backend/tests/agent/runtime/test_event_handler.py` | `make_handler_from_notify` forwards method, params, and `request_id` correctly |
| `backend/tests/agent/runtime/test_permissions.py` | `ToolPermissionRequest`/`Response` round-trip; ToolCategory exhaustiveness |

Per-runtime tests live under `backend/tests/agent/runtime/<name>/`.
