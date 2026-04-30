---
id: task-agent-runtime-contract
type: task-spec
status: done
title: Runtime Contract — IAgentRuntime + Unified Permission Types
implements:
- module-agent-runtime
covers:
- backend/app/agent/runtime/
- backend/app/agent/permissions.py
depends-on:
- task-agent-runner
- task-agent-models
- task-agent-tracker
tags:
- backend
- agent
- runtime
- refactor
---
# Runtime Contract — IAgentRuntime + Unified Permission Types

> Plan: [`docs/plans/completed/2026-04-29-01-runtime-contract.md`](../../../docs/plans/completed/2026-04-29-01-runtime-contract.md) | Status: **Done** (2026-04-29) | Priority: high

## Goal

Introduce the runtime-agnostic contract that future Claude / Codex /
other backends will implement, and make the permission engine
runtime-neutral. Zero runtime behaviour change — only new types and a
permissions refactor.

## What landed

### Types

- `IAgentRuntime` Protocol with `run_session(task, exec_config, handler)`
  and `interrupt(task, tracker)`.
- `RuntimeExecutionConfig` Pydantic model carrying per-session execution
  parameters (working_directory, model, system_prompt, resume_session_id,
  betas, effort, max_turns, permission_mode, stream_text).
- `RuntimeEvent(method, params, request_id?)` envelope and
  `AgentEventHandler` Protocol; `make_handler_from_notify` adapter.
- `ToolPermissionRequest` / `ToolPermissionResponse` — neutral
  permission types with `context` escape hatch.
- `ToolCategory = Literal["read", "net", "edit", "bash", "mcp"]`.

### Permission engine

- `can_use_tool` refactored to accept `ToolPermissionRequest` and return
  `ToolPermissionResponse`. Body unchanged in spirit — only the
  input/output shape changes.
- `claude_can_use_tool_adapter` — the **only** place in the codebase
  that imports Claude SDK permission types. The runner's
  `_can_use_tool` callback delegates here.
- INTERCEPTORS in `app/agent/tools/{specs, visualization, suggest_session,
  suggest_description, orchestrator, change_ticket_status}.py` now
  return `ToolPermissionResponse`, never SDK types.
- `_TOOL_CATEGORIES` + `_INTERCEPTOR_CATEGORIES` + `categorize()` +
  `evaluate_mode()` implement category-driven mode filtering inside
  `can_use_tool`. The `(mode, category)` table mirrors the reference's
  `permissionPolicyEngine.ts:192-246`.

## Where the implementation diverged from plan

1. **Mode filter ordering** — plan said "after INTERCEPTORS dispatch";
   implementation runs filter **before** INTERCEPTORS so plan mode can
   deny mutating MCP tools (interceptors auto-approve in their fast
   path). Documented inline in `permissions.py:332-341`.
2. **`_INTERCEPTOR_CATEGORIES` map** — bonsai's MCP tools needed
   per-interceptor category overrides; the plan would have lumped them
   all under `mcp` (denied in plan mode), which would have blocked
   read-only tools like `spec_search`.
3. **Control-flow tools classified `read`** — `ExitPlanMode` /
   `EnterPlanMode` / `Task` / `TodoWrite` were not in the plan's
   `_TOOL_CATEGORIES`. Without them, plan mode would auto-deny
   `ExitPlanMode` and trap the user in plan mode forever.
4. **Input-aware classification for `SuggestDescription`** — categorized
   as `edit` iff `apply=true`, else `read`. Not in plan; correctness
   requirement that surfaced during implementation.

## Files changed

- Created: `backend/app/agent/runtime/{__init__,types,events,permissions}.py`
- Modified: `backend/app/agent/permissions.py` (refactored `can_use_tool`
  + added `claude_can_use_tool_adapter` + category engine)
- Modified: `backend/app/agent/tools/{specs, visualization,
  suggest_session, suggest_description, orchestrator,
  change_ticket_status}.py` (return type swap)
- Modified: `backend/app/agent/runner.py` (single-line callback swap —
  later deleted by plan 02)
- Created: `backend/tests/agent/runtime/test_{types, event_handler,
  permissions}.py`
- Modified: `backend/tests/agent/test_permissions.py`

## Acceptance

- `uv run pytest` — green (950 → 968 by end of plan).
- `grep -r "PermissionResultAllow\|PermissionResultDeny" backend/app/agent/tools/`
  returns nothing.
- `grep -r "PermissionResultAllow\|PermissionResultDeny" backend/app/agent/permissions.py`
  matches only inside `claude_can_use_tool_adapter`.
- `grep -r claude_agent_sdk backend/app/agent/runtime/` returns nothing.
- Mode-category matrix (4 modes × 5 categories) verified by parametrised
  `TestEvaluateMode` (22 cases).
- `test_every_built_in_tool_classified` asserts every tool emitted by
  the runner is classified.

## Follow-ups

- Plan 02 — extract `ClaudeRuntime` from `runner.py` ✅ done
- Plan 03 — registry + `AgentConfig.runtime` field
- Future — add `allowPatterns` / per-pattern session allowlist (the
  reference's `PermissionCheckResponse.allowPatterns` field that bonsai
  intentionally dropped for the mode-only model).
