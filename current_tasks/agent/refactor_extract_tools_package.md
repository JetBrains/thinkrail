# Extract tools/ package and permissions.py from runner.py

> Parent: [Agent Module](../../backend/app/agent/README.md) | Implements: [Agent Tools Package](../../backend/app/agent/tools/README.md) | Priority: **High** | Created: 2026-03-11

## Context

The agent tools package spec (`backend/app/agent/tools/README.md`) defines a clean architecture where each MCP tool lives in its own file with schema + handler + MCP server + `intercept()`. Currently, all tool code is inline in `runner.py`:

- **SuggestSession**: schema, handler, MCP server (lines 35-86) and interception logic (lines 117-142)
- **Visualization**: import of `viz_mcp_server` from `agent/visualization.py`; interception is a 2-line auto-approve in `can_use_tool` (lines 113-116)
- **`can_use_tool`**: monolithic nested function (lines 108-186) that mixes tool interception with AskUserQuestion and generic confirmAction logic

The tools package spec prescribes:
- `tools/__init__.py` — exports `MCP_SERVERS` and `INTERCEPTORS` registries
- `tools/suggest_session.py` — extracted SuggestSession tool
- `tools/visualization.py` — moved from `agent/visualization.py`
- `agent/permissions.py` — extracted `can_use_tool` routing logic using the `INTERCEPTORS` registry

## Plan

### 1. Create `tools/suggest_session.py`

Extract from `runner.py` lines 35-86 and 117-142:

```python
"""SuggestSession proactive tool — agent suggests follow-up sessions."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tracker import Tracker

SUGGEST_SESSION_SCHEMA: dict = {
    "type": "object",
    "required": ["skill", "name", "reason"],
    "properties": {
        "skill": {"type": "string", "description": "Skill ID for the suggested session"},
        "specIds": {"type": "array", "items": {"type": "string"}, "description": "Spec IDs to attach as context"},
        "name": {"type": "string", "description": "Suggested session name"},
        "reason": {"type": "string", "description": "Why the agent suggests this session"},
    },
}


@tool("SuggestSession", "Suggest a follow-up session to the developer...", SUGGEST_SESSION_SCHEMA)
async def _suggest_session(args: dict) -> dict:
    if args.get("dismissed"):
        return {"content": [{"type": "text", "text": "✗ Suggestion dismissed by developer."}]}
    if args.get("approved"):
        return {"content": [{"type": "text", "text": f"✓ Session '{args.get('name', '')}' approved and created."}]}
    return {"content": [{"type": "text", "text": "Suggestion processed."}]}


suggest_session_mcp_server = create_sdk_mcp_server(name="bonsai-proactive", tools=[_suggest_session])


async def intercept_suggest_session(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
) -> PermissionResultAllow:
    request_id = str(uuid4())
    future = tracker.register_future(task.bonsai_sid, request_id)
    await notify("agent/suggestSession", {
        "bonsaiSid": task.bonsai_sid,
        "skill": input_data.get("skill", ""),
        "specIds": input_data.get("specIds", []),
        "name": input_data.get("name", ""),
        "reason": input_data.get("reason", ""),
    }, request_id=request_id)
    response = await future
    if response.get("behavior") == "deny":
        return PermissionResultAllow(behavior="allow", updated_input={**input_data, "dismissed": True})
    return PermissionResultAllow(behavior="allow", updated_input={**input_data, "approved": True})
```

### 2. Move `agent/visualization.py` → `tools/visualization.py`

Move the file and add the `intercept_visualize` function:

```python
# Add to existing visualization.py after viz_mcp_server:

async def intercept_visualize(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
) -> PermissionResultAllow:
    return PermissionResultAllow(behavior="allow")
```

`VIZ_INSTRUCTIONS` stays exported — consumed by `context.py`.

### 3. Create `tools/__init__.py`

```python
"""Agent tools package — registry of MCP servers and tool interceptors."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

from app.agent.models import AgentTask
from app.agent.tracker import Tracker
from app.agent.tools.suggest_session import intercept_suggest_session, suggest_session_mcp_server
from app.agent.tools.visualization import intercept_visualize, viz_mcp_server

InterceptFn = Callable[
    [dict[str, Any], Tracker, Any, AgentTask],
    Awaitable[PermissionResultAllow | PermissionResultDeny],
]

MCP_SERVERS: dict[str, Any] = {
    "bonsai-viz": viz_mcp_server,
    "bonsai-proactive": suggest_session_mcp_server,
}

INTERCEPTORS: dict[str, InterceptFn] = {
    "bonsai_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
}
```

### 4. Create `agent/permissions.py`

