---
id: task-agent-context
type: task-spec
status: done
title: Implement Agent context.py and wire skill_id
implements:
- agent-context
- module-agent
covers:
- backend/app/agent/context.py
- backend/app/agent/service.py
- backend/app/rpc/methods/agents.py
- backend/app/core/config.py
tags:
- high
- new-feature
---
# Implement Agent context.py and wire skill_id through service + RPC

**Status:** Done
**Priority:** High
**Spec reference:** `backend/app/agent/README.md`, `backend/app/agent/CONTEXT.md`

Skill selection in the frontend is currently UI-only — the backend never receives `skill_id` and never loads skill instructions. The `_build_context()` helper in `service.py` only loads spec content. This task implements the Context submodule (`context.py`) per [CONTEXT.md](../../backend/app/agent/CONTEXT.md) and wires `skill_id` from the RPC layer through to the runner.

## Plan

### 1. Add `plugin_dir` to `AppConfig` (`backend/app/core/config.py`)

- Add field: `plugin_dir: Path` with default `project_root / "claude-plugin"`
- Update `load_config()` to set `plugin_dir` from `root`

### 2. Create `backend/app/agent/context.py`

Implement `build_context()` as a pure function per CONTEXT.md spec:

```python
def build_context(
    spec_ids: list[str],
    skill_id: str | None,
    project_root: Path,
    config: AgentConfig,
    spec_service: SpecService,
    plugin_dir: Path | None = None,
) -> str:
```

Internal steps:
1. **Load skill** — if `skill_id` is not `None`, read `{plugin_dir}/skills/{skill_id}/SKILL.md`, strip YAML frontmatter, wrap in `## Your Task` framing section
2. **Project metadata** — `## Project\n\nWorking directory: {project_root}`
3. **Load specs** — for each `spec_id`, call `spec_service.get_spec(id)`, wrap each in `### {title}\n\n{content}`, separate with `---`, wrap group in `## Specifications` framing section
4. **Compose** — join non-empty sections with `\n\n`

Helper: `_strip_frontmatter(text: str) -> str` — removes content between first two `---` lines.

Raise `FileNotFoundError` if `skill_id` is provided but SKILL.md doesn't exist.

### 3. Update `AgentService.run_task()` (`backend/app/agent/service.py`)

- Add `skill_id: str | None = None` parameter to `run_task()`
- Replace `self._build_context(spec_ids)` call with:
  ```python
  from app.agent.context import build_context
  spec_context = build_context(
      spec_ids=spec_ids,
      skill_id=skill_id,
      project_root=self._config.project_root,
      config=config,
      spec_service=self._spec_service,
      plugin_dir=self._config.plugin_dir,
  )
  ```
- Remove `_build_context()` private method
- Also update the `interrupt_task()` re-launch path (line 88) to use `build_context()` — currently calls `self._build_context(task.spec_ids)`. Note: `skill_id` needs to be recoverable for re-launch — store it on the task or in a side dict.

### 4. Update `run_agent` RPC handler (`backend/app/rpc/methods/agents.py`)

- Extract optional `skillId` from params: `skill_id = params.get("skillId")`
- Pass to service: `await service.run_task(params["specIds"], config, notify, skill_id=skill_id)`

### 5. Store `skill_id` on `AgentTask` model (optional but recommended)

- Add `skill_id: str | None = None` field to `AgentTask` in `models.py`
- Update `Tracker.create_task()` to accept and store `skill_id`
- This enables `interrupt_task()` re-launch to recover the skill_id

## Files to modify

| File | Change |
|------|--------|
| `backend/app/core/config.py` | Add `plugin_dir` field to `AppConfig`, update `load_config()` |
| `backend/app/agent/context.py` | **NEW** — `build_context()` function + `_strip_frontmatter()` helper |
| `backend/app/agent/service.py` | Add `skill_id` param to `run_task()`, replace `_build_context()` with `build_context()`, update interrupt re-launch |
| `backend/app/agent/models.py` | Add `skill_id: str \| None = None` to `AgentTask` |
| `backend/app/agent/tracker.py` | Update `create_task()` to accept `skill_id` |
| `backend/app/rpc/methods/agents.py` | Extract `skillId` from params, pass to `run_task()` |

## Definition of done

- `build_context()` returns correct prompt with skill → project → specs ordering
- YAML frontmatter is stripped from SKILL.md content
- `skill_id=None` produces prompt without skill section (backward compatible)
- Empty `spec_ids` produces prompt without specs section
- `agent/run` accepts optional `skillId` param and passes it through
- `interrupt_task()` re-launch preserves the original skill context
- Existing tests still pass (`uv run pytest`)

## Out of scope

- Frontend changes (sending `skillId` in `AgentRunParams`) — separate task
- Context size management / token counting
- Multiple plugin directory support

**Priority:** High
**Spec:** [CONTEXT.md](../../backend/app/agent/CONTEXT.md)
**Started:** 2026-03-03
