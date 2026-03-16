# RPC Module — Design Specification

> Parent: [DESIGN_DOC.md](../../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-02-26 | Updated: 2026-03-12

## Table of Contents
1. [Purpose](#purpose)
2. [Protocol Overview](#protocol-overview)
3. [Methods](#methods)
4. [Error Codes](#error-codes)
5. [Internal Architecture](#internal-architecture)
6. [File Organization & Public Interface](#file-organization--public-interface)
7. [JSON-RPC Dispatch](#json-rpc-dispatch)
8. [Connection Management](#connection-management)
9. [Watcher Integration](#watcher-integration)
10. [Design Decisions](#design-decisions)
11. [Dependencies](#dependencies)
12. [Known Limitations](#known-limitations)
13. [Related Specs](#related-specs)

## Purpose

The RPC module is the transport layer bridging the WebSocket connection and the domain modules.
It manages the WebSocket connection lifecycle, parses and dispatches incoming JSON-RPC 2.0
messages to domain handlers using `jsonrpcserver`, sends outgoing server→client messages
(notifications and server-initiated requests), and starts and routes the filesystem watcher.

## Protocol Overview

**Style:** JSON-RPC 2.0 over WebSocket — true bidirectional (LSP-style)

All communication happens over a single WebSocket at `/ws?project=<path>`. Messages follow JSON-RPC 2.0:
- **Requests** have `id` + `method` + `params`; the other side must send back a response with the same `id`
- **Notifications** omit `id`; fire-and-forget, no response expected

Both sides can send either. The server can initiate requests to the client (e.g. asking a question mid-agent-run), and the client responds via `agent/respond`.

**Wire format convention:** All JSON-RPC params and result keys use **camelCase** (e.g. `bonsaiSid`, `sessionId`, `specIds`). Python models use `snake_case` internally and convert via Pydantic `alias_generator` + `model_dump(by_alias=True)`.

## Methods

### Client → Server (requests)

| Method            | Params                                                                                       | Returns             | Description                                                                                                                                                 |
|-------------------|----------------------------------------------------------------------------------------------|---------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `spec/list`       | `{}`                                                                                         | `list[SpecSummary]` | List all specs with metadata                                                                                                                                |
| `spec/get`        | `{ id: str }`                                                                                | `SpecDetail`        | Get spec content and metadata                                                                                                                               |
| `spec/create`     | `{ type: str, path: str, content?: str, id?: str }`                                           | `SpecDetail`        | Create a new spec                                                                                                                                           |
| `spec/update`     | `{ id: str, content: str }`                                                                  | `SpecDetail`        | Update spec content                                                                                                                                         |
| `spec/delete`     | `{ id: str }`                                                                                | `null`              | Delete a spec                                                                                                                                               |
| `spec/graph`      | `{}`                                                                                         | `SpecGraph`         | Get spec hierarchy graph                                                                                                                                    |
| `agent/run`       | `{ specIds: list[str], config: AgentConfig, skillId?: str }`                                 | `{ bonsaiSid: str }`   | Start a persistent agent session with spec and optional skill context. If `skillId` is provided, the skill's instructions (from the Bonsai plugin's `SKILL.md`) are loaded and prepended to the system prompt. Session starts in `idle` state, ready for messages. `sessionId` arrives later via `agent/sessionStart` notification. See [Agent Context](../agent/CONTEXT.md). |
| `agent/send`      | `{ bonsaiSid: str, text: str }`                                                                 | `null`              | Send a user message to the session, triggering a new turn. Session must be `idle`.                                                                          |
| `agent/status`    | `{ bonsaiSid: str }`                                                                            | `AgentTask`         | Get session status and metadata                                                                                                                             |
| `agent/list`      | `{}`                                                                                         | `list[AgentTask]`   | List all agent sessions                                                                                                                                     |
| `agent/interrupt` | `{ bonsaiSid: str }`                                                                            | `null`              | Cancel the current turn. Session stays `idle` and can accept new messages.                                                                                  |
| `agent/end`       | `{ bonsaiSid: str }`                                                                            | `null`              | Gracefully close the session. Session enters `done` state.                                                                                                  |
| `agent/respond`   | `{ bonsaiSid: str, requestId: str, response: AskUserQuestionResponse \| ToolApprovalResponse }` | `null`              | Respond to a pending server→client request. See [Agent Module models](../agent/README.md#interactive-requestresponse-models) for response type definitions. |
| `session/list`    | `{}`                                                                                         | `list[SessionSummary]` | List all sessions (in-memory active + on-disk archived from `.specs/sessions/`) |
| `session/get`     | `{ bonsaiSid: str }`                                                                            | `SessionData \| null`  | Get full session data including events from disk |
| `session/continue`| `{ bonsaiSid: str }`                                                                            | `{ bonsaiSid: str }`   | Resume a session — reuses the same `bonsaiSid`, loads old conversation as context for a new SDK session |
| `session/delete`  | `{ bonsaiSid: str }`                                                                            | `bool`              | Delete a session from disk |
| `agent/transcribe`| `{ audioBase64: str, mimeType: str }`                                                        | `{ text: str }`     | Transcribe audio via OpenAI Whisper API (fallback for browsers without Web Speech API). See [TRANSCRIBE.md](../agent/TRANSCRIBE.md). |
| `vis/state`       | `{}`                                                                                         | `DashboardState`    | Return the current dashboard state without recomputing. State is computed on WebSocket connect and after file changes. |
| `vis/recompute`   | `{}`                                                                                         | `DashboardState`    | Force a dashboard recompute from registry, specs, and tasks on disk. Returns the new state and pushes `vis/stateChanged` notification. |

### Server → Client (notifications)

#### Spec Watcher Events

| Method | Params | Description |
| --- | --- | --- |
| `spec/didChange` | `{ id: str, changes: object }` | Spec file changed on disk |
| `spec/didCreate` | `{ id: str, path: str }` | New spec file detected |
| `spec/didDelete` | `{ id: str }` | Spec file removed |
| `registry/didUpdate` | `{ registry: object }` | registry.json changed |

#### File Notifications

| Method | Params | Description |
| --- | --- | --- |
| `files/treeChanged` | `{}` | File added or deleted in project |
| `file/didChange` | `{ path: str }` | File content modified on disk (relative path from project root) |

#### Agent Streaming Events

| Method | Params | Description |
| --- | --- | --- |
| `agent/sessionStart` | `{ bonsaiSid, sessionId, model, tools[], cwd, permissionMode }` | Agent session initialized |
| `agent/textDelta` | `{ bonsaiSid, sessionId, text, streaming, agentId? }` | Text output (streaming or full block). `agentId` present when text originates from a subagent. |
| `agent/toolCallStart` | `{ bonsaiSid, sessionId, toolUseId, toolName, toolInput, agentId? }` | Agent started a tool call. `agentId` present when the tool call originates from a subagent. |
| `agent/toolCallEnd` | `{ bonsaiSid, sessionId, toolUseId, toolName, output, isError, agentId? }` | Tool call completed with result. `agentId` present when the tool call originates from a subagent. |
| `agent/subagentStart` | `{ bonsaiSid, sessionId, agentId, agentType, taskToolUseId? }` | Subagent spawned. `taskToolUseId` is the `toolUseId` of the Task tool call that spawned this subagent (used internally by the backend to resolve `agentId` on subsequent events via `parent_tool_use_id`). |
| `agent/subagentEnd` | `{ bonsaiSid, sessionId, agentId }` | Subagent finished |
| `agent/notification` | `{ bonsaiSid, sessionId, message, title? }` | General agent notification |
| `agent/compact` | `{ bonsaiSid, sessionId, trigger, preTokens }` | Context window compacted |
| `agent/progress` | `{ bonsaiSid, sessionId, status, message }` | Task progress update |
| `agent/turnComplete` | `{ bonsaiSid, sessionId, result, costUsd, turns, durationMs, usage }` | Turn finished; session is `idle`, ready for next `agent/send` |
| `agent/interrupted` | `{ bonsaiSid, sessionId }` | Current turn was cancelled via `agent/interrupt`; session is `idle`. Preceded by synthetic `agent/subagentEnd` for any subagents still open when the interrupt fired. |
| `agent/done` | `{ bonsaiSid, sessionId, result, costUsd, turns, durationMs, usage }` | Session closed (via `agent/end` or terminal condition) |
| `agent/error` | `{ bonsaiSid, sessionId, subtype, errors[], result, costUsd, turns, durationMs, usage }` | Session ended due to error |
| `agent/permissionDenied` | `{ bonsaiSid, sessionId, toolName, toolInput }` | Tool blocked by permission policy |

#### Visualization Events

| Method | Params | Description |
| --- | --- | --- |
| `vis/stateChanged` | `DashboardState` | Dashboard state recomputed (triggered by file changes to `.md`/`.json` files or explicit `vis/recompute`) |

> **SDK event mapping:** `agent/sessionStart` ← `SDKSystemMessage` subtype `init` · `agent/textDelta` ← `SDKAssistantMessage` text block / `SDKPartialAssistantMessage` text_delta · `agent/toolCallStart` ← `SDKAssistantMessage` tool_use block · `agent/toolCallEnd` ← `SDKUserMessage` tool_result block · `agent/subagentStart` / `End` ← `SubagentStart` / `SubagentStop` hooks · `agent/notification` ← `Notification` hook · `agent/compact` ← `SDKCompactBoundaryMessage` · `agent/turnComplete` ← `SDKResultMessage` (turn ends, session stays open) · `agent/interrupted` ← `agent/interrupt` cancels current turn · `agent/done` ← session closed via `agent/end` · `agent/error` / `permissionDenied` ← `SDKResultMessage` error subtypes
>
> **Subagent event correlation:** The SDK provides `parent_tool_use_id` on `AssistantMessage` and `UserMessage` to identify which Task tool call produced each message. The runner builds a `tool_use_id → agent_id` mapping from `SubagentStart` hooks, then resolves `parent_tool_use_id` to `agentId` on outgoing `textDelta`, `toolCallStart`, and `toolCallEnd` notifications. This enables deterministic event grouping on the frontend.

> **Streaming text:** Requires `includePartialMessages: true` in SDK options to receive `agent/textDelta` with `streaming: true`. Without it, full text blocks are emitted per turn.

### Server → Client (requests)

The server suspends an `asyncio.Future` keyed by `requestId` until the client responds. If no response arrives within a timeout, the server auto-denies and continues.

| Method | Params | Expected Response | Description |
| --- | --- | --- | --- |
| `agent/askUserQuestion` | `{ bonsaiSid, requestId, questions: Question[] }` | [`AskUserQuestionResponse`](../agent/README.md#interactive-requestresponse-models) | Ask the user a question during an agent run |
| `agent/confirmAction` | `{ bonsaiSid, requestId, toolName, toolInput }` | [`ToolApprovalResponse`](../agent/README.md#interactive-requestresponse-models) | Request approval for a tool action. When `toolName === "ExitPlanMode"`, `toolInput` is enriched with `planContent: string` (accumulated assistant text). See [ExitPlanMode enrichment](../agent/README.md#exitplanmode-plan-content-enrichment). |
| `agent/suggestSession` | `{ bonsaiSid, requestId, skill, specIds, name, reason }` | [`ToolApprovalResponse`](../agent/README.md#interactive-requestresponse-models) | Suggest a follow-up session to the developer. Approve creates a new session with the suggested skill/specs; dismiss returns `PermissionResultAllow` with `dismissed: true` so the agent continues. |

All methods originate from the SDK's `canUseTool` callback. `runner.py` distinguishes them by `tool_name`: `"AskUserQuestion"` → `agent/askUserQuestion`, `"SuggestSession"` → `agent/suggestSession`, `"ExitPlanMode"` → `agent/confirmAction` (enriched with `planContent`), any other tool → `agent/confirmAction`. See [Agent Module — Interactive Request/Response Models](../agent/README.md#interactive-requestresponse-models) for `Question`, `QuestionOption`, `AskUserQuestionResponse`, and `ToolApprovalResponse` type definitions. See [SuggestSession Backend Spec](../agent/tools/SUGGEST_SESSION.md) for the suggestion wire format.

## Error Codes

Domain exceptions raised inside handlers are mapped to JSON-RPC error responses:

| Exception | JSON-RPC Code | Message |
| --- | --- | --- |
| `SpecNotFoundError` | -32001 | "Spec not found" |
| `RegistryError` | -32002 | "Registry error" |
| `ValidationError` | -32003 | "Validation error" |
| `AgentTaskNotFoundError` | -32011 | "Agent task not found" |
| `FutureNotFoundError` | -32012 | "No pending request" |
| `KeyError` / missing params | -32602 | "Invalid params" |
| Any other exception | -32603 | "Internal error" |

Standard errors (-32700 parse error, -32601 method not found) are handled automatically by jsonrpcserver.

## Internal Architecture

**Pattern:** Three-layer — WebSocket transport + dispatch in `server.py`, domain-organized
handlers in `methods/`, outgoing message factory in `notifications.py`.

```mermaid
---
title: RPC Module — Internal Architecture
---
graph TD
    Browser["Browser<br/>(WebSocket /ws)"]

    Browser --> Server

    subgraph RPCModule["RPC Module"]
        Server["server.py<br/><i>FastAPI + jsonrpcserver</i><br/>JSON-RPC dispatch, connection mgmt,<br/>watcher startup + callback"]
        subgraph Methods["Methods"]
          direction LR
          Specs["methods/specs.py"]
          Agents["methods/agents.py"]
          Vis["methods/vis.py"]
          Agents ~~~ Specs ~~~ Vis
        end
        Server ---> Methods
        Server -- "Creates notify on connect" --> Notify["notifications.py<br/>make_notify(ws) → notify callable<br/>current_notify module-level ref"]
        Agents -- "Reads current_notify" --> Notify
    end

    SpecSvc["spec/service<br/>Spec CRUD"]
    AgentSvc["agent/service<br/>Agent task management"]
    VisSvc["vis/service<br/>Dashboard state"]

    Specs ---> SpecSvc
    Agents ---> AgentSvc
    Vis ---> VisSvc
```

```mermaid
---
title: "Watcher path (per-connection, scoped to project)"
---
graph TD
    Connect["WebSocket connect<br/>/ws?project=path"]
    Validate["Validate project path<br/>+ .specs/registry.json"]
    StartW["_start_watcher(config, service)"]
    Watch["core/watcher.watch(project_root, _on_file_change)"]
    Change["File change on disk"]
    Callback["_on_file_change callback"]
    SpecPath["spec/service → current_notify → frontend"]
    Dropped["notification dropped"]
    StopW["Disconnect → stop(watcher_handle)"]

    Connect --> Validate --> StartW --> Watch
    Change --> Callback
    Callback -- "spec file" --> SpecPath
    Callback -- "no connection" --> Dropped
    Watch -.- StopW
```

## File Organization & Public Interface

### server.py

**Responsibility:** WebSocket endpoint with per-connection project selection, connection management, JSON-RPC dispatch loop, per-connection watcher lifecycle.

**Dependencies:** jsonrpcserver, methods/specs, methods/agents, methods/vis, notifications, core/watcher, core/config, spec/service, vis/service

| Export | Signature | Description |
| --- | --- | --- |
| `register_routes` | `(app: FastAPI) → None` | Register the `/ws` WebSocket endpoint on the FastAPI app. Called by `main.py` during setup. No config needed — config is built per-connection from the `project` query parameter. |

`METHODS` is a mapping from JSON-RPC method names to handler coroutines, assembled in `server.py` from the functions in `methods/specs.py`, `methods/agents.py`, and `methods/vis.py`.

`_start_watcher` is a private helper that starts a filesystem watcher scoped to the connection's project directory. Called inside `ws_endpoint` after project validation; stopped on disconnect.

### notifications.py

**Responsibility:** `make_notify` factory + `current_notify` module-level variable — creates per-connection notify callable, holds reference to active callable.

**Dependencies:** none

| Export | Type / Signature | Description |
| --- | --- | --- |
| `make_notify` | `(websocket: WebSocket) → NotifyCallable` | Create a notify callable bound to the given WebSocket. Called by `server.py` on each new connection. |
| `current_notify` | `NotifyCallable \| None` | Module-level variable holding the active notify callable. Set by `server.py` on connect, cleared on disconnect. |

**`NotifyCallable`** type alias:
```python
NotifyCallable = Callable[[str, dict, str | None], Awaitable[None]]
```

**Returned callable signature:**
```python
async def notify(method: str, params: dict, request_id: str | None = None) -> None
```
- `request_id=None` → send JSON-RPC **notification** (message has no `id` field)
- `request_id` set → send JSON-RPC **request** (message includes `id` field; `request_id` value appears as both the JSON-RPC `id` and in `params.requestId` so the client can reference it in `agent/respond`)

### methods/specs.py

**Responsibility:** jsonrpcserver handlers for all `spec/*` methods.

**Dependencies:** spec/service

| Export | Signature | Description |
| --- | --- | --- |
| `list_specs` | `(**params) → list[SpecSummary]` | Handler for `spec/list` |
| `get_spec` | `(**params) → SpecDetail` | Handler for `spec/get` |
| `create_spec` | `(**params) → SpecDetail` | Handler for `spec/create` |
| `update_spec` | `(**params) → SpecDetail` | Handler for `spec/update` |
| `delete_spec` | `(**params) → None` | Handler for `spec/delete` |
| `get_graph` | `(**params) → SpecGraph` | Handler for `spec/graph` |

### methods/agents.py

**Responsibility:** jsonrpcserver handlers for all `agent/*` methods.

**Dependencies:** agent/service, notifications

| Export | Signature | Description |
| --- | --- | --- |
| `run_agent` | `(**params) → dict` | Handler for `agent/run` |
| `send_message` | `(**params) → None` | Handler for `agent/send` |
| `get_agent_status` | `(**params) → AgentTask` | Handler for `agent/status` |
| `list_agents` | `(**params) → list[AgentTask]` | Handler for `agent/list` |
| `interrupt_agent` | `(**params) → None` | Handler for `agent/interrupt` |
| `end_session` | `(**params) → None` | Handler for `agent/end` |
| `respond_agent` | `(**params) → None` | Handler for `agent/respond` |

`run_agent` captures `current_notify` at call time (the active connection's notify callable), extracts the optional `skillId` param, and passes both to `agent/service.run_task`. Returns `{ bonsaiSid }` immediately. The agent session runs in the background; the runner enters a conversation loop waiting for messages. The `sessionId` arrives later via `agent/sessionStart` notification.

`send_message` routes to `agent/service.send_message(bonsai_sid, text)`, which enqueues the message. The runner picks it up and starts a new turn.

`end_session` routes to `agent/service.end_session(bonsai_sid)`, which sends a sentinel to the runner's message queue, causing it to close the SDK client and emit `agent/done`.

`respond_agent` routes to `agent/service.respond(bonsai_sid, request_id, response)`, which resolves the pending `asyncio.Future` in `tracker.py`.

### methods/vis.py

**Responsibility:** jsonrpcserver handlers for all `vis/*` methods.

**Dependencies:** vis/service

| Export | Signature | Description |
| --- | --- | --- |
| `get_vis_state` | `(service, **params) → DashboardState` | Handler for `vis/state` — returns current state without recomputing |
| `recompute_vis` | `(service, **params) → DashboardState` | Handler for `vis/recompute` — forces recompute and returns new state |

## JSON-RPC Dispatch

```mermaid
graph TD
    WS["Receive text from WebSocket"]
    Dispatch["jsonrpcserver.async_dispatch<br/>(message, methods=METHODS)"]
    Parse["Parse JSON"]
    Validate["Validate JSON-RPC 2.0 structure"]
    IsRequest{"Has 'id'?"}
    Request["Call handler → send result/error response"]
    Notification["Call handler → no response sent"]
    Error["jsonrpcserver generates<br/>error response automatically"]

    WS --> Dispatch --> Parse --> Validate
    Validate --> IsRequest
    IsRequest -- "Yes (request)" --> Request
    IsRequest -- "No (notification)" --> Notification
    Validate -- "parse error /<br/>unknown method" --> Error
```

## Connection Management

- Single active WebSocket connection at a time (single developer tool, localhost only)
- WebSocket URL: `/ws?project=<path>` — the `project` query parameter specifies the project directory
- On connect:
  1. Validate `project` param exists (close with 4001 if missing)
  2. Validate `<project>/.specs/registry.json` exists (close with 4002 if invalid)
  3. Build per-connection `AppConfig`, `SpecService`, `AgentService`, `VisualizationService` scoped to the project
  4. Replace existing connection if any (close old WebSocket + stop old watcher)
  5. Create `notify = make_notify(ws)`, set `notifications.current_notify = notify`
  6. Start per-connection file watcher for the project directory
  7. Begin JSON-RPC dispatch loop
- On disconnect / close: set `notifications.current_notify = None`, stop the file watcher
- If a second client connects while one is already active, the new connection replaces the old one (previous connection and its watcher are closed)

## Watcher Integration

The file watcher is **per-connection**, scoped to the connected project directory. It starts when a WebSocket client connects and stops when the client disconnects.

1. Inside `ws_endpoint`, after project validation: `_start_watcher(config, spec_service)` is called.
2. `_start_watcher()` calls `core/watcher.watch([project_root], _on_file_change)`.
3. On file change, `_on_file_change(changes)` runs:
   - Routes by file type:
     - `.specs/registry.json` → send `registry/didUpdate` via `current_notify`
     - Any path registered as a spec in the registry (`*.md` or `*.json` spec files) → send `spec/didChange`, `spec/didCreate`, or `spec/didDelete` via `current_notify`
     - Any modified file → send `file/didChange` with relative path (so open editors can refresh)
   - If `notifications.current_notify is None`: notifications are dropped silently
4. On disconnect, the watcher handle is stopped via `stop(watcher_handle)`.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| JSON-RPC library | `jsonrpcserver` | Handles parse errors, method-not-found, and response formatting automatically; eliminates boilerplate in handlers |
| Notify interface | Single `notify(method, params, request_id=None)` | Unified callable for notifications and server-initiated requests; decouples runner from WebSocket details |
| Watcher lifecycle | Per-connection, scoped to project directory | Watcher starts when a client connects with a valid project, stops on disconnect. Each connection watches only its project. Replaces the old application-level approach. |
| `current_notify` in `notifications.py` | Module-level mutable ref, set by `server.py` on connect/disconnect | Avoids circular import between `server.py` and `methods/agents.py`; `notifications.py` is the natural owner of active-connection state |
| Methods organized by domain namespace | `methods/specs.py`, `methods/agents.py`, `methods/vis.py` | Each file mirrors its domain module; easy to locate handlers by method prefix |
| `METHODS` dict assembled in `server.py` | Explicit mapping from method name to handler | Avoids implicit global state from decorator-based registration; makes method set inspectable |
| Per-connection project selection | `?project=` query param on WebSocket URL; services/watcher created per-connection | Allows the frontend to switch projects without restarting the backend; config + services are scoped to the validated project directory |
| No RPC-layer models | Domain models serialized directly | Pydantic models in spec/ and agent/ serialize to JSON; no translation layer needed |

## Dependencies

| Dependency | Usage |
|------------|-------|
| `fastapi` | WebSocket endpoint and app integration |
| `jsonrpcserver` | JSON-RPC 2.0 message parsing and dispatch |
| `spec/service` | Spec CRUD operations; watcher postprocessing |
| `agent/service` | Agent task management |
| `vis/service` | Dashboard state computation and push notifications |
| `core/watcher` | File change detection |
| `core/config` | Project root path for watcher |

## Known Limitations

- **No reconnect replay:** File changes that occur while no client is connected are not queued; they are dropped. A reconnecting client will not receive missed notifications.
- **Single connection only:** No explicit rejection or queuing of concurrent clients; the second connection silently replaces the first.
- **No authentication:** The WebSocket endpoint at `/ws` has no auth; assumes localhost-only access.
- **Pending agent futures on disconnect:** If the client disconnects mid-agent-run, `notifications.current_notify` becomes `None`; outgoing agent events are dropped. Pending `asyncio.Future` objects in `tracker.py` will time out per the configured deadline.

## Related Specs

- **Parent:** [Architecture Design](../../../DESIGN_DOC.md)
- **Depends on:** [Spec Module](../spec/README.md), [Agent Module](../agent/README.md), [Core Module](../core/README.md)
- **Related files:** `main.py` — FastAPI entry point; calls `register_routes(app)`
