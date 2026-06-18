"""Board service — façade for all meta-ticket operations.

Each ticket drives a **WorkNode stage-DAG**; the coarse lifecycle
(``created`` / ``design`` / ``implementation`` / ``done``) is derived from it
by ``derive_lifecycle``.  Artifact files live under ``.tr/tickets/{id}/``.
A git commit fires when an ``amend-specs`` node completes
(``_maybe_commit_on_node_done``), covering accumulated spec amendments and the
per-ticket patch log.
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
    OrchestrationConfig,
    OrchestratorRef,
    Ticket,
    TicketSummary,
    TicketType,
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
from app.board.work_node import NodeStatus
from app.core.config import AppConfig, DESIGN_DOCS_DIR, PROJECT_DIRNAME, TICKETS_DIR

logger = logging.getLogger(__name__)


class TicketNotFoundError(Exception):
    """Raised when a meta-ticket ID does not exist."""


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class BoardService:
    """Facade — single entry point for all board/meta-ticket operations."""

    def __init__(self, config: AppConfig) -> None:
        from app.board.plan import PlanService
        self._config = config
        self.plans = PlanService(config)
        self.trash_service: Any = None  # Injected by server.py
        self.agent_service: Any = None  # Injected by ProjectContext; builds TicketState
        # Optional (ticket_id, title) -> orchestrator thinkrail_sid; set by ProjectContext.
        self.on_ticket_created: Any = None

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
        spawn_orchestrator: bool = True,
    ) -> Ticket:
        wipe_legacy_meta_tickets(self._project_root)
        existing = _list_files(self._tickets_dir)
        max_order = max((t.order for t in existing), default=-1)
        ticket = Ticket(title=title, body=body, type=type, order=max_order + 1)
        _ensure_dir(self._project_root, ticket.id)
        write_ticket(ticket_path(self._tickets_dir, ticket.id), ticket)
        if spawn_orchestrator and self.on_ticket_created is not None:
            try:
                sid = self.on_ticket_created(ticket.id, ticket.title)
                if sid:
                    ticket.orchestrator = OrchestratorRef(kind="session", session_id=sid)
                    write_ticket(ticket_path(self._tickets_dir, ticket.id), ticket)
            except Exception:
                logger.warning("orchestrator spawn failed for %s", ticket.id, exc_info=True)
        return ticket

    def update_ticket(
        self,
        id: str,
        *,
        title: str | None = None,
        body: str | None = None,
        type: TicketType | None = None,
    ) -> Ticket:
        ticket = self.get_ticket(id)
        if title is not None:
            ticket.title = title
        if body is not None:
            ticket.body = body
        if type is not None:
            ticket.type = type
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, id), ticket)
        return ticket

    def delete_ticket(self, id: str) -> None:
        path = ticket_path(self._tickets_dir, id)
        if not path.is_file():
            raise TicketNotFoundError(f"Ticket '{id}' not found")
        _delete_file(path)

    def reorder_ticket(self, id: str, order: int) -> Ticket:
        """Reposition a ticket within its (derived) lifecycle column."""
        ticket = self.get_ticket(id)
        ticket.order = order
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, id), ticket)
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

    def bump_rev(self, ticket_id: str) -> Ticket:
        """Increment the ticket's monotonic revision and persist it."""
        ticket = self.get_ticket(ticket_id)
        ticket.rev += 1
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def apply(self, ticket_id: str, op: dict) -> Ticket:
        """The single mutator for the stage DAG: validate → mutate → rev++ → persist.

        Raises DagError on an invalid op (nothing is persisted). Emitting
        ``ticket/didChange`` is the caller's responsibility via
        ``publish_ticket_state`` (so the same method works in tests without a bus).
        """
        from app.board.ops import apply_op

        ticket = self.get_ticket(ticket_id)
        if op.get("op") == "setOrchestration":
            merged = {**ticket.orchestration.model_dump(), **op["config"]}
            ticket.orchestration = OrchestrationConfig.model_validate(merged)
        else:
            ticket.stages = apply_op(ticket.stages, op)  # raises DagError → no write
        ticket.rev += 1
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        self._maybe_commit_on_node_done(ticket_id, ticket, op)
        return ticket

    def _maybe_commit_on_node_done(self, ticket_id: str, ticket: Ticket, op: dict) -> None:
        """When an amend-specs node completes, commit the accumulated spec
        amendments + the per-ticket patch log."""
        if op.get("op") != "recordRunFinish" or op.get("isError"):
            return
        node = next((n for n in ticket.stages if n.id == op.get("id")), None)
        if node is None or node.status != NodeStatus.DONE or node.skill != "ticket-amend-specs":
            return
        self._commit_paths(
            [
                f"{PROJECT_DIRNAME}/{DESIGN_DOCS_DIR}",
                f"{PROJECT_DIRNAME}/{TICKETS_DIR}/{ticket_id}/history.patch",
            ],
            f"[ticket {ticket_id}] amend specs",
        )

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
        if ticket.orchestrator and ticket.orchestrator.session_id == session_id:
            ticket.orchestrator = None
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    def detach_session_from_all(self, session_id: str) -> None:
        """Remove a session reference from every ticket that has it."""
        for ticket in _list_files(self._tickets_dir):
            if (session_id in ticket.session_ids
                    or (ticket.orchestrator and ticket.orchestrator.session_id == session_id)):
                self.detach_session(ticket.id, session_id)

    def set_orchestrator(self, ticket_id: str, session_id: str) -> Ticket:
        """Set the ticket's orchestrator session."""
        ticket = self.get_ticket(ticket_id)
        ticket.orchestrator = OrchestratorRef(kind="session", session_id=session_id)
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)
        return ticket

    # ── Per-ticket artifact bookkeeping ─────────────────────────

    def ensure_ticket_dir(self, ticket_id: str) -> Path:
        """Idempotent: create the per-ticket folder if missing."""
        return _ensure_dir(self._project_root, ticket_id)

    def sync_artifact_bookkeeping(self, ticket_id: str, kind: ArtifactKind) -> None:
        """Refresh ticket bookkeeping after an artifact file was edited in place.

        The Edit/Write tools write the file directly, so this updates the
        relevant ``*_path``, the product-design body fallback, and ``updated``
        from the on-disk file — without rewriting it. No-op if the file or
        ticket is missing.
        """
        p = artifact_path(self._project_root, ticket_id, kind)
        if not p.is_file():
            return
        try:
            ticket = self.get_ticket(ticket_id)
        except TicketNotFoundError:
            return
        rel = p.relative_to(self._project_root).as_posix()
        if kind == "product_design":
            ticket.product_design_path = rel
            if not ticket.body:
                fallback = _extract_first_paragraph(p.read_text(encoding="utf-8"))
                if fallback:
                    ticket.body = fallback
        elif kind == "technical_design":
            ticket.technical_design_path = rel
        elif kind == "history":
            ticket.history_path = rel
        elif kind == "implementation_plan":
            ticket.implementation_plan_path = rel
        ticket.updated = _now_iso()
        write_ticket(ticket_path(self._tickets_dir, ticket_id), ticket)

    def write_artifact(self, ticket_id: str, kind: ArtifactKind, content: str) -> Path:
        """Write an artifact file under the ticket's folder and update bookkeeping.

        Side-effect (via sync_artifact_bookkeeping): when writing
        ``product_design`` and the ticket body is empty, populate the body with
        the first non-empty paragraph from the markdown.
        """
        assert kind in ARTIFACT_FILENAMES
        self.ensure_ticket_dir(ticket_id)
        p = artifact_path(self._project_root, ticket_id, kind)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        self.sync_artifact_bookkeeping(ticket_id, kind)
        return p

    def read_artifact(self, ticket_id: str, kind: ArtifactKind) -> str | None:
        p = artifact_path(self._project_root, ticket_id, kind)
        return p.read_text(encoding="utf-8") if p.exists() else None

    # ── Transition side-effects ────────────────────────────────

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
