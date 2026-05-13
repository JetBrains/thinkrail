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

> Parent: [Agent module](../README.md) | Status: **Active** | Created: 2026-04-29 | Last updated: 2026-05-13 (harness-abstraction PR 1)

## Overview

`runtime/` defines the runtime-agnostic contract that decouples
`AgentService` from any specific LLM backend. Each backend (Claude SDK
today, Codex / others later) implements `IAgentRuntime`; the service
resolves a runtime per task via `runtime_registry.get(task.config.runtime)`
and delegates the conversational loop to it.

See `.bonsai/design_docs/MULTI_RUNTIME_DESIGN.md` for the cross-cutting
architecture; this module spec covers the runtime contract surface.

## Design principle

A runtime is the declaration that "this kind of agent is supported." The
protocol is intentionally minimal — six surfaces total — and
**protocol-stateless**: no `startup`/`shutdown` handshake, no
freshness/refresh metadata leaking out. Any per-runtime caching
(models, credentials) is an internal implementation detail, triggered
lazily on first use.

## Public interface

| Symbol | Defined in | Purpose |
|--------|-----------|---------|
| `IAgentRuntime` | `types.py` | Protocol every runtime implements. Class attrs `runtime_type`, `display_name`. Methods: `list_models`, `get_context_window`, `run_session`, `interrupt` |
| `RuntimeType` | `types.py` (re-exported from `app.agent.models`) | `Literal["claude", "codex"]` — declared in `models.py` to break a circular import |
| `ModelInfo` | `types.py` | Neutral frozen Pydantic model — `id, label, group, context_window, max_output, pricing_tier` |
| `DEFAULT_CONTEXT_WINDOW` | `types.py` | `200_000` — neutral floor for unknown ids |
| `RuntimeExecutionConfig` | `types.py` | Per-session execution config — `working_directory`, `model` (required), `system_prompt`, `resume_session_id`, `effort`, `max_turns`, `permission_mode`, `stream_text`. Derived from `AgentConfig` + task context inside `AgentService` |
| `RuntimeRegistry` | `registry.py` | Lookup table. `register / get / has / all`. Domain exceptions `RuntimeRegistryError`, `DuplicateRuntimeError`, `UnknownRuntimeError` |
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
| `types.py` | `IAgentRuntime` Protocol, `RuntimeType`, `ModelInfo`, `RuntimeExecutionConfig`, capability + default-window constants |
| `registry.py` | `RuntimeRegistry` + domain exceptions |
| `events.py` | `RuntimeEvent`, `AgentEventHandler`, `make_handler_from_notify` |
| `permissions.py` | Neutral permission types — request/response, category type alias |
| `claude/` | First implementation — see [`claude/README.md`](claude/README.md) |
| `codex/` | Second implementation, planned (PR 2 + PR 3 unblock it) |

## Lifecycle assumptions

- **One runtime instance per `ProjectContext`.** Constructed once with
  all of its dependencies wired in (tracker, spec service, coordinator,
  app config). Re-used across every session.
- **No startup/shutdown handshake.** Runtimes are protocol-stateless.
  Any per-runtime warmup (e.g. an initial model-list refresh in Claude)
  is the implementation's internal concern, triggered lazily on first
  use of whatever method needs the data.
- **Per-session state stays in `run_session`.** Subagent correlation
  maps, iteration cost-tracking, mode-change records, MCP context
  registration — all created fresh per call.
- **`run_session` owns the conversational loop.** No
  open/send/close split. The loop reads from `tracker.get_next_message`,
  drives the SDK / wire protocol, and exits on `END_SIGNAL` or fatal
  error. Cancellation enters via `interrupt(task, tracker)`; the loop
  itself never polls a cancel flag.

## Model surface

Each runtime owns its model list. Two methods on the protocol:

```python
def list_models(self) -> list[ModelInfo]: ...
def get_context_window(self, model_id: str) -> int: ...
```

How a runtime sources its list — static, lazy fetch, periodic refresh,
remote registry — is invisible to callers. There is intentionally no
`refresh_models` or `models_status` on the protocol; those leaked
caching strategy into the contract. The Claude implementation does a
one-shot lazy refresh on first `list_models()` call; future runtimes are
free to pick a different strategy.

`get_context_window(model_id)` returns the size for ids the runtime
knows, falling back to `DEFAULT_CONTEXT_WINDOW` for unknown ids.
`AgentService._get_context_max(task)` is a one-line delegation; the
service never maintains its own model→window table.

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
level up. The Claude adapter currently sits in `app/agent/permissions.py`
alongside the engine; harness-abstraction PR 2 will relocate it to
`runtime/claude/permissions_adapter.py`.

## Planned implementations

| Runtime | Status | Module | Plan |
|---------|--------|--------|------|
| Claude (SDK in-process) | ✅ shipped | `runtime/claude/` | harness-abstraction PR 1 |
| Codex (subprocess JSON-RPC) | pending | `runtime/codex/` | unblocks after harness-abstraction PR 2 + PR 3 |

## Cancellation invariant

`IAgentRuntime.interrupt` is the single entry point for cancellation. It
runs **alongside** the running `run_session` (not from inside it) — when
`AgentService.interrupt_task` fires, both happen:

1. `tracker.set_interrupted(sid)` — bonsai-internal flag
2. `tracker.interrupt_futures(sid)` — resolves any pending user-prompt futures with deny+interrupt
3. `runtime.interrupt(task, tracker)` — runtime-specific cancel
   (Claude calls `client.interrupt()`; Codex sends `turn/interrupt` then
   kills the subprocess after a grace period)

If step 3 cannot resolve the runtime (e.g. `task.config.runtime` no
longer matches any registered runtime), `AgentService.interrupt_task`
rolls back the `set_interrupted` flag so the session isn't left wedged
emitting spurious `agent/interrupted` events on subsequent turns.

The conversational loop in `run_session` never checks a cancel flag.
It exits naturally when its message stream terminates or when
`tracker.get_next_message` returns `END_SIGNAL`.

This mirrors the reference's `AbortSignal.addEventListener('abort', …)`
pattern at `codex-agent.ts:252-260` — same semantics, different surface.

## Tests

| Path | What it covers |
|------|----------------|
| `backend/tests/agent/runtime/test_types.py` | `RuntimeExecutionConfig` validation, `IAgentRuntime` protocol shape |
| `backend/tests/agent/runtime/test_registry.py` | `RuntimeRegistry` register / duplicate / unknown / sorted `all()` |
| `backend/tests/agent/runtime/test_event_handler.py` | `make_handler_from_notify` forwards method, params, and `request_id` correctly |
| `backend/tests/agent/runtime/test_permissions.py` | `ToolPermissionRequest`/`Response` round-trip; ToolCategory exhaustiveness |
| `backend/tests/rpc/test_methods_settings.py` | `models/list` wire shape (option C) — grouped by runtime, with `displayName`, no per-model `runtime` field |

Per-runtime tests live under `backend/tests/agent/runtime/<name>/`.
