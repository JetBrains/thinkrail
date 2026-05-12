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
    MANIFEST_FILE,
    META_TICKETS_DIR,
    PLANS_DIR,
    SESSIONS_DIR,
    SPEC_DRAFTS_DIR,
    SPEC_PATCHES_DIR,
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
        # Extract display name from session metadata
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
        """Move a ticket's JSON file to trash.

        When *cascade* is True (the default), also trashes the ticket's plan,
        all spec drafts, and patches before trashing the ticket itself.
        """
        cascaded: list[str] = []

        if cascade:
            # Cascade: plan
            plan_file = self._project_root / BONSAI_DIRNAME / PLANS_DIR / f"{ticket_id}.md"
            if plan_file.is_file():
                self.trash_plan(ticket_id)
                cascaded.append(f"plans/{ticket_id}")

            # Cascade: drafts (each entry individually)
            drafts_dir = self._project_root / BONSAI_DIRNAME / SPEC_DRAFTS_DIR / ticket_id
            manifest_path = drafts_dir / MANIFEST_FILE
            if manifest_path.is_file():
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                entries = raw.get("entries", [])
                for i in range(len(entries) - 1, -1, -1):
                    entry = entries[i]
                    draft_file = drafts_dir / entry.get("draftPath", "")
                    self.trash_draft(
                        ticket_id, i,
                        manifest_entry=entry,
                        draft_file=draft_file if draft_file.is_file() else None,
                    )
                    cascaded.append(f"drafts/{ticket_id}--{i}")
                # Clean up empty manifest dir
                if drafts_dir.is_dir():
                    shutil.rmtree(drafts_dir)

            # Cascade: patches
            patches_dir = self._project_root / BONSAI_DIRNAME / SPEC_PATCHES_DIR / ticket_id
            if patches_dir.is_dir():
                self.trash_patches(ticket_id)
                cascaded.append(f"patches/{ticket_id}")

        tickets_dir = self._project_root / BONSAI_DIRNAME / META_TICKETS_DIR
        ticket_file = tickets_dir / f"{ticket_id}.json"
        source_files = [f for f in [ticket_file] if f.is_file()]
        if not source_files:
            logger.debug("No ticket file found for %s — skipping trash", ticket_id)
            return
        # Extract display title from ticket metadata
        ctx: dict[str, Any] = {"cascaded": cascaded} if cascaded else {}
        if ticket_file.is_file():
            try:
                info = json.loads(ticket_file.read_text(encoding="utf-8"))
                if info.get("title"):
                    ctx["title"] = info["title"]
            except Exception:
                pass
        move_to_trash(
            self._trash_dir, "tickets", ticket_id, source_files, str(tickets_dir),
            context=ctx,
        )

    def restore_ticket(self, ticket_id: str) -> None:
        """Restore a trashed ticket back to .bonsai/meta-tickets/."""
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

    # -- plans -----------------------------------------------------------------

    def trash_plan(self, ticket_id: str) -> None:
        """Move .bonsai/plans/{ticket_id}.md to trash."""
        plans_dir = self._project_root / BONSAI_DIRNAME / PLANS_DIR
        plan_file = plans_dir / f"{ticket_id}.md"
        source_files = [plan_file] if plan_file.is_file() else []
        if not source_files:
            logger.debug("No plan file found for %s — skipping trash", ticket_id)
            return
        move_to_trash(
            self._trash_dir, "plans", ticket_id, source_files, str(plans_dir),
            context={"ticketId": ticket_id},
        )

    def restore_plan(self, ticket_id: str) -> None:
        """Restore a trashed plan back to .bonsai/plans/."""
        restore_from_trash(self._trash_dir, "plans", ticket_id)

    # -- drafts ----------------------------------------------------------------

    def trash_draft(
        self,
        ticket_id: str,
        draft_index: int,
        manifest_entry: dict[str, Any],
        draft_file: Path | None,
    ) -> None:
        """Move a single draft entry to trash with its manifest metadata.

        *draft_file* may be ``None`` for delete-operation drafts that have
        no file on disk.
        """
        item_id = f"{ticket_id}--{draft_index}"
        source_files = [draft_file] if draft_file and draft_file.is_file() else []
        original_dir = str(self._project_root / BONSAI_DIRNAME / SPEC_DRAFTS_DIR / ticket_id)
        move_to_trash(
            self._trash_dir, "drafts", item_id, source_files, original_dir,
            context={"ticketId": ticket_id, "manifestEntry": manifest_entry},
        )

    def restore_draft(self, trash_item_id: str) -> dict[str, Any]:
        """Restore a trashed draft and return its manifest entry for re-insertion."""
        ctx = restore_from_trash(self._trash_dir, "drafts", trash_item_id)
        return ctx.get("manifestEntry", {})

    # -- patches ---------------------------------------------------------------

    def trash_patches(self, ticket_id: str) -> None:
        """Move all .bonsai/spec-patches/{ticket_id}/ to trash."""
        patches_dir = self._project_root / BONSAI_DIRNAME / SPEC_PATCHES_DIR / ticket_id
        if not patches_dir.is_dir():
            logger.debug("No patches dir found for %s — skipping trash", ticket_id)
            return
        source_files = [f for f in patches_dir.iterdir() if f.is_file()]
        move_to_trash(
            self._trash_dir, "patches", ticket_id, source_files, str(patches_dir),
            context={"ticketId": ticket_id},
        )
        # Clean up empty source directory
        if patches_dir.is_dir() and not any(patches_dir.iterdir()):
            patches_dir.rmdir()

    def restore_patches(self, ticket_id: str) -> None:
        """Restore a trashed patches directory back to .bonsai/spec-patches/."""
        restore_from_trash(self._trash_dir, "patches", ticket_id)

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
