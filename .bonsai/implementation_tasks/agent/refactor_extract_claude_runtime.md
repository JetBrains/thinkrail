---
id: task-agent-runtime-claude
type: task-spec
status: done
title: Extract ClaudeRuntime from runner.py
implements:
- module-agent-runtime-claude
covers:
- backend/app/agent/runtime/claude/
- backend/app/agent/service.py
depends-on:
- task-agent-runtime-contract
- task-agent-runner
tags:
- backend
- agent
- runtime
- refactor
---
# Extract ClaudeRuntime from runner.py

> Plan: [`docs/plans/completed/2026-04-29-02-extract-claude-runtime.md`](../../../docs/plans/completed/2026-04-29-02-extract-claude-runtime.md) | Status: **Done** (2026-04-30) | Priority: high

## Goal

Move the existing Claude SDK integration out of `app/agent/runner.py`
into a `ClaudeRuntime` class that implements `IAgentRuntime` (introduced
in [`task-agent-runtime-contract`](refactor_runtime_contract.md)).
Replace direct `notify(...)` calls with `handler.on_event(...)`. Zero
behaviour change.

The original runner work was tracked in
[`task-agent-runner`](feature_agent_runner.md); this task supersedes
its scope by relocating the runner body — the historical record stays
in place to document what shipped at the time. After this task, the
file `runner.py` no longer exists; its body lives at
`backend/app/agent/runtime/claude/runtime.py`.

## What landed

### New module: `backend/app/agent/runtime/claude/`

- `__init__.py` — re-exports `ClaudeRuntime`.
- `runtime.py` — `class ClaudeRuntime`. Body migrated verbatim from
  `runner.run`. Owns the SDK client lifecycle, conversational loop,
  per-iteration cost tracking, mode-change tracking, 1M-context beta
  auto-injection, MCP tool-result serialization, and `Write`-tool
  `_previousContent` injection.
- `hooks.py` — `class SubagentHooks`. Per-session subagent / PreCompact
  correlation extracted out of the `runner.run` closures (`_active_subagent_ids`,
  `_parent_to_agent`, `_pending_task_tool_ids`, `start_hook`, `stop_hook`,
  `pre_compact_hook`, `close_orphaned_subagents`).

### Service wiring

- `AgentService` builds one `ClaudeRuntime` instance per service
  lifetime via `_make_runtime()` (constructor takes shared deps:
  tracker, app_config, plugin_dir, model_registry, spec_service,
  coordinator).
- `_run_background` builds a `RuntimeExecutionConfig` from
  `task.config` + `spec_context` + `cwd` + `resume_session_id`, wraps
  `_persisting_notify` with `make_handler_from_notify`, and calls
  `runtime.run_session(task, exec_config, handler)`.
- `interrupt_task` delegates the runtime-specific cancel to
  `runtime.interrupt(task, tracker)`. `set_interrupted` and
  `interrupt_futures` stay in the service (bonsai-internal state).

### Removed

- `backend/app/agent/runner.py` — deleted. `grep -r "from app.agent.runner"`
  returns nothing.
- `backend/tests/agent/test_runner.py` — moved to
  `backend/tests/agent/runtime/claude/test_runtime.py`. Imports updated.

### Tests

- 41 tests in `backend/tests/agent/runtime/claude/` (test_runtime.py +
  test_hooks.py). Full suite at 968 passing.

## Where the implementation diverged from plan

1. **Constructor takes shared deps** — the plan implied stateless
   instantiation but the runtime needs tracker / config / spec_service /
   model_registry / coordinator passed in. The implementation models this
   honestly via `__init__` params, which is closer to the reference's DI
   pattern than what the plan asked for.
2. **Local `notify` shim retained** — the plan said replace **every**
   `notify` call with `handler.on_event`. The implementation kept a
   thin `notify(method, params, request_id?)` shim (`runtime.py:127`)
   that wraps `handler.on_event`, because `set_tool_context` and
   `claude_can_use_tool_adapter` both expect the original
   3-argument callable signature. Functionally equivalent; less churn
   in downstream consumers.

## Acceptance

- `uv run pytest` green (968 passing).
- `grep -r "from app.agent.runner" backend/` returns nothing (only the
  docstring reference inside `runtime/claude/runtime.py:3`).
- All six special-case behaviours preserved (1M-context beta,
  CLAUDECODE strip, per-iteration cost, mode-change tracking,
  `_previousContent` injection, `_serialize_tool_content`).
- `runtime/claude/` imports limited to allowed set (verified — only
  `claude_agent_sdk`, `app.agent.{models, permissions, pricing, tools,
  tracker}`, `app.agent.runtime.{events, types, claude.hooks,
  claude.adapter}`, `app.core.config`).

## Follow-up

- Plan 03 swaps the hardcoded `_make_runtime()` for
  `RUNTIMES[task.config.runtime]` registry lookup.
- Plan 05 adds the Codex adapter and asserts diff-parity with Claude;
  the new `runtime/claude/adapter.py` module is the boundary that
  contract enforces against.
