"""SuggestSession proactive tool — agent suggests follow-up sessions.

Interactive proactive tool: the agent suggests a follow-up session.
canUseTool intercepts the call, sends a request to the frontend, and awaits
the developer's approve/dismiss.  The handler runs after interception and
returns a result message based on the updated_input.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.spec.registry import find_entry, read_registry

logger = logging.getLogger(__name__)

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
    if args.get("error"):
        return {"content": [{"type": "text", "text": f"Error: {args['error']}"}]}
    if args.get("dismissed"):
        return {"content": [{"type": "text", "text": "✗ Suggestion dismissed by developer."}]}
    if args.get("approved"):
        return {"content": [{"type": "text", "text": f"✓ Session '{args.get('name', '')}' approved and created."}]}
    return {"content": [{"type": "text", "text": "Suggestion processed."}]}


suggest_session_mcp_server = create_sdk_mcp_server(
    name="bonsai-proactive", tools=[_suggest_session]
)


def _validate_skill(skill: str, plugin_dir: Path) -> str | None:
    """Return an error message if the skill does not exist, else None."""
    skill_path = plugin_dir / "skills" / skill / "SKILL.md"
    if not skill_path.is_file():
        return f"Unknown skill: {skill}"
    return None


def _validate_spec_ids(spec_ids: list[str], registry_path: Path) -> str | None:
    """Return an error message if any specId is missing from the registry, else None."""
    if not spec_ids:
        return None
    try:
        entries, _ = read_registry(registry_path)
    except (FileNotFoundError, ValueError) as exc:
        logger.warning("Failed to read registry for validation: %s", exc)
        return f"Cannot validate specIds: registry unavailable ({exc})"
    missing = [sid for sid in spec_ids if find_entry(entries, sid) is None]
    if missing:
        return f"Unknown specIds: {', '.join(missing)}"
    return None


async def intercept_suggest_session(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Intercept SuggestSession tool call — validate inputs, suspend agent, await developer response."""
    plugin_dir = config.plugin_dir
    registry_path = config.get_registry_path()

    # Validate skill exists in the plugin
    skill = input_data.get("skill", "")
    if skill:
        skill_error = _validate_skill(skill, plugin_dir)
        if skill_error:
            return PermissionResultAllow(
                behavior="allow",
                updated_input={**input_data, "error": skill_error},
            )

    # Validate specIds exist in the registry
    spec_ids = input_data.get("specIds", [])
    if spec_ids:
        spec_error = _validate_spec_ids(spec_ids, registry_path)
        if spec_error:
            return PermissionResultAllow(
                behavior="allow",
                updated_input={**input_data, "error": spec_error},
            )

    # Validation passed — proceed with interactive flow
    request_id = str(uuid4())
    future = tracker.register_future(task.bonsai_sid, request_id)
    await notify(
        "agent/suggestSession",
        {
            "bonsaiSid": task.bonsai_sid,
            "skill": skill,
            "specIds": spec_ids,
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
