"""TrashService — soft-delete and restore for sessions and tickets."""

from __future__ import annotations

import logging
from pathlib import Path

from app.trash.storage import (
    list_trashed as _list_trashed,
    move_to_trash,
    purge_trashed,
    restore_from_trash,
)

logger = logging.getLogger(__name__)


class TrashService:
    """Stateless service for soft-delete operations.

    Operates purely on the filesystem. Takes project_root at construction
    and derives all paths from it.
    """

    def __init__(self, project_root: Path) -> None:
        self._project_root = project_root
        self._trash_dir = project_root / ".bonsai" / "trash"

    # -- sessions --------------------------------------------------------------

    def trash_session(self, bonsai_sid: str) -> None:
        """Move a session's files to trash."""
        sessions_dir = self._project_root / ".specs" / "sessions"
        meta = sessions_dir / f"{bonsai_sid}.json"
        events = sessions_dir / f"{bonsai_sid}.events.jsonl"
        source_files = [f for f in [meta, events] if f.is_file()]
        if not source_files:
            logger.debug("No session files found for %s — skipping trash", bonsai_sid)
            return
        move_to_trash(self._trash_dir, "sessions", bonsai_sid, source_files, str(sessions_dir))

    def restore_session(self, bonsai_sid: str) -> None:
        """Restore a trashed session back to .specs/sessions/."""
        restore_from_trash(self._trash_dir, "sessions", bonsai_sid)

    # -- tickets ---------------------------------------------------------------

    def trash_ticket(self, ticket_id: str) -> None:
        """Move a ticket's JSON file to trash."""
        tickets_dir = self._project_root / ".bonsai" / "meta-tickets"
        ticket_file = tickets_dir / f"{ticket_id}.json"
        source_files = [f for f in [ticket_file] if f.is_file()]
        if not source_files:
            logger.debug("No ticket file found for %s — skipping trash", ticket_id)
            return
        move_to_trash(self._trash_dir, "tickets", ticket_id, source_files, str(tickets_dir))

    def restore_ticket(self, ticket_id: str) -> None:
        """Restore a trashed ticket back to .bonsai/meta-tickets/."""
        restore_from_trash(self._trash_dir, "tickets", ticket_id)

    # -- generic operations ----------------------------------------------------

    def list_trashed(self, item_type: str | None = None) -> list[dict]:
        """List all trashed items, optionally filtered by type."""
        return _list_trashed(self._trash_dir, item_type=item_type)

    def purge(self, item_type: str, item_id: str) -> None:
        """Permanently delete a trashed item."""
        purge_trashed(self._trash_dir, item_type, item_id)

    def empty_trash(self, item_type: str | None = None) -> None:
        """Permanently delete all trashed items, optionally filtered by type."""
        for item in _list_trashed(self._trash_dir, item_type=item_type):
            purge_trashed(self._trash_dir, item["type"], item["id"])
