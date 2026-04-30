---
id: multi-runtime-design
type: architecture-design
status: active
title: Multi-Runtime Agent Architecture
covers:
- backend/app/agent/runtime.
- backend/app/agent/permissions.py
- backend/app/agent/service.py
tags:
- backend
- agent
- runtime
- architecture
---
# Multi-Runtime Agent Architecture

> Status: **In progress** | Created: 2026-04-29

## Overview

Bonsai is moving from a Claude-SDK-only agent runner to a runtime-agnostic
contract that can host multiple agent backends — Claude Code SDK today,
OpenAI Codex (`codex app-server`) next, and any future LLM provider that
exposes a session-based protocol behind the same interface.

This doc describes the end state and the reasoning behind the
architectural choices. Read it for *why* the architecture is shaped the
way it is.

## Goals

1. **Add Codex as a first-class runtime** — same UI surface, same session
   semantics, same permission model as Claude.
2. **No regression for Claude flows** — the existing conversational loop,
   tool approvals, AskUserQuestion / ConfirmStatement, subagent
   correlation, persistence, and resume must work unchanged.
3. **Single permission engine** — one canonical `can_use_tool` decides
   allow/deny for every runtime, so toggling permission mode mid-session
   takes effect uniformly.
4. **Runtime-neutral event bus** — the WebSocket event stream
   (`agent/textDelta`, `agent/toolCallStart`, etc.) is the unified
   contract; runtimes either produce these events directly (Claude) or
   adapt their wire protocol to them (Codex, future).

## Non-goals

- Replacing the Claude SDK with our own LLM client.
- Per-message runtime switching. Runtime is fixed for the session
  lifetime; resume re-uses the original runtime.
- Vendor-neutral tool API. Bonsai's frontend renders Claude-shape tool
  inputs (`{file_path, old_string, new_string}` for `Edit`, etc.); other
  runtimes must translate *to* that shape on their boundary, not the
  other way.

## Architecture overview

```
┌─────────────────────────────────────────────────────┐
│  AgentService                                        │
│  - prepare_task / start_draft / interrupt_task       │
│  - resolves runtime via RUNTIMES[task.config.runtime]│
└──────────────────┬──────────────────────────────────┘
                   │ runtime.run_session(task, exec_config, handler)
                   ▼
       ┌───────────────────────┐
       │  IAgentRuntime        │  Protocol — runtime contract
       │  - run_session        │
       │  - interrupt          │
       └───────┬───────────────┘
               │
       ┌───────┴────────────┬──────────────────┐
       ▼                    ▼                  ▼
  ClaudeRuntime         CodexRuntime       (future …)
       │                    │
       │              ┌─────┴─────────┐
       │              ▼               ▼
       │        CodexJsonRpcClient   CodexProtocolAdapter
       │
       ▼
  Claude SDK (in-process)
```

## Key contracts

### `IAgentRuntime`

```python
class IAgentRuntime(Protocol):
    runtime_type: RuntimeType        # "claude" | "codex"
    display_name: str

    async def run_session(
        self,
        task: AgentTask,
        exec_config: RuntimeExecutionConfig,
        handler: AgentEventHandler,
    ) -> AgentResult: ...

    async def interrupt(self, task: AgentTask, tracker: Tracker) -> None: ...
```

- One instance per `AgentService` (instances are stateful re: shared
  deps but stateless re: per-session data — tracker, hooks etc. are
  built per call).
- `run_session` owns the conversational loop: `tracker.get_next_message`
  → query → stream events → repeat. Exits on `END_SIGNAL`.
- `interrupt` is the cancellation hook. No `cancel_event`, no polling.
  Each runtime decides what "interrupt the current turn" means.

### `RuntimeEvent` and `AgentEventHandler`

```python
class RuntimeEvent(BaseModel):
    method: str          # "agent/textDelta", "agent/toolCallStart", …
    params: dict
    request_id: str | None = None  # for confirmAction / askUserQuestion

class AgentEventHandler(Protocol):
    async def on_event(self, event: RuntimeEvent) -> None: ...
    async def on_complete(self, result: AgentResult) -> None: ...
```

