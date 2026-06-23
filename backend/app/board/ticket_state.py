"""TicketState — the single read-model aggregate broadcast to frontends.

Composes a ``Ticket`` (its ``WorkNode`` stage DAG and per-session
``AgentTask`` records) into one structured snapshot carrying a monotonic
``rev``.  Built and broadcast server-side; the frontend renders directly
from it.

``stages`` is the dynamic ``WorkNode`` DAG; ``lifecycle`` is the derived
4-value board grouping.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.board.models import Lifecycle, OrchestrationConfig, OrchestratorRef, _CAMEL_CONFIG
from app.board.work_node import NodeRun, WorkNode, derive_lifecycle

if TYPE_CHECKING:
    from app.board.service import BoardService

logger = logging.getLogger(__name__)


class SessionRef(BaseModel):
    model_config = _CAMEL_CONFIG

    thinkrail_sid: str
    skill_id: str | None = None
    status: str = ""
    name: str = ""
    summary: str | None = None


class TicketState(BaseModel):
    model_config = _CAMEL_CONFIG

    id: str
    title: str
    body: str = ""
    type: str = "feature"
    rev: int = 0
    lifecycle: Lifecycle = Lifecycle.CREATED
    orchestrator: OrchestratorRef | None = None
    orchestration: OrchestrationConfig = Field(default_factory=OrchestrationConfig)
    stages: list[WorkNode] = Field(default_factory=list)
    sessions: list[SessionRef] = Field(default_factory=list)
    linked_spec_ids: list[str] = Field(default_factory=list)
    created: str = ""
    updated: str = ""


def _run_session_ids(nodes: list[WorkNode]) -> list[tuple[str, NodeRun]]:
    """Every ``kind="session"`` run id across the DAG, depth-first, with its run."""
    out: list[tuple[str, NodeRun]] = []
    for node in nodes:
        for run in node.runs:
            if run.kind == "session" and run.session_id:
                out.append((run.session_id, run))
        if node.children:
            out.extend(_run_session_ids(node.children))
    return out


def _session_ref(agent_service, sid: str, run: NodeRun | None) -> SessionRef:
    """Build a ref, enriching from the live session when available, else from the
    persisted run (so counts survive a backend restart / unloaded sessions)."""
    session = None
    if agent_service is not None:
        try:
            session = agent_service.get_task(sid)
        except Exception:
            logger.debug("No live session for %s; using persisted run", sid)
    if session is not None:
        result = getattr(session, "result", None)
        return SessionRef(
            thinkrail_sid=sid, skill_id=session.skill_id, status=str(session.status),
            name=session.name or "",
            summary=result.summary if result else None,
        )
    return SessionRef(
        thinkrail_sid=sid, status=run.status if run else "",
        summary=run.summary if run else None,
    )


def build_ticket_state(board_service: "BoardService", ticket_id: str) -> TicketState:
    """Compose a TicketState from the ticket's stage DAG and sessions.

    Steps live as the implementing node's ``children`` inside ``stages`` — there
    is no separate plan document. ``sessions`` is derived from the DAG's
    persisted session runs plus the orchestrator / attached session ids, so the
    set is authoritative without depending on the live tracker.
    """
    ticket = board_service.get_ticket(ticket_id)
    agent_service = getattr(board_service, "agent_service", None)

    runs_by_sid = {sid: run for sid, run in _run_session_ids(ticket.stages)}
    ordered_ids: list[str] = []
    orch_sid = ticket.orchestrator.session_id if ticket.orchestrator else None
    for sid in [orch_sid, *ticket.session_ids, *runs_by_sid]:
        if sid and sid not in ordered_ids:
            ordered_ids.append(sid)
    sessions = [_session_ref(agent_service, sid, runs_by_sid.get(sid)) for sid in ordered_ids]

    return TicketState(
        id=ticket.id, title=ticket.title, body=ticket.body, type=ticket.type,
        rev=ticket.rev, lifecycle=derive_lifecycle(ticket.stages),
        orchestrator=ticket.orchestrator,
        orchestration=ticket.orchestration.model_copy(deep=True),
        stages=[n.model_copy(deep=True) for n in ticket.stages],
        sessions=sessions,
        linked_spec_ids=list(ticket.linked_spec_ids),
        created=ticket.created, updated=ticket.updated,
    )


async def publish_ticket_state(
    board_service: "BoardService",
    project_path: str,
    ticket_id: str,
    *,
    bus=None,
) -> None:
    """Bump rev, build the snapshot, and broadcast ``ticket/didChange``.

    Single emitter for all ticket/plan/session changes. Never raises — a
    failed emit must not break the mutation that triggered it.
    """
    if bus is None:
        from app.rpc.bus import bus as _default_bus
        bus = _default_bus
    try:
        board_service.bump_rev(ticket_id)
        state = build_ticket_state(board_service, ticket_id)
    except Exception:
        logger.debug("publish_ticket_state: build failed for %s", ticket_id, exc_info=True)
        return
    try:
        await bus.publish_to_project(
            project_path, "ticket/didChange", state.model_dump(by_alias=True),
        )
    except Exception:
        logger.debug("publish_ticket_state: emit failed for %s", ticket_id, exc_info=True)
