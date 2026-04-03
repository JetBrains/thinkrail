"""RecordSpecChange tool — agent records a spec modification on a ticket.

Called by the agent after each ``spec_save`` during a ticket-specify session.
Appends a structured ``SpecChange`` record to the ticket so users can review
what the specify session produced.
"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.board.models import MetaTicketSummary, SpecChange
from app.board.service import BoardService, TicketNotFoundError
from app.core.config import AppConfig

logger = logging.getLogger(__name__)

RECORD_SPEC_CHANGE_SCHEMA: dict = {
    "type": "object",
    "required": ["specId", "specTitle", "changeType", "summary", "detail"],
    "properties": {
        "specId": {
            "type": "string",
            "description": "The ID of the spec that was created or modified.",
        },
        "specTitle": {
            "type": "string",
            "description": "Human-readable title of the spec.",
        },
        "changeType": {
            "type": "string",
            "enum": ["created", "modified", "deleted"],
            "description": "Whether the spec was created, modified, or deleted.",
        },
        "summary": {
            "type": "string",
            "description": "One-line summary of the change.",
        },
        "sectionsChanged": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "List of section names that were affected "
                "(e.g., ['Interface', 'Data Model', 'Constraints'])."
            ),
        },
        "detail": {
            "type": "string",
            "description": (
                "Full structured description of the changes (markdown). "
                "Include before/after summaries for modifications."
            ),
        },
    },
}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


@tool(
    "RecordSpecChange",
    "Record a spec modification on the current meta-ticket. Call this after "
    "each spec_save to track what changes the specify session produced.",
    RECORD_SPEC_CHANGE_SCHEMA,
)
async def _record_spec_change(args: dict) -> dict:
    ctx = get_tool_context()

    ticket_id = ctx.task.meta_ticket_id
    if not ticket_id:
        return _error("This session is not linked to a meta-ticket")

    spec_id = args.get("specId", "")
    if not spec_id:
        return _error("specId is required")

    change = SpecChange(
        spec_id=spec_id,
        spec_title=args.get("specTitle", ""),
        change_type=args.get("changeType", "created"),
        summary=args.get("summary", ""),
        sections_changed=args.get("sectionsChanged", []),
        detail=args.get("detail", ""),
        session_id=ctx.task.bonsai_sid,
    )

    board_service = BoardService(ctx.config)
    try:
        ticket = board_service.add_spec_change(ticket_id, change)
    except TicketNotFoundError:
        return _error(f"Ticket {ticket_id} not found — it may have been deleted")

    # Notify frontend so the UI refreshes
    summary = MetaTicketSummary.from_ticket(ticket)
    await ctx.notify("board/didChange", summary.model_dump(by_alias=True))

    return {
        "content": [
            {
                "type": "text",
                "text": f"✓ Recorded spec change: {change.change_type} '{change.spec_title}'.",
            }
        ]
    }


record_spec_change_mcp_server = create_sdk_mcp_server(
    name="bonsai-spec-changes", tools=[_record_spec_change]
)


async def intercept_record_spec_change(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve — recording spec changes is always safe."""
    return PermissionResultAllow(behavior="allow")
