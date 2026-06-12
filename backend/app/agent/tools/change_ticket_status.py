"""ChangeTicketStatus tool — agent transitions a ticket to a new state.

Used by skills (ticket-describe, ticket-specify, ticket-plan) after
getting user confirmation via AskUserQuestion.  The agent asks the user
whether to advance the ticket, and if confirmed, calls this tool.
"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.board.service import BoardService, TicketNotFoundError
from app.board.state_machine import InvalidTransitionError
from app.core.config import AppConfig, MCP_PREFIX

logger = logging.getLogger(__name__)

CHANGE_STATUS_SCHEMA: dict = {
    "type": "object",
    "required": ["status"],
    "properties": {
        "status": {
            "type": "string",
            "enum": [
                "idea",
                "product-design",
                "technical-design",
                "amend-specs",
                "implementation-plan",
                "implementing",
                "done",
            ],
            "description": "The target status to transition the ticket to.",
        },
    },
}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


def _recover_ticket_id(board_service: BoardService, thinkrail_sid: str) -> str | None:
    """Scan tickets for one that already lists ``thinkrail_sid`` in its
    ``session_ids``. If exactly one match is found, return its id; otherwise
    None (caller should hard-fail). Lets us self-heal sessions whose
    in-memory / on-disk ``ticket_id`` got lost (e.g., older SuggestSession
    spawns that didn't carry the link forward)."""
    matches: list[str] = []
    for ticket in board_service.list_tickets():
        if thinkrail_sid in ticket.session_ids:
            matches.append(ticket.id)
            if len(matches) > 1:
                return None
    return matches[0] if matches else None


@tool(
    "ChangeTicketStatus",
    "Transition the current ticket to a new status. Use after "
    "confirming the transition with the user via AskUserQuestion.",
    CHANGE_STATUS_SCHEMA,
)
async def _change_ticket_status(args: dict) -> dict:
    ctx = get_tool_context()

    status = args.get("status", "")
    if not status:
        return _error("status is required")

    board_service = BoardService(ctx.config)
    ticket_id = ctx.task.ticket_id

    # Self-heal a missing link by reverse-lookup on ticket.session_ids.
    if not ticket_id:
        recovered = _recover_ticket_id(board_service, ctx.task.thinkrail_sid)
        if recovered is None:
            return _error(
                "This session is not linked to a ticket "
                "(no ticket lists this session in its sessionIds)"
            )
        ticket_id = recovered
        ctx.task.ticket_id = recovered
        logger.info(
            "Recovered ticket link for session %s -> %s",
            ctx.task.thinkrail_sid[:8], recovered,
        )

    try:
        ticket = board_service.update_ticket(ticket_id, status=status)
    except TicketNotFoundError:
        return _error(f"Ticket {ticket_id} not found — it may have been deleted")
    except InvalidTransitionError as exc:
        return _error(str(exc))
    except RuntimeError as exc:
        # Raised by service.on_status_change on commit/IO failure.
        return _error(str(exc))

    # The service may skip-walk past phases marked as skipped, so report the
    # ticket's resulting status rather than the requested one.
    return {
        "content": [
            {
                "type": "text",
                "text": f"✓ Ticket status changed to '{ticket.status}'.",
            }
        ]
    }


change_ticket_status_mcp_server = create_sdk_mcp_server(
    name=f"{MCP_PREFIX}ticket-status", tools=[_change_ticket_status]
)


async def intercept_change_ticket_status(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Auto-approve — the user already confirmed via AskUserQuestion."""
    return ToolPermissionResponse(behavior="allow")
