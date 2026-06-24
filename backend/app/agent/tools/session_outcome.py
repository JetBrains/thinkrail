"""SessionFinalize tool — agent declares the done-screen contract.

When a skill finishes, it calls SessionFinalize with the artifacts (files
to open) and the actions the user can take next (queued ticket creations,
recommended follow-up sessions, simple navigation).  The frontend renders
this contract on the session done screen.

The agent should call SessionFinalize once near the end of the skill,
before the conversation closes.  The runtime separately marks the task
as ``done`` when the SDK loop ends — this tool only attaches the outcome.
"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool
from pydantic import ValidationError

from app.agent.models import TicketActionState, AgentTask, SessionOutcome
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig, MCP_PREFIX

logger = logging.getLogger(__name__)

# Sanity caps. Outcomes are user-facing UI driven by the agent — bounding
# the payload keeps a misbehaving skill from filling the disk or the
# done-screen with thousands of entries the user can't realistically act on.
_MAX_ACTIONS = 50
_MAX_ARTIFACTS = 10
_MAX_SUMMARY_LEN = 500

# JSON Schema mirrors the SessionOutcome Pydantic model.  Pydantic still
# validates the parsed payload, so keep this loose-but-typed for the agent.
SESSION_FINALIZE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "Short one-line banner shown above the actions, e.g. 'Project planted. Doc saved to GOAL&REQUIREMENTS.md.'",
        },
        "artifacts": {
            "type": "array",
            "description": "Files produced by the session — opened on the done screen.",
            "items": {
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": {"type": "string", "description": "Project-relative file path."},
                    "label": {"type": "string", "description": "Display name; defaults to the file basename."},
                    "openOnDone": {"type": "boolean", "default": True},
                },
            },
        },
        "actions": {
            "type": "array",
            "description": "Action buttons the user can click after the session. Three kinds: create_ticket (queued board ticket), start_session (recommended follow-up skill), navigate (UI-only).",
            "items": {
                "oneOf": [
                    {
                        "type": "object",
                        "required": ["type", "id", "title"],
                        "properties": {
                            "type": {"const": "create_ticket"},
                            "id": {"type": "string", "description": "Stable identifier — survives reloads and lets the frontend mark this action 'applied'."},
                            "title": {"type": "string", "description": "Ticket title."},
                            "body": {"type": "string"},
                            "state": {"enum": [s.value for s in TicketActionState], "default": TicketActionState.PENDING.value},
                        },
                    },
                    {
                        "type": "object",
                        "required": ["type", "id", "title", "skillId"],
                        "properties": {
                            "type": {"const": "start_session"},
                            "id": {"type": "string"},
                            "title": {"type": "string", "description": "CTA label, e.g. 'Continue → Architecture'."},
                            "description": {"type": "string"},
                            "skillId": {"type": "string"},
                            "prompt": {"type": "string", "description": "Optional first message to the new session."},
                            "primary": {"type": "boolean", "default": False, "description": "Mark this as the recommended next step (renders as primary CTA)."},
                        },
                    },
                    {
                        "type": "object",
                        "required": ["type", "id", "title", "target"],
                        "properties": {
                            "type": {"const": "navigate"},
                            "id": {"type": "string"},
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "target": {"enum": ["board", "specs", "graph", "files"]},
                        },
                    },
                ],
            },
        },
    },
}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


@tool(
    "SessionFinalize",
    "Declare the done-screen contract for this session — what artifacts to open "
    "and which action buttons to offer (queued tickets, follow-up skill, navigation). "
    "Call once near the end of a skill, after all decisions are made.",
    SESSION_FINALIZE_SCHEMA,
)
async def _session_finalize(args: dict) -> dict:
    ctx = get_tool_context()

    try:
        outcome = SessionOutcome.model_validate(args)
    except ValidationError as exc:
        return _error(f"Invalid outcome payload: {exc}")

    if len(outcome.actions) > _MAX_ACTIONS:
        return _error(
            f"Too many actions ({len(outcome.actions)}); max {_MAX_ACTIONS}. "
            f"Pick the most important next steps and group related tickets."
        )
    if len(outcome.artifacts) > _MAX_ARTIFACTS:
        return _error(
            f"Too many artifacts ({len(outcome.artifacts)}); max {_MAX_ARTIFACTS}. "
            f"List only the primary deliverables — supporting files can be discovered from the tree."
        )
    if outcome.summary and len(outcome.summary) > _MAX_SUMMARY_LEN:
        return _error(
            f"Summary too long ({len(outcome.summary)} chars); max {_MAX_SUMMARY_LEN}. "
            f"Keep it to one banner-style line."
        )

    thinkrail_sid = ctx.task.thinkrail_sid
    updated = ctx.tracker.set_outcome(thinkrail_sid, outcome)

    # Tell the frontend the session metadata changed so the done-screen can
    # render the outcome as soon as it's available — even before status=done.
    await ctx.notify(
        "session/didUpdate",
        {"task": updated.model_dump(by_alias=True)},
    )

    # Close the session: SessionFinalize is the agent saying "I've declared
    # the next-step contract, I'm done". Without END_SIGNAL the runtime
    # loop would sit waiting for the next user message and the status would
    # never flip to "done" — the frontend would stay stuck in the
    # in-progress goal layout.
    ctx.tracker.enqueue_end_signal(thinkrail_sid)

    summary = (
        f"Outcome saved: {len(outcome.artifacts)} artifact(s), "
        f"{len(outcome.actions)} action(s)."
    )
    return {"content": [{"type": "text", "text": summary}]}


session_outcome_mcp_server = create_sdk_mcp_server(
    name=f"{MCP_PREFIX}session-outcome", tools=[_session_finalize]
)


async def intercept_session_finalize(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Auto-approve — declaring the outcome is a metadata-only operation."""
    return ToolPermissionResponse(behavior="allow")
