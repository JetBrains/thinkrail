---
id: agent-tools
type: module-design
status: active
title: Agent Tools — Design Specification
parent: module-agent
covers:
- backend/app/agent/tools/
tags:
- backend
- agent-orchestration
- mcp-tools
---
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

**Interceptors are simplified auto-approvals.** All real tool logic lives in the handler via `contextvars`. The interceptors just return `ToolPermissionResponse(behavior="allow")` so tools aren't gated behind `agent/confirmAction` in non-yolo modes.

## File Organization

| File | Responsibility | Status |
|------|---------------|--------|
| `__init__.py` | Re-exports `MCP_SERVERS`, `INTERCEPTORS`, and context helpers from all tool files | Active |
| `_context.py` | `contextvars`-based session context: `set_tool_context()`, `get_tool_context()`, `ToolContext` dataclass | Active |
| `suggest_session.py` | SuggestSession proactive tool — in-handler interaction via context (validates, shows card, awaits response) | Active |
| `visualization.py` | thinkrail_visualize display tool — agent renders structured visualizations in the UI | Active |
| `specs.py` | Spec MCP tools — 3 tools: `spec_search`, `spec_links`, `spec_delete` | Active |
| `suggest_description.py` | SuggestDescription proactive tool — agent proposes meta-ticket descriptions | Active |
| `orchestrator.py` | Orchestrator tool — proposes next plan step for ticket execution | Active |
| `change_ticket_status.py` | ChangeTicketStatus tool — transitions meta-ticket status | Active |
| `_vis_validation.py` | Shared visualization validation — pure stdlib, imported by `visualization.py` and `vis-server.py` | Active |
| `progress.py` | UpdateProgress proactive tool — agent broadcasts phase/plan/status | Future |

## Public Interface

### tools/__init__.py

```python
from app.agent.tools._context import ToolContext, set_tool_context, get_tool_context
from app.agent.tools.specs import intercept_specs, specs_mcp_server
from app.agent.tools.suggest_session import intercept_suggest_session, suggest_session_mcp_server
from app.agent.tools.suggest_description import intercept_suggest_description, suggest_description_mcp_server
from app.agent.tools.visualization import intercept_visualize, vis_mcp_server
from app.agent.tools.orchestrator import intercept_orchestrator, orchestrator_mcp_server
from app.agent.tools.change_ticket_status import intercept_change_ticket_status, change_ticket_status_mcp_server

MCP_SERVERS: dict[str, Any] = {
    "thinkrail-vis": vis_mcp_server,
    "thinkrail-proactive": suggest_session_mcp_server,
    "thinkrail-specs": specs_mcp_server,
    "thinkrail-describe": suggest_description_mcp_server,
    "thinkrail-orchestrator": orchestrator_mcp_server,
    "thinkrail-ticket-status": change_ticket_status_mcp_server,
}

INTERCEPTORS: dict[str, InterceptFn] = {
    "thinkrail_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
    "SuggestDescription": intercept_suggest_description,
    "suggest_step": intercept_orchestrator,
    "ChangeTicketStatus": intercept_change_ticket_status,
    "spec_search": intercept_specs,
    "spec_links": intercept_specs,
    "spec_delete": intercept_specs,
}
```

### _context.py

```python
"""Tool context — session-scoped state for MCP tool handlers via contextvars."""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.agent.models import AgentTask
from app.agent.tracker import Tracker
from app.core.config import AppConfig

if TYPE_CHECKING:
    from app.spec.service import SpecService


@dataclass(frozen=True)
class ToolContext:
    """Immutable session context available to all MCP tool handlers."""
    tracker: Tracker
    notify: Any          # async callable: (method, params, *, request_id?) → None
    task: AgentTask
    config: AppConfig
    spec_service: SpecService | None = None  # cached service from server (reuses index connection)


_tool_context: contextvars.ContextVar[ToolContext] = contextvars.ContextVar("tool_context")


def set_tool_context(
    tracker: Tracker, notify: Any, task: AgentTask, config: AppConfig,
    spec_service: SpecService | None = None,
) -> contextvars.Token:
    """Set session context. Called by `runtime/claude/runtime.py` before SDK operations."""
    return _tool_context.set(
        ToolContext(tracker=tracker, notify=notify, task=task, config=config, spec_service=spec_service)
    )


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
| `spec_*` (3 tools) | Inject `_config` into `updated_input` | `RuntimeError: Missing _config in tool args` |
| `thinkrail_visualize` | Auto-approve (no-op) | No impact (interceptor was a no-op) |

With `contextvars`, tool handlers read session context directly — no dependency on the permission hook.

### How `ClaudeRuntime.run_session` sets context

```python
from app.agent.tools import MCP_SERVERS, set_tool_context
from app.agent.permissions import claude_can_use_tool_adapter

# Set context BEFORE creating the SDK client
# spec_service is threaded from AgentService → ClaudeRuntime for index connection reuse
set_tool_context(tracker, notify, task, config, spec_service=spec_service)

options = ClaudeAgentOptions(
    ...
    can_use_tool=_can_use_tool,  # closure that delegates to claude_can_use_tool_adapter
    mcp_servers=MCP_SERVERS,
)
```

The `claude_can_use_tool_adapter` builds a `ToolPermissionRequest` from the SDK's `(tool_name, input_data, ToolPermissionContext)` triple, calls the runtime-neutral `can_use_tool` engine in `permissions.py`, and converts the `ToolPermissionResponse` back to `PermissionResultAllow | PermissionResultDeny`. The `INTERCEPTORS` registry still auto-approves MCP tools, mode-category filtering still applies, and `AskUserQuestion` / unknown tools still flow through `agent/askUserQuestion` / `agent/confirmAction`.

### How tool handlers read context

```python
from app.agent.tools._context import get_tool_context

@tool("SuggestSession", "...", SCHEMA)
async def _suggest_session(args: dict) -> dict:
    ctx = get_tool_context()
    # ctx.tracker, ctx.notify, ctx.task, ctx.config, ctx.spec_service all available
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

    # Validate specIds exist in index
    spec_ids = args.get("specIds", [])
    if spec_ids:
        spec_error = await _validate_spec_ids(spec_ids, ctx.config.get_thinkrail_dir())
        if spec_error:
            return _error(spec_error)

    # Interactive flow: send card → await developer response
    request_id = str(uuid4())
    future = ctx.tracker.register_future(ctx.task.thinkrail_sid, request_id)
    payload = {
        "thinkrailSid": ctx.task.thinkrail_sid,
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
    name="thinkrail-proactive", tools=[_suggest_session]
)
```

### Example: specs.py (cached SpecService via context)

```python
@tool("spec_search", "...", SPEC_SEARCH_SCHEMA)
async def _spec_search(args: dict) -> dict:
    async with _index_service() as svc:
        # _index_service() yields ctx.spec_service (cached) or opens fresh connection
        results = await svc.list_specs(...)
```

## Output Contract

### MCP_SERVERS

| Key | Server name | Tools exposed | Description |
|-----|-------------|--------------|-------------|
| `"thinkrail-vis"` | `thinkrail-vis` | `thinkrail_visualize` | Display-only visualization rendering |
| `"thinkrail-proactive"` | `thinkrail-proactive` | `SuggestSession` | Interactive session suggestion |
| `"thinkrail-specs"` | `thinkrail-specs` | `spec_search`, `spec_links`, `spec_delete` | Spec search, link queries, and deletion |
| `"thinkrail-describe"` | `thinkrail-describe` | `SuggestDescription` | Propose meta-ticket descriptions |
| `"thinkrail-orchestrator"` | `thinkrail-orchestrator` | `suggest_step` | Propose next plan step for execution |
| `"thinkrail-ticket-status"` | `thinkrail-ticket-status` | `ChangeTicketStatus` | Transition meta-ticket status |

## Adding a New Tool

1. **Create** `tools/<tool_name>.py` with schema + handler + MCP server + `intercept_<tool>()`
2. **Use** `get_tool_context()` in the handler if session context is needed
3. **Register** in `tools/__init__.py`: add to `MCP_SERVERS` and `INTERCEPTORS`
4. **Done** — works in all permission modes automatically

No changes needed to `runtime/claude/runtime.py`, `permissions.py`, or `service.py`.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| contextvars for handler logic | Tool handlers access context via `get_tool_context()` | Works in all permission modes. In yolo mode, the CLI bypasses `canUseTool` entirely — interceptors never fire. contextvars are set by `ClaudeRuntime.run_session` and available regardless of how the tool is invoked. |
| INTERCEPTORS for auto-approval | Suffix-matched routing in permissions.py returns `ToolPermissionResponse(behavior="allow")` | In non-yolo modes, `canUseTool` fires for all tools. Without interceptors, MCP tools would fall through to `agent/confirmAction` requiring manual approval. Interceptors auto-approve known MCP tools. |
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
- **Tool specs:** [SuggestSession](SUGGEST_SESSION.md), [Visualization](VISUALIZATION.md), [UpdateProgress](PROGRESS.md), [Spec Tools](SPECS_TOOLS.md), [Orchestrator](ORCHESTRATOR.md)
- **Feature specs:** [Proactive Agent Experience](../../../../.tr/design_docs/PROACTIVE_AGENT_EXPERIENCE_DESIGN.md)
- **Consumer:** [agent/permissions.py](../permissions.py) (routes `INTERCEPTORS` + SDK built-ins), [agent/runtime/claude/runtime.py](../runtime/claude/runtime.py) (sets context + wires `MCP_SERVERS` into SDK)
