"""SuggestSession proactive tool — agent suggests follow-up sessions.

Interactive proactive tool: the agent suggests a follow-up session.
canUseTool intercepts the call, sends a request to the frontend, and awaits
the developer's approve/dismiss.  The handler runs after interception and
returns a result message based on the updated_input.
"""

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
        "skill": {
            "type": "string",
            "description": "Skill ID for the suggested session (e.g. 'module-design', 'task-spec')",
        },
        "specIds": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Spec IDs to attach as context (defaults to [])",
        },
        "name": {
            "type": "string",
            "description": "Suggested session name",
        },
        "reason": {
            "type": "string",
            "description": "Why the agent suggests this session",
        },
    },
}


@tool(
    "SuggestSession",
    "Suggest a follow-up session to the developer. The developer sees a card "
    "with the skill, specs, name, and reason — and can approve or dismiss. "
    "If approved, a new session is auto-created. If dismissed, you receive "
    "a dismissal flag and should continue your current work.",
    SUGGEST_SESSION_SCHEMA,
)
async def _suggest_session(args: dict) -> dict:
    # Actual interaction handled by canUseTool interception.
    # This handler runs AFTER canUseTool returns Allow with updated_input.
    if args.get("dismissed"):
        return {"content": [{"type": "text", "text": "✗ Suggestion dismissed by developer."}]}
    if args.get("approved"):
        return {"content": [{"type": "text", "text": f"✓ Session '{args.get('name', '')}' approved and created."}]}
    return {"content": [{"type": "text", "text": "Suggestion processed."}]}


suggest_session_mcp_server = create_sdk_mcp_server(
    name="bonsai-proactive", tools=[_suggest_session]
)


async def intercept_suggest_session(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
) -> PermissionResultAllow:
    """Intercept SuggestSession tool call — suspend agent, await developer response."""
    request_id = str(uuid4())
    future = tracker.register_future(task.bonsai_sid, request_id)
    await notify(
        "agent/suggestSession",
        {
            "bonsaiSid": task.bonsai_sid,
            "skill": input_data.get("skill", ""),
            "specIds": input_data.get("specIds", []),
            "name": input_data.get("name", ""),
            "reason": input_data.get("reason", ""),
        },
        request_id=request_id,
    )
    response = await future
    if response.get("behavior") == "deny":
        return PermissionResultAllow(
            behavior="allow",
            updated_input={**input_data, "dismissed": True},
        )
    return PermissionResultAllow(
        behavior="allow",
        updated_input={**input_data, "approved": True},
    )
