"""Orchestrator MCP tool — suggest_step for plan-driven execution.

The orchestrator agent calls suggest_step to propose the next plan step.
An interactive card is sent to the frontend; the developer approves or
dismisses. If approved, the frontend creates a new step session.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.board.plan import PlanService
from app.core.config import AppConfig

logger = logging.getLogger(__name__)

SUGGEST_STEP_SCHEMA: dict = {
    "type": "object",
    "required": ["ticketId", "stepNumber"],
    "properties": {
        "ticketId": {
            "type": "string",
            "description": "Meta-ticket ID this plan belongs to",
        },
        "stepNumber": {
            "type": "integer",
            "description": "Step number to propose for execution",
        },
        "reason": {
            "type": "string",
            "description": "Why this step should run next (e.g. dependencies met)",
        },
    },
}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


@tool(
    "suggest_step",
    "Propose the next plan step for execution. Sends an interactive card to "
    "the developer who can approve or dismiss. If approved, a session is "
    "created for that step. Use this when orchestrating a plan.",
    SUGGEST_STEP_SCHEMA,
)
async def _suggest_step(args: dict) -> dict:
    ctx = get_tool_context()
    ticket_id = args.get("ticketId", "")
    step_number = args.get("stepNumber", 0)

    if not ticket_id or not step_number:
        return _error("ticketId and stepNumber are required")

    # Validate the plan and step exist
    plan_svc = PlanService(ctx.config)
    if not plan_svc.plan_exists(ticket_id):
        return _error(f"No plan found for ticket {ticket_id}")

    plan = plan_svc.read_plan(ticket_id)
    all_steps = plan.all_steps()
    step = None
    for s in all_steps:
        if s.number == step_number:
            step = s
            break

    if step is None:
        return _error(f"Step {step_number} not found in plan")

    if step.status not in ("pending",):
        return _error(f"Step {step_number} is already '{step.status}', cannot propose")

    # Check dependencies are met
    done_steps = {s.number for s in all_steps if s.status == "done"}
    unmet = [d for d in step.depends_on if d not in done_steps]
    if unmet:
        deps = ", ".join(f"Step {d}" for d in unmet)
        return _error(f"Step {step_number} is blocked by unfinished dependencies: {deps}")

    # Send interactive card to frontend
    request_id = str(uuid4())
    future = ctx.tracker.register_future(ctx.task.bonsai_sid, request_id)

    payload: dict[str, Any] = {
        "bonsaiSid": ctx.task.bonsai_sid,
        "ticketId": ticket_id,
        "stepNumber": step_number,
        "stepTitle": step.title,
        "skill": step.skill,
        "inputSpecIds": step.input_spec_ids,
        "reason": args.get("reason", ""),
    }

    await ctx.notify(
        "agent/suggestStep",
        payload,
        request_id=request_id,
    )

    response = await future  # suspended until developer responds

    if response.get("behavior") == "deny":
        dismiss_reason = response.get("message") or ""
        msg = (
            f"✗ Step {step_number} dismissed: {dismiss_reason}"
            if dismiss_reason
            else f"✗ Step {step_number} dismissed by developer."
        )
        return {"content": [{"type": "text", "text": msg}]}

    # Step was approved — the frontend will create the session
    return {
        "content": [
            {
                "type": "text",
                "text": (
                    f"✓ Step {step_number}: '{step.title}' approved. "
                    f"Session will be created with skill='{step.skill}'."
                ),
            }
        ]
    }


orchestrator_mcp_server = create_sdk_mcp_server(
    name="bonsai-orchestrator", tools=[_suggest_step]
)


async def intercept_orchestrator(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve — interactive flow handled inside the tool handler."""
    return PermissionResultAllow(behavior="allow")
