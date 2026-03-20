# Agent Tools — Design Specification

> Parent: [Agent Module](../README.md) | Status: **Active** | Created: 2026-03-11 | Updated: 2026-03-20

## Table of Contents
1. [Purpose](#purpose)
2. [Design Principle](#design-principle)
3. [File Organization](#file-organization)
4. [Public Interface](#public-interface)
5. [Tool Context Pattern](#tool-context-pattern)
6. [Tool File Contract](#tool-file-contract)
7. [Output Contract](#output-contract)
8. [Adding a New Tool](#adding-a-new-tool)
9. [Key Design Decisions](#key-design-decisions)
10. [Known Limitations](#known-limitations)
11. [RelatedSpecs](#related-specs)

## Purpose

Self-contained MCP tools for the agent runtime. Each tool lives in its own file with schema, handler, and MCP server instance. The `tools/` package is the single source of truth for what custom tools the agent can use.

Tool handlers access session context (tracker, notify, task, config) via **`contextvars`**, ensuring tools work correctly in **all permission modes** — including `bypassPermissions` (yolo mode), where the CLI skips the `canUseTool` hook entirely. Each tool also exports an `intercept_*()` function registered in `INTERCEPTORS` for auto-approval in non-yolo modes where `canUseTool` fires.

**Graduation rule:** A tool starts here as a single file. If it grows complex enough to need its own models, service layer, or multi-file logic (like the `vis/` dashboard), it graduates to a top-level package under `backend/app/`.

## Design Principle

```
One file = one tool = schema + handler + MCP server
```

The `tools/__init__.py` re-exports what the runner and permissions need:
- `MCP_SERVERS` — dict of server name → MCP server instance (wired into SDK)
- `INTERCEPTORS` — dict of tool name suffix → intercept function (used by `permissions.py` for auto-approval)
- `set_tool_context()` / `get_tool_context()` — from `_context.py` (set by runner, read by handlers)

**Interceptors are simplified auto-approvals.** All real tool logic lives in the handler via `contextvars`. The interceptors just return `PermissionResultAllow` so tools aren't gated behind `agent/confirmAction` in non-yolo modes.

## File Organization

| File | Responsibility | Status |
|------|---------------|--------|
| `__init__.py` | Re-exports `MCP_SERVERS`, `INTERCEPTORS`, and context helpers from all tool files | Updated |
| `_context.py` | **New** — `contextvars`-based session context: `set_tool_context()`, `get_tool_context()`, `ToolContext` dataclass | New |
| `suggest_session.py` | SuggestSession proactive tool — in-handler interaction via context (validates, shows card, awaits response) | Updated |
| `visualization.py` | bonsai_visualize display tool — agent renders structured visualizations in the UI | No change |
| `specs.py` | Spec & registry MCP tools — 7 tools for spec CRUD, link queries, registry mutations | Updated (reads config from context) |
| `_vis_validation.py` | Shared visualization validation — pure stdlib, imported by `visualization.py` and `vis-server.py` | No change |
| `progress.py` | UpdateProgress proactive tool — agent broadcasts phase/plan/status | Future |

## Public Interface

### tools/__init__.py

```python
from app.agent.tools._context import ToolContext, set_tool_context, get_tool_context
from app.agent.tools.specs import intercept_specs, specs_mcp_server
from app.agent.tools.suggest_session import intercept_suggest_session, suggest_session_mcp_server
from app.agent.tools.visualization import intercept_visualize, vis_mcp_server

MCP_SERVERS: dict[str, Any] = {
    "bonsai-vis": vis_mcp_server,
    "bonsai-proactive": suggest_session_mcp_server,
    "bonsai-specs": specs_mcp_server,
}

INTERCEPTORS: dict[str, InterceptFn] = {
    "bonsai_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
    "spec_list": intercept_specs,
    "spec_get": intercept_specs,
    # ... (all 7 spec tools → intercept_specs)
}
```

### _context.py

```python
"""Tool context — session-scoped state for MCP tool handlers via contextvars."""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from typing import Any

from app.agent.models import AgentTask
from app.agent.tracker import Tracker
from app.core.config import AppConfig


@dataclass(frozen=True)
class ToolContext:
    """Immutable session context available to all MCP tool handlers."""
    tracker: Tracker
    notify: Any          # async callable: (method, params, *, request_id?) → None
    task: AgentTask
    config: AppConfig


_tool_context: contextvars.ContextVar[ToolContext] = contextvars.ContextVar("tool_context")


def set_tool_context(tracker: Tracker, notify: Any, task: AgentTask, config: AppConfig) -> contextvars.Token:
    """Set session context. Called by runner.py before SDK operations."""
    return _tool_context.set(ToolContext(tracker=tracker, notify=notify, task=task, config=config))


def get_tool_context() -> ToolContext:
    """Read session context. Called by tool handlers during execution."""
    return _tool_context.get()
```

## Tool Context Pattern

### Why contextvars?

The previous architecture relied on `canUseTool` interceptors to inject session context into tool inputs. This breaks in `bypassPermissions` (yolo) mode because the CLI auto-approves MCP tools via `mcp_message` without calling the `canUseTool` hook. Affected tools:

| Tool | Old interceptor logic | Yolo mode failure |
|------|----------------------|-------------------|
| `SuggestSession` | Validate → Future → card → await response | No card shown, returns generic "Suggestion processed." |
| `spec_*` (7 tools) | Inject `_config` into `updated_input` | `RuntimeError: Missing _config in tool args` |
| `bonsai_visualize` | Auto-approve (no-op) | No impact (interceptor was a no-op) |

With `contextvars`, tool handlers read session context directly — no dependency on the permission hook.

### How runner.py sets context

```python
from app.agent.tools import MCP_SERVERS, set_tool_context
from app.agent.permissions import can_use_tool

# Set context BEFORE creating the SDK client
ctx_token = set_tool_context(tracker, notify, task, config)

options = ClaudeAgentOptions(
    ...
    can_use_tool=partial(can_use_tool, tracker=tracker, notify=notify, task=task, config=config),
    mcp_servers=MCP_SERVERS,
)
```

The `can_use_tool` hook still routes MCP tools through `INTERCEPTORS` for auto-approval, handles `AskUserQuestion` interactively, and falls back to `agent/confirmAction` for unknown tools.

### How tool handlers read context

```python
from app.agent.tools._context import get_tool_context

@tool("SuggestSession", "...", SCHEMA)
async def _suggest_session(args: dict) -> dict:
    ctx = get_tool_context()
    # ctx.tracker, ctx.notify, ctx.task, ctx.config all available
    ...
```

The handler runs in the same asyncio event loop as the runner (MCP SDK servers are in-process). `await future` yields control, allowing the event loop to process the frontend's `agent/respond` RPC and resolve the future.

### How permissions.py routes tools

```python
async def can_use_tool(tool_name, input_data, context, *, tracker, notify, task, config):
    # MCP tools: dispatch via INTERCEPTORS (suffix match → auto-approve)
    for suffix, intercept_fn in INTERCEPTORS.items():
        if tool_name.endswith(suffix):
            return await intercept_fn(input_data, tracker, notify, task, config)

    # SDK built-in: AskUserQuestion
    if tool_name == "AskUserQuestion":
        ...  # interactive flow (Future + card)

    # Default: generic tool approval
    else:
        ...  # confirmAction flow
```

INTERCEPTORS routing ensures MCP tools are auto-approved without prompting the user. All real tool logic lives in the handler via `get_tool_context()`.

## Tool File Contract

Every tool file in `tools/` must export:

| Export | Type | Description |
|--------|------|-------------|
| `<tool>_mcp_server` | MCP server instance | Created via `create_sdk_mcp_server()`. Registered in `MCP_SERVERS`. |
| `<TOOL>_SCHEMA` | `dict` | JSON Schema for the tool's input parameters. Used by `@tool()` decorator. |
| `intercept_<tool>()` | `InterceptFn` | Auto-approve function for `canUseTool`. Registered in `INTERCEPTORS`. |

Tool handlers that need session context call `get_tool_context()`. Intercept functions are simple auto-approvals — all real logic lives in the handler.

### Example: suggest_session.py (in-handler interaction)

```python
"""SuggestSession proactive tool — agent suggests follow-up sessions."""

from uuid import uuid4
from claude_agent_sdk import create_sdk_mcp_server, tool
from app.agent.tools._context import get_tool_context

SUGGEST_SESSION_SCHEMA: dict = { ... }

@tool("SuggestSession", "Suggest a follow-up session...", SUGGEST_SESSION_SCHEMA)
async def _suggest_session(args: dict) -> dict:
    ctx = get_tool_context()

    # Validate skill exists in plugin
    skill = args.get("skill", "")
    if skill:
        skill_error = _validate_skill(skill, ctx.config.plugin_dir)
        if skill_error:
            return _error(skill_error)

    # Validate specIds exist in registry
    spec_ids = args.get("specIds", [])
    if spec_ids:
        spec_error = _validate_spec_ids(spec_ids, ctx.config.get_registry_path())
        if spec_error:
            return _error(spec_error)

    # Interactive flow: send card → await developer response
    request_id = str(uuid4())
    future = ctx.tracker.register_future(ctx.task.bonsai_sid, request_id)
    payload = {
        "bonsaiSid": ctx.task.bonsai_sid,
        "skill": skill,
        "specIds": spec_ids,
        "name": args.get("name", ""),
        "reason": args.get("reason", ""),
    }
    if args.get("prompt"):
        payload["prompt"] = args["prompt"]

    await ctx.notify("agent/suggestSession", payload, request_id=request_id)
    response = await future  # agent suspended until developer responds

    if response.get("behavior") == "deny":
        dismiss_reason = response.get("dismissReason") or response.get("message") or ""
        msg = f"✗ Suggestion dismissed by developer: {dismiss_reason}" if dismiss_reason else "✗ Suggestion dismissed by developer."
        return {"content": [{"type": "text", "text": msg}]}

    return {"content": [{"type": "text", "text": f"✓ Session '{args.get('name', '')}' approved and created."}]}

suggest_session_mcp_server = create_sdk_mcp_server(
    name="bonsai-proactive", tools=[_suggest_session]
)
```

### Example: specs.py (context for config)

```python
@tool("spec_list", "...", SPEC_LIST_SCHEMA)
async def _spec_list(args: dict) -> dict:
    ctx = get_tool_context()
    svc = SpecService(ctx.config)
    # ... use svc directly, no _config injection needed
```

## Output Contract

### MCP_SERVERS

| Key | Server name | Tools exposed | Description |
|-----|-------------|--------------|-------------|
| `"bonsai-vis"` | `bonsai-vis` | `bonsai_visualize` | Display-only visualization rendering |
| `"bonsai-proactive"` | `bonsai-proactive` | `SuggestSession` | Interactive session suggestion |
| `"bonsai-specs"` | `bonsai-specs` | `spec_list`, `spec_get`, `spec_save`, `spec_delete`, `spec_links`, `registry_query`, `registry_mutate` | Spec CRUD and registry |

## Adding a New Tool

1. **Create** `tools/<tool_name>.py` with schema + handler + MCP server + `intercept_<tool>()`
2. **Use** `get_tool_context()` in the handler if session context is needed
3. **Register** in `tools/__init__.py`: add to `MCP_SERVERS` and `INTERCEPTORS`
4. **Done** — works in all permission modes automatically

No changes needed to runner.py, permissions.py, or service.py.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| contextvars for handler logic | Tool handlers access context via `get_tool_context()` | Works in all permission modes. In yolo mode, the CLI bypasses `canUseTool` entirely — interceptors never fire. contextvars are set by the runner and available regardless of how the tool is invoked. |
| INTERCEPTORS for auto-approval | Suffix-matched routing in permissions.py returns `PermissionResultAllow` | In non-yolo modes, `canUseTool` fires for all tools. Without interceptors, MCP tools would fall through to `agent/confirmAction` requiring manual approval. Interceptors auto-approve known MCP tools. |
| One file per tool | Each tool is self-contained: schema + handler + server | Easy to find everything about a tool in one place. |
| Frozen dataclass for ToolContext | `@dataclass(frozen=True)` | Prevents accidental mutation. Context is set once per session by the runner. |
| In-handler interaction for interactive tools | Handler creates Future, sends notification, awaits response | Same async pattern as the old interceptor, but runs at tool execution time — not permission check time. Works regardless of CLI permission decisions. |
| AskUserQuestion stays in permissions.py | Not migrated to contextvars | It's an SDK built-in tool, not an MCP tool. The CLI always sends `canUseTool` for it regardless of permission mode. |
| Graduation to own package | Complex features move to `backend/app/<feature>/` | Prevents tools/ from becoming a dumping ground. |

## Known Limitations

- **No auto-discovery** — Tools must be manually imported and registered in `__init__.py`. This is intentional for explicitness.
- **Single MCP server per tool** — Each tool creates its own MCP server. If multiple tools should share a server, manual coordination in `__init__.py` is needed.
- **contextvars must be set before SDK client creation** — If `set_tool_context()` is not called before the SDK processes tool calls, `get_tool_context()` raises `LookupError`. The runner is the single call site.

## Related Specs

- **Parent:** [Agent Module](../README.md)
- **Tool specs:** [SuggestSession](SUGGEST_SESSION.md), [Visualization](VISUALIZATION.md), [UpdateProgress](PROGRESS.md), [Spec Tools](SPECS_TOOLS.md)
- **Feature specs:** [Proactive Agent Experience](../../../../features/PROACTIVE_AGENT_EXPERIENCE_DESIGN.md)
- **Consumer:** [agent/permissions.py](../permissions.py) (routes `INTERCEPTORS` + SDK built-ins), [agent/runner.py](../runner.py) (sets context + wires `MCP_SERVERS` into SDK)
