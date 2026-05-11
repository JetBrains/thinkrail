"""SQLite index management for the spec module.

Manages the per-project spec index — a generated cache rebuilt from YAML
frontmatter in spec files.  The index is stored outside the project repo
in the server data directory (``~/.bonsai/indexes/<hash>/index.db``),
following the VS Code / Bazel pattern for external per-project caches.

Provides schema creation, full rebuild from disk, incremental upsert,
and query methods.  The index can be deleted and rebuilt at any time.

Design reference:
    .bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md §SQLite Index Schema
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiofiles
import aiosqlite
import pathspec

from pydantic import ValidationError

from app.core.config import BONSAI_DIRNAME
from app.spec.frontmatter import _LIST_LINK_FIELDS, parse_frontmatter
from app.spec.models import DocumentEntry, Frontmatter, Link, SpecEntry

logger = logging.getLogger(__name__)


# ── Constants ────────────────────────────────────────────────────────────────

SCHEMA_VERSION = "3"  # bumped: forces rebuild to apply built-in skip paths

# .bonsai/ subdirectories that are Bonsai infrastructure — never meaningful as
# unmanaged documents.  Checked as path prefixes during _find_md_files().
BONSAI_INTERNAL_SKIP = frozenset(
    f"{BONSAI_DIRNAME}/{sub}/"
    for sub in ("trash", "cache", "sessions", "plans", "design_docs/plans")
)

_PRAGMAS = """\
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA auto_vacuum = FULL;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;
"""

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS specs (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    path         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft',
    covers       TEXT NOT NULL DEFAULT '[]',
    tags         TEXT NOT NULL DEFAULT '[]',
    extras       TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL,
    indexed_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
    from_id TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
    to_id   TEXT NOT NULL,
    type    TEXT NOT NULL,
    UNIQUE(from_id, to_id, type)
);

CREATE INDEX IF NOT EXISTS idx_links_to   ON links(to_id);
CREATE INDEX IF NOT EXISTS idx_links_type ON links(type);

CREATE TABLE IF NOT EXISTS documents (
    path         TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    indexed_at   TEXT NOT NULL
);
"""

_DROP_ALL = """\
DROP TABLE IF EXISTS links;
DROP TABLE IF EXISTS specs;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS _meta;
"""


# ── Helpers ──────────────────────────────────────────────────────────────────


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def extract_title(content: str, path: str) -> str:
    """Extract title from the first Markdown ``#`` heading, or derive from path."""
    if content:
        match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if match:
            return match.group(1).strip()
    return Path(path).stem.replace("_", " ").replace("-", " ").title()


def _row_to_spec_entry(row: aiosqlite.Row) -> SpecEntry:
    """Convert a SQLite row to a :class:`SpecEntry`."""
    return SpecEntry(
        id=row["id"],
        type=row["type"],
        path=row["path"],
        title=row["title"],
        status=row["status"],
        covers=json.loads(row["covers"]),
        tags=json.loads(row["tags"]),
        extras=json.loads(row["extras"]),
        content_hash=row["content_hash"],
        indexed_at=row["indexed_at"],
    )


def _row_to_link(row: aiosqlite.Row) -> Link:
    """Convert a SQLite row to a :class:`Link`."""
    return Link(from_id=row["from_id"], to_id=row["to_id"], type=row["type"])


# ── RebuildStats ─────────────────────────────────────────────────────────────


@dataclass
class RebuildStats:
    """Summary of a full index rebuild."""

    specs: int = 0
    documents: int = 0
    links: int = 0
    warnings: list[str] = field(default_factory=list)


# ── SpecIndex ────────────────────────────────────────────────────────────────


class SpecIndex:
    """Async facade over the per-project spec index SQLite database.

    The index is stored outside the repo at
    ``~/.bonsai/indexes/<project-hash>/index.db``.  Use
    :func:`app.core.config.get_index_path` to compute the path.

    Follows the same lifecycle pattern as :class:`AppStore`:
    ``open()`` → use → ``close()``, or use as an async context manager.
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._ready_event = asyncio.Event()
        self._in_transaction: bool = False
        self._bonsaihide_spec: pathspec.PathSpec | None = None

    # ── Lifecycle ────────────────────────────────────────────────────────

    @property
    def is_ready(self) -> bool:
        """True after :meth:`initialize` completes successfully."""
        return self._ready_event.is_set()

    async def wait_ready(self, timeout: float = 30.0) -> None:
        """Block until the index is ready, or raise TimeoutError."""
        await asyncio.wait_for(self._ready_event.wait(), timeout=timeout)

    async def open(self) -> None:
        """Open the database and set PRAGMAs.  Does NOT create schema or rebuild."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self._db_path))
        self._conn.row_factory = aiosqlite.Row

        for line in _PRAGMAS.strip().splitlines():
            line = line.strip()
            if line:
                await self._conn.execute(line)

    async def initialize(
        self,
        project_root: Path,
        bonsaihide_spec: pathspec.PathSpec | None = None,
    ) -> RebuildStats | None:
        """Single-pass init: connect → PRAGMAs → version check → rebuild if needed.

        Returns :class:`RebuildStats` if a rebuild was performed, else ``None``.
        """
        self._bonsaihide_spec = bonsaihide_spec
        await self.open()

        # Probe schema version — catch OperationalError on fresh DB
        needs_rebuild = False
        try:
            async with self._conn.execute(
                "SELECT value FROM _meta WHERE key = 'schema_version'"
            ) as cur:
                row = await cur.fetchone()
                if row is None or row["value"] != SCHEMA_VERSION:
                    needs_rebuild = True
        except aiosqlite.OperationalError:
            needs_rebuild = True  # fresh DB — no tables at all

        # Quick integrity check (only if version matched)
        if not needs_rebuild:
            if not await self.check_integrity():
                needs_rebuild = True

        # Rebuild (sets _ready_event internally) or mark ready
        if needs_rebuild:
            await self._conn.executescript(_DROP_ALL + "\n" + _SCHEMA)
            return await self.rebuild(project_root, bonsaihide_spec)

        self._ready_event.set()
        return None

    async def open_and_check(
        self,
        bonsaihide_spec: pathspec.PathSpec | None = None,
    ) -> bool:
        """Open the database, check schema version, and prepare for operation.

        Returns ``True`` if a full rebuild is needed (version mismatch, fresh DB,
        or corruption). Returns ``False`` if the index is ready to serve.

        When a rebuild is needed, creates the schema tables (so the coordinator
        can emit ``RebuildRequested`` immediately) but does NOT perform the
        rebuild itself.

        When no rebuild is needed, sets ``_ready_event`` so reads work
        immediately while a background differential scan runs.
        """
        self._bonsaihide_spec = bonsaihide_spec
        await self.open()

        needs_rebuild = False
        try:
            async with self._conn.execute(
                "SELECT value FROM _meta WHERE key = 'schema_version'"
            ) as cur:
                row = await cur.fetchone()
                if row is None or row["value"] != SCHEMA_VERSION:
                    needs_rebuild = True
        except aiosqlite.OperationalError:
            needs_rebuild = True  # fresh DB — no tables at all

        if not needs_rebuild:
            if not await self.check_integrity():
                needs_rebuild = True

        if needs_rebuild:
            # Create schema so rebuild has tables to work with
            await self._conn.executescript(_DROP_ALL + "\n" + _SCHEMA)
        else:
            # Index is valid — ready to serve immediately
            self._ready_event.set()

        return needs_rebuild

    async def close(self) -> None:
        """Close the database connection."""
        if self._conn:
            await self._conn.close()
            self._conn = None

    async def __aenter__(self) -> SpecIndex:
        """Open and create schema (for tests and ephemeral callers)."""
        await self.open()
        await self._db.executescript(_SCHEMA)
        # Stamp version so get_schema_version() works
        await self._db.execute(
            "INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)",
            (SCHEMA_VERSION,),
        )
        await self._db.commit()
        self._ready_event.set()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    @property
    def _db(self) -> aiosqlite.Connection:
        assert self._conn is not None, "SpecIndex not opened"
        return self._conn

    # ── Schema management ────────────────────────────────────────────────

    async def get_schema_version(self) -> str | None:
        """Return the stored schema version, or ``None`` if unset."""
        async with self._db.execute(
            "SELECT value FROM _meta WHERE key = 'schema_version'"
        ) as cur:
            row = await cur.fetchone()
            return row["value"] if row else None

    async def check_integrity(self) -> bool:
        """Run ``PRAGMA integrity_check`` and return True if OK."""
        try:
            async with self._db.execute("PRAGMA integrity_check") as cur:
                row = await cur.fetchone()
                return row is not None and row[0] == "ok"
        except Exception:
            logger.debug("Integrity check failed", exc_info=True)
            return False

    # ── Upsert methods ───────────────────────────────────────────────────

    async def upsert_spec(self, entry: SpecEntry, links: list[Link] | None = None) -> None:
        """Insert or replace a spec and its outgoing links."""
        await self._db.execute(
            """INSERT OR REPLACE INTO specs
               (id, type, path, title, status, covers, tags, extras, content_hash, indexed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entry.id,
                entry.type,
                entry.path,
                entry.title,
                entry.status,
                json.dumps(entry.covers),
                json.dumps(entry.tags),
                json.dumps(entry.extras),
                entry.content_hash,
                entry.indexed_at or _now(),
            ),
        )

        # Replace all outgoing links for this spec
        await self._db.execute("DELETE FROM links WHERE from_id = ?", (entry.id,))
        if links:
            await self._db.executemany(
                "INSERT OR IGNORE INTO links (from_id, to_id, type) VALUES (?, ?, ?)",
                [(lnk.from_id, lnk.to_id, lnk.type) for lnk in links],
            )

        if not self._in_transaction:
            await self._db.commit()

    async def upsert_document(self, path: str, title: str, content_hash: str) -> None:
        """Insert or replace an unmanaged document."""
        await self._db.execute(
            """INSERT OR REPLACE INTO documents (path, title, content_hash, indexed_at)
               VALUES (?, ?, ?, ?)""",
            (path, title, content_hash, _now()),
        )
        if not self._in_transaction:
            await self._db.commit()

    async def remove_spec(self, spec_id: str) -> None:
        """Delete a spec by ID (CASCADE deletes its outgoing links)."""
        await self._db.execute("DELETE FROM specs WHERE id = ?", (spec_id,))
        await self._db.commit()

    async def remove_by_path(self, path: str) -> None:
        """Remove a spec or document by file path."""
        await self._db.execute("DELETE FROM specs WHERE path = ?", (path,))
        await self._db.execute("DELETE FROM documents WHERE path = ?", (path,))
        await self._db.commit()

    async def reindex_file(self, project_root: Path, file_path: Path) -> str:
        """Re-index a single ``.md`` file — classify and upsert.

        Returns ``"spec"``, ``"document"``, or ``"removed"`` indicating
        how the file was classified.  If the file no longer exists, any
        existing entry is removed.
        """
        rel_path = str(file_path.relative_to(project_root))

        # Skip files hidden by .bonsaihide (clean up if previously indexed)
        if self._bonsaihide_spec is not None and self._bonsaihide_spec.match_file(rel_path):
            await self.remove_by_path(rel_path)
            return "removed"

        if not file_path.exists():
            await self.remove_by_path(rel_path)
            return "removed"

        try:
            async with aiofiles.open(file_path, encoding="utf-8") as f:
                content = await f.read()
        except OSError:
            logger.debug("Cannot read %s for re-indexing", rel_path, exc_info=True)
            return "removed"

        c_hash = _content_hash(content)

        # Skip if content hasn't changed
        existing_hash = await self.get_stored_hash(rel_path)
        if existing_hash == c_hash:
            # Determine current classification without re-parsing
            spec = await self.get_spec_by_path(rel_path)
            return "spec" if spec else "document"

        meta, body = parse_frontmatter(content)

        if meta and meta.get("id") and meta.get("type"):
            # Managed spec
            normalised = dict(meta)
            for _lf in _LIST_LINK_FIELDS:
                _val = normalised.get(_lf)
                if isinstance(_val, str):
                    normalised[_lf] = [_val] if _val else []

            try:
                fm = Frontmatter(**normalised)
            except ValidationError:
                # Validation failed — fall back to document
                title = extract_title(body or content, rel_path)
                await self._db.execute("DELETE FROM specs WHERE path = ?", (rel_path,))
                await self.upsert_document(rel_path, title, c_hash)
                return "document"

            if not fm.title:
                fm.title = extract_title(body, rel_path)

            entry = fm.to_spec_entry(rel_path, c_hash, _now())
            raw_links = fm.extract_links()
            link_models = [
                Link(from_id=entry.id, to_id=target, type=ltype)
                for ltype, target in raw_links
            ]

            # Remove from documents if it was previously unmanaged
            await self._db.execute("DELETE FROM documents WHERE path = ?", (rel_path,))
            await self.upsert_spec(entry, link_models)
            return "spec"

        else:
            # No valid frontmatter — unmanaged document
            title = extract_title(body or content if meta else content, rel_path)
            # Remove from specs if it was previously managed (CASCADE deletes links)
            await self._db.execute("DELETE FROM specs WHERE path = ?", (rel_path,))
            await self.upsert_document(rel_path, title, c_hash)
            return "document"

    # ── Query methods ────────────────────────────────────────────────────

    async def list_specs(
        self,
        *,
        type: str | None = None,
        status: str | None = None,
        tag: str | None = None,
        covers: str | None = None,
    ) -> list[SpecEntry]:
        """Return specs matching optional filters."""
        clauses: list[str] = []
        params: list[Any] = []

        if type:
            clauses.append("s.type = ?")
            params.append(type)
        if status:
            clauses.append("s.status = ?")
            params.append(status)
        if tag:
            clauses.append("EXISTS (SELECT 1 FROM json_each(s.tags) WHERE json_each.value = ?)")
            params.append(tag)
        if covers:
            clauses.append(
                "EXISTS (SELECT 1 FROM json_each(s.covers) AS c "
                "WHERE c.value LIKE ? OR ? LIKE c.value || '%')"
            )
            params.extend([f"{covers}%", covers])

        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        sql = f"SELECT * FROM specs s{where} ORDER BY s.id"

        async with self._db.execute(sql, params) as cur:
            return [_row_to_spec_entry(row) async for row in cur]

    async def get_spec(self, spec_id: str) -> SpecEntry | None:
        """Lookup a single spec by ID."""
        async with self._db.execute(
            "SELECT * FROM specs WHERE id = ?", (spec_id,)
        ) as cur:
            row = await cur.fetchone()
            return _row_to_spec_entry(row) if row else None

    async def get_spec_by_path(self, path: str) -> SpecEntry | None:
        """Lookup a spec by file path."""
        async with self._db.execute(
            "SELECT * FROM specs WHERE path = ?", (path,)
        ) as cur:
            row = await cur.fetchone()
            return _row_to_spec_entry(row) if row else None

    async def get_links(
        self,
        ids: list[str],
        *,
        direction: str | None = None,
        link_type: str | None = None,
    ) -> list[Link]:
        """Return links involving any of the given spec IDs.

        *direction* can be ``"outgoing"``, ``"incoming"``, or ``None`` (both).
        """
        if not ids:
            return []

        placeholders = ",".join("?" for _ in ids)
        clauses: list[str] = []
        params: list[Any] = []

        if direction == "outgoing":
            clauses.append(f"l.from_id IN ({placeholders})")
            params.extend(ids)
        elif direction == "incoming":
            clauses.append(f"l.to_id IN ({placeholders})")
            params.extend(ids)
        else:
            clauses.append(f"(l.from_id IN ({placeholders}) OR l.to_id IN ({placeholders}))")
            params.extend(ids)
            params.extend(ids)

        if link_type:
            clauses.append("l.type = ?")
            params.append(link_type)

        where = " WHERE " + " AND ".join(clauses)
        sql = f"SELECT from_id, to_id, type FROM links l{where}"

        async with self._db.execute(sql, params) as cur:
            return [_row_to_link(row) async for row in cur]

    async def get_all_specs(self) -> list[SpecEntry]:
        """Return all specs (for graph building)."""
        async with self._db.execute("SELECT * FROM specs ORDER BY id") as cur:
            return [_row_to_spec_entry(row) async for row in cur]

    async def get_all_links(self) -> list[Link]:
        """Return all links (for graph building)."""
        async with self._db.execute("SELECT from_id, to_id, type FROM links") as cur:
            return [_row_to_link(row) async for row in cur]

    async def get_all_documents(self) -> list[DocumentEntry]:
        """Return all unmanaged documents (for graph building)."""
        async with self._db.execute(
            "SELECT path, title FROM documents ORDER BY path"
        ) as cur:
            return [
                DocumentEntry(path=row["path"], title=row["title"])
                async for row in cur
            ]

    async def get_all_indexed_paths(self) -> set[str]:
        """Return the set of all indexed paths (specs + documents).

        Lightweight query — returns only path strings, not full entries.
        Used by the differential scan to detect offline deletions.
        """
        paths: set[str] = set()
        async with self._db.execute("SELECT path FROM specs") as cur:
            async for row in cur:
                paths.add(row["path"])
        async with self._db.execute("SELECT path FROM documents") as cur:
            async for row in cur:
                paths.add(row["path"])
        return paths

    async def get_referencing_specs(self, target_id: str) -> list[SpecEntry]:
        """Return specs whose outgoing links reference *target_id*."""
        async with self._db.execute(
            """SELECT DISTINCT s.* FROM specs s
               JOIN links l ON l.from_id = s.id
               WHERE l.to_id = ?""",
            (target_id,),
        ) as cur:
            return [_row_to_spec_entry(row) async for row in cur]

    async def get_stored_hash(self, path: str) -> str | None:
        """Return the stored content hash for a path (spec or document)."""
        async with self._db.execute(
            "SELECT content_hash FROM specs WHERE path = ?", (path,)
        ) as cur:
            row = await cur.fetchone()
            if row:
                return row["content_hash"]

        async with self._db.execute(
            "SELECT content_hash FROM documents WHERE path = ?", (path,)
        ) as cur:
            row = await cur.fetchone()
            return row["content_hash"] if row else None

    # ── Rebuild ──────────────────────────────────────────────────────────

    async def rebuild(
        self,
        project_root: Path,
        bonsaihide_spec: pathspec.PathSpec | None = None,
    ) -> RebuildStats:
        """Perform a full rebuild of the index from disk.

        Scans all ``.md`` files under *project_root* (excluding patterns
        matched by *bonsaihide_spec*), parses frontmatter, classifies each
        file, and populates the index.

        Sets ``is_ready`` to ``False`` during execution to prevent concurrent
        ``reindex_file()`` calls, and restores it when done (even on error).
        """
        self._bonsaihide_spec = bonsaihide_spec
        self._ready_event.clear()
        stats = RebuildStats()
        try:
            return await self._do_rebuild(project_root, bonsaihide_spec, stats)
        finally:
            self._ready_event.set()

    async def _do_rebuild(
        self,
        project_root: Path,
        bonsaihide_spec: pathspec.PathSpec | None,
        stats: RebuildStats,
    ) -> RebuildStats:
        """Inner rebuild logic — called by :meth:`rebuild` inside try/finally."""
        self._in_transaction = True
        try:
            await self._db.execute("BEGIN IMMEDIATE")

            # Clear existing data
            await self._db.execute("DELETE FROM links")
            await self._db.execute("DELETE FROM specs")
            await self._db.execute("DELETE FROM documents")

            md_files = await asyncio.to_thread(_find_md_files, project_root, bonsaihide_spec)

            for file_path in md_files:
                rel_path = str(file_path.relative_to(project_root))
                try:
                    async with aiofiles.open(file_path, encoding="utf-8") as f:
                        content = await f.read()
                except OSError as exc:
                    stats.warnings.append(f"Cannot read {rel_path}: {exc}")
                    continue

                c_hash = _content_hash(content)
                meta, body = parse_frontmatter(content)

                if meta and meta.get("id") and meta.get("type"):
                    # Managed spec — normalise single-string list-link fields
                    normalised = dict(meta)
                    for _lf in _LIST_LINK_FIELDS:
                        _val = normalised.get(_lf)
                        if isinstance(_val, str):
                            normalised[_lf] = [_val] if _val else []

                    try:
                        fm = Frontmatter(**normalised)
                    except ValidationError as exc:
                        # Soft validation — log warnings but skip this spec
                        msgs = [
                            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}"
                            for e in exc.errors()
                        ]
                        stats.warnings.append(
                            f"{rel_path}: frontmatter warnings — {'; '.join(msgs)}"
                        )
                        # Fall back to unmanaged document
                        title = extract_title(body or content, rel_path)
                        await self.upsert_document(rel_path, title, c_hash)
                        stats.documents += 1
                        continue

                    # Override empty title with heading from body
                    if not fm.title:
                        fm.title = extract_title(body, rel_path)

                    entry = fm.to_spec_entry(rel_path, c_hash, _now())

                    # Build links from frontmatter
                    raw_links = fm.extract_links()
                    link_models = [
                        Link(from_id=entry.id, to_id=target, type=ltype)
                        for ltype, target in raw_links
                    ]

                    await self.upsert_spec(entry, link_models)
                    stats.specs += 1
                    stats.links += len(link_models)

                elif meta and (meta.get("id") or meta.get("type")):
                    # Has frontmatter but missing id or type — warning
                    missing = []
                    if not meta.get("id"):
                        missing.append("id")
                    if not meta.get("type"):
                        missing.append("type")
                    stats.warnings.append(
                        f"{rel_path}: frontmatter missing required field(s): {', '.join(missing)}"
                    )
                    # Index as unmanaged document
                    title = extract_title(body or content, rel_path)
                    await self.upsert_document(rel_path, title, c_hash)
                    stats.documents += 1

                else:
                    # No frontmatter or empty — unmanaged document
                    title = extract_title(content, rel_path)
                    await self.upsert_document(rel_path, title, c_hash)
                    stats.documents += 1

            # Update schema version
            await self._db.execute(
                "INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)",
                (SCHEMA_VERSION,),
            )

            await self._db.commit()  # Single atomic commit

            logger.info(
                "Rebuilt index: %d specs, %d documents, %d links, %d warnings",
                stats.specs, stats.documents, stats.links, len(stats.warnings),
            )
            return stats

        except BaseException:
            await self._db.rollback()
            raise
        finally:
            self._in_transaction = False



# ── File discovery ───────────────────────────────────────────────────────────


def _find_md_files(
    project_root: Path,
    bonsaihide_spec: pathspec.PathSpec | None = None,
) -> list[Path]:
    """Recursively find all ``.md`` files under *project_root*.

    Excludes hidden directories (starting with ``.``), ``node_modules``,
    and paths matching *bonsaihide_spec* (gitignore-style matching via
    ``pathspec``).
    """
    results: list[Path] = []
    skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv"}

    for file_path in project_root.rglob("*.md"):
        # Skip hidden directories and known non-content dirs
        parts = file_path.relative_to(project_root).parts
        if any(p.startswith(".") and p != BONSAI_DIRNAME for p in parts):
            continue
        if any(p in skip_dirs for p in parts):
            continue

        # Skip .bonsai/ infrastructure directories (trash, cache, etc.)
        rel = str(file_path.relative_to(project_root))
        if any(rel.startswith(prefix) for prefix in BONSAI_INTERNAL_SKIP):
            continue

        # Check bonsaihide patterns (gitignore-style matching)
        if bonsaihide_spec is not None and bonsaihide_spec.match_file(rel):
            continue

        results.append(file_path)

    return sorted(results)
