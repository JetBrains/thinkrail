---
id: multi-runtime-design
type: architecture-design
status: active
title: Multi-Runtime Agent Architecture
covers:
- backend/app/agent/runtime/
- backend/app/agent/permissions.py
- backend/app/agent/service.py
tags:
- backend
- agent
- runtime
- architecture
---
# Multi-Runtime Agent Architecture

## Overview

Bonsai hosts agent backends behind a runtime-agnostic contract. Claude
Code SDK is the only runtime currently registered; the architecture is
shaped so additional runtimes (e.g. OpenAI Codex via `codex app-server`)
can be added without changing the session layer above.

This doc describes the architecture and the reasoning behind the
choices. Read it for *why* the architecture is shaped the way it is.

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
┌──────────────────────────────────────────────────────────────┐
│  AgentService                                                 │
│  - prepare_task / start_draft / interrupt_task                │
│  - _get_runtime(task) → self.runtime_registry.get(            │
│                            task.config.runtime)               │
│  - _get_context_max(task) → runtime.get_context_window(...)   │
└──────────────────┬───────────────────────────────────────────┘
                   │ runtime.run_session(task, exec_config, handler)
                   ▼
       ┌───────────────────────┐
       │  IAgentRuntime        │  Protocol — runtime contract
       │  - list_models        │
       │  - get_context_window │
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

    def list_models(self) -> list[ModelInfo]: ...
    def get_context_window(self, model_id: str) -> int: ...

    async def run_session(
        self,
        task: AgentTask,
        exec_config: RuntimeExecutionConfig,
        handler: AgentEventHandler,
    ) -> AgentResult: ...

    async def interrupt(self, task: AgentTask, tracker: Tracker) -> None: ...
```

- A runtime is the declaration that "this kind of agent is supported."
  Protocol is intentionally minimal — six surfaces total.
- **Protocol-stateless.** No `startup` / `shutdown` handshake. Any
  per-runtime warmup is the implementation's private concern.
- One instance per `ProjectContext`, constructed with all dependencies
  wired in (tracker, spec service, coordinator, app config). Re-used
  across every session that runtime handles.
- `run_session` owns the conversational loop: `tracker.get_next_message`
  → query → stream events → repeat. Exits on `END_SIGNAL`.
- `interrupt` is the cancellation hook. No `cancel_event`, no polling.
  Each runtime decides what "interrupt the current turn" means.
- `list_models` returns the runtime's current best view. How the runtime
  sources it (static list, lazy fetch, periodic refresh, remote API) is
  invisible to callers. There is no `refresh_models` or `models_status`
  on the protocol — those leak caching strategy.
- `get_context_window(model_id)` returns the context-window size for
  the runtime's own models, falling back to a neutral
  `DEFAULT_CONTEXT_WINDOW` for unknown ids. Services consult the runtime
  rather than maintaining their own model→window tables.

### `RuntimeRegistry`

`backend/app/agent/runtime/registry.py` — lookup table from
`RuntimeType` to live `IAgentRuntime` instance.

```python
class RuntimeRegistry:
    def register(self, runtime: IAgentRuntime) -> None: ...
    def get(self, runtime_type: RuntimeType) -> IAgentRuntime: ...
    def has(self, runtime_type: RuntimeType) -> bool: ...
    def all(self) -> list[IAgentRuntime]: ...   # sorted by runtime_type
```

Domain exceptions: `RuntimeRegistryError`, `DuplicateRuntimeError`,
`UnknownRuntimeError`. The RPC layer translates `UnknownRuntimeError` to
`UNKNOWN_RUNTIME (-32031)` so a client sending an unregistered runtime
key gets a clean domain error instead of an opaque `INTERNAL_ERROR`.

`ProjectContext.runtime_registry` lazy property constructs and registers
the available runtimes once per project. No `start_all` / `stop_all` —
the registry just holds the instances.

### `ModelInfo`

```python
class ModelInfo(BaseModel):           # frozen
    id: str
    label: str
    context_window: int

DEFAULT_CONTEXT_WINDOW = 200_000             # neutral floor
```

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

Mode names are Claude-SDK-shaped (`bypassPermissions` / `acceptEdits` /
`plan` / `default`) — neutral mode names with a per-runtime translation
layer are a future change, tracked when a second runtime lands.

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
   - Default — `agent/confirmAction` user prompt; waits indefinitely for the user's response.
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

- `AgentConfig.runtime: RuntimeType = "claude"`. Default keeps existing
  on-disk sessions backward-compat. `RuntimeType` is `Literal["claude",
  "codex"]` — declared in `app/agent/models.py` to break a circular
  import with `runtime/types.py`, re-exported via `runtime/__init__.py`.
- `AgentService._get_runtime(task)` is a one-line registry lookup:
  `self.runtime_registry.get(task.config.runtime)`. Unknown runtime
  raises `UnknownRuntimeError` → RPC layer surfaces `UNKNOWN_RUNTIME`.
- Frontend model picker hydrates from the `models/list` RPC, which now
  returns models grouped by runtime:

  ```json
  {
    "runtimes": [
      {
        "runtimeType": "claude",
        "displayName": "Claude Code",
        "models": [ { "id": "...", "label": "...", "contextWindow": 200000 }, ... ]
      }
    ]
  }
  ```

  `displayName` ships from the runtime — frontends don't hardcode a
  `runtime_type → display_name` mapping. Sorted by `runtime_type` for
  deterministic rendering.

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
    __init__.py            # public exports — incl. RuntimeRegistry, ModelInfo
    types.py               # IAgentRuntime, RuntimeExecutionConfig, ModelInfo, DEFAULT_CONTEXT_WINDOW
    registry.py            # RuntimeRegistry + RuntimeRegistryError / DuplicateRuntimeError / UnknownRuntimeError
    events.py              # RuntimeEvent, AgentEventHandler, make_handler_from_notify
    permissions.py         # ToolPermissionRequest/Response, ToolCategory  (engine lives one level up)
    claude/
      __init__.py          # exports ClaudeRuntime
      runtime.py           # ClaudeRuntime — IAgentRuntime impl
      models.py            # ClaudeModelRegistry — loads models.json
      models.json          # curated model catalog
      hooks.py             # SubagentHooks (subagent / PreCompact correlation)
      adapter.py           # event-shape builders
  permissions.py           # can_use_tool engine + claude_can_use_tool_adapter
  service.py               # AgentService — wires runtime to tasks
  tools/                   # bonsai MCP tools (interceptors)
```

## SDK boundary

The Claude SDK is the only provider SDK currently in tree. Imports
outside `runtime/claude/` mark the parts of the system that are still
Claude-shaped and would need a per-runtime path the day a second
runtime registers:

- `app/agent/permissions.py` (claude_agent_sdk permission types).
- `app/agent/tools/*.py` interceptors (claude_agent_sdk MCP shapes).
- `app/agent/service.py:update_config` calls `client.set_model` /
  `client.set_permission_mode` directly rather than going through
  `IAgentRuntime`.
- `app/agent/context.py` falls back to the `anthropic` tokenizer when
  computing context windows.

`app/agent/revise.py` calls `claude_agent_sdk.query()` for one-shot
voice-transcript cleanup; the `"haiku"` alias is resolved by the SDK.
