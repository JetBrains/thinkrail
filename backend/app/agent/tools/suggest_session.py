"""SuggestSession proactive tool — agent suggests follow-up sessions.

In-handler interaction: the handler validates inputs, sends a card to the
frontend, and awaits the developer's approve/dismiss.  Uses ``get_tool_context()``
to access session state — works in all permission modes including yolo.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.spec.index import SpecIndex

logger = logging.getLogger(__name__)

SUGGEST_SESSION_SCHEMA: dict = {
    "type": "object",
    "required": ["name", "reason"],
    "properties": {
        "skill": {
            "type": "string",
            "description": (
                "Skill ID for the suggested session. "
                "Use the SHORT name without namespace prefix "
                "(e.g. 'module-design', 'task-spec', NOT 'specdriven:module-design')."
            ),
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
        "prompt": {
            "type": "string",
            "description": (
                "Optional instructions or task description for the new session. "
                "Placed before the skill instructions in the system prompt."
            ),
        },
    },
}


def _validate_skill(skill: str, plugin_dir: Path) -> str | None:
    """Return an error message if the skill does not exist, else None."""
    skill_path = plugin_dir / "skills" / skill / "SKILL.md"
    if not skill_path.is_file():
        return f"Unknown skill: {skill}"
    return None


async def _validate_spec_ids(spec_ids: list[str], project_root: Path) -> str | None:
    """Return an error message if any specId is missing from the index, else None."""
    if not spec_ids:
        return None
    from app.core.config import get_index_path

    db_path = get_index_path(project_root)
    if not db_path.exists():
        return "Cannot validate specIds: index not found"
    try:
        async with SpecIndex(db_path) as index:
            missing = [sid for sid in spec_ids if await index.get_spec(sid) is None]
    except Exception as exc:
        logger.warning("Failed to validate spec IDs via index: %s", exc)
        return f"Cannot validate specIds: index unavailable ({exc})"
    if missing:
        return f"Unknown specIds: {', '.join(missing)}"
    return None


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


@tool(
    "SuggestSession",
    "Suggest a follow-up session to the developer. The developer sees a card "
    "with the skill, specs, name, and reason — and can approve or dismiss. "
    "If approved, a new session is auto-created. If dismissed, you receive "
    "a dismissal flag and should continue your current work.",
    SUGGEST_SESSION_SCHEMA,
)
async def _suggest_session(args: dict) -> dict:
    ctx = get_tool_context()

    # --- Validate inputs ---
    skill = args.get("skill", "")
    if skill:
        skill_error = _validate_skill(skill, ctx.config.plugin_dir)
        if skill_error:
            return _error(skill_error)

    spec_ids = args.get("specIds", [])
    if spec_ids:
        spec_error = await _validate_spec_ids(spec_ids, ctx.config.get_project_root())
        if spec_error:
            return _error(spec_error)

    # --- Interactive flow: send card → await developer response ---
    request_id = str(uuid4())
    future = ctx.tracker.register_future(ctx.task.bonsai_sid, request_id)

    payload: dict[str, Any] = {
        "bonsaiSid": ctx.task.bonsai_sid,
        "skill": skill,
        "specIds": spec_ids,
        "name": args.get("name", ""),
        "reason": args.get("reason", ""),
    }
    prompt = args.get("prompt")
    if prompt:
        payload["prompt"] = prompt

    await ctx.notify(
        "agent/suggestSession",
        payload,
        request_id=request_id,
    )

    response = await future  # agent suspended until developer responds

    # --- Handle response ---
    if response.get("behavior") == "deny":
        dismiss_reason = (
            response.get("dismissReason") or response.get("message") or ""
        )
        msg = (
            f"✗ Suggestion dismissed by developer: {dismiss_reason}"
            if dismiss_reason
            else "✗ Suggestion dismissed by developer."
        )
        return {"content": [{"type": "text", "text": msg}]}

    return {
        "content": [
            {
                "type": "text",
                "text": f"✓ Session '{args.get('name', '')}' approved and created.",
            }
        ]
    }


suggest_session_mcp_server = create_sdk_mcp_server(
    name="bonsai-proactive", tools=[_suggest_session]
)


async def intercept_suggest_session(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve — interactive flow is handled inside the tool handler.

    The handler uses get_tool_context() for validation, card notification,
    and Future-based suspension.  This interceptor just lets it through.
    """
    return PermissionResultAllow(behavior="allow")
