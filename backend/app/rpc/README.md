---
id: module-rpc
type: module-design
status: active
title: RPC Module Design
parent: design-doc
depends-on:
- module-spec
- module-agent
- module-core
covers:
- backend/app/rpc/
tags:
- backend
- transport
---
# RPC Module — Design Specification

> Parent: [DESIGN_DOC.md](../../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-02-26 | Updated: 2026-04-12

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

**Wire format convention:** All JSON-RPC params and result keys use **camelCase** (e.g. `thinkrailSid`, `sessionId`, `specIds`). Python models use `snake_case` internally and convert via Pydantic `alias_generator` + `model_dump(by_alias=True)`.

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
| `agent/run`       | `{ specIds: list[str], config: AgentConfig, skillId?: str }`                                 | `{ thinkrailSid: str }`   | Start a persistent agent session with spec and optional skill context. If `skillId` is provided, the skill's instructions (from the ThinkRail plugin's `SKILL.md`) are loaded and prepended to the system prompt. Session starts in `idle` state, ready for messages. `sessionId` arrives later via `agent/sessionStart` notification. See [Agent Context](../agent/CONTEXT.md). |
| `agent/send`      | `{ thinkrailSid: str, text: str }`                                                                 | `null`              | Send a user message to the session, triggering a new turn. Session must be `idle`. |
| `agent/retryLastMessage` | `{ thinkrailSid: str }`                                                                      | `{ ok: bool }`      | Retry the last user message (e.g. after a `context_overflow` error). SDK may auto-compact on retry. |
| `agent/status`    | `{ thinkrailSid: str }`                                                                            | `AgentTask`         | Get session status and metadata                                                                                                                             |
| `agent/list`      | `{}`                                                                                         | `list[AgentTask]`   | List all agent sessions                                                                                                                                     |
| `agent/interrupt` | `{ thinkrailSid: str }`                                                                            | `null`              | Cancel the current turn. Session stays `idle` and can accept new messages.                                                                                  |
| `agent/end`       | `{ thinkrailSid: str }`                                                                            | `null`              | Gracefully close the session. Session enters `done` state.                                                                                                  |
| `agent/respond`   | `{ thinkrailSid: str, requestId: str, response: AskUserQuestionResponse \| ToolApprovalResponse }` | `null`              | Respond to a pending server→client request. See [Agent Module models](../agent/README.md#interactive-requestresponse-models) for response type definitions. |
| `session/list`    | `{}`                                                                                         | `list[SessionSummary]` | List all sessions (in-memory active + on-disk archived from `.tr/sessions/`) |
| `session/get`     | `{ thinkrailSid: str }`                                                                            | `SessionData \| null`  | Get full session data including events from disk |
| `session/continue`| `{ thinkrailSid: str }`                                                                            | `{ thinkrailSid: str }`   | Resume a session — reuses the same `thinkrailSid`, loads old conversation as context for a new SDK session |
| `session/delete`  | `{ thinkrailSid: str }`                                                                            | `bool`              | Delete a session from disk |
| `session/subscribe` | `{ thinkrailSid: str }`                                                                          | `null`              | Subscribe calling connection to a session's event topic (multi-client) |
| `session/unsubscribe` | `{ thinkrailSid: str }`                                                                        | `null`              | Unsubscribe calling connection from a session's event topic |
| `agent/transcribe`| `{ audioBase64: str, mimeType: str }`                                                        | `{ text: str }`     | Transcribe audio via OpenAI Whisper API (fallback for browsers without Web Speech API). See [TRANSCRIBE.md](../agent/TRANSCRIBE.md). |
| `vis/state`       | `{}`                                                                                         | `DashboardState`    | Return the current dashboard state without recomputing. State is computed on WebSocket connect and after file changes. |
| `vis/recompute`   | `{}`                                                                                         | `DashboardState`    | Force a dashboard recompute from registry, specs, and tasks on disk. Returns the new state and pushes `vis/stateChanged` notification. |
| `trash/list`      | `{ type?: str }`                                                                             | `list[TrashedItem]` | List all trashed items, optionally filtered by type (`sessions`, `tickets`, `specs`, `plans`, `drafts`, `patches`) |
| `trash/purge`     | `{ type: str, id: str }`                                                                     | `null`              | Permanently delete a specific trashed item |
| `trash/empty`     | `{ type?: str }`                                                                             | `null`              | Permanently delete all trashed items, optionally filtered by type |
| `trash/restoreSpec` | `{ specId: str }`                                                                          | `{ registryEntry, links }` | Restore a trashed spec: moves file back to original location and returns registry entry + links for caller to re-insert into registry |
| `trash/restorePlan` | `{ ticketId: str }`                                                                        | `null`              | Restore a trashed plan file back to `.tr/plans/` |
| `trash/restoreDraft` | `{ trashItemId: str }`                                                                    | `{ manifestEntry }` | Restore a trashed draft file and return its manifest entry for re-insertion |
| `trash/restorePatches` | `{ ticketId: str }`                                                                     | `null`              | Restore trashed patches directory back to `.tr/spec-patches/` |
| `board/list`      | `{}`                                                                                         | `list[TicketSummary]` | List all meta-tickets |
| `board/get`       | `{ id: str }`                                                                                | `MetaTicket`        | Get full ticket with body, patches, links |
| `board/create`    | `{ title: str, body?: str, type?: str }`                                                     | `MetaTicket`        | Create a new meta-ticket |
| `board/update`    | `{ id: str, title?: str, body?: str, status?: str, type?: str }`                             | `MetaTicket`        | Update ticket fields |
| `board/delete`    | `{ id: str }`                                                                                | `null`              | Delete a meta-ticket |
| `board/reorder`   | `{ id: str, status: str, order: int }`                                                       | `MetaTicket`        | Move ticket to a status column at a position |
| `board/linkSpec`  | `{ ticketId: str, specId: str }`                                                             | `MetaTicket`        | Link a spec to a ticket |
| `board/unlinkSpec`| `{ ticketId: str, specId: str }`                                                             | `MetaTicket`        | Unlink a spec from a ticket |
| `board/attachSession` | `{ ticketId: str, sessionId: str }`                                                      | `MetaTicket`        | Attach an agent session to a ticket |
| `board/detachSession` | `{ ticketId: str, sessionId: str }`                                                      | `MetaTicket`        | Detach an agent session from a ticket |
| `board/getPlan`   | `{ ticketId: str }`                                                                          | `Plan \| null`      | Get the plan for a ticket |
| `board/createPlan`| `{ ticketId: str, title: str, steps: list, verification?: list }`                            | `Plan`              | Create a plan for a ticket |
| `board/savePlan`  | `{ ticketId: str, plan: dict }`                                                              | `Plan`              | Save/update a plan |
| `board/getPlanRaw`| `{ ticketId: str }`                                                                          | `{ content: str }`  | Get plan as raw markdown |
| `board/savePlanRaw`| `{ ticketId: str, content: str }`                                                           | `Plan`              | Save plan from raw markdown |
| `board/updateStep`| `{ ticketId: str, stepNumber: int, status: str, sessionId?: str }`                           | `Plan`              | Update a plan step's status |
| `board/getNextStep`| `{ ticketId: str }`                                                                         | `Step \| null`      | Get the next actionable step |
| `board/readArtifact`| `{ ticketId: str, kind: ArtifactKind }`                                                    | `{ content, stale, updated }` | Read an artifact file (product/technical design, plan, history) |
| `board/writeArtifact`| `{ ticketId: str, kind: ArtifactKind, content: str }`                                     | `{ content, stale, updated }` | Persist edited artifact content to disk |
| `board/listDrafts`| `{ ticketId: str }`                                                                          | `list[DraftEntry]`  | List spec draft entries for a ticket |
| `board/getDraftDiff`| `{ ticketId: str, index: int }`                                                             | `DraftDiff`         | Get diff for a specific draft |
| `board/applyDraft`| `{ ticketId: str, index: int }`                                                              | `null`              | Apply a single draft to the registry |
| `board/applyAllDrafts`| `{ ticketId: str }`                                                                       | `null`              | Apply all drafts for a ticket |
| `board/discardDraft`| `{ ticketId: str, index: int }`                                                             | `null`              | Discard (trash) a single draft |
| `board/discardAllDrafts`| `{ ticketId: str }`                                                                     | `null`              | Discard all drafts for a ticket |
| `board/listPatches`| `{ ticketId: str }`                                                                         | `list[SpecPatch]`   | List applied spec patches for a ticket |
| `board/getPatchDiff`| `{ ticketId: str, index: int }`                                                             | `PatchDiff`         | Get diff for an applied patch |
| `board/revertPatch`| `{ ticketId: str, index: int }`                                                             | `MetaTicket`        | Revert an applied patch |
| `board/setOrchestrator`| `{ ticketId: str, sessionId: str }`                                                     | `MetaTicket`        | Set the orchestrator session for a ticket |
| `board/setPlanPath`| `{ ticketId: str, planPath: str }`                                                          | `MetaTicket`        | Set the plan file path on a ticket |
| `settings/get`    | `{}`                                                                                         | `ProjectSettings`   | Get current project settings |
| `settings/update` | `{ settings: dict }`                                                                         | `ProjectSettings`   | Validate and save settings |
| `settings/ensureFile`| `{}`                                                                                       | `ProjectSettings`   | Create settings file with defaults if missing |
| `appSettings/getSessionDefaults` | `{}`                                                                          | `SessionDefaults`   | Get the user-scoped session-creation defaults (AppStore-backed). Cold-start values returned when the AppStore key is absent. |
| `appSettings/setSessionDefaults` | `{ model, permissionMode, effort }`                                            | `SessionDefaults`   | Persist the user-scoped session-creation defaults. |
| `runtimes/list`   | `{}`                                                                                         | `RuntimesListResponse { runtimes: [RuntimeIdentity { runtimeType, displayName }] }` | List registered runtimes, sorted by `runtimeType`. |
| `runtimes/capabilities` | `{ runtimeType: str }`                                                                 | `RuntimeCapabilities { permissionModes, effortLevels, models, flags, modelCapabilities }` | Capability lists for one runtime — `permissionModes`/`effortLevels`/`models` are `LabeledOption { value, label }` lists, order is contract (position 0 is the runtime default); `flags` are runtime-declared toggles; `modelCapabilities` is a per-model `{ model, effortLevels, flags }` allowlist narrowing the menus so the picker can't offer an unsound combination (e.g. Haiku has no effort levels and no 1M flag). `runtimeType` is validated; returns `-32031` UNKNOWN_RUNTIME for a valid-but-unregistered runtime and `-32003` VALIDATION_ERROR for a value outside the `RuntimeType` literal. |
| `skills/list`     | `{}`                                                                                         | `list[SkillDef]`    | List available **ThinkRail-bundled** skills with icon, group, requires metadata (scans `claude-plugin/skills/`) |
| `skills/listRuntime` | `{ runtime: str }`                                                                        | `list[RuntimeSkillInfo]` | List skills exposed by the **active runtime** — Claude Code user/project/plugin skills, custom commands, built-ins. Each entry has `id`, `name`, `description`, `source` (`"user" \| "project" \| "plugin" \| "command" \| "builtin"`). Powers the chat composer's slash autocomplete alongside `skills/list`. Returns `-32031` if `runtime` is not registered. Frontend treats failure/empty result as "no runtime section" (silent fallback — no error toast). |

### Server → Client (notifications)

#### Spec Watcher Events

| Method | Params | Description |
| --- | --- | --- |
| `spec/didChange` | `{ id: str, changes: object }` | Spec file changed on disk |
| `spec/didCreate` | `{ id: str, path: str }` | New spec file detected |
| `spec/didDelete` | `{ id: str }` | Spec file removed |
| `spec/indexRebuilt` | `{}` | Spec index rebuilt (frontmatter change detected) |
| `docs/didChange` | `{}` | Unmanaged document added, changed, or removed — frontend re-fetches graph |
| `index/ready` | `{}` | Index initialization complete — frontend should re-fetch specs and graph |

#### File Notifications

| Method | Params | Description |
| --- | --- | --- |
| `files/treeChanged` | `{}` | File added/deleted in project, or `.thinkrailhide` modified |
| `file/didChange` | `{ path: str }` | File content modified on disk (relative path from project root) |

#### Agent Streaming Events

| Method | Params | Description |
| --- | --- | --- |
| `agent/ready` | `{ thinkrailSid }` | SDK client initialized; session transitions from `initializing` to `idle` |
| `agent/sessionStart` | `{ thinkrailSid, sessionId, model, tools[], cwd, permissionMode }` | Agent session initialized |
| `agent/textDelta` | `{ thinkrailSid, sessionId, text, streaming, agentId? }` | Text output (streaming or full block). `agentId` present when text originates from a subagent. |
| `agent/toolCallStart` | `{ thinkrailSid, sessionId, toolUseId, toolName, toolInput, agentId? }` | Agent started a tool call. `agentId` present when the tool call originates from a subagent. |
| `agent/toolCallEnd` | `{ thinkrailSid, sessionId, toolUseId, toolName, output, isError, agentId? }` | Tool call completed with result. `agentId` present when the tool call originates from a subagent. |
| `agent/subagentStart` | `{ thinkrailSid, sessionId, agentId, agentType, taskToolUseId? }` | Subagent spawned. `taskToolUseId` is the `toolUseId` of the `Agent` tool call that spawned this subagent (used internally by the backend to resolve `agentId` on subsequent events via `parent_tool_use_id`). |
| `agent/subagentEnd` | `{ thinkrailSid, sessionId, agentId }` | Subagent finished |
| `agent/notification` | `{ thinkrailSid, sessionId, message, title? }` | General agent notification |
| `agent/compact` | `{ thinkrailSid, sessionId, trigger, preTokens }` | Context window compacted |
| `agent/progress` | `{ thinkrailSid, sessionId, status, message }` | Task progress update |
| `agent/turnComplete` | `{ thinkrailSid, sessionId, result, costUsd, turns, durationMs, usage, contextMax }` | Turn finished; session is `idle`, ready for next `agent/send`. `contextMax` is the model's context-window size inferred from the live SDK (`get_context_usage().rawMaxTokens`), cached per model and fetched at turn-start. |
| `agent/interrupted` | `{ thinkrailSid, sessionId, contextMax }` | Current turn was cancelled via `agent/interrupt`; session is `idle`. Preceded by synthetic `agent/subagentEnd` for any subagents still open when the interrupt fired. |
| `agent/done` | `{ thinkrailSid, sessionId, result, costUsd, turns, durationMs, usage }` | Session closed (via `agent/end` or terminal condition) |
| `agent/error` | `{ thinkrailSid, sessionId, subtype, errors[], result, costUsd, turns, durationMs, usage, contextMax }` | Turn error. `subtype` is `"context_overflow"` (prompt exceeded context window — recoverable, session stays idle) or `"turn_error"` (other errors). `subtype: "crash"` for fatal session errors. |
| `agent/permissionDenied` | `{ thinkrailSid, sessionId, toolName, toolInput }` | Tool blocked by permission policy |
| `agent/statusChanged` | `{ thinkrailSid, status }` | Backend session status changed. Emitted by runner on `idle→running` and `running→idle` transitions. Frontend uses this as the authoritative status signal for non-first turns (since `agent/sessionStart` only fires once per runner). Added to `_SKIP_METRICS` — does not trigger metadata persistence. |

#### Multi-Client Sync Events

| Method | Params | Description |
| --- | --- | --- |
| `session/didCreate` | `{ thinkrailSid, name, skillId, specIds, filePaths, status, config, metaTicketId, createdAt }` | A session was created or started — published to project topic so all clients see the new session with full metadata |
| `session/userMessage` | `{ thinkrailSid, text, isMarkdown }` | A user sent a message from another client — append to chat stream |
| `agent/requestResolved` | `{ thinkrailSid, requestId, resolvedBy, response }` | An interactive request (question/approval) was answered by another client — dismiss the pending card |
| `connection/didJoin` | `{ connId, userId, displayName }` | A new client connected to the project |
| `connection/didLeave` | `{ connId, userId, displayName }` | A client disconnected from the project |

#### Visualization Events

| Method | Params | Description |
| --- | --- | --- |
| `vis/stateChanged` | `DashboardState` | Dashboard state recomputed (triggered by file changes to `.md`/`.json` files or explicit `vis/recompute`) |

> **SDK event mapping:** `agent/ready` ← `ClaudeSDKClient` context manager entered · `agent/sessionStart` ← `SDKSystemMessage` subtype `init` · `agent/textDelta` ← `SDKAssistantMessage` text block / `SDKPartialAssistantMessage` text_delta · `agent/toolCallStart` ← `SDKAssistantMessage` tool_use block · `agent/toolCallEnd` ← `SDKUserMessage` tool_result block · `agent/subagentStart` / `End` ← `SubagentStart` / `SubagentStop` hooks · `agent/notification` ← `Notification` hook · `agent/compact` ← `SDKCompactBoundaryMessage` · `agent/turnComplete` ← `SDKResultMessage` (turn ends, session stays open) · `agent/interrupted` ← `agent/interrupt` cancels current turn · `agent/statusChanged` ← `tracker.set_status()` in runner (idle↔running) · `agent/done` ← session closed via `agent/end` · `agent/error` / `permissionDenied` ← `SDKResultMessage` error subtypes
>
> **Subagent event correlation:** The SDK provides `parent_tool_use_id` on `AssistantMessage` and `UserMessage` to identify which `Agent` tool call produced each message. The runner builds a `tool_use_id → agent_id` mapping from `SubagentStart` hooks, then resolves `parent_tool_use_id` to `agentId` on outgoing `textDelta`, `toolCallStart`, and `toolCallEnd` notifications. This enables deterministic event grouping on the frontend.

> **Streaming text:** Requires `includePartialMessages: true` in SDK options to receive `agent/textDelta` with `streaming: true`. Without it, full text blocks are emitted per turn.

### Server → Client (requests)

The server suspends an `asyncio.Future` keyed by `requestId` until the client responds. If no response arrives within a timeout, the server auto-denies and continues.

| Method | Params | Expected Response | Description |
| --- | --- | --- | --- |
| `agent/askUserQuestion` | `{ thinkrailSid, requestId, questions: Question[] }` | [`AskUserQuestionResponse`](../agent/README.md#interactive-requestresponse-models) | Ask the user a question during an agent run |
| `agent/confirmAction` | `{ thinkrailSid, requestId, toolName, toolInput }` | [`ToolApprovalResponse`](../agent/README.md#interactive-requestresponse-models) | Request approval for a tool action. When `toolName === "ExitPlanMode"`, `toolInput` is enriched with `planContent: string` (accumulated assistant text). See [ExitPlanMode enrichment](../agent/README.md#exitplanmode-plan-content-enrichment). |
| `agent/suggestSession` | `{ thinkrailSid, requestId, skill, specIds, name, reason }` | [`ToolApprovalResponse`](../agent/README.md#interactive-requestresponse-models) | Suggest a follow-up session to the developer. Approve creates a new session with the suggested skill/specs; dismiss returns `PermissionResultAllow` with `dismissed: true` so the agent continues. |

All methods originate from the SDK's `canUseTool` callback. `runner.py` distinguishes them by `tool_name`: `"AskUserQuestion"` → `agent/askUserQuestion`, `"SuggestSession"` → `agent/suggestSession`, `"ExitPlanMode"` → `agent/confirmAction` (enriched with `planContent`), any other tool → `agent/confirmAction`. See [Agent Module — Interactive Request/Response Models](../agent/README.md#interactive-requestresponse-models) for `Question`, `QuestionOption`, `AskUserQuestionResponse`, and `ToolApprovalResponse` type definitions. See [SuggestSession Backend Spec](../agent/tools/SUGGEST_SESSION.md) for the suggestion wire format.

## Error Codes

Domain exceptions raised inside handlers are mapped to JSON-RPC error responses:

| Exception | JSON-RPC Code | Message |
| --- | --- | --- |
| `SpecNotFoundError` | -32001 | "Spec not found" |
| `ValidationError` | -32003 | "Validation error" |
| `AgentTaskNotFoundError` | -32011 | "Agent task not found" |
| `FutureNotFoundError` | -32012 | "No pending request" |
| `IndexNotReadyError` | -32015 | "Index is still initializing" |
| `UnknownRuntimeError` | -32031 | "Unknown runtime" — raised by `RuntimeRegistry.get(name)` and surfaced by `agent/run`, `skills/listRuntime`, `runtimes/capabilities` etc. when the requested runtime is not registered |
| `InvalidCapabilityValueError` | -32032 | "Invalid capability value" — a `model` / `permissionMode` / `effort` outside the runtime's capabilities at a launch path (`agent/run`/`start_draft`, `run_task`, `continue_session`) or `agent/updateConfig`. `data: { field, value, runtimeType, allowed }`. |
| `KeyError` / missing params | -32602 | "Invalid params" |
| Any other exception | -32603 | "Internal error" |

Standard errors (-32700 parse error, -32601 method not found) are handled automatically by jsonrpcserver.

## Internal Architecture

**Pattern:** Four-layer — WebSocket transport + dispatch in `server.py`, EventBus pub/sub in `bus.py`,
domain-organized handlers in `methods/`, per-connection notify factory in `notifications.py`.

```mermaid
---
title: RPC Module — Internal Architecture (Multi-Client)
---
graph TD
    ClientA["Client A<br/>(Browser Tab)"]
    ClientB["Client B<br/>(Browser / Mobile)"]

    ClientA --> Server
    ClientB --> Server

    subgraph RPCModule["RPC Module"]
        Server["server.py<br/><i>FastAPI + jsonrpcserver</i><br/>connection registration,<br/>per-project watcher"]
        Bus["bus.py<br/><i>EventBus</i><br/>pub/sub, ring buffers,<br/>replay, dead-conn sweep"]
        Conns["connections.py<br/><i>ClientConnection</i><br/>conn_id, user_id, subscriptions"]
        subgraph Methods["Methods"]
          direction LR
          Specs["methods/specs.py"]
          Agents["methods/agents.py"]
          Sessions["methods/sessions.py"]
          Vis["methods/vis.py"]
          Agents ~~~ Specs ~~~ Sessions ~~~ Vis
        end
        Server -- "register / unregister" --> Bus
        Server -- "creates" --> Conns
        Methods -- "publish events" --> Bus
        Bus -- "delivers to" --> Conns
    end

    SpecSvc["spec/service<br/>Spec CRUD"]
    AgentSvc["agent/service<br/>Agent task management"]
    VisSvc["vis/service<br/>Dashboard state"]
    TrashSvc["trash/service<br/>Soft-delete operations"]

    Specs ---> SpecSvc
    Agents ---> AgentSvc
    Sessions ---> AgentSvc
    Vis ---> VisSvc
```

```mermaid
---
title: "Watcher path (per-project, reference-counted)"
---
graph TD
    Connect["WebSocket connect<br/>/ws?project=path"]
    Validate["Validate project path<br/>+ .tr/ structure"]
    Acquire["_acquire_watcher — ref count++"]
    Watch["core/watcher.watch(project_root, _on_file_change)"]
    Change["File change on disk"]
    Callback["_on_file_change callback"]
    BusPub["bus.publish(project:path, ...)"]
    Release["Disconnect → _release_watcher — ref count--"]
    Stop["ref count == 0 → stop(watcher)"]

    Connect --> Validate --> Acquire --> Watch
    Change --> Callback --> BusPub
    Watch -.- Release
    Release -.- Stop
```

## File Organization & Public Interface

### server.py

**Responsibility:** WebSocket endpoint with per-connection project selection, connection management, JSON-RPC dispatch loop, per-connection watcher lifecycle.

**Dependencies:** jsonrpcserver, methods/specs, methods/agents, methods/vis, methods/trash, notifications, core/watcher, core/config, spec/service, vis/service, trash/service

| Export | Signature | Description |
| --- | --- | --- |
| `register_routes` | `(app: FastAPI) → None` | Register the `/ws` WebSocket endpoint on the FastAPI app. Called by `main.py` during setup. No config needed — config is built per-connection from the `project` query parameter. |

`METHODS` is a mapping from JSON-RPC method names to handler coroutines, assembled in `server.py` from the functions in `methods/specs.py`, `methods/agents.py`, and `methods/vis.py`.

`_start_watcher` is a private helper that starts a filesystem watcher scoped to the connection's project directory. Called inside `ws_endpoint` after project validation; stopped on disconnect.

### bus.py

**Responsibility:** EventBus — central pub/sub for multi-client notification routing. All server→client notifications flow through the bus.

**Dependencies:** connections.py

| Export | Type / Signature | Description |
| --- | --- | --- |
| `bus` | `EventBus` | Module-level singleton instance. Import and use directly. |
| `EventBus` | class | Pub/sub with per-topic ring buffers, replay, and dead-connection sweep. |
| `Event` | dataclass | A single published event (topic, method, params, request_id, timestamp). |

**Topics:**
- `project:{path}` — file changes, spec updates, vis state, board changes
- `session:{thinkrail_sid}` — agent session events, interactive requests

**Key methods:**
- `register(conn)` / `unregister(conn_id)` — connection lifecycle
- `subscribe(conn_id, topic)` / `unsubscribe(conn_id, topic)` — subscription management
- `publish(topic, method, params, request_id=None)` — fan-out to subscribers
- `publish_to_project(path, method, params)` / `publish_to_session(sid, method, params)` — convenience
- `replay(conn_id, topic, since)` — replay buffered events on reconnect
- `cleanup_topic(topic)` — remove topic buffer and subscriptions (e.g. session ended)
- `start_sweep()` / `_sweep_dead()` — periodic removal of zombie connections

### connections.py

**Responsibility:** `ClientConnection` dataclass and `current_conn_id` context variable for identifying the calling connection in RPC handlers.

**Dependencies:** notifications.py

| Export | Type / Signature | Description |
| --- | --- | --- |
| `ClientConnection` | dataclass | Tracks conn_id, user_id, display_name, ws, project_path, subscriptions. In single-user mode `user_id` is fixed to `"local"` and `display_name` to `"Local"` — kept on the dataclass to give multi-tab `connection/didJoin` / `didLeave` events stable identifiers. |
| `current_conn_id` | `ContextVar[str]` | Set by dispatch loop so RPC handlers know which connection is calling. |

### notifications.py

**Responsibility:** `make_notify` factory — creates per-connection notify callables used by the EventBus internally. The module-level `current_notify` singleton has been removed in favour of the EventBus pub/sub model.

**Dependencies:** none

| Export | Type / Signature | Description |
| --- | --- | --- |
| `make_notify` | `(websocket: WebSocket) → NotifyCallable` | Create a notify callable bound to the given WebSocket. |

**`NotifyCallable`** type alias:
```python
NotifyCallable = Callable[[str, dict, str | None], Awaitable[None]]
```

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

`run_agent` calls `agent/service.run_task` (no `notify` parameter — the runner publishes via EventBus). Auto-subscribes all project connections to the new session topic. Returns `{ thinkrailSid }` immediately. The `sessionId` arrives later via `agent/sessionStart` notification.

`send_message` routes to `agent/service.send_message(thinkrail_sid, text)`, which enqueues the message. Also publishes `session/userMessage` to the bus so other clients see the message in their chat stream.

`end_session` routes to `agent/service.end_session(thinkrail_sid)`, which sends a sentinel to the runner's message queue, causing it to close the SDK client and emit `agent/done`.

`respond_agent` routes to `agent/service.respond(thinkrail_sid, request_id, response)`, which resolves the pending `asyncio.Future` in `tracker.py`. Also publishes `agent/requestResolved` so other clients dismiss the pending approval card.

### methods/trash.py

**Responsibility:** jsonrpcserver handlers for all `trash/*` methods.

**Dependencies:** trash/service

| Export | Signature | Description |
| --- | --- | --- |
| `list_trashed` | `(service, **params) → list[dict]` | Handler for `trash/list` |
| `purge_trashed` | `(service, **params) → None` | Handler for `trash/purge` |
| `empty_trash` | `(service, **params) → None` | Handler for `trash/empty` |
| `restore_spec` | `(service, **params) → dict` | Handler for `trash/restoreSpec` — returns `{ registryEntry, links }` |
| `restore_plan` | `(service, **params) → None` | Handler for `trash/restorePlan` |
| `restore_draft` | `(service, **params) → dict` | Handler for `trash/restoreDraft` — returns `{ manifestEntry }` |
| `restore_patches` | `(service, **params) → None` | Handler for `trash/restorePatches` |

### methods/vis.py

**Responsibility:** jsonrpcserver handlers for all `vis/*` methods.

**Dependencies:** vis/service

| Export | Signature | Description |
| --- | --- | --- |
| `get_vis_state` | `(service, **params) → DashboardState` | Handler for `vis/state` — returns current state without recomputing |
| `recompute_vis` | `(service, **params) → DashboardState` | Handler for `vis/recompute` — forces recompute and returns new state |

### methods/board.py

**Responsibility:** jsonrpcserver handlers for all `board/*` methods (meta-tickets, plans, drafts, patches).

**Dependencies:** board/service

### methods/sessions.py

**Responsibility:** jsonrpcserver handlers for `session/*` methods (list, get, continue, delete, subscribe, unsubscribe).

**Dependencies:** agent/service, agent/persistence

### methods/settings.py

**Responsibility:** jsonrpcserver handlers for `settings/*`, `appSettings/*`, `runtimes/*`, and `skills/*` methods.

**Dependencies:** core/settings (project-scoped), core/session_defaults (user-scoped, AppStore-backed), core/app_store (the SQLite handle that backs `appSettings/*`), agent/runtime (RuntimeRegistry — owns the per-runtime `capabilities()` projection). `runtimes/capabilities` validates its params via a `RuntimesCapabilitiesRequest` Pydantic model.

### methods/subsessions.py

**Responsibility:** jsonrpcserver handlers for subsession (child agent session) management.

**Dependencies:** agent/service

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

- **Multiple simultaneous WebSocket connections** — web browsers, mobile apps, multiple tabs
- WebSocket URL: `/ws?project=<path>[&last_seen=<timestamp>]`
- On connect:
  1. Validate `project` param exists (close with 4001 if missing)
  2. Call `ensure_project(project_path)` to auto-create missing `.tr/` meta-files and subdirectories (close with 4002 on filesystem error)
  3. Accept WebSocket connection (immediate — within frontend's 5s `connectTimeout`)
  4. Build per-connection `AppConfig`, `SpecService`. Reuse or create per-project `SpecIndex` (guarded by per-project `asyncio.Lock`).
  5. If index is new: start background `asyncio.Task` for `index.initialize()` → emit `index/ready` notification when complete.
  6. Create `ClientConnection` with unique `conn_id`, register with EventBus
  7. Publish `connection/didJoin` to existing project clients
  8. Subscribe to project topic + all active session topics
  9. Replay missed events if `last_seen` query param provided
  10. Start or ref-count per-project file watcher (watcher callback guards `reindex_file()` with `index.is_ready` check to prevent race with background rebuild)
  11. Begin JSON-RPC dispatch loop (sets `current_conn_id` context var per request)
- On disconnect: publish `connection/didLeave`, unregister from EventBus (cleans up all subscriptions), release watcher ref count

## Watcher Integration

The file watcher is **per-project, reference-counted**. It starts when the first client connects to a project and stops when the last client disconnects.

1. `_acquire_watcher(project_key, ...)` increments the ref count (or starts the watcher on first connection).
2. `_start_watcher()` calls `core/watcher.watch([project_root], _on_file_change)`.
3. On file change, `_on_file_change(changes)` publishes events to the **project topic** via `bus.publish`:
   - Spec files (`.md`) → `spec/didChange`, `spec/didCreate`, or `spec/didDelete` (frontmatter parsed, index updated); unmanaged documents → `docs/didChange`
   - `.thinkrailhide` modified → `files/treeChanged` + background index rebuild with fresh patterns → `index/ready` when complete

   **Guard:** `reindex_file()` is only called when `index.is_ready` is `True`. During background initialization, spec-related reindexing is skipped (the full rebuild catches all files). Non-spec events (`files/treeChanged`, `file/didChange`) fire normally.

   When `.thinkrailhide` is modified, the watcher reloads patterns from disk and launches a background `_rebuild_on_thinkrailhide()` task that calls `index.rebuild()` with the new patterns, then emits `index/ready`. During rebuild, `is_ready` is `False`, preventing concurrent `reindex_file()` calls.

   - Any modified file → `file/didChange` with relative path
4. `_release_watcher(project_key)` decrements the ref count. When it reaches 0, the watcher is stopped.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| JSON-RPC library | `jsonrpcserver` | Handles parse errors, method-not-found, and response formatting automatically; eliminates boilerplate in handlers |
| EventBus pub/sub | Module-level singleton (`bus.py`) | All notifications flow through one bus. Services publish; bus routes to subscribers. Future-proof for adding push notifications, webhooks. |
| Topic hierarchy | `project:{path}` + `session:{sid}` | Project-level events (files, specs) broadcast to all. Session events go to subscribers. Simple two-level model. |
| Ring buffer replay | `deque(maxlen=200)` per topic | Handles reconnect gaps. Bounded memory. Events also persisted to `.events.jsonl` for full history. |
| Connection identity | `current_conn_id` ContextVar | Set per-request in dispatch loop. RPC handlers access via `current_conn_id.get()` without changing signatures. |
| Watcher lifecycle | Per-project, reference-counted | First connection starts watcher, last disconnection stops it. Shared across all connections to same project. |
| Phase 1 broadcast-all | Auto-subscribe all clients to all sessions | Simplest multi-client model. Phase 3 will add per-client subscription filtering. |
| First-responder-wins | `asyncio.Future.set_result()` once-only | No additional locking for interactive requests. Second responder gets `-32013` error. |
| Methods organized by domain namespace | `methods/specs.py`, `methods/agents.py`, etc. | Each file mirrors its domain module; easy to locate handlers by method prefix |
| WebSocket accept timing | Accept before index init | Prevents frontend 5s `connectTimeout` failure on first connect or schema upgrade. Spec RPCs return empty data until `index/ready`. |
| Index init concurrency | Per-project `asyncio.Lock` on `_spec_indexes` | Prevents concurrent `rebuild()` when two connections arrive simultaneously. |
| Per-connection project selection | `?project=` query param on WebSocket URL | Allows the frontend to switch projects without restarting the backend |
| Handlers return Pydantic models | `rpc_handler`'s `serialize_result()` auto-dumps `BaseModel` / `list[BaseModel]` returns with `by_alias=True` | Handlers return domain models directly — no per-handler `model_dump`. `serialize_result()` also forwards an exception's `rpc_data` attribute as the JSON-RPC error `data`. Curated wire payload models for codegen live in `schema_export.py:RPC_PAYLOAD_MODELS` → `rpc-methods.ts`. |

## Dependencies

| Dependency | Usage |
|------------|-------|
| `fastapi` | WebSocket endpoint and app integration |
| `jsonrpcserver` | JSON-RPC 2.0 message parsing and dispatch |
| `rpc/bus` | EventBus singleton for pub/sub notification routing |
| `rpc/connections` | ClientConnection dataclass, `current_conn_id` context variable |
| `rpc/notifications` | `make_notify` factory for per-connection callables |
| `spec/service` | Spec CRUD operations; watcher postprocessing |
| `agent/service` | Agent task management (no longer takes `notify` parameter) |
| `vis/service` | Dashboard state computation and push notifications |
| `trash/service` | Soft-delete operations for all `.tr/` data types |
| `board/service` | Ticket and plan management |
| `core/watcher` | File change detection |
| `core/config` | Project root path for watcher |

## Known Limitations

- **No authentication:** ThinkRail is single-user and localhost-only. The WebSocket handshake accepts a `?project=<path>` query without any token check. There is no concept of users, tokens, or admin roles. (See [Storage Architecture](../../../.tr/design_docs/STORAGE_ARCHITECTURE.md) for the rationale.)
- **Broadcast-all for sessions:** All connections receive all session events for the project. Per-client session filtering is available via `session/subscribe` and `session/unsubscribe`.
- **Ring buffer capacity:** Replay buffer holds 200 events per topic. Events older than that are lost from the buffer (still persisted to `.events.jsonl` on disk).
- **Pending agent futures on disconnect:** If all clients disconnect mid-agent-run, agent events are published to the bus with no subscribers (silently dropped). Events are still persisted to disk. Pending `asyncio.Future` objects in `tracker.py` will time out per the configured deadline.

## Related Specs

- **Parent:** [Architecture Design](../../../DESIGN_DOC.md)
- **Depends on:** [Spec Module](../spec/README.md), [Agent Module](../agent/README.md), [Core Module](../core/README.md)
- **Related files:** `main.py` — FastAPI entry point; calls `register_routes(app)`
