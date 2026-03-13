# Agent Tools — Design Specification

> Parent: [Agent Module](../README.md) | Status: **Active** | Created: 2026-03-11

## Table of Contents
1. [Purpose](#purpose)
2. [Design Principle](#design-principle)
3. [File Organization](#file-organization)
4. [Public Interface](#public-interface)
5. [Tool File Contract](#tool-file-contract)
6. [Output Contract](#output-contract)
7. [Interception Pattern](#interception-pattern)
8. [Adding a New Tool](#adding-a-new-tool)
9. [Key Design Decisions](#key-design-decisions)
10. [Known Limitations](#known-limitations)
11. [Related Specs](#related-specs)

## Purpose

Self-contained MCP tools for the agent runtime. Each tool lives in its own file with schema, handler, MCP server instance, and interception logic. The `tools/` package is the single source of truth for what custom tools the agent can use and how each tool's permission flow works.

**Graduation rule:** A tool starts here as a single file. If it grows complex enough to need its own models, service layer, or multi-file logic (like the `viz/` dashboard), it graduates to a top-level package under `backend/app/`.

## Design Principle

Follow the pattern established by `visualization.py`:

```
One file = one tool = schema + handler + MCP server + intercept()
```

The `tools/__init__.py` re-exports everything the runner needs:
- `MCP_SERVERS` — dict of server name → MCP server instance (wired into SDK)
- `INTERCEPTORS` — dict of tool name suffix → intercept function (used by `permissions.py`)

## File Organization

| File | Responsibility | Status |
|------|---------------|--------|
| `__init__.py` | Re-exports `MCP_SERVERS` and `INTERCEPTORS` registries from all tool files | New |
| `suggest_session.py` | SuggestSession proactive tool — agent suggests a follow-up session, developer approves/dismisses | New (extracted from runner.py lines 35–86, 117–142) |
| `visualization.py` | bonsai_visualize display tool — agent renders structured visualizations in the UI | Moved from `agent/visualization.py` |
| `progress.py` | UpdateProgress proactive tool — agent broadcasts phase/plan/status (auto-approved) | Future |
| `SUGGEST_SESSION.md` | Backend spec for SuggestSession | Existing |
| `PROGRESS.md` | Backend spec for UpdateProgress | Existing |

## Public Interface

### tools/__init__.py

```python
from app.agent.tools.suggest_session import suggest_session_mcp_server, intercept_suggest_session
from app.agent.tools.visualization import viz_mcp_server, intercept_visualize

# Registry: server name → MCP server instance
# Passed to ClaudeAgentOptions.mcp_servers in runner.py
MCP_SERVERS: dict[str, Any] = {
    "bonsai-viz": viz_mcp_server,
    "bonsai-proactive": suggest_session_mcp_server,
}

# Registry: tool name suffix → intercept function
# Used by permissions.py to route can_use_tool() callbacks
INTERCEPTORS: dict[str, InterceptFn] = {
    "bonsai_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
}
```

### InterceptFn signature

```python
async def intercept_<tool>(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Callable,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow | PermissionResultDeny
```

Each intercept function receives the tool input, tracker (for futures), notify callback (for frontend requests), the current task, and the app config (for plugin dir, registry path, etc.). Returns a permission result that the SDK understands.

## Tool File Contract

Every tool file in `tools/` must export:

| Export | Type | Description |
|--------|------|-------------|
| `<tool>_mcp_server` | MCP server instance | Created via `create_sdk_mcp_server()`. Registered in `MCP_SERVERS`. |
| `intercept_<tool>()` | `InterceptFn` | Handles the `can_use_tool()` callback for this tool. Registered in `INTERCEPTORS`. |
| `<TOOL>_SCHEMA` | `dict` | JSON Schema for the tool's input parameters. Used by `@tool()` decorator. |

### Example: suggest_session.py

```python
"""SuggestSession proactive tool — agent suggests follow-up sessions."""

from claude_agent_sdk import create_sdk_mcp_server, tool, PermissionResultAllow
from app.agent.tracker import Tracker
from app.agent.models import AgentTask
from app.core.config import AppConfig

SUGGEST_SESSION_SCHEMA: dict = { ... }

@tool("SuggestSession", "Suggest a follow-up session...", SUGGEST_SESSION_SCHEMA)
async def _suggest_session(args: dict) -> dict:
    if args.get("error"):
        return {"content": [{"type": "text", "text": f"Error: {args['error']}"}]}
    if args.get("dismissed"):
        reason = args.get("dismissReason", "")
        msg = f"✗ Suggestion dismissed by developer: {reason}" if reason else "✗ Suggestion dismissed by developer."
        return {"content": [{"type": "text", "text": msg}]}
    if args.get("approved"):
        return {"content": [{"type": "text", "text": f"✓ Session '{args.get('name', '')}' approved."}]}
    return {"content": [{"type": "text", "text": "Suggestion processed."}]}

suggest_session_mcp_server = create_sdk_mcp_server(
    name="bonsai-proactive", tools=[_suggest_session]
)

async def intercept_suggest_session(
    input_data: dict, tracker: Tracker, notify, task: AgentTask, config: AppConfig,
) -> PermissionResultAllow:
    # Validate skill and specIds against plugin dir and registry
    skill = input_data.get("skill", "")
    if skill:
        skill_error = _validate_skill(skill, config.plugin_dir)
        if skill_error:
            return PermissionResultAllow(behavior="allow", updated_input={**input_data, "error": skill_error})
    # ... (specIds validation omitted for brevity)

    request_id = str(uuid4())
    future = tracker.register_future(task.bonsai_sid, request_id)
    payload = {
        "bonsaiSid": task.bonsai_sid,
        "skill": skill,
        "specIds": input_data.get("specIds", []),
        "name": input_data.get("name", ""),
        "reason": input_data.get("reason", ""),
    }
    prompt = input_data.get("prompt")
    if prompt:
        payload["prompt"] = prompt
    await notify("agent/suggestSession", payload, request_id=request_id)
    response = await future
    if response.get("behavior") == "deny":
        dismiss_reason = response.get("dismissReason") or response.get("message") or ""
        updated = {**input_data, "dismissed": True}
        if dismiss_reason:
            updated["dismissReason"] = dismiss_reason
        return PermissionResultAllow(behavior="allow", updated_input=updated)
    return PermissionResultAllow(
        behavior="allow",
        updated_input={**input_data, "approved": True},
    )
```

## Output Contract

### MCP_SERVERS

| Key | Server name | Tool exposed | Description |
|-----|-------------|-------------|-------------|
| `"bonsai-viz"` | `bonsai-viz` | `bonsai_visualize` | Display-only visualization rendering |
| `"bonsai-proactive"` | `bonsai-proactive` | `SuggestSession` | Interactive session suggestion |

### INTERCEPTORS

| Key (suffix match) | Behavior | Suspends? | Returns |
|---------------------|----------|-----------|---------|
| `"bonsai_visualize"` | Auto-approve immediately | No | `PermissionResultAllow` |
| `"SuggestSession"` | Notify frontend → await Future → approve/dismiss | Yes | `PermissionResultAllow` with `updated_input` |

### Future: UpdateProgress

| Key | Behavior | Suspends? | Returns |
|-----|----------|-----------|---------|
| `"UpdateProgress"` | Emit notification → auto-approve | No | `PermissionResultAllow` |

## Interception Pattern

### How permissions.py uses the registry

```python
"""Tool permission routing for the agent runtime."""

from app.agent.tools import INTERCEPTORS

async def can_use_tool(
    tool_name: str,
    input_data: dict,
    context: ToolPermissionContext,
    *,
    tracker: Tracker,
    notify: Callable,
    task: AgentTask,
) -> PermissionResultAllow | PermissionResultDeny:
    # Check registered tool interceptors (suffix match)
    for suffix, intercept_fn in INTERCEPTORS.items():
        if tool_name.endswith(suffix):
            return await intercept_fn(input_data, tracker, notify, task)

    # Built-in: AskUserQuestion (SDK tool, not in tools/)
    if tool_name == "AskUserQuestion":
        ...  # existing logic

    # Default: any other tool requires user approval
    else:
        ...  # existing logic
```

### How runner.py uses the registries

```python
from app.agent.tools import MCP_SERVERS
from app.agent.permissions import can_use_tool

options = ClaudeAgentOptions(
    ...
    can_use_tool=partial(can_use_tool, tracker=tracker, notify=notify, task=task),
    mcp_servers=MCP_SERVERS,
)
```

Runner imports `MCP_SERVERS` for SDK wiring and `can_use_tool` from permissions. No tool-specific logic in runner.py at all.

## Adding a New Tool

1. **Create** `tools/<tool_name>.py` following the [tool file contract](#tool-file-contract)
2. **Export** the MCP server and intercept function
3. **Register** in `tools/__init__.py`: add to `MCP_SERVERS` and `INTERCEPTORS`
4. **Done** — permissions.py and runner.py pick it up automatically via the registries

No changes needed to runner.py, permissions.py, or service.py.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| One file per tool | Each tool is self-contained: schema + handler + server + intercept | Follows the `visualization.py` pattern the project already uses. Easy to find everything about a tool in one place. |
| Registry in `__init__.py` | `MCP_SERVERS` and `INTERCEPTORS` dicts exported from package init | Adding a new tool only requires touching the tool file + `__init__.py`. Runner and permissions are stable. |
| Suffix matching for tool names | `INTERCEPTORS` keys are suffixes, not exact names | MCP tools may be prefixed by server name (e.g., `mcp__bonsai-viz__bonsai_visualize`). Suffix match handles both prefixed and unprefixed names. |
| intercept() co-located with tool | Each tool file owns its interception logic | Tool-specific knowledge (what to notify, how to handle response) stays with the tool definition. permissions.py is a thin router, not a knowledge center. |
| Graduation to own package | Complex features move to `backend/app/<feature>/` | Prevents tools/ from becoming a dumping ground. If a tool needs models.py + service.py + multiple files, it's graduated (like `viz/` did). |
| AskUserQuestion stays in permissions.py | Not extracted to a tool file | It's an SDK built-in tool, not a custom MCP tool. No schema/handler/server — just interception logic. |

## Known Limitations

- **No auto-discovery** — Tools must be manually imported and registered in `__init__.py`. There is no filesystem scanning or decorator-based auto-registration. This is intentional for explicitness but means forgetting to register a tool is a silent failure.
- **Single MCP server per tool** — Each tool creates its own MCP server. If multiple tools should share a server (e.g., all proactive tools on one `bonsai-proactive` server), the current pattern requires manual coordination in `__init__.py`.
- **Suffix collision risk** — If two tools have names where one is a suffix of the other, the `INTERCEPTORS` suffix match could route incorrectly. Current tools don't have this issue.

## Related Specs

- **Parent:** [Agent Module](../README.md)
- **Tool specs:** [SuggestSession](SUGGEST_SESSION.md), [UpdateProgress](PROGRESS.md)
- **Feature specs:** [Proactive Agent Experience](../../../../features/PROACTIVE_AGENT_EXPERIENCE_DESIGN.md)
- **Pattern reference:** [agent/visualization.py](../visualization.py) (original pattern this package follows)
- **Consumer:** [agent/permissions.py](../permissions.py) (routes `can_use_tool` via `INTERCEPTORS`), [agent/runner.py](../runner.py) (wires `MCP_SERVERS` into SDK)
