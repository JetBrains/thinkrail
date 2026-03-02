# Implement Agent models.py

> Pydantic models for agent tasks, events, and interactive flows

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Spec reference:** `backend/app/agent/README.md` (lines 55-92)

## Summary

`models.py` defines the data structures used across the Agent module. These are Pydantic models for task records, run configuration, streaming events, terminal results, and the interactive request/response types for mid-run user interactions (questions and tool approvals).

## Models

### Core Models

| Model | Key Fields | Description |
|-------|------------|-------------|
| `AgentTask` | `id`, `status`, `spec_ids`, `config`, `session_id?`, `created`, `updated` | Task record. Status: pending, running, done, error |
| `AgentConfig` | `model`, `max_turns`, `permission_mode`, `stream_text` | Run configuration passed to the SDK |
| `AgentEvent` | `task_id`, `session_id`, `event_type`, `payload` | Serializable event sent as notification to frontend |
| `AgentResult` | `task_id`, `session_id`, `result`, `cost_usd`, `turns`, `duration_ms`, `usage` | Terminal success result |

#### AgentEvent `event_type` Values
`session_start`, `text_delta`, `tool_call_start`, `tool_call_end`, `subagent_start`, `subagent_end`, `notification`, `compact`, `progress`, `done`, `error`, `permission_denied`

### Interactive Request/Response Models

| Model | Key Fields | Description |
|-------|------------|-------------|
| `Question` | `question`, `header`, `options`, `multi_select` | A single question with selectable options (1-4 questions, 2-4 options) |
| `QuestionOption` | `label`, `description` | A selectable option within a question |
| `AskUserQuestionResponse` | `questions`, `answers` | Response to a question request. `answers` maps question text to selected label |
| `ToolApprovalResponse` | `behavior`, `message?`, `interrupt?` | Response to a tool approval request. `behavior`: "allow" or "deny" |

## Plan

1. Define `AgentConfig` with field defaults (`model="claude-sonnet-4-6"`, `max_turns=25`, `permission_mode="default"`, `stream_text=True`)
2. Define `QuestionOption` and `Question` models
3. Define `AskUserQuestionResponse` and `ToolApprovalResponse` models
4. Define `AgentEvent` with `event_type` as a string enum/literal
5. Define `AgentResult` with numeric fields
6. Define `AgentTask` with status enum, auto-generated id (uuid4), timestamps
7. Create `agent/__init__.py` with module exports
8. Write unit tests — model construction, validation, serialization

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/agent/models.py` | Create | All Pydantic models |
| `backend/app/agent/__init__.py` | Create | Module exports |
| `backend/tests/agent/__init__.py` | Create | Test package init |
| `backend/tests/agent/test_models.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the interface in `backend/app/agent/README.md`
