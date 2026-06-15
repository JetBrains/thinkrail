from __future__ import annotations

from typing import Any

from app.board.models import ArtifactKind, TicketSummary
from app.board.service import BoardService, TicketNotFoundError
from app.board.ticket_state import build_ticket_state, publish_ticket_state
from app.board.work_node import DagError
from app.rpc.bus import bus
from app.rpc.context import get_current_conn
from app.rpc.errors import INVALID_TRANSITION, TICKET_NOT_FOUND, rpc_handler

_handle_errors = rpc_handler(
    (TicketNotFoundError, TICKET_NOT_FOUND, "Ticket not found"),
    (DagError, INVALID_TRANSITION, "Invalid DAG mutation"),
)


async def _broadcast(service: BoardService, ticket: Any) -> None:
    conn = get_current_conn()
    if conn is None:
        return
    summary = TicketSummary.from_ticket(ticket)
    await bus.publish_to_project(
        conn.project_path, "board/didChange", summary.model_dump(by_alias=True),
    )
    await publish_ticket_state(service, conn.project_path, ticket.id)


@_handle_errors
async def list_tickets(service: BoardService, **params: Any) -> list[dict]:
    return [t.model_dump(by_alias=True) for t in service.list_tickets()]


@_handle_errors
async def get_ticket(service: BoardService, **params: Any) -> dict:
    return service.get_ticket(params["id"]).model_dump(by_alias=True)


@_handle_errors
async def get_state(service: BoardService, **params: Any) -> dict:
    return build_ticket_state(service, params["id"]).model_dump(by_alias=True)


@_handle_errors
async def apply(service: BoardService, **params: Any) -> dict:
    ticket = service.apply(params["ticketId"], params["op"])
    conn = get_current_conn()
    if conn is not None:
        await publish_ticket_state(service, conn.project_path, ticket.id)
    return build_ticket_state(service, ticket.id).model_dump(by_alias=True)


@_handle_errors
async def create_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.create_ticket(
        title=params["title"],
        body=params.get("body", ""),
        type=params.get("type", "feature"),
    )
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def update_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.update_ticket(
        id=params["id"],
        title=params.get("title"),
        body=params.get("body"),
        type=params.get("type"),
    )
    await _broadcast(service, ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def delete_ticket(service: BoardService, **params: Any) -> None:
    service.delete_ticket(params["id"])


@_handle_errors
async def reorder_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.reorder_ticket(params["id"], params["order"])
    await _broadcast(service, ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def link_spec(service: BoardService, **params: Any) -> dict:
    ticket = service.link_spec(params["ticketId"], params["specId"])
    await _broadcast(service, ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def unlink_spec(service: BoardService, **params: Any) -> dict:
    ticket = service.unlink_spec(params["ticketId"], params["specId"])
    await _broadcast(service, ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def attach_session(service: BoardService, **params: Any) -> dict:
    ticket = service.attach_session(params["ticketId"], params["sessionId"])
    await _broadcast(service, ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def detach_session(service: BoardService, **params: Any) -> dict:
    ticket = service.detach_session(params["ticketId"], params["sessionId"])
    await _broadcast(service, ticket)
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def set_orchestrator(service: BoardService, **params: Any) -> dict:
    ticket = service.set_orchestrator(params["ticketId"], params["sessionId"])
    await _broadcast(service, ticket)
    return ticket.model_dump(by_alias=True)


# ── Artifact methods ───────────────────────────────────────────


@_handle_errors
async def read_artifact(service: BoardService, **params: Any) -> dict:
    ticket_id = params["ticketId"]
    kind: ArtifactKind = params["kind"]
    content = service.read_artifact(ticket_id, kind)
    ticket = service.get_ticket(ticket_id)
    return {
        "content": content,
        "updated": ticket.updated,
    }


@_handle_errors
async def board_complete_node(service: BoardService, **params: Any) -> dict:
    ticket_id = params["ticketId"]
    node_id = params["nodeId"]
    agent_service = getattr(service, "agent_service", None)
    if agent_service is not None:
        await agent_service.complete_node(ticket_id, node_id)
    else:
        from datetime import UTC, datetime
        try:
            service.apply(ticket_id, {"op": "recordRunFinish", "id": node_id,
                                      "isError": False, "completedAt": datetime.now(UTC).isoformat()})
        except Exception:
            pass
        await _broadcast(service, service.get_ticket(ticket_id))
    return build_ticket_state(service, ticket_id).model_dump(by_alias=True)


@_handle_errors
async def board_refine_node(service: BoardService, **params: Any) -> dict:
    ticket_id = params["ticketId"]
    node_id = params["nodeId"]
    agent_service = getattr(service, "agent_service", None)
    if agent_service is not None:
        await agent_service.refine_node(ticket_id, node_id)
    else:
        await _broadcast(service, service.get_ticket(ticket_id))
    return build_ticket_state(service, ticket_id).model_dump(by_alias=True)


@_handle_errors
async def write_artifact(service: BoardService, **params: Any) -> dict:
    """Persist edited artifact content to the ticket's file on disk."""
    ticket_id = params["ticketId"]
    kind: ArtifactKind = params["kind"]
    content = params["content"]
    service.write_artifact(ticket_id, kind, content)
    ticket = service.get_ticket(ticket_id)
    return {
        "content": content,
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
    service.get_ticket(ticket_id)
    return parse_patch_log(service._config.get_project_root(), ticket_id)


@_handle_errors
async def skip_phase(service: BoardService, **params: Any) -> dict:
    """RPC: mark a phase as skipped on a ticket (stub — not fully implemented)."""
    ticket = service.get_ticket(params["ticketId"])
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def unskip_phase(service: BoardService, **params: Any) -> dict:
    """RPC: remove a phase from the skipped list (stub — not fully implemented)."""
    ticket = service.get_ticket(params["ticketId"])
    return ticket.model_dump(by_alias=True)
