"""ChangeTicketStatus tool — agent transitions a ticket to a new state.

Used by skills (ticket-describe, ticket-specify, ticket-plan) after
getting user confirmation via AskUserQuestion.  The agent asks the user
whether to advance the ticket, and if confirmed, calls this tool.
"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.board.models import MetaTicketSummary
from app.board.service import BoardService, TicketNotFoundError
from app.board.state_machine import InvalidTransitionError
from app.core.config import AppConfig

logger = logging.getLogger(__name__)

CHANGE_STATUS_SCHEMA: dict = {
    "type": "object",
    "required": ["status"],
    "properties": {
        "status": {
            "type": "string",
            "enum": [
                "idea",
                "described",
                "specified",
                "planned",
                "executing",
                "done",
            ],
            "description": "The target status to transition the ticket to.",
        },
    },
}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


@tool(
    "ChangeTicketStatus",
    "Transition the current meta-ticket to a new status. Use after "
    "confirming the transition with the user via AskUserQuestion.",
    CHANGE_STATUS_SCHEMA,
)
async def _change_ticket_status(args: dict) -> dict:
    ctx = get_tool_context()

    status = args.get("status", "")
    if not status:
        return _error("status is required")

    ticket_id = ctx.task.meta_ticket_id
    if not ticket_id:
        return _error("This session is not linked to a meta-ticket")

    board_service = BoardService(ctx.config)
    try:
        ticket = board_service.update_ticket(ticket_id, status=status)
    except TicketNotFoundError:
        return _error(f"Ticket {ticket_id} not found — it may have been deleted")
    except InvalidTransitionError as exc:
        return _error(str(exc))

    # Notify frontend so the UI refreshes
    summary = MetaTicketSummary.from_ticket(ticket)
    await ctx.notify("board/didChange", summary.model_dump(by_alias=True))

    return {
        "content": [
            {
                "type": "text",
                "text": f"✓ Ticket status changed to '{status}'.",
            }
        ]
    }


change_ticket_status_mcp_server = create_sdk_mcp_server(
    name="bonsai-ticket-status", tools=[_change_ticket_status]
)


async def intercept_change_ticket_status(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve — the user already confirmed via AskUserQuestion."""
    return PermissionResultAllow(behavior="allow")