- `RuntimeEvent` carries the JSON-RPC envelope shape `(method, params,
  request_id)` — the same shape the WebSocket already emits.
- Naming: `RuntimeEvent` is the *runtime-layer* envelope.
  `AgentEvent` (`app/agent/models.py`) is the *persisted* discriminated
  union written to `.events.jsonl`. Same data flows through both, but
  they live at different layers and must not be confused.
- `make_handler_from_notify(notify)` adapts the existing
  `_persisting_notify` callable to the handler protocol; the
  `request_id` kwarg is load-bearing — without it, frontend
  `agent/respond` cannot match a reply to its pending request.

### Permission types

```python
class ToolPermissionRequest(BaseModel):
    tool_name: str
    input: dict
    tool_use_id: str | None
    session_id: str | None
    permission_mode: str = "default"
    context: dict = {}              # escape hatch for runtime-specific fields

class ToolPermissionResponse(BaseModel):
    behavior: Literal["allow", "deny"]
    updated_input: dict | None = None
    message: str | None = None
    interrupt: bool = False
```

`ToolPermissionRequest`/`Response` are runtime-neutral. Each runtime
(Claude SDK adapter, Codex `handle_server_request`) is responsible for
translating its native shape to/from these.

## Permission flow

1. Runtime intercepts a tool call → builds `ToolPermissionRequest` (with
   the *current* `permission_mode` from `task.config`).
2. `permissions.can_use_tool(request, …)` runs:
   - Built-in interactive primitives (`ConfirmStatement`,
     `AskUserQuestion`) short-circuit to the user-prompt flow.
   - **Mode-category filter** — `evaluate_mode(mode, categorize(name))`
     resolves the `(mode, category)` cell against the table:

     | mode               | read  | net   | edit  | bash  | mcp   |
     |--------------------|-------|-------|-------|-------|-------|
     | `bypassPermissions`| allow | allow | allow | allow | allow |
     | `plan`             | allow | allow | deny  | deny  | deny  |
     | `acceptEdits`      | allow | allow | allow | None  | None  |
     | `default`          | allow | allow | None  | None  | None  |

     `None` cells fall through.
   - INTERCEPTORS dispatch — bonsai's MCP tools auto-approve in their
     fast path (mode filter runs *before* this so plan mode can still
     deny mutating tools like `spec_delete` / `ChangeTicketStatus`).
   - Default — `agent/confirmAction` user prompt with timeout policy.
3. Response returned as `ToolPermissionResponse`. Each runtime maps it
   back to its native shape:
   - **Claude:** `claude_can_use_tool_adapter` returns
     `PermissionResultAllow | PermissionResultDeny`.
   - **Codex:** `handle_server_request` returns
     `{decision: "approved" | "denied"}` for command/file approvals,
     `{action: ..., content: null}` for elicitations.

### Tool categories — five buckets

`ToolCategory = Literal["read", "net", "edit", "bash", "mcp"]`

The classification is centralised in `app/agent/permissions.py`:

- `_TOOL_CATEGORIES` — explicit map for built-in Claude SDK tools.
- `_INTERCEPTOR_CATEGORIES` — per-bonsai-MCP-tool overrides
  (`spec_search`/`spec_links`/`bonsai_visualize` = `read`,
  `spec_delete`/`ChangeTicketStatus` = `edit`).
- `categorize()` does dynamic special-case resolution
  (`SuggestDescription` is `edit` iff `apply=true`, else `read`).
- Unknown tools default to `edit` (fail-closed, requires approval).

A flat lookup table is used because Claude SDK tools come from the SDK
without a registration hook. The trade-off is documented drift risk;
mitigated by the `test_every_built_in_tool_classified` test that
asserts every tool emitted by the runner is classified.

## Event flow

```
Runtime emits:
  await handler.on_event(RuntimeEvent(method, params, request_id))

handler (built by make_handler_from_notify):
  forwards to _persisting_notify(method, params, request_id)

_persisting_notify:
  1. WebSocket broadcast (live frontend)
  2. append_event() → .events.jsonl (replay on resume)

Frontend:
  WS message → store → render
```

