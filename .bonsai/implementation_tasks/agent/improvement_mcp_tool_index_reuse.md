---
id: task-mcp-tool-index-reuse
type: task-spec
status: done
title: "Reuse cached SpecIndex connection in MCP tool handlers"
parent: module-agent-tools
implements:
  - module-agent-tools
  - submodule-specs-tools
references:
  - design-mcp-tool-index-reuse
tags:
  - high
  - improvement
  - backend
  - performance
covers:
  - backend/app/agent/tools/_context.py
  - backend/app/agent/runner.py
  - backend/app/agent/service.py
  - backend/app/agent/tools/specs.py
---

# Reuse cached SpecIndex connection in MCP tool handlers

## Context

Every MCP tool call (`spec_search`, `spec_links`, `spec_delete`) opens a **fresh SQLite connection** via `_index_service()` in `specs.py`. Each call pays: new `aiosqlite` connection + 6 PRAGMAs + 4 `CREATE TABLE IF NOT EXISTS` + schema version check. A typical agent session calls `spec_search` 5-10 times.

Meanwhile, the RPC server already maintains a long-lived `SpecIndex` in `_spec_indexes[key]` that the watcher and RPC methods reuse. The server creates a `SpecService(config, cached_index)` and passes it to `AgentService.__init__()` — but the threading stops there. `AgentService._run_background()` passes `config` to `runner.run()` but **not** `spec_service`.

**Secondary issue:** `spec_delete` writes on an ephemeral connection while the watcher reads from the cached one — stale state until the watcher re-indexes the file changes.

**Root cause:** `ToolContext` has `config` but not `SpecService`. Tools can't access the cached connection.

**Design doc:** `.bonsai/mcp-tool-index-reuse/design-doc.md`

## Plan

### 1. Add `spec_service` to `ToolContext` (`_context.py`)

Add `spec_service: SpecService | None = None` field to the frozen dataclass. Update `set_tool_context()` to accept the new optional parameter. Use `TYPE_CHECKING` guard for the import to avoid any import cycle risk.

```python
from __future__ import annotations
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.spec.service import SpecService

@dataclass(frozen=True)
class ToolContext:
    tracker: Tracker
    notify: Any
    task: AgentTask
    config: AppConfig
    spec_service: SpecService | None = None  # cached from server

def set_tool_context(
    tracker, notify, task, config,
    spec_service: SpecService | None = None,
) -> contextvars.Token:
    return _tool_context.set(
        ToolContext(tracker=tracker, notify=notify, task=task, config=config,
                    spec_service=spec_service)
    )
```

### 2. Thread `spec_service` through `runner.run()` (`runner.py`)

Add `spec_service: Any = None` parameter to `run()`. Pass it to the `set_tool_context()` call (~line 160).

```python
async def run(
    task, spec_context, notify, tracker,
    ...,
    spec_service=None,  # NEW
) -> AgentResult:
    ...
    set_tool_context(tracker, notify, task, config, spec_service=spec_service)
```

### 3. Pass `self._spec_service` from `AgentService` (`service.py`)

In `_run_background()` (~line 673), add `spec_service=self._spec_service` to the `run()` call. The attribute already exists — just needs threading.

```python
await run(
    task, spec_context, notify, self._tracker,
    ...,
    model_registry=self.model_registry,
    spec_service=self._spec_service,  # NEW
)
```

### 4. Rewrite `_index_service()` to prefer cached service (`specs.py`)

Replace the current `_index_service()` that always opens a fresh connection. New logic: check `ctx.spec_service` first; if `None` (tests, edge cases), fall back to opening a fresh connection as before.

```python
@asynccontextmanager
async def _index_service() -> AsyncIterator[SpecService]:
    """Get SpecService — prefer cached session service, fallback to fresh."""
    ctx = get_tool_context()

    if ctx.spec_service is not None:
        yield ctx.spec_service
        return

    # Fallback: fresh connection (tests, edge cases)
    from app.core.config import get_index_path
    db_path = get_index_path(ctx.config.get_project_root())
    async with SpecIndex(db_path) as index:
        yield SpecService(ctx.config, index=index)
```

## Files to modify

| File | Change |
|------|--------|
| `backend/app/agent/tools/_context.py` | Add `spec_service: SpecService \| None = None` to `ToolContext` + update `set_tool_context()` signature |
| `backend/app/agent/runner.py` | Add `spec_service` param to `run()`, pass to `set_tool_context()` |
| `backend/app/agent/service.py` | Pass `self._spec_service` to `run()` in `_run_background()` |
| `backend/app/agent/tools/specs.py` | Rewrite `_index_service()` to prefer cached service, fallback to fresh |

## Testing

**Test file:** `backend/tests/agent/test_tools.py` (add new class alongside existing `TestSpecSearch`, `TestSpecLinks`, `TestSpecDelete`)

**Existing tests pass unchanged** — the helper `_make_spec_args()` calls `set_tool_context(tracker, AsyncMock(), task, config)` without `spec_service`, so all existing spec tool tests exercise the fallback path automatically. No changes needed.

**New test class: `TestIndexServiceCaching`**

```python
class TestIndexServiceCaching:
    async def test_yields_cached_spec_service_when_set(self, tmp_path: Path) -> None:
        """When ToolContext has spec_service, _index_service() yields it directly."""
        from app.agent.tools.specs import _index_service

        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        mock_service = MagicMock()  # stand-in for SpecService
        set_tool_context(tracker, AsyncMock(), task, config, spec_service=mock_service)

        async with _index_service() as svc:
            assert svc is mock_service  # same object, no fresh connection

    async def test_falls_back_to_fresh_connection_when_no_service(self, tmp_path: Path) -> None:
        """When spec_service is None, _index_service() opens a fresh SpecIndex."""
        from app.agent.tools.specs import _index_service

        config = await _setup_index_with_specs(tmp_path)
        _make_spec_args({}, config)  # sets context with spec_service=None

        async with _index_service() as svc:
            assert svc is not None
            # Verify it can actually query (fresh connection works)
            results = await svc.list_specs()
            assert len(results) == 3  # from _setup_index_with_specs
```

## Definition of done

- [ ] All 4 files modified as described in Plan
- [ ] Existing tests pass unchanged (`cd backend && uv run pytest tests/agent/test_tools.py`)
- [ ] New test: `test_yields_cached_spec_service_when_set` passes
- [ ] New test: `test_falls_back_to_fresh_connection_when_no_service` passes
- [ ] Manual verification: agent session reuses cached connection (no per-call SQLite open/close in logs)

**Priority:** High
**Scope:** Medium (4 files, <30 lines of production code)
**Started:** 2026-04-23
