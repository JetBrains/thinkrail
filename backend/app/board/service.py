from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.board.models import MetaTicket, MetaTicketSummary, MetaTicketStatus, MetaTicketType
from app.board.plan import PlanService
from app.board.state_machine import validate_transition
from app.board.storage import (
    delete_ticket as _delete_file,
    list_tickets as _list_files,
    read_ticket,
    ticket_path,
    write_ticket,
)
from app.core.config import AppConfig


class TicketNotFoundError(Exception):
    """Raised when a meta-ticket ID does not exist."""


class BoardService:
    """Facade — single entry point for all board/meta-ticket operations."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self.plans = PlanService(config)
        self.trash_service: Any = None  # Injected by server.py

    @property
    def _tickets_dir(self) -> Path:
        return self._config.get_project_root() / ".bonsai" / "meta-tickets"

    @property
    def _plans_dir(self) -> Path:
        return self._config.get_project_root() / ".bonsai" / "plans"

    # -- queries ---------------------------------------------------------------

    def list_tickets(self) -> list[MetaTicketSummary]:
        tickets = _list_files(self._tickets_dir)
        result: list[MetaTicketSummary] = []
        for t in tickets:
            # Auto-detect plan file
            if t.plan_path is None and self.plans.plan_exists(t.id):
                t.plan_path = f"plans/{t.id}.md"
                if t.status == "specified":
                    t.status = "planned"
                t.updated = datetime.now(UTC).isoformat()
                write_ticket(ticket_path(self._tickets_dir, t.id), t)
            result.append(MetaTicketSummary(
                id=t.id,
                title=t.title,
                status=t.status,
                type=t.type,
                plan_path=t.plan_path,
                orchestrator_session_id=t.orchestrator_session_id,
                linked_spec_ids=t.linked_spec_ids,
                session_ids=t.session_ids,
                created=t.created,
                updated=t.updated,
            ))
        return result

    def get_ticket(self, id: str) -> MetaTicket:
        path = ticket_path(self._tickets_dir, id)
        try:
            ticket = read_ticket(path)
        except FileNotFoundError:
            raise TicketNotFoundError(f"Ticket '{id}' not found") from None
        # Auto-detect plan file if planPath is not set
        if ticket.plan_path is None and self.plans.plan_exists(id):
            ticket.plan_path = f"plans/{id}.md"
            if ticket.status == "specified":
                ticket.status = "planned"
            ticket.updated = datetime.now(UTC).isoformat()
            write_ticket(path, ticket)
        return ticket

    # -- mutations -------------------------------------------------------------

    def create_ticket(
        self,
        title: str,
        body: str = "",
        type: MetaTicketType = "feature",
    ) -> MetaTicket:
        # Set order to max+1 within the default "idea" column
        existing = _list_files(self._tickets_dir)
        max_order = max((t.order for t in existing if t.status == "idea"), default=-1)
        ticket = MetaTicket(title=title, body=body, type=type, order=max_order + 1)
        write_ticket(ticket_path(self._tickets_dir, ticket.id), ticket)
        return ticket

    def update_ticket(
        self,
        id: str,
        *,
        title: str | None = None,
        body: str | None = None,
        status: MetaTicketStatus | None = None,
        type: MetaTicketType | None = None,
    ) -> MetaTicket:
        ticket = self.get_ticket(id)

        if status is not None and status != ticket.status:
            validate_transition(ticket.status, status)
            ticket.status = status

        if title is not None:
            ticket.title = title
        if body is not None:
            ticket.body = body
        if type is not None:
            ticket.type = type

        ticket.updated = datetime.now(UTC).isoformat()
        write_ticket(ticket_path(self._tickets_dir, id), ticket)
        return ticket

    def delete_ticket(self, id: str) -> None:
        path = ticket_path(self._tickets_dir, id)
        if not path.is_file():
            raise TicketNotFoundError(f"Ticket '{id}' not found")
        if self.trash_service:
            self.trash_service.trash_ticket(id)
        else:
            _delete_file(path)

    def reorder_ticket(
        self, id: str, status: MetaTicketStatus, order: int
    ) -> MetaTicket:
        """Move a ticket to a new status column and/or position within a column."""
        ticket = self.get_ticket(id)
        if status != ticket.status:
            validate_transition(ticket.status, status)
            ticket.status = status
        ticket.order = order
        ticket.updated = datetime.now(UTC).isoformat()
        write_ticket(ticket_path(self._tickets_dir, id), ticket)
        return ticket

    # -- linking ---------------------------------------------------------------

    def link_spec(self, ticket_id: str, spec_id: str) -> MetaTicket:
        ticket = self.get_ticket(ticket_id)
        if spec_id not in ticket.linked_spec_ids:
            ticket.linked_spec_ids.append(spec_id)
            # Auto-transition: idea → specified when first spec is linked
            if ticket.status == "idea":
                ticket.status = "specified"
            ticket.updated = datetime.now(UTC).isoformat()
            write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def unlink_spec(self, ticket_id: str, spec_id: str) -> MetaTicket:
        ticket = self.get_ticket(ticket_id)
        if spec_id in ticket.linked_spec_ids:
            ticket.linked_spec_ids.remove(spec_id)
            ticket.updated = datetime.now(UTC).isoformat()
            write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def attach_session(self, ticket_id: str, session_id: str) -> MetaTicket:
        ticket = self.get_ticket(ticket_id)
        if session_id not in ticket.session_ids:
            ticket.session_ids.append(session_id)
        ticket.updated = datetime.now(UTC).isoformat()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def detach_session(self, ticket_id: str, session_id: str) -> MetaTicket:
        """Remove a session link from a ticket."""
        ticket = self.get_ticket(ticket_id)
        if session_id in ticket.session_ids:
            ticket.session_ids.remove(session_id)
        if ticket.orchestrator_session_id == session_id:
            ticket.orchestrator_session_id = None
        ticket.updated = datetime.now(UTC).isoformat()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def detach_session_from_all(self, session_id: str) -> None:
        """Remove a session reference from every ticket that has it."""
        for ticket in _list_files(self._tickets_dir):
            if session_id in ticket.session_ids or ticket.orchestrator_session_id == session_id:
                self.detach_session(ticket.id, session_id)

    def set_orchestrator(self, ticket_id: str, session_id: str) -> MetaTicket:
        """Set the orchestrator session for a ticket and auto-transition to executing."""
        ticket = self.get_ticket(ticket_id)
        ticket.orchestrator_session_id = session_id
        if ticket.status == "planned":
            ticket.status = "executing"
        ticket.updated = datetime.now(UTC).isoformat()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def set_plan_path(self, ticket_id: str, plan_path: str) -> MetaTicket:
        """Set the plan path and auto-transition to planned."""
        ticket = self.get_ticket(ticket_id)
        ticket.plan_path = plan_path
        if ticket.status == "specified":
            ticket.status = "planned"
        ticket.updated = datetime.now(UTC).isoformat()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket
