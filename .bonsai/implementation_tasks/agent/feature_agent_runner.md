---
id: task-agent-runner
type: task-spec
status: done
title: Implement Agent runner.py
depends-on:
- task-agent-models
- task-agent-tracker
implements:
- module-agent
covers:
- backend/app/agent/runner.py
tags:
- high
- new-feature
---
# Implement Agent runner.py

> Claude Agent SDK integration and event stream mapping

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `feature_agent_models`, `feature_agent_tracker`
**Spec reference:** `backend/app/agent/README.md` (lines 40, 84-128)

## Files to Modify

- `backend/app/agent/runner.py`

## Summary

`runner.py` is the sole integration point with the Claude Agent SDK. It iterates the SDK's event stream, maps SDK events to `AgentEvent` notifications, and handles the `canUseTool` callback for both user questions and tool approvals by suspending execution via `asyncio.Future` (managed by `tracker.py`).

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `run` | `(task: AgentTask, spec_context: str, notify: Callable, tracker: Tracker) → AgentResult` | Execute an agent run |

### `run()` Steps

1. Configure SDK with `task.config` settings
2. Set `spec_context` as system prompt / initial context
3. Iterate SDK events, mapping to `AgentEvent` and sending via `notify`
4. Register `canUseTool` callback that:
   - If `tool_name == "AskUserQuestion"`: send `agent/askUserQuestion` request
   - Otherwise: send `agent/confirmAction` request
   - Both: register Future in tracker, await it, map response to SDK return
5. Return `AgentResult` on completion

## SDK Event → AgentEvent Mapping

| SDK Event | `event_type` |
|-----------|-------------|
| `SDKSystemMessage` (init subtype) | `session_start` |
| `SDKAssistantMessage` text block / `SDKPartialAssistantMessage` text_delta | `text_delta` |
| `SDKAssistantMessage` tool_use block | `tool_call_start` |
| `SDKUserMessage` tool_result block | `tool_call_end` |
| SubagentStart hook | `subagent_start` |
| SubagentStop hook | `subagent_end` |
| Notification hook | `notification` |
| `SDKCompactBoundaryMessage` | `compact` |
| Internal milestones | `progress` |
| `SDKResultMessage` success | `done` |
| `SDKResultMessage` error | `error` |
| `SDKResultMessage` permission_denials | `permission_denied` |

## canUseTool → JSON-RPC Request Mapping

| Condition | JSON-RPC Method | Response Type | SDK Return |
|-----------|----------------|---------------|------------|
| `tool_name="AskUserQuestion"` | `agent/askUserQuestion` | `AskUserQuestionResponse` | `PermissionResultAllow(updated_input=...)` |
| Any other tool | `agent/confirmAction` | `ToolApprovalResponse` | `PermissionResultAllow()` or `PermissionResultDeny(...)` |

## Plan

1. Implement SDK configuration from `AgentConfig` (model, max_turns, stream_text)
2. Implement `canUseTool` callback — distinguish by tool_name, register future, send request via notify, await future, map response
3. Implement event stream iteration — match SDK event types, build AgentEvent, send via notify
4. Implement `run()` — orchestrate SDK invocation, event loop, result construction
5. Build `AgentResult` from SDK terminal message (cost, turns, duration, usage)
6. Handle errors — catch SDK exceptions, set task status to error via tracker
7. Write unit tests — mock SDK event stream, mock tracker, verify event mapping

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/agent/runner.py` | Create | SDK integration + event mapping |
| `backend/app/agent/__init__.py` | Update | Add runner exports |
| `backend/tests/agent/test_runner.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the interface in `backend/app/agent/README.md`
- `canUseTool` handles both AskUserQuestion and tool approvals correctly
