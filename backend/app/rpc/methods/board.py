from __future__ import annotations

from typing import Any

from app.board.models import ArtifactKind, TicketSummary
from app.board.plan import Milestone, Plan, PlanStep, SuccessCriterion
from app.board.service import BoardService, TicketNotFoundError
from app.board.state_machine import InvalidTransitionError
from app.rpc.bus import bus
from app.rpc.context import get_current_conn
from app.rpc.errors import INVALID_TRANSITION, TICKET_NOT_FOUND, rpc_handler

_handle_errors = rpc_handler(
    (TicketNotFoundError, TICKET_NOT_FOUND, "Ticket not found"),
    (InvalidTransitionError, INVALID_TRANSITION, "Invalid transition"),
)


async def _broadcast(ticket: Any) -> None:
    """Publish board/didChange for a ticket mutation to all project subscribers.

    All mutating board methods funnel through here so a BoardView open in
    a second window sees the change without needing to know which RPC
    triggered it.
    """
    conn = get_current_conn()
    if conn is None:
        return
    summary = TicketSummary.from_ticket(ticket)
    await bus.publish_to_project(
        conn.project_path, "board/didChange", summary.model_dump(by_alias=True),
    )


@_handle_errors
async def list_tickets(service: BoardService, **params: Any) -> list[dict]:
    return [t.model_dump(by_alias=True) for t in service.list_tickets()]


@_handle_errors
async def get_ticket(service: BoardService, **params: Any) -> dict:
    return service.get_ticket(params["id"]).model_dump(by_alias=True)


@_handle_errors
async def create_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.create_ticket(
        title=params["title"],
        body=params.get("body", ""),
        type=params.get("type", "feature"),
        status=params.get("status", "idea"),
    )
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def update_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.update_ticket(
        id=params["id"],
        title=params.get("title"),
        body=params.get("body"),
        status=params.get("status"),
        type=params.get("type"),
    )
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def delete_ticket(service: BoardService, **params: Any) -> None:
    service.delete_ticket(params["id"])


