---
id: task-native-resume
type: task-spec
status: done
title: Replace text-replay continue with SDK native resume
implements:
- module-agent
covers:
- backend/app/agent/runner.py
- backend/app/agent/service.py
tags:
- high
- improvement
---
# Replace text-replay continue with SDK native resume

Replace the lossy text-replay `continue_session()` with the Claude Code SDK's native `--resume <sessionId>` feature. This eliminates truncated context, reduces input token waste, and gives resumed sessions full conversation fidelity.

## Context

Currently `service.py:continue_session()` rebuilds conversation history by iterating over saved events and constructing a plain-text summary (tool outputs truncated to 500 chars). This is injected into the system prompt as extra context. The SDK already supports `ClaudeAgentOptions(resume=<session_id>)` which passes `--resume <id>` to the CLI, restoring the full conversation natively.

**Spec:** [Agent Module README — Session Continuation](../../backend/app/agent/README.md#session-continuation-resume)

## Plan

### 1. Add `resume_session_id` param to `runner.run()`

**File:** `backend/app/agent/runner.py`

- Add optional parameter: `resume_session_id: str | None = None`
- Pass it to `ClaudeAgentOptions`:
  ```python
  options = ClaudeAgentOptions(
      system_prompt=spec_context,
      model=task.config.model,
      resume=resume_session_id,  # NEW
      ...
  )
  ```

### 2. Rewrite `continue_session()` in service.py

**File:** `backend/app/agent/service.py`

Replace the entire `continue_session` method (lines 212-278). New logic:

```python
async def continue_session(self, bonsai_sid: str, notify: Callable) -> AgentTask:
    if bonsai_sid in self._running_tasks:
        raise ValueError(f"Session {bonsai_sid} is already running")

    old = load_session(self._config.project_root, bonsai_sid)
    if not old:
        raise ValueError(f"Session {bonsai_sid} not found on disk")

    old_session_id = old.get("sessionId")
    if not old_session_id:
        raise ValueError(
            f"Cannot resume session {bonsai_sid}: no stored sessionId"
        )

    # Re-create task with SAME bonsai_sid
    old_config = AgentConfig(**old.get("config", {}))
    task = self._tracker.create_task(
        old.get("specIds", []), old_config,
        skill_id=old.get("skillId"),
        name=old.get("name", "session"),
        bonsai_sid=bonsai_sid,
    )

    # Update metadata (don't touch events JSONL)
    metadata = {
        "bonsaiSid": bonsai_sid,
        "name": task.name,
        "skillId": task.skill_id,
        "specIds": list(task.spec_ids),
        "config": old_config.model_dump(by_alias=True),
        "status": "idle",
        "sessionId": old_session_id,  # preserve until CLI gives new one
        "createdAt": old.get("createdAt", task.created),
        "updatedAt": task.updated,
    }
    save_session(self._config.project_root, metadata)

    # Build fresh spec context (no history replay)
    spec_context = self._build_context_for(task)

    bg_task = asyncio.create_task(
        self._run_background(task, spec_context, notify,
                             resume_session_id=old_session_id)
    )
    self._running_tasks[task.bonsai_sid] = bg_task
    return task
```

**Delete:** The entire text-replay block:
- `context_parts` list construction
- `history_context` string join
- `combined_context` concatenation

### 3. Update `_run_background` to forward `resume_session_id`

**File:** `backend/app/agent/service.py`

- Add `resume_session_id: str | None = None` param to `_run_background`
- Pass it through to `run()`:
  ```python
  await run(task, spec_context, notify, self._tracker,
            cwd=self._config.project_root,
            plugin_dir=self._config.plugin_dir,
            resume_session_id=resume_session_id)
  ```
- Update the two existing call sites (`run_task` and `interrupt_task` re-launch) to pass `resume_session_id=None` (default).

### 4. Add tests

**File:** `backend/tests/agent/test_resume.py` (new)

Tests to write:
- `test_runner_passes_resume_to_options` — verify `ClaudeAgentOptions` receives `resume=session_id` when param is set
- `test_runner_no_resume_by_default` — verify `resume` is `None` when param is not set
- `test_continue_session_uses_native_resume` — mock `load_session` to return session with `sessionId`, verify `run()` is called with `resume_session_id`
- `test_continue_session_missing_session_id_raises` — mock `load_session` to return session without `sessionId`, expect `ValueError`
- `test_continue_session_not_found_raises` — mock `load_session` to return `None`, expect `ValueError`
- `test_continue_session_already_running_raises` — session already in `_running_tasks`, expect `ValueError`

## Files to modify

- `backend/app/agent/runner.py` — add `resume_session_id` param, pass to `ClaudeAgentOptions`
- `backend/app/agent/service.py` — rewrite `continue_session()`, update `_run_background` signature
- `backend/tests/agent/test_resume.py` — new test file for resume functionality

## Definition of done

- All new tests pass (`cd backend && uv run pytest tests/agent/test_resume.py`)
- Existing tests still pass (`cd backend && uv run pytest`)
- Code aligns with [Agent Module spec — Session Continuation](../../backend/app/agent/README.md#session-continuation-resume)
- No text-replay code remains in `continue_session`

**Priority:** High
**Type:** Improvement
**Module:** agent
**Started:** 2026-03-07