The *only* difference between Claude and Codex sessions on the wire is
**which runtime constructs the event**. Frontend rendering is
runtime-agnostic.

## Cancellation contract

When the user clicks **Stop**:

1. `AgentService.interrupt_task(bonsai_sid)` — sets
   `tracker.set_interrupted` (bonsai-internal flag) and
   `tracker.interrupt_futures` (resolves pending user-prompt futures).
2. `runtime.interrupt(task, tracker)` — runtime-specific cancel:
   - **Claude:** `await tracker.get_client(sid).interrupt()` (SDK
     control-protocol message).
   - **Codex:** `client.notify("turn/interrupt", …)` →
     wait up to 8s for `turn/completed` → `client.kill()` if no ack.
3. `run_session`'s loop exits naturally on the next iteration when its
   message stream terminates. The runtime's existing `interrupted`
   branch emits `agent/interrupted`; no polling, no `cancel_event`,
   no `asyncio.Event`.

Cancellation is callback-driven, not flag-polled. The `interrupt`
method runs alongside the loop, not from inside it. The reason: a
polling design forces the inner loop to race the iterator against the
event, which is both more code and slower (interrupt latency = poll
interval). The callback design has zero latency and zero extra code.

## Runtime selection

- `AgentConfig.runtime: Literal["claude", "codex"] = "claude"`. Default
  keeps existing on-disk sessions backward-compat.
- `AgentService._launch_runner` resolves
  `RUNTIMES[task.config.runtime]`. Unknown runtime → service rejects at
  draft creation, not at start.
- Frontend `RuntimePicker` fetches `runtime/list` on app start. Codex is
  `available: false` until binary discovery / install / login wiring is
  in place.

## Design choices

| Decision | Choice | Reason |
|---|---|---|
| Runtime contract shape | One `IAgentRuntime` with `run_session` + `interrupt` | Bonsai's session is long-lived and conversational; install/login go through separate RPC handlers instead of factory methods |
| Cancellation | `interrupt(task, tracker)` callback | Zero-latency cancel without flag-polling in the inner loop |
| Tool categorisation | Flat `_TOOL_CATEGORIES` + `_INTERCEPTOR_CATEGORIES` | Claude SDK tools have no registration hook; per-interceptor overrides handle bonsai's MCP tools |
| Permission "always allow" | Mode-only (`bypassPermissions`/`acceptEdits`) | Coarser than per-pattern allowlists, simpler to reason about; per-pattern allowlist is future work |
| Claude protocol adapter | Small shape-builders in `runtime/claude/adapter.py` | Bonsai's frontend consumes Claude-shape events directly, so far less translation is needed; the small adapter is the boundary that cross-runtime parity tests enforce against |
| `AgentEventHandler` | `on_event(RuntimeEvent)` envelope | Matches bonsai's existing JSON-RPC wire format |

## File organisation

```
backend/app/agent/
  runtime/
    __init__.py            # public exports
    types.py               # IAgentRuntime, RuntimeExecutionConfig, RuntimeType
    events.py              # RuntimeEvent, AgentEventHandler, make_handler_from_notify
    permissions.py         # ToolPermissionRequest/Response, ToolCategory
    claude/
      __init__.py          # exports ClaudeRuntime
      runtime.py           # ClaudeRuntime — IAgentRuntime impl
      hooks.py             # SubagentHooks (subagent / PreCompact correlation)
      adapter.py           # event-shape builders
  permissions.py           # can_use_tool engine, claude_can_use_tool_adapter
  service.py               # AgentService — wires runtime to tasks
  tools/                   # bonsai MCP tools (interceptors)
```

## Acceptance / health

- Backend test suite green (`uv run pytest`).
- Zero `from app.agent.runner` imports remain.
- Zero `claude_agent_sdk` imports outside `runtime/claude/`.
- All `PermissionResultAllow|Deny` references contained to
  `claude_can_use_tool_adapter`.
