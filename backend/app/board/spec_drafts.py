"""Spec draft service — shadow directory for spec changes during ticket-specify.

Instead of writing specs directly to disk, writes go to
``.bonsai/spec-drafts/{ticket_id}/`` with a manifest tracking each entry.
The user reviews diffs and applies changes selectively.
"""

from __future__ import annotations

import difflib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import AppConfig
from app.core.fileio import ensure_dir, read_text, write_text


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


_CAMEL = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class DraftEntry(BaseModel):
    """A single spec draft entry in the manifest."""

    model_config = _CAMEL

    operation: Literal["create", "update", "delete"]
    real_path: str
    draft_path: str
    registry_id: str = ""
    registry_type: str = ""
    registry_title: str = ""
    registry_covers: list[str] = Field(default_factory=list)
    registry_tags: list[str] = Field(default_factory=list)
    created: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class DraftManifest(BaseModel):
    """Manifest for all draft entries of a ticket."""

    model_config = _CAMEL

    ticket_id: str
    session_id: str = ""
    created: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    entries: list[DraftEntry] = Field(default_factory=list)


class SpecDraftService:
    """Read/write spec drafts in shadow directories."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self.trash_service: Any = None  # Injected by server.py

    @property
    def _drafts_dir(self) -> Path:
        return self._config.get_project_root() / ".bonsai" / "spec-drafts"

    def _ticket_dir(self, ticket_id: str) -> Path:
        return self._drafts_dir / ticket_id

    def _manifest_path(self, ticket_id: str) -> Path:
        return self._ticket_dir(ticket_id) / "manifest.json"

    def _draft_file_path(self, ticket_id: str, real_path: str) -> Path:
        return self._ticket_dir(ticket_id) / real_path

    def _real_file_path(self, real_path: str) -> Path:
        return self._config.get_project_root() / real_path

    # -- Read manifest --

    def _read_manifest(self, ticket_id: str) -> DraftManifest:
        path = self._manifest_path(ticket_id)
        if not path.is_file():
            return DraftManifest(ticket_id=ticket_id)
        raw = json.loads(read_text(path))
        return DraftManifest(**raw)

    def _write_manifest(self, ticket_id: str, manifest: DraftManifest) -> None:
        path = self._manifest_path(ticket_id)
        ensure_dir(path.parent)
        write_text(path, json.dumps(manifest.model_dump(by_alias=True), indent=2))

    # -- Core operations --

    def has_drafts(self, ticket_id: str) -> bool:
        """Check if any drafts exist for a ticket."""
        manifest = self._read_manifest(ticket_id)
        return len(manifest.entries) > 0

    def write_draft(
        self,
        ticket_id: str,
        real_path: str,
        content: str,
        *,
        operation: Literal["create", "update"] = "create",
        registry_id: str = "",
        registry_type: str = "",
        registry_title: str = "",
        registry_covers: list[str] | None = None,
        registry_tags: list[str] | None = None,
        session_id: str = "",
    ) -> DraftEntry:
        """Write a spec draft to the shadow directory."""
        draft_path = self._draft_file_path(ticket_id, real_path)
        ensure_dir(draft_path.parent)
        write_text(draft_path, content)

        manifest = self._read_manifest(ticket_id)
        if session_id and not manifest.session_id:
            manifest.session_id = session_id

        # Replace existing entry for same path, or append
        entry = DraftEntry(
            operation=operation,
            real_path=real_path,
            draft_path=real_path,
            registry_id=registry_id,
            registry_type=registry_type,
            registry_title=registry_title,
            registry_covers=registry_covers or [],
            registry_tags=registry_tags or [],
        )
        manifest.entries = [e for e in manifest.entries if e.real_path != real_path]
        manifest.entries.append(entry)
        self._write_manifest(ticket_id, manifest)
        return entry

    def record_delete(
        self,
        ticket_id: str,
        real_path: str,
        registry_id: str = "",
    ) -> DraftEntry:
        """Record a spec deletion in the draft manifest."""
        manifest = self._read_manifest(ticket_id)
        entry = DraftEntry(
            operation="delete",
            real_path=real_path,
            draft_path="",
            registry_id=registry_id,
        )
        manifest.entries = [e for e in manifest.entries if e.real_path != real_path]
        manifest.entries.append(entry)
        self._write_manifest(ticket_id, manifest)
        return entry

    def read_draft(self, ticket_id: str, real_path: str) -> str | None:
        """Read draft content if it exists, otherwise return None."""
        draft_path = self._draft_file_path(ticket_id, real_path)
        if draft_path.is_file():
            return read_text(draft_path)
        return None

    def has_draft(self, ticket_id: str, real_path: str) -> bool:
        """Check if a specific draft exists."""
        return self._draft_file_path(ticket_id, real_path).is_file()

    def list_drafts(self, ticket_id: str) -> list[DraftEntry]:
        """List all draft entries for a ticket."""
        manifest = self._read_manifest(ticket_id)
        return manifest.entries

    def get_draft_diff(self, ticket_id: str, index: int) -> dict:
        """Get original and draft content for diffing."""
        manifest = self._read_manifest(ticket_id)
        if index < 0 or index >= len(manifest.entries):
            raise IndexError(f"Draft index {index} out of range")

        entry = manifest.entries[index]
        original = ""
        draft = ""

        if entry.operation != "delete":
            draft_path = self._draft_file_path(ticket_id, entry.real_path)
            if draft_path.is_file():
                draft = read_text(draft_path)

        if entry.operation != "create":
            real_path = self._real_file_path(entry.real_path)
            if real_path.is_file():
                original = read_text(real_path)

        return {
            "original": original,
            "draft": draft,
            "path": entry.real_path,
            "operation": entry.operation,
            "registryId": entry.registry_id,
            "registryTitle": entry.registry_title,
        }

    # -- Apply / Discard --

    async def apply_draft(
        self, ticket_id: str, index: int, *, board_service: Any = None,
    ) -> None:
        """Apply a single draft entry to the real filesystem + index."""
        from app.spec.index import SpecIndex
        from app.spec.service import SpecService

        manifest = self._read_manifest(ticket_id)
        if index < 0 or index >= len(manifest.entries):
            raise IndexError(f"Draft index {index} out of range")

        entry = manifest.entries[index]

        # Read original content before applying
        original_content = ""
        if entry.operation != "create":
            real_path = self._real_file_path(entry.real_path)
            if real_path.is_file():
                original_content = read_text(real_path)

        # Read draft content
        draft_content = ""
        if entry.operation != "delete":
            draft_content = self.read_draft(ticket_id, entry.real_path) or ""

        # Apply to real filesystem via index-backed SpecService
        from app.core.config import get_index_path

        db_path = get_index_path(self._config.get_project_root())
        async with SpecIndex(db_path) as idx:
            svc = SpecService(self._config, index=idx)
            svc.trash_service = self.trash_service

            if entry.operation == "delete" and entry.registry_id:
                await svc.delete_spec(entry.registry_id)
            elif entry.operation in ("create", "update"):
                if not draft_content:
                    raise FileNotFoundError(f"Draft file not found for {entry.real_path}")
                if entry.operation == "create":
                    await svc.create_spec(
                        entry.registry_type or "module-design",
                        entry.real_path,
                        draft_content,
                        entry.registry_id or None,
                    )
                else:
                    if entry.registry_id:
                        await svc.update_spec(entry.registry_id, draft_content)
                    else:
                        real = self._real_file_path(entry.real_path)
                        ensure_dir(real.parent)
                        write_text(real, draft_content)

        # Generate patch file and record on ticket
        if board_service is not None:
            self._generate_patch(
                ticket_id, entry, original_content, draft_content, board_service,
                session_id=manifest.session_id,
            )

        # Remove applied entry
        manifest.entries.pop(index)
        self._write_manifest(ticket_id, manifest)

        # Clean up draft file
        draft_file = self._draft_file_path(ticket_id, entry.real_path)
        if draft_file.is_file():
            draft_file.unlink()

    def _generate_patch(
        self,
        ticket_id: str,
        entry: DraftEntry,
        original: str,
        modified: str,
        board_service: Any,
        session_id: str = "",
    ) -> None:
        """Generate a unified diff patch file and record it on the ticket."""
        from app.board.models import SpecPatch

        timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        spec_id = entry.registry_id or entry.real_path.replace("/", "-")
        patch_filename = f"{spec_id}-{timestamp}.patch"
        patch_rel = f"spec-patches/{ticket_id}/{patch_filename}"

        # Compute unified diff
        original_lines = original.splitlines(keepends=True)
        modified_lines = modified.splitlines(keepends=True)
        diff = difflib.unified_diff(
            original_lines, modified_lines,
            fromfile=f"a/{entry.real_path}",
            tofile=f"b/{entry.real_path}",
        )
        patch_content = "".join(diff)

        # Write patch file
        patch_path = self._config.get_project_root() / ".bonsai" / patch_rel
        ensure_dir(patch_path.parent)
        write_text(patch_path, patch_content)

        # Record on ticket
        op_map = {"create": "created", "update": "modified", "delete": "deleted"}
        patch_record = SpecPatch(
            spec_id=entry.registry_id,
            spec_title=entry.registry_title,
            operation=op_map.get(entry.operation, entry.operation),
            patch_path=patch_rel,
            spec_path=entry.real_path,
            session_id=session_id,
        )
        board_service.add_spec_patch(ticket_id, patch_record)

        # Auto-link spec to ticket
        if entry.registry_id and entry.operation != "delete":
            board_service.link_spec(ticket_id, entry.registry_id)

    async def apply_all(self, ticket_id: str, *, board_service: Any = None) -> None:
        """Apply all draft entries."""
        manifest = self._read_manifest(ticket_id)
        for _ in range(len(manifest.entries)):
            await self.apply_draft(ticket_id, 0, board_service=board_service)
        self.discard_all(ticket_id)

    def discard_draft(self, ticket_id: str, index: int) -> None:
        """Discard a single draft entry (soft-delete to trash if available)."""
        manifest = self._read_manifest(ticket_id)
        if index < 0 or index >= len(manifest.entries):
            raise IndexError(f"Draft index {index} out of range")

        entry = manifest.entries.pop(index)

        draft_file = self._draft_file_path(ticket_id, entry.real_path)
        if self.trash_service:
            entry_dict = entry.model_dump(by_alias=True)
            self.trash_service.trash_draft(
                ticket_id, index,
                manifest_entry=entry_dict,
                draft_file=draft_file if draft_file.is_file() else None,
            )
        elif draft_file.is_file():
            draft_file.unlink()

        self._write_manifest(ticket_id, manifest)

    def discard_all(self, ticket_id: str) -> None:
        """Discard all drafts (soft-delete each entry to trash if available)."""
        if self.trash_service:
            manifest = self._read_manifest(ticket_id)
            for i in range(len(manifest.entries) - 1, -1, -1):
                entry = manifest.entries[i]
                draft_file = self._draft_file_path(ticket_id, entry.real_path)
                entry_dict = entry.model_dump(by_alias=True)
                self.trash_service.trash_draft(
                    ticket_id, i,
                    manifest_entry=entry_dict,
                    draft_file=draft_file if draft_file.is_file() else None,
                )
        ticket_dir = self._ticket_dir(ticket_id)
        if ticket_dir.is_dir():
            shutil.rmtree(ticket_dir)
