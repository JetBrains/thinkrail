"""Board service — façade for all meta-ticket operations.

Manages the per-ticket lifecycle (idea → product-design → technical-design →
amend-specs → implementation-plan → implementing → done), per-ticket
artifact files under ``.bonsai/tickets/{id}/``, and side-effects for state
transitions (single commit on entry to ``implementation-plan`` covering all
accumulated spec amendments + the per-ticket .patch log).
"""

from __future__ import annotations

import logging
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.board.artifact_paths import (
    ARTIFACT_FILENAMES,
    artifact_path,
    ensure_ticket_dir as _ensure_dir,
)
from app.board.models import (
    ArtifactKind,
    Ticket,
    TicketStatus,
    TicketSummary,
    TicketType,
)
from app.board.plan import PlanService
from app.board.state_machine import (
    InvalidTransitionError,
    is_backward_transition,
    is_skippable,
    next_unskipped_status,
    validate_transition,
)
from app.board.storage import (
    _extract_first_paragraph,
    delete_ticket as _delete_file,
    list_tickets as _list_files,
    read_ticket,
    ticket_path,
    tickets_root,
    wipe_legacy_meta_tickets,
    write_ticket,
)
from app.core.config import AppConfig

logger = logging.getLogger(__name__)


class TicketNotFoundError(Exception):
    """Raised when a meta-ticket ID does not exist."""


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class BoardService:
    """Facade — single entry point for all board/meta-ticket operations."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self.plans = PlanService(config)

    # ── Paths ─────────────────────────────────────────────────────

    @property
    def _project_root(self) -> Path:
        return self._config.get_project_root()

    @property
    def _tickets_dir(self) -> Path:
        return tickets_root(self._project_root)

    # ── Queries ──────────────────────────────────────────────────

    def list_tickets(self) -> list[TicketSummary]:
        # One-shot legacy cleanup on every list call is cheap (directory check + fast-path return).
        wipe_legacy_meta_tickets(self._project_root)
        tickets = _list_files(self._tickets_dir)
        return [TicketSummary.from_ticket(t) for t in tickets]

    def get_ticket(self, id: str) -> Ticket:
        path = ticket_path(self._tickets_dir, id)
        try:
            return read_ticket(path)
        except FileNotFoundError:
            raise TicketNotFoundError(f"Ticket '{id}' not found") from None

    # ── Mutations ────────────────────────────────────────────────

    def create_ticket(
        self,
        title: str,
        body: str = "",
        type: TicketType = "feature",
        status: TicketStatus = "idea",
    ) -> Ticket:
        wipe_legacy_meta_tickets(self._project_root)
        existing = _list_files(self._tickets_dir)
        max_order = max((t.order for t in existing if t.status == status), default=-1)
        ticket = Ticket(
            title=title,
            body=body,
            type=type,
            status=status,
            order=max_order + 1,
        )
        _ensure_dir(self._project_root, ticket.id)
        write_ticket(ticket_path(self._tickets_dir, ticket.id), ticket)
        return ticket

    def update_ticket(
        self,
        id: str,
        *,
        title: str | None = None,
        body: str | None = None,
        status: TicketStatus | None = None,
        type: TicketType | None = None,
    ) -> Ticket:
        ticket = self.get_ticket(id)
        prev_status = ticket.status

        if status is not None and status != ticket.status:
            validate_transition(ticket.status, status)
            # On forward advancement, walk past any phase the user marked skipped.
            if (
                not is_backward_transition(ticket.status, status)
                and status in ticket.skipped_phases
            ):
                ticket.status = next_unskipped_status(status, ticket.skipped_phases)
            else:
                ticket.status = status

        if title is not None:
            ticket.title = title
        if body is not None:
            ticket.body = body
        if type is not None:
            ticket.type = type

        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, id), ticket)

        if status is not None and prev_status != ticket.status:
            self.on_status_change(id, prev_status, ticket.status)
        return ticket

    def skip_phase(self, ticket_id: str, phase: TicketStatus) -> Ticket:
        """Mark a phase as skipped. If ``phase == ticket.status``, advance
        the ticket's status to the next non-skipped phase. Idempotent.
        Rejects non-skippable phases (idea, done)."""
        if not is_skippable(phase):
            raise InvalidTransitionError(phase, phase)
        ticket = self.get_ticket(ticket_id)
        prev_status = ticket.status
        if phase not in ticket.skipped_phases:
            ticket.skipped_phases.append(phase)
        if ticket.status == phase:
            ticket.status = next_unskipped_status(phase, ticket.skipped_phases)
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        if prev_status != ticket.status:
            self.on_status_change(ticket_id, prev_status, ticket.status)
        return ticket

    def unskip_phase(self, ticket_id: str, phase: TicketStatus) -> Ticket:
        """Remove a phase from the skipped list. Idempotent. Does NOT
        change the ticket's status."""
        ticket = self.get_ticket(ticket_id)
        if phase in ticket.skipped_phases:
            ticket.skipped_phases.remove(phase)
            ticket.updated = _now_iso()
            write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def delete_ticket(self, id: str) -> None:
        path = ticket_path(self._tickets_dir, id)
        if not path.is_file():
            raise TicketNotFoundError(f"Ticket '{id}' not found")
        _delete_file(path)

    def reorder_ticket(
        self, id: str, status: TicketStatus, order: int
    ) -> Ticket:
        """Move a ticket to a new status column and/or position within a column."""
        ticket = self.get_ticket(id)
        prev_status = ticket.status
        if status != ticket.status:
            validate_transition(ticket.status, status)
            ticket.status = status
        ticket.order = order
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, id), ticket)
        if prev_status != ticket.status:
            self.on_status_change(id, prev_status, ticket.status)
        return ticket

    # ── Linking ──────────────────────────────────────────────────

    def link_spec(self, ticket_id: str, spec_id: str) -> Ticket:
        ticket = self.get_ticket(ticket_id)
        if spec_id not in ticket.linked_spec_ids:
            ticket.linked_spec_ids.append(spec_id)
            ticket.updated = _now_iso()
            write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def unlink_spec(self, ticket_id: str, spec_id: str) -> Ticket:
        ticket = self.get_ticket(ticket_id)
        if spec_id in ticket.linked_spec_ids:
            ticket.linked_spec_ids.remove(spec_id)
            ticket.updated = _now_iso()
            write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def attach_session(self, ticket_id: str, session_id: str) -> Ticket:
        ticket = self.get_ticket(ticket_id)
        if session_id not in ticket.session_ids:
            ticket.session_ids.append(session_id)
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def detach_session(self, ticket_id: str, session_id: str) -> Ticket:
        """Remove a session link from a ticket."""
        ticket = self.get_ticket(ticket_id)
        if session_id in ticket.session_ids:
            ticket.session_ids.remove(session_id)
        if ticket.orchestrator_session_id == session_id:
            ticket.orchestrator_session_id = None
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def detach_session_from_all(self, session_id: str) -> None:
        """Remove a session reference from every ticket that has it."""
        for ticket in _list_files(self._tickets_dir):
            if session_id in ticket.session_ids or ticket.orchestrator_session_id == session_id:
                self.detach_session(ticket.id, session_id)

    def set_orchestrator(self, ticket_id: str, session_id: str) -> Ticket:
        """Set the orchestrator session for a ticket and auto-transition to implementing."""
        ticket = self.get_ticket(ticket_id)
        prev_status = ticket.status
        ticket.orchestrator_session_id = session_id
        if ticket.status == "implementation-plan":
            ticket.status = "implementing"
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        if prev_status != ticket.status:
            self.on_status_change(ticket_id, prev_status, ticket.status)
        return ticket

    # ── Per-ticket artifact bookkeeping ─────────────────────────

    def ensure_ticket_dir(self, ticket_id: str) -> Path:
        """Idempotent: create the per-ticket folder if missing."""
        return _ensure_dir(self._project_root, ticket_id)

    def write_artifact(self, ticket_id: str, kind: ArtifactKind, content: str) -> Path:
        """Write an artifact file under the ticket's folder and update bookkeeping.

        Side-effect: when writing ``product_design`` and the ticket body is
        currently empty, populate the body with the first non-empty paragraph
        from the markdown (after frontmatter). This guarantees the ticket has
        a visible description even if the skill skipped ``SuggestDescription``.
        """
        assert kind in ARTIFACT_FILENAMES
        self.ensure_ticket_dir(ticket_id)
        p = artifact_path(self._project_root, ticket_id, kind)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")

        try:
            ticket = self.get_ticket(ticket_id)
        except TicketNotFoundError:
            return p
        rel = p.relative_to(self._project_root).as_posix()
        if kind == "product_design":
            ticket.product_design_path = rel
            if not ticket.body:
                fallback = _extract_first_paragraph(content)
                if fallback:
                    ticket.body = fallback
        elif kind == "technical_design":
            ticket.technical_design_path = rel
            ticket.technical_design_stale = False
        elif kind == "history":
            ticket.history_path = rel
            ticket.history_stale = False
        elif kind == "implementation_plan":
            ticket.implementation_plan_path = rel
            ticket.implementation_plan_stale = False
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return p

    def read_artifact(self, ticket_id: str, kind: ArtifactKind) -> str | None:
        p = artifact_path(self._project_root, ticket_id, kind)
        return p.read_text(encoding="utf-8") if p.exists() else None

    # ── Transition side-effects ────────────────────────────────

    def on_status_change(
        self,
        ticket_id: str,
        from_status: TicketStatus,
        to_status: TicketStatus,
    ) -> None:
        """Flip stale flags on one-step-backward transitions; commit all
        accumulated spec amendments on entry to ``implementation-plan``."""
        try:
            ticket = self.get_ticket(ticket_id)
        except TicketNotFoundError:
            return

        modified = False

        # End of amend-specs step: single commit covering all accumulated
        # spec changes + the per-ticket .patch log.
        if from_status == "amend-specs" and to_status == "implementation-plan":
            self._commit_paths(
                [
                    ".bonsai/design_docs",
                    f".bonsai/tickets/{ticket_id}/history.patch",
                ],
                f"[ticket {ticket_id}] amend specs",
            )

        # Stale flags on one-step-backward transitions.
        if is_backward_transition(from_status, to_status):
            stale_map: dict[tuple[str, str], str] = {
                ("technical-design", "product-design"): "technical_design_stale",
                ("amend-specs", "technical-design"): "history_stale",
                ("implementation-plan", "amend-specs"): "implementation_plan_stale",
            }
            attr = stale_map.get((from_status, to_status))
            if attr and not getattr(ticket, attr):
                setattr(ticket, attr, True)
                modified = True

        if modified:
            ticket.updated = _now_iso()
            write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)

    def _commit_paths(self, paths: list[str], message: str) -> None:
        """git add + git commit the given paths only. Best-effort; logs on failure.

        The trailing ``-- *paths`` on commit scopes the new commit to those
        paths even if the caller's index has other unrelated content staged.
        """
        try:
            subprocess.run(
                ["git", "add", "--", *paths],
                cwd=self._project_root,
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "commit", "-m", message, "--", *paths],
                cwd=self._project_root,
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            logger.debug("commit '%s' failed: %s", message, exc, exc_info=True)
        except FileNotFoundError:
            logger.debug("git not available; skipping commit '%s'", message)
