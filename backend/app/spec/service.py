"""Spec service — facade for all spec operations.

Single entry point called from RPC methods, the file watcher, and
agent tools.  Backed by ``SpecIndex`` (SQLite) with YAML frontmatter
as the source of truth for spec metadata.

Design reference:
    .bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md §Write Flow, §Read Flow
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

from app.core.config import AppConfig
from app.core.fileio import delete_file, ensure_dir, read_text, write_text
from app.spec.frontmatter import extract_links, parse_frontmatter, serialize_frontmatter
from app.spec.graph import build_graph
from app.spec.index import SpecIndex, extract_title
from app.spec.models import (
    Frontmatter,
    Link,
    RECOGNIZED_TYPES,
    SpecDetail,
    SpecEntry,
    SpecGraph,
    SpecSummary,
)


# ── Constants ────────────────────────────────────────────────────────────────

SPEC_FILENAME_MAP: dict[str, str] = {
    "GOAL&REQUIREMENTS.md": "goal-and-requirements",
    "GOAL_AND_REQUIREMENTS.md": "goal-and-requirements",
    "DESIGN_DOC.md": "architecture-design",
}


def detect_spec_type(filename: str) -> str | None:
    """Return spec type if filename matches a known spec pattern."""
    return SPEC_FILENAME_MAP.get(filename)


# ── Exceptions ───────────────────────────────────────────────────────────────


class SpecNotFoundError(Exception):
    """Raised when a spec ID does not exist."""


class IndexNotReadyError(Exception):
    """Raised when a write operation is attempted while the index is still initializing."""


# ── SpecService ──────────────────────────────────────────────────────────────


class SpecService:
    """Facade — single entry point for all spec operations.

    Requires a ``SpecIndex`` backed by the SQLite index.  All public
    methods are ``async``.
    """

    def __init__(self, config: AppConfig, index: SpecIndex | None = None) -> None:
        self._config = config
        self._index = index

    @property
    def _root(self) -> Path:
        return self._config.get_project_root()

    @property
    def has_index(self) -> bool:
        """Whether the service has an index backend."""
        return self._index is not None

    # ── Readiness guards ────────────────────────────────────────────────

    def _require_ready(self) -> None:
        """Raise if the index is not yet initialized."""
        if self._index is not None and not self._index.is_ready:
            raise IndexNotReadyError("Index is still initializing")

    # ── Public async methods ─────────────────────────────────────────────

    async def list_specs(
        self,
        *,
        type: str | None = None,
        status: str | None = None,
        tag: str | None = None,
        covers: str | None = None,
    ) -> list[SpecSummary]:
        if self._index is not None and not self._index.is_ready:
            return []
        entries = await self._index.list_specs(
            type=type, status=status, tag=tag, covers=covers,
        )
        return [
            SpecSummary(
                id=e.id,
                type=e.type,
                path=e.path,
                status=e.status,
                title=e.title,
                tags=e.tags,
                covers=e.covers,
            )
            for e in entries
        ]

    async def get_spec(self, id: str) -> SpecDetail:
        self._require_ready()
        entry = await self._index.get_spec(id)
        if entry is None:
            raise SpecNotFoundError(f"Spec '{id}' not found")

        file_path = self._root / entry.path
        content = read_text(file_path)

        # Strip frontmatter from content for display
        _, body = parse_frontmatter(content)

        links = await self._index.get_links([id])
        return SpecDetail(
            id=entry.id,
            type=entry.type,
            path=entry.path,
            status=entry.status,
            title=entry.title,
            tags=entry.tags,
            content=body,
            links=links,
        )

    async def create_spec(
        self, type: str, path: str, content: str | None = None, id: str | None = None,
    ) -> SpecDetail:
        self._require_ready()
        if type not in RECOGNIZED_TYPES:
            raise ValueError(f"Invalid spec type: '{type}'")

        # Check for path conflicts
        existing = await self._index.get_spec_by_path(path)
        if existing is not None:
            raise ValueError(f"Path conflict: '{path}' already exists")

        body = content or ""
        title = _extract_title(body, path)
        spec_id = id if id is not None else _generate_id(title)

        # Check for ID conflicts
        if await self._index.get_spec(spec_id) is not None:
            raise ValueError(f"ID '{spec_id}' already exists")

        # Build frontmatter via model and write file
        fm = Frontmatter(id=spec_id, type=type, status="draft", title=title)
        file_content = serialize_frontmatter(fm.to_ordered_dict(), body)

        file_path = self._root / path
        ensure_dir(file_path.parent)
        write_text(file_path, file_content)

        # Upsert into index directly (don't wait for watcher)
        now = datetime.now(UTC).isoformat()
        c_hash = hashlib.sha256(file_content.encode("utf-8")).hexdigest()
        entry = fm.to_spec_entry(path, c_hash, now)
        await self._index.upsert_spec(entry)

        return SpecDetail(
            id=spec_id, type=type, path=path, status="draft",
            title=title, content=body, links=[],
        )

    async def update_spec(self, id: str, content: str) -> SpecDetail:
        self._require_ready()
        entry = await self._index.get_spec(id)
        if entry is None:
            raise SpecNotFoundError(f"Spec '{id}' not found")

        file_path = self._root / entry.path
        existing_content = read_text(file_path)
        meta, _ = parse_frontmatter(existing_content)

        # Re-serialize with existing frontmatter + new body
        file_content = serialize_frontmatter(meta, content)
        write_text(file_path, file_content)

        # Upsert into index
        now = datetime.now(UTC).isoformat()
        c_hash = hashlib.sha256(file_content.encode("utf-8")).hexdigest()
        updated_entry = SpecEntry(
            id=entry.id, type=entry.type, path=entry.path,
            title=entry.title, status=entry.status,
            covers=entry.covers, tags=entry.tags, extras=entry.extras,
            content_hash=c_hash, indexed_at=now,
        )
        # Re-extract links from frontmatter
        raw_links = extract_links(meta)
        link_models = [
            Link(from_id=entry.id, to_id=target, type=ltype)
            for ltype, target in raw_links
        ]
        await self._index.upsert_spec(updated_entry, link_models)

        links = await self._index.get_links([id])
        return SpecDetail(
            id=entry.id, type=entry.type, path=entry.path,
            status=entry.status, title=entry.title, tags=entry.tags,
            content=content, links=links,
        )

    async def delete_spec(self, id: str) -> None:
        self._require_ready()
        entry = await self._index.get_spec(id)
        if entry is None:
            raise SpecNotFoundError(f"Spec '{id}' not found")

        file_path = self._root / entry.path

        delete_file(file_path)

        # Clean dangling references from other specs' frontmatter
        await self._clean_dangling_refs(id)

        # Remove from index (CASCADE deletes outgoing links)
        await self._index.remove_spec(id)

    async def get_graph(self) -> SpecGraph:
        if self._index is not None and not self._index.is_ready:
            return SpecGraph(nodes=[], edges=[], documents=[])
        entries = await self._index.get_all_specs()
        links = await self._index.get_all_links()
        documents = await self._index.get_all_documents()
        return build_graph(entries, links, documents)

    async def get_links(
        self,
        ids: list[str],
        *,
        direction: str | None = None,
        link_type: str | None = None,
    ) -> list[Link]:
        """Return links involving *ids*, with optional direction/type filtering."""
        return await self._index.get_links(ids, direction=direction, link_type=link_type)

    async def get_referencing_specs(self, target_id: str) -> list[SpecEntry]:
        """Return specs whose outgoing links reference *target_id*."""
        return await self._index.get_referencing_specs(target_id)

    # ── Internal helpers ─────────────────────────────────────────────────

    async def _clean_dangling_refs(self, deleted_id: str) -> None:
        """Remove references to *deleted_id* from other specs' frontmatter."""

        referencing = await self._index.get_referencing_specs(deleted_id)
        for spec in referencing:
            if spec.id == deleted_id:
                continue
            file_path = self._root / spec.path
            try:
                content = read_text(file_path)
                meta, body = parse_frontmatter(content)
                changed = False

                for field in ("parent", "depends-on", "references", "implements"):
                    value = meta.get(field)
                    if value is None:
                        continue
                    if isinstance(value, str) and value == deleted_id:
                        del meta[field]
                        changed = True
                    elif isinstance(value, list) and deleted_id in value:
                        meta[field] = [v for v in value if v != deleted_id]
                        if not meta[field]:
                            del meta[field]
                        changed = True

                if changed:
                    write_text(file_path, serialize_frontmatter(meta, body))
            except Exception:
                logger.debug("Failed to clean dangling ref from %s", spec.path, exc_info=True)


# ── Helpers ──────────────────────────────────────────────────────────────────


_extract_title = extract_title  # backward-compatible alias


def _generate_id(title: str) -> str:
    """Generate a slug ID from a title."""
    slug = title.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug
