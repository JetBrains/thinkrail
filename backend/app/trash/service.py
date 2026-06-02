"""TrashService — universal soft-delete and restore for all .bonsai/ data."""

from __future__ import annotations

import json
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.config import (
    BONSAI_DIRNAME,
    SESSIONS_DIR,
    TICKETS_DIR,
    TRASH_DIR,
)
from app.trash.storage import (
    TrashItemType,
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
        self._trash_dir = project_root / BONSAI_DIRNAME / TRASH_DIR

    # -- sessions --------------------------------------------------------------

    def trash_session(self, bonsai_sid: str) -> None:
        """Move a session's files to trash."""
        sessions_dir = self._project_root / BONSAI_DIRNAME / SESSIONS_DIR
        meta = sessions_dir / f"{bonsai_sid}.json"
        events = sessions_dir / f"{bonsai_sid}.events.jsonl"
        source_files = [f for f in [meta, events] if f.is_file()]
        if not source_files:
            logger.debug("No session files found for %s — skipping trash", bonsai_sid)
            return
        ctx: dict[str, Any] = {}
        if meta.is_file():
            try:
                info = json.loads(meta.read_text(encoding="utf-8"))
                if info.get("name"):
                    ctx["name"] = info["name"]
            except Exception:
                pass
        move_to_trash(self._trash_dir, "sessions", bonsai_sid, source_files, str(sessions_dir), context=ctx)

    def restore_session(self, bonsai_sid: str) -> None:
        """Restore a trashed session back to .bonsai/sessions/."""
        restore_from_trash(self._trash_dir, "sessions", bonsai_sid)

    # -- tickets ---------------------------------------------------------------

    def trash_ticket(self, ticket_id: str, *, cascade: bool = True) -> None:
        """Move a ticket's folder (ticket.json + all artifacts) to trash.

        With the unified folder layout, every file inside
        ``.bonsai/tickets/{id}/`` is bundled. ``cascade`` is retained for
        callers but has no behavioral effect now.
        """
        del cascade  # Retained for backwards compatibility with callers.

        ticket_folder = self._project_root / BONSAI_DIRNAME / TICKETS_DIR / ticket_id
        if not ticket_folder.is_dir():
            logger.debug("No ticket folder found for %s — skipping trash", ticket_id)
            return

        source_files: list[Path] = [p for p in ticket_folder.iterdir() if p.is_file()]
        if not source_files:
            logger.debug("Ticket folder %s is empty — skipping trash", ticket_id)
            return

        ctx: dict[str, Any] = {"artifactDir": str(ticket_folder)}
        meta = ticket_folder / "ticket.json"
        if meta.is_file():
            try:
                info = json.loads(meta.read_text(encoding="utf-8"))
                if info.get("title"):
                    ctx["title"] = info["title"]
            except Exception:
                pass

        move_to_trash(
            self._trash_dir, "tickets", ticket_id, source_files,
            str(ticket_folder), context=ctx,
        )

        try:
            if ticket_folder.is_dir() and not any(ticket_folder.iterdir()):
                ticket_folder.rmdir()
        except OSError:
            pass

    def restore_ticket(self, ticket_id: str) -> None:
        """Restore a trashed ticket folder back to .bonsai/tickets/."""
        restore_from_trash(self._trash_dir, "tickets", ticket_id)

    # -- specs -----------------------------------------------------------------

    def trash_spec(
        self,
        spec_id: str,
        spec_file: Path,
        registry_entry: dict[str, Any],
        links: list[dict[str, Any]],
    ) -> None:
        """Move a spec file to trash with a registry snapshot for full restore."""
        source_files = [spec_file] if spec_file.is_file() else []
        if not source_files:
            logger.debug("No spec file found for %s — skipping trash", spec_id)
            return
        move_to_trash(
            self._trash_dir, "specs", spec_id, source_files,
            str(spec_file.parent),
            context={"registryEntry": registry_entry, "links": links},
        )

    def restore_spec(self, spec_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """Restore a trashed spec and return (registry_entry, links) for re-insertion."""
        ctx = restore_from_trash(self._trash_dir, "specs", spec_id)
        return ctx.get("registryEntry", {}), ctx.get("links", [])

    # -- generic operations ----------------------------------------------------

    def list_trashed(self, item_type: TrashItemType | None = None) -> list[dict]:
        """List all trashed items, optionally filtered by type."""
        return _list_trashed(self._trash_dir, item_type=item_type)

    def purge(self, item_type: TrashItemType, item_id: str) -> None:
        """Permanently delete a trashed item."""
        purge_trashed(self._trash_dir, item_type, item_id)

    def empty_trash(self, item_type: TrashItemType | None = None) -> None:
        """Permanently delete all trashed items, optionally filtered by type."""
        for item in _list_trashed(self._trash_dir, item_type=item_type):
            purge_trashed(self._trash_dir, item["type"], item["id"])

    # -- auto-purge ------------------------------------------------------------

    def auto_purge(self, retention_days: int) -> int:
        """Permanently delete items older than *retention_days*.

        Returns the number of purged items.  Skips if *retention_days* <= 0.
        """
        if retention_days <= 0:
            return 0
        now = datetime.now(UTC)
        purged = 0
        for item in _list_trashed(self._trash_dir):
            try:
                trashed_at = datetime.fromisoformat(item["trashedAt"])
            except (ValueError, KeyError):
                continue
            age_days = (now - trashed_at).total_seconds() / 86400
            if age_days >= retention_days:
                try:
                    purge_trashed(self._trash_dir, item["type"], item["id"])
                    purged += 1
                except FileNotFoundError:
                    pass
        if purged:
            logger.info("Auto-purge: removed %d item(s) older than %d day(s)", purged, retention_days)
        return purged
