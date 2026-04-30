"""SuggestDescription tool — agent proposes ticket description text.

Two modes:
- **Suggest** (default): sends an interactive card to the frontend with
  the proposed description.  The user can apply it to the textarea or
  dismiss with feedback.
- **Direct apply** (``apply=True``): writes the description directly to
  the ticket body via ``BoardService`` and notifies the frontend.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from claude_agent_sdk import create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.board.models import MetaTicketSummary
from app.board.service import BoardService, TicketNotFoundError
from app.core.config import AppConfig

logger = logging.getLogger(__name__)

SUGGEST_DESCRIPTION_SCHEMA: dict = {
    "type": "object",
    "required": ["description"],
    "properties": {
        "description": {
            "type": "string",
            "description": (
                "The proposed ticket description text (markdown). "
                "Should follow the structured format: What, Purpose, How, Success Criteria."
            ),
        },
        "section": {
            "type": "string",
            "enum": ["full", "what", "purpose", "how", "criteria"],
            "description": (
                "Which section this suggestion covers. "
                "Defaults to 'full' for a complete description."
            ),
        },
        "apply": {
            "type": "boolean",
            "description": (
                "If true, directly update the ticket body instead of "
                "showing a suggestion card. Use when the user says "
                "'just do it' or 'write it directly'."
            ),
        },
    },
}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


@tool(
    "SuggestDescription",
    "Propose a description for the current meta-ticket. By default, the user "
    "sees a card with the suggested text and can apply it to the description "
    "or dismiss with feedback. Set apply=true to write directly.",
    SUGGEST_DESCRIPTION_SCHEMA,
)
async def _suggest_description(args: dict) -> dict:
    ctx = get_tool_context()

    description = args.get("description", "")
    if not description.strip():
        return _error("description must not be empty")

    ticket_id = ctx.task.meta_ticket_id
    if not ticket_id:
        return _error("This session is not linked to a meta-ticket")

    section = args.get("section", "full")
    apply_directly = args.get("apply", False)

    if apply_directly:
        # Direct flow: update ticket body immediately
        board_service = BoardService(ctx.config)
        try:
            ticket = board_service.update_ticket(ticket_id, body=description)
        except TicketNotFoundError:
            return _error(f"Ticket {ticket_id} not found — it may have been deleted")

        # Auto-transition: idea → described when description is applied
        if ticket.status == "idea":
            ticket = board_service.update_ticket(ticket_id, status="described")

        # Notify frontend so the UI refreshes
        summary = MetaTicketSummary.from_ticket(ticket)
        await ctx.notify("board/didChange", summary.model_dump(by_alias=True))

        return {
            "content": [
                {
                    "type": "text",
                    "text": "✓ Description applied directly to ticket.",
                }
            ]
        }

    # Interactive flow: send card → await user response
    request_id = str(uuid4())
    future = ctx.tracker.register_future(ctx.task.bonsai_sid, request_id)

    await ctx.notify(
        "agent/suggestDescription",
        {
            "bonsaiSid": ctx.task.bonsai_sid,
            "description": description,
            "section": section,
        },
        request_id=request_id,
    )

    response = await future  # agent suspended until user responds

    if response.get("behavior") == "deny":
        dismiss_reason = (
            response.get("dismissReason") or response.get("message") or ""
        )
        msg = (
            f"✗ Description dismissed: {dismiss_reason}"
            if dismiss_reason
            else "✗ Description dismissed by user."
        )
        return {"content": [{"type": "text", "text": msg}]}

    return {
        "content": [
            {"type": "text", "text": "✓ Description applied by user."}
        ]
    }


suggest_description_mcp_server = create_sdk_mcp_server(
    name="bonsai-describe", tools=[_suggest_description]
)


async def intercept_suggest_description(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Auto-approve — interactive flow is handled inside the tool handler."""
    return ToolPermissionResponse(behavior="allow")