@_handle_errors
async def reorder_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.reorder_ticket(params["id"], params["status"], params["order"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def link_spec(service: BoardService, **params: Any) -> dict:
    ticket = service.link_spec(params["ticketId"], params["specId"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def unlink_spec(service: BoardService, **params: Any) -> dict:
    ticket = service.unlink_spec(params["ticketId"], params["specId"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def attach_session(service: BoardService, **params: Any) -> dict:
    ticket = service.attach_session(params["ticketId"], params["sessionId"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def detach_session(service: BoardService, **params: Any) -> dict:
    ticket = service.detach_session(params["ticketId"], params["sessionId"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def set_orchestrator(service: BoardService, **params: Any) -> dict:
    ticket = service.set_orchestrator(params["ticketId"], params["sessionId"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def skip_phase(service: BoardService, **params: Any) -> dict:
    """RPC: mark a phase as skipped on a ticket."""
    ticket = service.skip_phase(params["ticketId"], params["phase"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def unskip_phase(service: BoardService, **params: Any) -> dict:
    """RPC: remove a phase from the skipped list."""
    ticket = service.unskip_phase(params["ticketId"], params["phase"])
    await _broadcast(ticket)
    return ticket.model_dump(by_alias=True)


# ── Plan methods ────────────────────────────────────────────────


@_handle_errors
async def get_plan(service: BoardService, **params: Any) -> dict | None:
    ticket_id = params["ticketId"]
    if not service.plans.plan_exists(ticket_id):
        return None
    return service.plans.read_plan(ticket_id).model_dump(by_alias=True)


@_handle_errors
async def create_plan(service: BoardService, **params: Any) -> dict:
    ticket_id = params["ticketId"]
    title = params["title"]
    raw_steps = params.get("steps", [])
    raw_verification = params.get("verification", [])

    steps = [PlanStep(**s) for s in raw_steps]
    verification = [SuccessCriterion(**c) for c in raw_verification]

    plan = service.plans.create_plan(ticket_id, title, steps, verification)
    # Update the ticket's implementation_plan_path now that the file exists.
    service.write_artifact(ticket_id, "implementation_plan", service.plans.read_plan_raw(ticket_id))
    return plan.model_dump(by_alias=True)


@_handle_errors
async def update_step(service: BoardService, **params: Any) -> dict:
    plan = service.plans.update_step_status(
        ticket_id=params["ticketId"],
        step_number=params["stepNumber"],
        status=params["status"],
        session_id=params.get("sessionId"),
    )
    return plan.model_dump(by_alias=True)


@_handle_errors
async def save_plan(service: BoardService, **params: Any) -> dict:
    """Save a full structured plan (milestones + verification)."""
    ticket_id = params["ticketId"]
    raw_plan = params["plan"]
    milestones = [
        Milestone(
            number=m["number"],
            title=m["title"],
            description=m.get("description", ""),
            steps=[PlanStep(**s) for s in m.get("steps", [])],
        )
        for m in raw_plan.get("milestones", [])
    ]
    verification = [SuccessCriterion(**c) for c in raw_plan.get("verification", [])]
    plan = Plan(
        ticket_id=ticket_id,
        title=raw_plan.get("title", ""),
        status=raw_plan.get("status", "draft"),
        milestones=milestones,
        verification=verification,
    )
    result = service.plans.save_plan(ticket_id, plan)
    # Sync implementation_plan_path on the ticket
    ticket = service.get_ticket(ticket_id)
    if not ticket.implementation_plan_path:
        service.write_artifact(ticket_id, "implementation_plan", service.plans.read_plan_raw(ticket_id))
    return result.model_dump(by_alias=True)


@_handle_errors
async def get_plan_raw(service: BoardService, **params: Any) -> dict:
    """Return the raw markdown content of a plan file."""
    ticket_id = params["ticketId"]
    if not service.plans.plan_exists(ticket_id):
        return {"content": ""}
    content = service.plans.read_plan_raw(ticket_id)
    return {"content": content}


@_handle_errors
async def save_plan_raw(service: BoardService, **params: Any) -> dict:
    """Write raw markdown and return the parsed plan."""
    ticket_id = params["ticketId"]
    content = params["content"]
    plan = service.plans.write_plan_raw(ticket_id, content)
    # Sync ticket.implementation_plan_path
    ticket = service.get_ticket(ticket_id)
    if not ticket.implementation_plan_path:
        service.write_artifact(ticket_id, "implementation_plan", content)
    return plan.model_dump(by_alias=True)


@_handle_errors
async def get_next_step(service: BoardService, **params: Any) -> dict | None:
    step = service.plans.get_next_step(params["ticketId"])
    if step is None:
        return None
    return step.model_dump(by_alias=True)


# ── Artifact methods ───────────────────────────────────────────


@_handle_errors
async def read_artifact(service: BoardService, **params: Any) -> dict:
    ticket_id = params["ticketId"]
    kind: ArtifactKind = params["kind"]
    content = service.read_artifact(ticket_id, kind)
    ticket = service.get_ticket(ticket_id)
    return {
        "content": content,
        "stale": getattr(ticket, f"{kind}_stale", False),
        "updated": ticket.updated,
    }


@_handle_errors
async def get_history(service: BoardService, **params: Any) -> list[dict]:
    """Parse the per-ticket history.patch log into structured entries.

    Each entry: index, skill (None for legacy), filePath, specId, section,
    rationale, appliedAs, validation, timestamp, diff.
    """
    from app.board.patch import parse_patch_log
    ticket_id = params["ticketId"]
    # Confirm the ticket exists; raises TicketNotFoundError otherwise.
    service.get_ticket(ticket_id)
    return parse_patch_log(service._config.get_project_root(), ticket_id)
