---
id: module-agent
type: module-design
status: active
title: Agent Module Design
parent: design-doc
depends-on:
- module-core
- module-spec
covers:
- backend/app/agent/
tags:
- backend
- agent-orchestration
---
# Agent Module — Design Specification

> Parent: [DESIGN_DOC.md](../../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-02-25 | Updated: 2026-03-16

## Table of Contents
1. [Purpose](#purpose)
2. [Session Lifecycle](#session-lifecycle)
3. [Session Continuation (Resume)](#session-continuation-resume)
4. [Internal Architecture](#internal-architecture)
5. [File Organization](#file-organization)
6. [Public Interface](#public-interface)
7. [Context Assembly](#context-assembly)
8. [Plugin Wiring](#plugin-wiring)
9. [TODO](#todo)
10. [Design Decisions](#design-decisions)
11. [Dependencies](#dependencies)
12. [Known Limitations](#known-limitations)
13. [Related Specs](#related-specs)

## Purpose

The Agent module orchestrates persistent conversational AI agent sessions. It manages the full lifecycle — creating SDK clients, multi-turn messaging, streaming events, mid-turn interactions (questions, tool approvals), interruption, and **session continuation via the SDK's native resume** (`--resume <sessionId>`) which preserves full conversation context without lossy text replay.

Sessions are modeled after the Claude Code chat experience: the user starts a session with spec context, sends messages, receives streaming responses, and can continue the conversation across multiple turns until they explicitly end the session.

## Session Lifecycle

### States

```mermaid
stateDiagram-v2
    [*] --> initializing : agent/run

    initializing --> idle : SDK client ready
    initializing --> done : agent/end
    initializing --> error : SDK init error

    idle --> running : agent/send
    idle --> done : agent/end

    running --> idle : turn completes
    running --> waiting : mid-turn interaction
    running --> idle : agent/interrupt
    running --> done : agent/end
    running --> error : SDK error

    waiting --> running : user responds
    waiting --> idle : agent/interrupt
    waiting --> done : agent/end
```

| State | Description |
|-------|-------------|
| `initializing` | Session created, SDK client being set up. Messages sent during this phase are queued and processed once `idle` is reached. |
| `idle` | Session open, SDK client ready, waiting for user message |
| `running` | SDK turn in progress (processing user message) |
| `waiting` | Suspended on a mid-turn interaction (question or tool approval) — runner awaits a Future indefinitely. The backend tracker transitions to `waiting` via `permissions._await_user_response()` and back to `running` when the future resolves on the user's reply. The frontend also sets `waiting` locally via `onAskQuestion`/`onConfirmAction`. |
| `done` | Session ended gracefully |
| `error` | Session ended due to error |

**Status notifications:** The runner emits `agent/statusChanged` on every `idle→running` and `running→idle` transition. This is the frontend's authoritative signal for status changes after the first turn (since `agent/sessionStart` only fires once per runner lifetime). The `idle` statusChanged is redundant with `agent/turnComplete`/`agent/interrupted` but makes state synchronization explicit.

### Lifecycle Sequence

```mermaid
sequenceDiagram
    participant F as Frontend
    participant B as Backend (runtime/claude/runtime.py)
    participant S as Claude SDK

    F->>B: agent/run {specIds, config}
    B-->>F: {bonsaiSid}
    Note over B: state: initializing
    B->>S: create SDK client (async)
    Note over B: state: idle (SDK client ready)

    rect rgb(40, 40, 60)
        Note over F,S: Conversation loop (repeats)

        F->>B: agent/send {bonsaiSid, text}
        B->>S: query(text)
        Note over B: state: running
        B-->>F: agent/statusChanged {status: running}
        S-->>B: streaming
        B-->>F: agent/textDelta
        S-->>B: ToolUseBlock
        B-->>F: agent/toolCallStart
        S-->>B: ToolResultBlock
        B-->>F: agent/toolCallEnd

        opt Mid-turn interactions (canUseTool)
            B->>F: agent/askUserQuestion
            Note over B: suspends on Future
            F->>B: agent/respond
            Note over B: Future resolved
            B->>F: agent/confirmAction
            Note over B: suspends on Future
            F->>B: agent/respond
            Note over B: Future resolved
        end

        S-->>B: ResultMessage
        B-->>F: agent/turnComplete
        B-->>F: agent/statusChanged {status: idle}
        Note over B: state: idle
    end

    F->>B: agent/end {bonsaiSid}
    B->>S: close SDK client
    B-->>F: agent/done
    Note over B: state: done
```

### Interrupt Flow

`agent/interrupt` cancels the current turn but keeps the session alive. The SDK client is **not destroyed** — `service.py` calls `client.interrupt()` which sends a control protocol message to the CLI subprocess, gracefully stopping the current generation while preserving full conversation context.

**Two states require different mechanisms:**

| Current state | What's blocked | Interrupt mechanism |
|---------------|----------------|---------------------|
| `running` | `client.receive_response()` streaming | `await client.interrupt()` → SDK sends `{"subtype": "interrupt"}` control request to CLI |
| `waiting` | `await future` in `can_use_tool` callback | `tracker.interrupt_futures()` resolves futures with `{"behavior": "deny", "interrupt": true}` → SDK stops turn |

```mermaid
sequenceDiagram
    participant F as Frontend
    participant Svc as service.py
    participant R as runtime/claude/runtime.py
    participant SDK as SDK Client
    participant CLI as Claude CLI

    Note over R: state: running

    F->>Svc: agent/interrupt {bonsaiSid}
    Svc->>Svc: tracker.interrupt_futures(bonsaiSid)
    Svc->>SDK: client.interrupt()
    SDK->>CLI: control_request {subtype: interrupt}
    CLI-->>SDK: control_response {subtype: success}
    SDK-->>R: ResultMessage (turn ended)

    R->>R: check tracker.is_interrupted()
    R-->>F: agent/interrupted
    R->>R: tracker.clear_interrupted()
    R->>R: tracker.set_status(idle)
    R-->>F: agent/statusChanged {status: idle}
    Note over R: state: idle

    Note over F: user can send another message
    F->>Svc: agent/send {bonsaiSid, text}
    R->>R: tracker.set_status(running)
    R-->>F: agent/statusChanged {status: running}
    Note over R: same client, same context, state: running
```

**Key:** The runner stays alive in its conversation loop — no re-launch, no new client, no context rebuilt. After the interrupted `ResultMessage` is processed, the runner goes back to `await tracker.get_next_message()`, waiting for the next user message on the same SDK client.

## Session Continuation (Resume)

### Overview

When a session ends (done/error) or the backend restarts, the frontend can resume it via `session/continue`. This uses the Claude Code SDK's **native `--resume <sessionId>`** flag, which restores the full conversation context (all messages, tool calls, and results) without lossy reconstruction.

### Resume Flow

```mermaid
sequenceDiagram
    participant F as Frontend
    participant Svc as service.py
    participant R as runtime/claude/runtime.py
    participant SDK as Claude SDK (CLI)
    participant Disk as .bonsai/sessions/

    F->>Svc: session/continue {bonsaiSid}
    Svc->>Disk: load_session(bonsaiSid)
    Disk-->>Svc: metadata (incl. sessionId)

    Note over Svc: Validate: sessionId must exist

    Svc->>Svc: create AgentTask (same bonsai_sid)
    Svc->>Svc: build spec_context (fresh)
    Svc->>R: run(task, spec_context, ...,<br/>resume_session_id=old_sessionId)

    Note over R: state: initializing
    R->>SDK: ClaudeSDKClient(<br/>  resume=old_sessionId,<br/>  system_prompt=spec_context)
    SDK->>SDK: CLI restores full conversation<br/>from ~/.claude/ session store
    SDK-->>R: SystemMessage(init) — new session_id

    R-->>F: agent/sessionStart
    Note over R: state: idle (SDK client ready)
```

### Key Design Points

| Aspect | Design |
|--------|--------|
| **Session identity** | Same `bonsai_sid` is reused. The CLI may assign a new internal `session_id`. |
| **Context restoration** | Full conversation history restored natively by CLI — no text replay, no truncation. |
| **System prompt** | Fresh spec context is built from current specs/skills (passed via `system_prompt`). |
| **Event persistence** | New events from the resumed session append to the same `.events.jsonl` file. |
| **Metadata update** | Metadata `.json` is updated with new status and `sessionId`. |
| **Missing sessionId** | If the stored session has no `sessionId` (pre-resume era), `continue_session` raises a `ValueError`. |

### What Changed (vs. Previous Design)

| Before (text replay) | After (native resume) |
|-----------------------|-----------------------|
| Iterated over saved events, built truncated text summary | Passes `sessionId` to SDK `--resume` flag |
| Tool outputs truncated to 500 chars | Full tool outputs preserved by CLI |
| History injected as part of system prompt (extra input tokens) | CLI manages context window internally |
| New SDK session with no real history | CLI restores actual conversation state |
| Complex `context_parts` / `history_context` code | Simple: `resume_session_id=old_session_id` |

## Internal Architecture

**Pattern:** Service facade over collaborators — `context.py` (prompt assembly), `runtime/claude/runtime.py` (SDK loop, behind the `IAgentRuntime` contract), `tracker.py` (session state), `permissions.py` (tool routing), and `tools/` (self-contained MCP tools).

```mermaid
---
title: Agent Module — Internal Architecture
---
graph TD
    subgraph AgentModule["Agent Module"]
        Service["service.py<br/><i>Facade — single entry point</i>"]
        Context["context.py<br/><i>Context assembly pipeline</i>"]
        Runner["runtime/claude/runtime.py<br/><i>SDK lifecycle + conversation loop</i>"]
        Permissions["permissions.py<br/><i>Tool permission routing</i>"]
        Tracker["tracker.py<br/><i>State management + message queue</i>"]
        subgraph Tools["tools/ package"]
            ToolsInit["__init__.py<br/><i>MCP_SERVERS + INTERCEPTORS</i>"]
            Viz["visualization.py"]
            Suggest["suggest_session.py"]
            Progress["progress.py<br/><i>(future)</i>"]
        end
    end

    SDK["Claude Agent SDK<br/>(event stream)"]
    AI["External AI APIs<br/>(Claude, etc.)"]
    Futures["asyncio.Future<br/>map per requestId"]
    Queue["asyncio.Queue<br/>user messages per session"]
    PluginFS["Plugin FS<br/>(SKILL.md files)"]

    Service --> Context
    Service --> Runner
    Service --> Tracker
    Context --> PluginFS
    Runner --> Permissions
    Runner --> ToolsInit
    Permissions --> ToolsInit
    Runner --> SDK --> AI
    Tracker --> Futures
    Tracker --> Queue
```

## File Organization

| File | Responsibility | Depends On |
|------|---------------|------------|
| `models.py` | Pydantic models: AgentTask, AgentConfig, AgentEvent, AgentResult, Question, QuestionOption, AskUserQuestionResponse, ToolApprovalResponse | — |
| `context.py` | Context assembly pipeline: builds general instructions, loads skill instructions, project metadata, and spec content; composes system prompt. See [CONTEXT.md](CONTEXT.md). | models, spec/service |
| `service.py` | Facade — start sessions, send messages, interrupt turns, end sessions, continue sessions (native resume), relay responses to pending futures | context, runner, tracker, core/config, spec/service |
| `permissions.py` | Tool permission routing. `can_use_tool()` callback that routes MCP tools to auto-approve `intercept()` functions via `tools.INTERCEPTORS` (suffix match), handles AskUserQuestion interactively, and falls back to `agent/confirmAction` for unknown tools. Accepts `tool_use_id` from the runner's FIFO queue to include in `confirmAction` notifications for precise frontend matching. Shared `_await_user_response()` helper registers a Future and awaits the user's reply indefinitely — no timeout. Real MCP tool logic lives in handlers via `get_tool_context()`. | tools, tracker, models |
| `transcribe.py` | Audio transcription via OpenAI Whisper API. `transcribe(audio_base64, mime_type) -> str`. Lazy-imports `openai`; optional dependency for browsers without Web Speech API. See [TRANSCRIBE.md](TRANSCRIBE.md). | openai (optional) |
| `runtime/` | Runtime-agnostic agent contract — `IAgentRuntime` Protocol, `RuntimeRegistry`, neutral `ModelInfo` + capability constants, `RuntimeEvent`, `AgentEventHandler`, neutral permission types (`ToolPermissionRequest`/`Response`), `ToolCategory`. See [runtime/README.md](runtime/README.md). | models |
| `runtime/claude/` | Claude Agent SDK runtime — `class ClaudeRuntime` (conversational loop), `ClaudeModelRegistry` (Anthropic models fetch + cache + 3-entry fallback, lazy one-shot refresh), `credentials.py` (Anthropic API key resolution from env / macOS Keychain), `SubagentHooks` (per-session subagent / PreCompact correlation), `adapter` (event-shape builders). The only place under `runtime/` that imports `claude_agent_sdk` or `anthropic`. Owns SDK client lifecycle, MCP server wiring, per-iteration token tracking. **SDK field semantics:** `total_cost_usd` is cumulative (assign, don't accumulate); `num_turns` is per-turn (accumulate). See [runtime/claude/README.md](runtime/claude/README.md). | runtime, models, tracker, permissions, tools |
| `tracker.py` | Session lifecycle (initializing/idle/running/waiting/done/error), message queue per session (`asyncio.Queue`), registry of in-flight `asyncio.Future` objects keyed by `requestId`, **interrupt flag** per session for notification routing. Project-scoped — owned by `ProjectContext`, shared with `AgentService` and every runtime instance | models |
| `persistence.py` | Session persistence — split storage: metadata in `.json`, events in append-only `.events.jsonl`. Save/load/list/append/delete. See [PERSISTENCE.md](PERSISTENCE.md). | core/fileio |
| `pricing.py` | Per-model token pricing and cost estimation. Tier-based (opus/sonnet/haiku). `estimate_cost()` used by runner for live cost streaming. | — |
| `tools/` | Self-contained MCP tools package. Each tool is one file: schema + handler + MCP server + `intercept()`. Spec tools (`spec_search`, `spec_links`, `spec_delete`) query the SQLite index and handle multi-file cleanup — agents use standard `Write`/`Edit` for spec file creation/editing. Exports `MCP_SERVERS`, `INTERCEPTORS`, and `set_tool_context()`/`get_tool_context()` (contextvars for yolo mode). See [tools/README.md](tools/README.md), [SPECS_TOOLS.md](tools/SPECS_TOOLS.md). Harness-abstraction PR 3 will replace this with a unified `BonsaiTool` registry + per-runtime adapter. | claude-agent-sdk, tracker, models |

## Public Interface

### Service Layer (called by RPC methods)

**Class:** `AgentService(config: AppConfig, spec_service: SpecService)`

| Method | Signature | Description |
|--------|-----------|-------------|
| `run_task` | `(spec_ids: list[str], config: AgentConfig, skill_id: str \| None = None, session_prompt: str \| None = None, name: str = "") -> AgentTask` | Start a persistent agent session. Builds context from specs, skill, session prompt, and project metadata via `context.build_context()`, then launches the background runner. The runner publishes events via the EventBus (`rpc/bus.py`). Task is created in `initializing` state and returned immediately. |
| `send_message` | `(bonsai_sid: str, text: str, *, is_markdown: bool = False) -> None` | Send a user message to the session, triggering a new turn. Enqueues the message; runner picks it up and calls `client.query()`. Accepted during `initializing` (queued until SDK client is ready) and `idle`. |
| `interrupt_task` | `(bonsai_sid: str) -> None` | Cancel the current turn non-destructively. Calls `tracker.interrupt_futures()` to resolve pending futures with deny+interrupt, then calls `client.interrupt()` on the stored SDK client. The runner stays alive, the client is preserved, and the session returns to `idle` — ready for new messages with full context intact. |
| `end_session` | `(bonsai_sid: str) -> None` | Gracefully close the session and SDK client. Session enters `done` state. |
| `update_config` | `(bonsai_sid: str, model: str \| None = None, permission_mode: str \| None = None, effort: str \| None = None) -> dict` | Update config on a live session. Model and permissionMode go through the SDK client directly today; effort is stored on `task.config` and takes effect on the next turn. Harness-abstraction PR 2 will route these through `IAgentRuntime.update_running_session` instead of touching the SDK client from the service layer. |
| `get_task` | `(bonsai_sid: str) -> AgentTask` | Get current session status and metadata |
| `list_tasks` | `() -> list[AgentTask]` | List all sessions (initializing, idle, running, waiting, done, error) |
| `respond` | `(bonsai_sid: str, request_id: str, response: dict) -> None` | Resolve a pending `asyncio.Future` with the client's answer (for mid-turn interactions) |
| `list_all_sessions` | `() -> list[dict]` | List all sessions: in-memory active + on-disk archived (metadata only) |
| `get_session_data` | `(bonsai_sid: str) -> dict \| None` | Get full session data including events from disk |
| `continue_session` | `async (bonsai_sid: str) -> AgentTask` | **Resume a session using SDK native `--resume`.** Loads stored `sessionId` from disk, validates it exists, builds fresh spec context, then launches `_run_background` with `resume_session_id=old_session_id`. Runner publishes via EventBus. Raises `ValueError` if session not found or has no stored `sessionId`. |
| `restart_session` | `async (bonsai_sid: str) -> AgentTask` | End current session and resume with current (updated) config. |
| `trash_session` | `(bonsai_sid: str) -> None` | Soft-delete: detach from all tickets via `BoardService.detach_session_from_all`, move files to `.bonsai/trash/` via `TrashService`, clean up in-memory tracker state. Falls back to hard-delete if no TrashService is available. |

> **Multi-client note (2026-04-12):** The `notify: Callable` parameter and `rebind_notify()` method have been removed. The runtime now publishes events via the EventBus singleton (`rpc/bus.py`), which routes to all subscribed WebSocket connections. This eliminates the need to pass or rebind callbacks on reconnect.

> **Runtime abstraction (2026-05-13, harness-abstraction PR 1):** `AgentService._get_runtime(task)` is a one-line `runtime_registry.get(task.config.runtime)` lookup. `AgentConfig.runtime` (defaults to `"claude"`) selects the runtime per session. The runtime is constructed once per `ProjectContext` with all dependencies wired in (tracker, spec service, coordinator, app config). `_get_context_max(task)` delegates to `runtime.get_context_window(task.config.model)` — services no longer carry model→window tables. See [runtime/README.md](runtime/README.md) and `.bonsai/design_docs/MULTI_RUNTIME_DESIGN.md`.

### Runtime Abstraction

The agent module no longer hardcodes the Claude SDK. `IAgentRuntime` (defined in [`runtime/types.py`](runtime/types.py)) is the contract every backend implements:

```python
class IAgentRuntime(Protocol):
    runtime_type: RuntimeType        # "claude" | "codex"
    display_name: str
    def list_models(self) -> list[ModelInfo]: ...
    def get_context_window(self, model_id: str) -> int: ...
    async def run_session(task, exec_config, handler) -> AgentResult: ...
    async def interrupt(task, tracker) -> None: ...
```

`AgentService._run_background()` builds a `RuntimeExecutionConfig` from `task.config` + `cwd` + `system_prompt` + `resume_session_id`, wraps `_persisting_notify` with `make_handler_from_notify(notify)`, and dispatches via the registry:

```python
runtime = self._get_runtime(task)  # registry lookup keyed on task.config.runtime
await runtime.run_session(task, exec_config, handler)
```

| Type | Defined in | Role |
|------|-----------|------|
| `IAgentRuntime` | `runtime/types.py` | Runtime contract Protocol |
| `RuntimeRegistry` | `runtime/registry.py` | Lookup table from `RuntimeType` to live runtime instance. Constructed once in `ProjectContext`; `AgentService` consumes via `runtime_registry.get(...)` |
| `ModelInfo` | `runtime/types.py` | Neutral frozen Pydantic — `id, label, group, context_window, max_output, pricing_tier` |
| `DEFAULT_CONTEXT_WINDOW` | `runtime/types.py` | Neutral context-window floor (200K) for unknown model ids |
| `RuntimeExecutionConfig` | `runtime/types.py` | Per-session execution config (working_directory, model, system_prompt, resume_session_id, effort, max_turns, permission_mode, stream_text) — `model` is required, no Claude-specific defaults |
| `RuntimeEvent` | `runtime/events.py` | `(method, params, request_id?)` envelope — distinct from the persisted `AgentEvent` discriminated union in `models.py` |
| `AgentEventHandler` | `runtime/events.py` | Protocol for the runtime → service callback surface |
| `make_handler_from_notify` | `runtime/events.py` | Adapter from `_persisting_notify` to `AgentEventHandler` |
| `ToolPermissionRequest` / `ToolPermissionResponse` | `runtime/permissions.py` | Runtime-neutral permission types — `permissions.can_use_tool` operates on these |
| `UnknownRuntimeError` / `DuplicateRuntimeError` | `runtime/registry.py` | Domain exceptions; RPC translates `UnknownRuntimeError` → `UNKNOWN_RUNTIME (-32031)` |

For the cross-cutting design see [`.bonsai/design_docs/MULTI_RUNTIME_DESIGN.md`](../../../.bonsai/design_docs/MULTI_RUNTIME_DESIGN.md). The Claude implementation is documented at [`runtime/claude/README.md`](runtime/claude/README.md).

### Models

All models with multi-word fields use a `camelCase` alias generator (`to_camel` in `models.py`). Python code uses `snake_case` field names; JSON wire format uses `camelCase` via `model_dump(by_alias=True)`.

#### Core Models

| Model | Fields (Python / JSON wire) | Description |
|-------|--------|-------------|
| `AgentTask` | bonsai_sid/`bonsaiSid`, name, status, spec_ids/`specIds`, skill_id/`skillId`?, session_prompt/`sessionPrompt`?, config, session_id/`sessionId`?, created, updated | Session record. `status` is one of: `initializing`, `idle`, `running`, `waiting`, `done`, `error`. `skill_id` references the selected skill (if any). `session_prompt` holds custom instructions passed via `agent/run` or `SuggestSession`. |
| `AgentConfig` | runtime, model, max_turns/`maxTurns`, permission_mode/`permissionMode`, stream_text/`streamText`, effort | Run configuration. `runtime: RuntimeType` (defaults to `"claude"`) selects which `IAgentRuntime` handles the session. `effort` is `str \| None` — null for auto, or `"low"`/`"medium"`/`"high"`/`"max"`. `extra="ignore"` so persisted session files that still carry the removed `betas` field round-trip cleanly. |
| `AgentEvent` | bonsai_sid/`bonsaiSid`, session_id/`sessionId`, event_type/`eventType`, payload | Serializable event to send as notification |
| `AgentResult` | bonsai_sid/`bonsaiSid`, session_id/`sessionId`, result, cost_usd/`costUsd`, turns, duration_ms/`durationMs`, usage | Turn result (sent with `turnComplete`) or final session result (sent with `done`) |
| `MessageTooLargeError` | message, msg_tokens, remaining_tokens | Exception raised by `send_message()` when a user message would consume >80% of remaining context. Mapped to JSON-RPC error code `-32014`. |

#### Tracker State

The `Tracker` class manages session lifecycle and ancillary per-session state:

| Field | Type | Description |
|-------|------|-------------|
| `_last_messages` | `dict[str, str]` | Last user message per session (for retry after `context_overflow`) |
| `_context_tokens` | `dict[str, int]` | Latest context token count per session (updated from `agent/costEstimate` events) |

Both are cleaned up by `remove_task()`.

#### Interactive Request/Response Models

These types define the data exchanged during mid-turn interactions. Both `AskUserQuestion` and tool approvals flow through the SDK's `canUseTool` callback — `permissions.claude_can_use_tool_adapter` translates them into JSON-RPC requests/responses for the frontend.

**Question types** (sent to frontend in `agent/askUserQuestion` params):

| Model | Fields | Description |
|-------|--------|-------------|
| `Question` | question: str, header: str, options: list[QuestionOption], multi_select/`multiSelect`: bool | A single question with selectable options. 1-4 questions per request, 2-4 options per question. |
| `QuestionOption` | label: str, description: str | A selectable option within a question |

**Response types** (received from frontend via `agent/respond`):

| Model | Fields | Description |
|-------|--------|-------------|
| `AskUserQuestionResponse` | questions: list[Question], answers: dict[str, str] | Response to a question request. `questions` passes through the original questions. `answers` maps question text -> selected label. Multi-select joins labels with `", "`. Free-text "Other" input uses the user's text directly. |
| `ToolApprovalResponse` | behavior: `"allow"` \| `"deny"`, message?: str, interrupt?: bool | Response to a tool approval request. `message` is the denial reason. `interrupt=true` aborts the entire task. |

**SDK mapping:**

The SDK uses a single `canUseTool` callback for both questions and tool approvals. `permissions.can_use_tool` distinguishes them by `tool_name`:

| `tool_name` in `canUseTool` | Bonsai protocol method | Frontend response -> SDK return |
|------------------------------|------------------------|-------------------------------|
| `"AskUserQuestion"` | `agent/askUserQuestion` | `AskUserQuestionResponse` -> `PermissionResultAllow(updated_input={"questions": [...], "answers": {...}})` |
| `"SuggestSession"` | — (auto-approved by interceptor) | `PermissionResultAllow(behavior="allow")`. Interactive flow (card, Future, await) runs inside the tool handler via `get_tool_context()` — not in `canUseTool`. See [SuggestSession Backend Spec](tools/SUGGEST_SESSION.md). |
| Any other tool | `agent/confirmAction` | `ToolApprovalResponse` -> `PermissionResultAllow()` or `PermissionResultDeny(message=..., interrupt=...)` |

### Event Types (AgentEvent.event_type)

These map 1-to-1 to the `agent/*` notification methods in the protocol:

| event_type | Triggered by | Protocol method | Status |
|------------|-------------|-----------------|--------|
| `ready` | SDK client initialized, session is idle | `agent/ready` | Implemented |
| `session_start` | `SDKSystemMessage` subtype `init` | `agent/sessionStart` | Implemented |
| `text_delta` | `SDKAssistantMessage` text block / `SDKPartialAssistantMessage` text_delta | `agent/textDelta` | Partial — full blocks only; streaming partial messages TODO. Includes `agentId` when from a subagent. |
| `tool_call_start` | `SDKAssistantMessage` tool_use block | `agent/toolCallStart` | Implemented. Includes `agentId` when from a subagent. |
| `tool_call_end` | `SDKUserMessage` tool_result block | `agent/toolCallEnd` | Implemented. Includes `agentId` when from a subagent. |
| `turn_complete` | `SDKResultMessage` (non-terminal, session stays open) | `agent/turnComplete` | Implemented |
| `interrupted` | `agent/interrupt` cancels current turn | `agent/interrupted` | Implemented |
| `subagent_start` | `SubagentStart` hook | `agent/subagentStart` | Implemented. Runner correlates `Agent` tool calls (via `ToolUseBlock.id`) with `SubagentStart` hooks to build a `tool_use_id → agent_id` mapping, which resolves `parent_tool_use_id` on subsequent SDK messages into `agentId` on outgoing notifications. The SDK also emits `TaskStartedMessage` system messages with `tool_use_id` as a secondary correlation mechanism. |
| `subagent_end` | `SubagentStop` hook — also emitted synthetically for orphaned subagents before `agent/interrupted` | `agent/subagentEnd` | Implemented |
| `notification` | `Notification` hook | `agent/notification` | TODO |
| `compact` | `PreCompact` hook | `agent/compact` | Implemented — `PreCompact` hook captures `trigger` and `preTokens` (context size before compaction). Frontend renders via `CompactMarker.tsx`. |
| `progress` | Internal milestones | `agent/progress` | TODO |
| `done` | Session closed (via `agent/end` or session-level termination) | `agent/done` | Implemented |
| `error` | `SDKResultMessage` error subtypes / unhandled exception | `agent/error` | Implemented — classifies "Prompt is too long" errors as `subtype: "context_overflow"` (recoverable, session stays idle). Other errors use `subtype: "turn_error"`. |
| `permission_denied` | `SDKResultMessage.permission_denials` | `agent/permissionDenied` | TODO |
| `status_changed` | `tracker.set_status()` in runner — emitted on `idle→running` and `running→idle` transitions | `agent/statusChanged` | Implemented. Payload: `{bonsaiSid, status}`. Frontend uses this as the authoritative status signal for non-first turns (since `agent/sessionStart` only fires once per runner). |

### Interactive Request/Response Flow

For mid-turn interactions where the agent needs user input, `runtime/claude/runtime.py` suspends the SDK generator and the frontend must respond via `agent/respond`:

| Trigger | Server sends | Client responds with |
|---------|-------------|----------------------|
| `canUseTool` fires with `tool_name="AskUserQuestion"` | `agent/askUserQuestion` (JSON-RPC request with `id`); params: `{ bonsaiSid, questions }` | `agent/respond { bonsaiSid, requestId, response: AskUserQuestionResponse }` |
| SuggestSession tool handler (via `get_tool_context()`) | `agent/suggestSession` (JSON-RPC request with `id`); params: `{ bonsaiSid, skill, specIds, name, reason, prompt? }` | `agent/respond { bonsaiSid, requestId, response: ToolApprovalResponse }` — approve: `{"behavior":"allow"}`, dismiss: `{"behavior":"deny", "dismissReason": "..."}` |
| `canUseTool` fires with any other `tool_name` | `agent/confirmAction` (JSON-RPC request with `id`); params: `{ bonsaiSid, toolName, toolInput }` | `agent/respond { bonsaiSid, requestId, response: ToolApprovalResponse }` |

**Suspension mechanism:**
1. Runner registers a new `asyncio.Future` in `tracker.py` keyed by `requestId`
2. Runner sends the JSON-RPC request to the frontend via the `notify` callback
3. Runner `await`s the Future
4. Frontend user responds -> RPC layer calls `service.respond(bonsai_sid, request_id, response)`
5. `tracker.py` resolves the Future; runner resumes and returns the response to the SDK

**Timeout:** If no response arrives within a configurable deadline, the Future is cancelled, the action is auto-denied, and an `agent/notification` event is sent to inform the frontend.

### Tracker — Interrupt Primitives

The tracker manages an **interrupt flag** per session, used to coordinate between `service.interrupt_task()` (which sets the flag) and `runtime/claude/runtime.py` (which checks and clears it when processing the resulting `ResultMessage`).

| Method | Signature | Description |
|--------|-----------|-------------|
| `set_interrupted` | `(bonsai_sid: str) -> None` | Set the interrupt flag for this session. Called by `service.interrupt_task()` before calling `client.interrupt()`. |
| `is_interrupted` | `(bonsai_sid: str) -> bool` | Check whether the interrupt flag is set. Called by the runtime when processing `ResultMessage` to decide between emitting `agent/interrupted` vs `agent/turnComplete`. |
| `clear_interrupted` | `(bonsai_sid: str) -> None` | Clear the interrupt flag after processing. Called by the runtime after emitting the `agent/interrupted` notification. |
| `interrupt_futures` | `(bonsai_sid: str) -> None` | Resolve all pending futures for this session with `{"behavior": "deny", "message": "Interrupted", "interrupt": true}`. Unlike `cancel_futures()` (which raises `CancelledError`), this produces a clean `PermissionResultDeny(interrupt=True)` that tells the SDK to stop the turn gracefully. |

**Why resolve instead of cancel?** Cancelling a future raises `CancelledError` which propagates unpredictably through the SDK's `can_use_tool` callback. Resolving with `deny + interrupt=True` uses the SDK's intended mechanism — `PermissionResultDeny(interrupt=True)` tells the SDK to end the turn cleanly and emit a `ResultMessage`.

### Conversation Loop (runtime/claude/runtime.py)

`ClaudeRuntime.run_session` maintains a persistent SDK client and loops over user messages:

```python
# Task starts in initializing — SDK client not yet ready
async with ClaudeSDKClient(options=options) as client:
    tracker.set_client(task.bonsai_sid, client)
    tracker.set_status(task.bonsai_sid, "idle")  # SDK client ready → initializing → idle

    while True:
        message = await tracker.get_next_message(task.bonsai_sid)  # blocks until agent/send

        if message is END_SIGNAL:
            break  # agent/end was called

        await client.query(message)
        # state: running

        async for sdk_event in client.receive_response():
            # Map SDK events -> notifications (same as current)

            if isinstance(sdk_event, ResultMessage):
                if tracker.is_interrupted(task.bonsai_sid):
                    # Interrupt path — emit interrupted, not turnComplete
                    await notify("agent/interrupted", {...})
                    tracker.clear_interrupted(task.bonsai_sid)
                else:
                    await notify("agent/turnComplete", {...})
                tracker.set_status(task.bonsai_sid, "idle")
                break  # back to conversation loop, same client

    # Session closed -> emit agent/done
```

**Message delivery:** `tracker.py` maintains an `asyncio.Queue` per session. `service.send_message()` pushes to the queue; `runtime/claude/runtime.py` pulls from it. `service.end_session()` pushes a sentinel `END_SIGNAL` to break the loop.

**Interrupt handling:** When `service.interrupt_task()` calls `client.interrupt()`, the SDK sends a control request to the CLI and the `receive_response()` generator yields a final `ResultMessage`. The runner checks `tracker.is_interrupted()` to emit `agent/interrupted` instead of `agent/turnComplete`, then clears the flag and returns to idle — same client, same context, no re-launch.

## Context Assembly

Context assembly is handled by the `context.py` submodule. It builds the system prompt passed to the Claude Agent SDK by gathering content from four sources:

1. **General Instructions** — always-present behavioral rules: visualization, interaction style, spec-driven workflow, proactive suggestions, and available skills table (dynamically generated from SKILL.md frontmatter)
2. **Skill instructions** — loaded from `{plugin_dir}/skills/{skill_id}/SKILL.md` (if a skill is selected). Combined with optional `session_prompt` into a "Your Task" section.
3. **Project metadata** — working directory path from `AppConfig`
4. **Specification content** — loaded by ID via `spec_service.get_spec()`

Sections are ordered General Instructions → Skill → Project → Specs, with framing prompts (markdown headers and introductory text) between sections to help the LLM distinguish context types.

**Full specification:** [CONTEXT.md](CONTEXT.md)

## Plugin Wiring

The Bonsai `claude-plugin/` is wired into the Claude Agent SDK client as a **local plugin** via `ClaudeAgentOptions.plugins`. This gives sessions native SDK-level support for plugin hooks, custom commands, and namespaced skill invocation — beyond what context assembly alone provides.

### How It Works

```
  context.py                          runtime/claude/runtime.py
  +--------------------+              +------------------------------+
  | Loads SKILL.md     |              | ClaudeAgentOptions(          |
  | into system        |              |   ...                        |
  | prompt text        |              |   plugins=[{                 |
  +--------------------+              |     "type": "local",         |
         |                            |     "path": plugin_dir       |
         |                            |   }]                         |
         v                            | )                            |
  System prompt has                   +------------------------------+
  skill instructions                         |
  (context assembly)                         v
                                      SDK loads plugin natively
                                      (hooks, commands, skills)
```

**Dual loading:** Skill instructions are loaded twice — once by `context.py` (into the system prompt as text) and once by the SDK (natively via the plugin manifest). This is intentional for now; the context assembly provides explicit framing, while the SDK plugin enables runtime features (hooks, commands). May be consolidated later.

### Runner Changes

`ClaudeRuntime.run_session()` accepts an optional `plugin_dir: Path | None` parameter. When set and the path exists:

```python
plugins = []
if plugin_dir and plugin_dir.is_dir():
    plugins.append({"type": "local", "path": str(plugin_dir)})

options = ClaudeAgentOptions(
    ...
    plugins=plugins,
)
```

When `plugin_dir` is `None` or the directory doesn't exist, `plugins` is an empty list — the session works without a plugin, same as before.

### Service Changes

`service.py` builds a `RuntimeExecutionConfig` and passes it through to `ClaudeRuntime.run_session()`:

```python
exec_config = RuntimeExecutionConfig(
    working_directory=str(self._config.project_root),
    model=task.config.model,
    system_prompt=spec_context,
    resume_session_id=resume_session_id,
    permission_mode=task.config.permission_mode,
    max_turns=task.config.max_turns,
    effort=task.config.effort,
    stream_text=task.config.stream_text,
)
handler = make_handler_from_notify(notify)
runtime = self._get_runtime(task)  # registry.get(task.config.runtime); deps wired in ProjectContext
await runtime.run_session(task, exec_config, handler)
```

## Context Management

The agent system has a three-layer approach to context window management: Prevention, Detection, Recovery.

### Prevention

- **System prompt budget warnings** — `build_context_structured()` computes `budgetRatio` (system prompt tokens / context window). Warnings emitted at 40% and 80% thresholds. Surfaced in `prepare_agent` and `update_draft` RPC responses.
- **Message size estimation** — `send_message()` estimates incoming message tokens (heuristic: `len(text) / 6`). If the message would consume >80% of remaining context, raises `MessageTooLargeError` (RPC error code `-32014`).
- **Context max via runtime** — `_get_context_max(task)` delegates to `runtime.get_context_window(task.config.model)`. The runtime owns its own model→window lookup (and any fallback for ids it doesn't recognise). If the registry isn't wired or the runtime is unknown, the service returns the neutral `DEFAULT_CONTEXT_WINDOW` (200K).

### Detection

- **SDK auto-compaction** — `PreCompact` hook wired in `runtime/claude/runtime.py`. Emits `agent/compact` with `{trigger, preTokens}`. Frontend renders via `CompactMarker.tsx`.
- **Context usage warnings** — `_persisting_notify` emits `agent/contextWarning` at 75% (`"warning"`) and 90% (`"critical"`) context usage after `turnComplete`/`error` events.
- **Error classification** — `ResultMessage.is_error` with "Prompt is too long" or "prompt_too_long" in the error text → `subtype: "context_overflow"` (recoverable). All other errors → `subtype: "turn_error"`.

### Recovery

- **Retry** — `agent/retryLastMessage` RPC resends the last user message (stored in `tracker._last_messages`). SDK may auto-compact on retry.
- **Fresh session** — frontend offers "Start fresh session" via existing `continueSession` flow.
- **ErrorBanner** — enhanced for `context_overflow` subtype: shows "Context window full" with Retry/Fresh buttons.

## TODO

- **Add `streaming` field to `agent/textDelta`:** Set to `false` for `AssistantMessage` full blocks and `true` for `SDKPartialAssistantMessage` text deltas (once partial message handling is implemented).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **`initializing` state** | Task starts in `initializing`; transitions to `idle` once `ClaudeSDKClient` context manager is entered and `set_client()` completes. Messages sent during `initializing` are queued (not rejected). `agent/end` is allowed to cancel before ready. | Frontend can distinguish "SDK still spinning up" from "ready for messages". Avoids a race where the frontend sends a message before the SDK client exists. Queuing (not rejecting) keeps the UX seamless — user can type immediately without waiting. |
| Persistent session model | SDK client stays open across multiple turns; user sends messages via `agent/send` | Matches Claude Code chat experience; enables multi-turn conversation with accumulated context |
| **Native resume for continue** | `continue_session` passes stored `sessionId` to `ClaudeAgentOptions(resume=...)` | Full conversation context restored by CLI natively. Eliminates lossy text replay (old approach truncated tool outputs to 500 chars, lost structured data, cost extra input tokens). |
| **resume_session_id as runner param** | `ClaudeRuntime.run_session()` accepts optional `resume_session_id: str \| None`; service decides when to pass it | Runner stays SDK-focused (just maps param to options). Service owns the "should we resume?" decision. Clean separation. |
| **No text replay fallback** | If stored session has no `sessionId`, raise `ValueError` instead of falling back to text replay | Simplicity. Text replay was lossy anyway. Old sessions without `sessionId` are rare and can be started fresh. |
| Message queue for user input | `asyncio.Queue` per session in `tracker.py` | Clean producer-consumer pattern; `agent/send` pushes, runner pulls. Decouples RPC layer from runner timing. |
| **Non-destructive interrupt** | `interrupt` calls `client.interrupt()` on the live SDK client; `end` pushes END_SIGNAL to close the session | Uses the SDK's built-in control protocol (`{"subtype": "interrupt"}`) to stop the current turn without destroying the client or conversation context. Previous approach (`bg.cancel()` + re-launch) was destructive — killed the runner, destroyed the SDK client, and lost all accumulated context. |
| **Interrupt flag on tracker** | Tracker holds a per-session interrupt flag; runner checks it on ResultMessage | Cleanly routes `ResultMessage` to either `agent/interrupted` or `agent/turnComplete` notification without race conditions. Service sets the flag before calling `client.interrupt()`; runner clears it after emitting the notification. |
| **Resolve futures, don't cancel** | `interrupt_futures()` resolves with `deny + interrupt=True` instead of `cancel()` | Cancelling a future raises `CancelledError` which propagates unpredictably. Resolving with `PermissionResultDeny(interrupt=True)` uses the SDK's intended mechanism to end the turn cleanly. |
| `turnComplete` vs `done` | `turnComplete` fires after each turn; `done` fires once when session closes | Clear separation between turn-level and session-level events; frontend can distinguish "ready for next message" from "conversation over" |
| SDK integration point | `runtime/claude/runtime.py` only | Single place to swap SDK versions or add a Python-side SDK wrapper; service and tracker are SDK-agnostic |
| Suspension pattern | `asyncio.Future` per `requestId` | Idiomatic async Python; futures can be awaited, cancelled, and inspected without threads |
| Streaming text | `includePartialMessages: true` in SDK config | Required to emit `text_delta` events for live typewriter view; can be toggled via `AgentConfig.stream_text` |
| Notify callback | Injected into runner at session start; supports both notifications (`request_id=None`) and server-initiated requests (`request_id` set) | Keeps the runner decoupled from WebSocket details; RPC layer owns the connection and callback creation |
| Agent file change tracking | Filesystem watcher (core/watcher), not tool call interception | Watcher is ground truth — catches all file changes regardless of source (agent, user, external). Same pipeline as user changes: watcher -> spec/service -> rpc/notifications. |
| Context assembly | Dedicated `context.py` submodule with pipeline: gather -> compose | Separates prompt construction from session orchestration. Pure function, easy to test. Supports specs, skills, and project metadata as distinct sources with framing prompts. |
| Plugin wiring | Pass `plugin_dir` to SDK via `plugins=[{"type": "local", "path": ...}]` | Enables native SDK features (hooks, commands, namespaced skills) beyond what system prompt text provides. Bonsai plugin only — no project-local plugin discovery. |
| Dual skill loading | Skills loaded both in context.py (prompt text) and via SDK plugin (native) | Context assembly provides explicit framing for the LLM. SDK plugin enables runtime hook/command support. Intentional duplication, may consolidate later. |
| Silent skip on missing plugin | Empty `plugins` list when `plugin_dir` is None or doesn't exist | Graceful degradation — sessions work without a plugin, matching current behavior. No error, no warning. |

## Dependencies

| Dependency | Usage |
|------------|-------|
| `core/config` | Project root, API key resolution |
| `spec/service` | Load spec content to build agent context |
| `claude-agent-sdk` (Python) | Agent execution, event stream, and native session resume (`ClaudeAgentOptions.resume`) |
| `asyncio` | Future-based suspension for interactive requests, Queue for message delivery |

## Known Limitations

- **CLI session expiry** — The Claude CLI may garbage-collect old sessions from `~/.claude/`. If the CLI session referenced by `sessionId` no longer exists, `--resume` will fail. `continue_session` should handle this gracefully (surface error to frontend).
- **System prompt changes not applied on resume** — When resuming, the CLI restores the original system prompt from the session. If specs or skills have changed since the session was created, the resumed session won't reflect those changes.
- **No cross-machine resume** — CLI sessions are stored locally in `~/.claude/`. Resuming only works on the same machine where the session was originally created.
- Single WebSocket connection assumed — if the client disconnects mid-session, pending futures will time out rather than being immediately cancelled
- Concurrent session limit is not yet defined; multiple simultaneous agent sessions are architecturally supported but resource limits are an open question

## Related Specs

- **Parent:** [Architecture Design](../../../DESIGN_DOC.md)
- **Submodules:** [Tools Package](tools/README.md) — self-contained MCP tools (vis, SuggestSession, UpdateProgress), [Context Assembly](CONTEXT.md) — prompt construction pipeline, [Session Persistence](PERSISTENCE.md) — disk I/O for session data
- **Depends on:** [Spec Module](../spec/README.md) (for loading spec context), [Core Config](../core/README.md) (for project root and plugin dir)
- **Related modules:** `rpc/methods/agents.py` (JSON-RPC interface to this module), `rpc/notifications.py` (WebSocket push)
