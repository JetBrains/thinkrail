# Agent Module — Design Specification

> Parent: [DESIGN_DOC.md](../../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-02-25

## Purpose

The Agent module orchestrates AI coding agent runs. It accepts a task (a set of spec IDs + config), feeds the specs as context to the Claude Agent SDK, streams the resulting SDK events to the frontend as JSON-RPC notifications, and handles interactive mid-run flows (user questions, tool permission confirmations) by suspending execution until the frontend responds.

## Internal Architecture

**Pattern:** Service facade over two collaborators — `runner.py` (SDK integration) and `tracker.py` (task lifecycle + pending request state).

```
        ┌───────────────┐
        │  service.py   │  ← Single entry point (facade)
        └───┬───────────┘
            │
    ┌───────┴────────┐
    ▼                ▼
┌──────────┐  ┌────────────┐
│ runner.py│  │ tracker.py │
│ (SDK)    │  │ (state)    │
└────┬─────┘  └─────┬──────┘
     │               │
     ▼               ▼
Claude Agent SDK   asyncio.Future
(event stream)     map per requestId
     │
     ▼
External AI APIs
(Claude, etc.)
```

## File Organization

| File | Responsibility | Depends On |
|------|---------------|------------|
| `models.py` | Pydantic models: AgentTask, AgentConfig, AgentEvent, AgentResult | — |
| `service.py` | Facade — start/interrupt tasks, relay frontend responses to pending futures | runner, tracker, core/config |
| `runner.py` | Claude Agent SDK integration: iterate event stream, map SDK events to `AgentEvent` notifications, register `canUseTool` / hooks | models, tracker |
| `tracker.py` | Task lifecycle (pending/running/done/error), registry of in-flight `asyncio.Future` objects keyed by `requestId` | models |

## Public Interface

### Service Layer (called by RPC methods)

| Method | Signature | Description |
|--------|-----------|-------------|
| `run_task` | `(spec_ids: list[str], config: AgentConfig, notify: Callable) → AgentTask` | Start an agent task; `notify` is a callback the runner uses to push events to the frontend |
| `interrupt_task` | `(task_id: str) → None` | Interrupt a running task |
| `get_task` | `(task_id: str) → AgentTask` | Get current task status and metadata |
| `list_tasks` | `() → list[AgentTask]` | List all tasks (running, done, error) |
| `respond` | `(task_id: str, request_id: str, response: dict) → None` | Resolve a pending `asyncio.Future` with the client's answer |

### Models

| Model | Fields | Description |
|-------|--------|-------------|
| `AgentTask` | id, status, spec_ids, config, session_id?, created, updated | Task record |
| `AgentConfig` | model, max_turns, permission_mode, stream_text | Run configuration |
| `AgentEvent` | task_id, session_id, event_type, payload | Serializable event to send as notification |
| `AgentResult` | task_id, session_id, result, cost_usd, turns, duration_ms, usage | Terminal success result |

### Event Types (AgentEvent.event_type)

These map 1-to-1 to the `agent/*` notification methods in the protocol:

| event_type | Triggered by | Protocol method |
|------------|-------------|-----------------|
| `session_start` | `SDKSystemMessage` subtype `init` | `agent/sessionStart` |
| `text_delta` | `SDKAssistantMessage` text block / `SDKPartialAssistantMessage` text_delta | `agent/textDelta` |
| `tool_call_start` | `SDKAssistantMessage` tool_use block | `agent/toolCallStart` |
| `tool_call_end` | `SDKUserMessage` tool_result block | `agent/toolCallEnd` |
| `subagent_start` | `SubagentStart` hook | `agent/subagentStart` |
| `subagent_end` | `SubagentStop` hook | `agent/subagentEnd` |
| `notification` | `Notification` hook | `agent/notification` |
| `compact` | `SDKCompactBoundaryMessage` | `agent/compact` |
| `progress` | Internal milestones | `agent/progress` |
| `done` | `SDKResultMessage` subtype `success` | `agent/done` |
| `error` | `SDKResultMessage` error subtypes | `agent/error` |
| `permission_denied` | `SDKResultMessage.permission_denials` | `agent/permissionDenied` |

### Interactive Request/Response Flow

For mid-run interactions where the agent needs user input, `runner.py` suspends the SDK generator and the frontend must respond via `agent/respond`:

| Trigger | Server sends | Client must respond |
|---------|-------------|---------------------|
| Claude calls `AskUserQuestion` tool | `agent/askUserQuestion` (JSON-RPC request with `id`) | `agent/respond { requestId, response: { answers } }` |
| `canUseTool` / `PermissionRequest` hook fires | `agent/confirmAction` (JSON-RPC request with `id`) | `agent/respond { requestId, response: { decision, reason? } }` |

**Suspension mechanism:**
1. Runner registers a new `asyncio.Future` in `tracker.py` keyed by `requestId`
2. Runner sends the JSON-RPC request to the frontend via the `notify` callback
3. Runner `await`s the Future
4. Frontend user responds → RPC layer calls `service.respond(task_id, request_id, response)`
5. `tracker.py` resolves the Future; runner resumes and returns the response to the SDK

**Timeout:** If no response arrives within a configurable deadline, the Future is cancelled, the action is auto-denied, and an `agent/notification` event is sent to inform the frontend.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SDK integration point | `runner.py` only | Single place to swap SDK versions or add a Python-side SDK wrapper; service and tracker are SDK-agnostic |
| Suspension pattern | `asyncio.Future` per `requestId` | Idiomatic async Python; futures can be awaited, cancelled, and inspected without threads |
| Streaming text | `includePartialMessages: true` in SDK config | Required to emit `text_delta` events for live typewriter view; can be toggled via `AgentConfig.stream_text` |
| Notify callback | Injected into runner at task start | Keeps the runner decoupled from WebSocket details; RPC layer owns the connection |
| Agent file change tracking | Filesystem watcher (core/watcher), not tool call interception | Watcher is ground truth — catches all file changes regardless of source (agent, user, external). Same pipeline as user changes: watcher → spec/service → rpc/notifications. More reliable than intercepting agent tool calls, and adds no complexity to runner.py |

## Dependencies

| Dependency | Usage |
|------------|-------|
| `core/config` | Project root, API key resolution |
| `spec/service` | Load spec content to build agent context |
| `claude-agent-sdk` (JS or Python) | Agent execution and event stream |
| `asyncio` | Future-based suspension for interactive requests |

## Known Limitations

- Single WebSocket connection assumed — if the client disconnects mid-task, pending futures will time out rather than being immediately cancelled
- No persistent task storage — task list is in-memory only; restarts lose task history
- Concurrent task limit is not yet defined; multiple simultaneous agent runs are architecturally supported but resource limits are an open question

## Related Specs

- **Parent:** [Architecture Design](../../../DESIGN_DOC.md)
- **Depends on:** [Spec Module](../spec/README.md) (for loading spec context)
- **Related modules:** `rpc/methods/agents.py` (JSON-RPC interface to this module), `rpc/notifications.py` (WebSocket push)