Extract the `can_use_tool` routing logic. The tool-specific branches are replaced by the `INTERCEPTORS` registry loop. AskUserQuestion and generic confirmAction stay here (they're SDK built-in tools, not custom MCP tools).

```python
"""Tool permission routing for the agent runtime."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny, ToolPermissionContext

from app.agent.models import AgentTask
from app.agent.tools import INTERCEPTORS
from app.agent.tracker import Tracker


async def can_use_tool(
    tool_name: str,
    input_data: dict[str, Any],
    context: ToolPermissionContext,
    *,
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
) -> PermissionResultAllow | PermissionResultDeny:
    # Check registered tool interceptors (suffix match)
    for suffix, intercept_fn in INTERCEPTORS.items():
        if tool_name.endswith(suffix):
            return await intercept_fn(input_data, tracker, notify, task)

    # Built-in: AskUserQuestion
    if tool_name == "AskUserQuestion":
        request_id = str(uuid4())
        future = tracker.register_future(task.bonsai_sid, request_id)
        await notify("agent/askUserQuestion", {
            "bonsaiSid": task.bonsai_sid,
            "questions": input_data.get("questions", []),
        }, request_id=request_id)
        response = await future
        if response.get("behavior") == "deny":
            return PermissionResultDeny(
                behavior="deny",
                message=response.get("message", "Timed out"),
                interrupt=response.get("interrupt", False),
            )
        return PermissionResultAllow(
            behavior="allow",
            updated_input={
                "questions": response.get("questions", []),
                "answers": response.get("answers", {}),
            },
        )

    # Default: generic tool approval
    else:
        request_id = str(uuid4())
        future = tracker.register_future(task.bonsai_sid, request_id)
        await notify("agent/confirmAction", {
            "bonsaiSid": task.bonsai_sid,
            "toolName": tool_name,
            "toolInput": input_data,
        }, request_id=request_id)
        response = await future
        if response.get("behavior") == "allow":
            return PermissionResultAllow(behavior="allow")
        else:
            return PermissionResultDeny(
                behavior="deny",
                message=response.get("message", "Denied by user"),
                interrupt=response.get("interrupt", False),
            )
```

### 5. Simplify `runner.py`

Replace all tool-related code with imports from the new modules:

```python
# Remove:
#   - Lines 35-86 (SuggestSession schema, handler, MCP server)
#   - Lines 108-186 (entire can_use_tool nested function)
#   - import of viz_mcp_server from agent.visualization
#   - uuid4 import (no longer needed in runner.py)
#
# Add:
from functools import partial
from app.agent.tools import MCP_SERVERS
from app.agent.permissions import can_use_tool

# In options:
options = ClaudeAgentOptions(
    ...
    can_use_tool=partial(can_use_tool, tracker=tracker, notify=notify, task=task),
    mcp_servers=MCP_SERVERS,
)
```

### 6. Update `context.py` import

```python
# Change:
from app.agent.visualization import VIZ_INSTRUCTIONS
# To:
from app.agent.tools.visualization import VIZ_INSTRUCTIONS
```

### 7. Update tests

- Existing `TestSuggestSession` tests in `test_runner.py` — update imports/mocks as needed
- Existing visualization tests (if any) — update import paths
- Add a simple test for `permissions.can_use_tool` routing: verify that tool names ending in registered suffixes dispatch to the correct interceptor

## Files to create

| File | Description |
|------|-------------|
| `backend/app/agent/tools/__init__.py` | `MCP_SERVERS` and `INTERCEPTORS` registries |
| `backend/app/agent/tools/suggest_session.py` | SuggestSession: schema + handler + MCP server + `intercept_suggest_session()` |
| `backend/app/agent/tools/visualization.py` | Moved from `agent/visualization.py`: schema + handler + MCP server + `intercept_visualize()` + `VIZ_INSTRUCTIONS` |
| `backend/app/agent/permissions.py` | `can_use_tool()` routing function using `INTERCEPTORS` |

## Files to modify

| File | Change |
|------|--------|
| `backend/app/agent/runner.py` | Remove inline tool code + `can_use_tool` nested fn. Import `MCP_SERVERS` from tools, `can_use_tool` from permissions. Use `functools.partial` to bind tracker/notify/task. |
| `backend/app/agent/context.py` | Update `VIZ_INSTRUCTIONS` import path |
| `backend/tests/agent/test_runner.py` | Update mocks/imports for new module paths |

## Files to delete

| File | Reason |
|------|--------|
| `backend/app/agent/visualization.py` | Moved to `tools/visualization.py` |

## Design notes

- **AskUserQuestion stays in `permissions.py`**, not in `tools/` — it's an SDK built-in tool with no schema/handler/MCP server.
- **`partial()` for `can_use_tool`** — binds `tracker`, `notify`, and `task` so the SDK callback signature `(tool_name, input_data, context)` is satisfied while giving permissions access to runtime state.
- **No behavioral changes** — this is a pure structural refactoring. Every tool call, interception, and response must behave identically before and after.
- **Suffix matching** is already the pattern used in current runner.py (`tool_name.endswith("bonsai_visualize")`, `tool_name.endswith("SuggestSession")`).

## Definition of done

- [ ] `tools/__init__.py` exports `MCP_SERVERS` and `INTERCEPTORS`
- [ ] `tools/suggest_session.py` has schema + handler + MCP server + `intercept_suggest_session()`
- [ ] `tools/visualization.py` has schema + handler + MCP server + `intercept_visualize()` + `VIZ_INSTRUCTIONS`
- [ ] `permissions.py` has `can_use_tool()` routing via `INTERCEPTORS` + AskUserQuestion + generic confirmAction
- [ ] `runner.py` has no inline tool code — imports from `tools` and `permissions`
- [ ] `context.py` imports `VIZ_INSTRUCTIONS` from `tools.visualization`
- [ ] `agent/visualization.py` is deleted (moved to `tools/`)
- [ ] All 23 existing tests pass with no behavioral changes
- [ ] New test verifies `INTERCEPTORS` routing dispatches correctly
