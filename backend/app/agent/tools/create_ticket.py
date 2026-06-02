"""CreateBoardTicket tool — agent creates a new ticket on the board.

Used by skills (new-project) after the user confirms they want V1 features
added to the board. The agent calls this once per feature.
"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.board.models import TicketSummary
from app.board.service import BoardService
from app.core.config import AppConfig

logger = logging.getLogger(__name__)

CREATE_TICKET_SCHEMA: dict = {
    "type": "object",
    "required": ["title"],
    "properties": {
        "title": {
            "type": "string",
            "description": "Short title for the ticket (feature name).",
        },
        "body": {
            "type": "string",
            "description": "Description of the feature.",
        },
        "type": {
            "type": "string",
            "enum": ["feature", "bug", "idea", "improvement"],
            "description": "Ticket type. Defaults to 'feature'.",
        },
    },
}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


@tool(
    "CreateBoardTicket",
    "Create a new ticket on the board. Call once per feature when the user asks "
    "to add V1 features to the board.",
    CREATE_TICKET_SCHEMA,
)
async def _create_board_ticket(args: dict) -> dict:
    ctx = get_tool_context()

    title = args.get("title", "").strip()
    if not title:
        return _error("title is required")

    body = args.get("body", "").strip()
    # Infer initial status from what's provided: title+body → described, title only → idea
    status = "described" if body else "idea"

    board_service = BoardService(ctx.config)
    ticket = board_service.create_ticket(
        title=title,
        body=body,
        type=args.get("type", "feature"),
        status=status,
    )

    summary = TicketSummary.from_ticket(ticket)
    payload = summary.model_dump(by_alias=True)
    payload["bonsaiSid"] = ctx.task.bonsai_sid
    await ctx.notify("board/didCreate", payload)

    return {
        "content": [
            {
                "type": "text",
                "text": f"✓ Created ticket '{title}' ({ticket.id}).",
            }
        ]
    }


create_ticket_mcp_server = create_sdk_mcp_server(
    name="bonsai-create-ticket", tools=[_create_board_ticket]
)


async def intercept_create_board_ticket(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve — the user already confirmed via AskUserQuestion."""
    return PermissionResultAllow(behavior="allow")
