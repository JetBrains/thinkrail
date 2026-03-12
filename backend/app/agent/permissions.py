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
    """Route tool permission requests to the appropriate handler.

    Custom MCP tools are dispatched via the INTERCEPTORS registry (suffix match).
    SDK built-in tools (AskUserQuestion) and unknown tools go through the
    interactive approval flow.
    """
    # Check registered tool interceptors (suffix match)
    for suffix, intercept_fn in INTERCEPTORS.items():
        if tool_name.endswith(suffix):
            return await intercept_fn(input_data, tracker, notify, task)

    # Built-in: AskUserQuestion
    if tool_name == "AskUserQuestion":
        request_id = str(uuid4())
        future = tracker.register_future(task.bonsai_sid, request_id)
        await notify(
            "agent/askUserQuestion",
            {"bonsaiSid": task.bonsai_sid, "questions": input_data.get("questions", [])},
            request_id=request_id,
        )
        response = await future
        # Check for timeout auto-deny
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
        await notify(
            "agent/confirmAction",
            {
                "bonsaiSid": task.bonsai_sid,
                "toolName": tool_name,
                "toolInput": input_data,
            },
            request_id=request_id,
        )
        response = await future
        if response.get("behavior") == "allow":
            return PermissionResultAllow(behavior="allow")
        else:
            return PermissionResultDeny(
                behavior="deny",
                message=response.get("message", "Denied by user"),
                interrupt=response.get("interrupt", False),
            )
