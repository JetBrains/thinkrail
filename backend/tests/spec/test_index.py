"""Tests for the SpecIndex — SQLite index management."""

from __future__ import annotations

import textwrap
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch

import pathspec
import pytest

from app.spec.index import (
    BONSAI_INTERNAL_SKIP,
    SCHEMA_VERSION,
    RebuildStats,
    SpecIndex,
    _find_md_files,
)
from app.spec.models import Link, SpecEntry
from app.spec.service import IndexNotReadyError, SpecService


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_entry(
    id: str = "test-spec",
    type: str = "task-spec",
    path: str = "specs/test.md",
    title: str = "Test Spec",
    **kwargs,
) -> SpecEntry:
    """Create a SpecEntry with sensible defaults."""
    return SpecEntry(
        id=id, type=type, path=path, title=title,
        content_hash="abc123", indexed_at="2026-04-16T00:00:00",
        **kwargs,
    )


def _make_link(from_id: str, to_id: str, type: str = "depends-on") -> Link:
    return Link(from_id=from_id, to_id=to_id, type=type)


def _write_spec_file(root: Path, rel_path: str, content: str) -> Path:
    """Write a file at root/rel_path and return the full path."""
    full = root / rel_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(textwrap.dedent(content), encoding="utf-8")
    return full


def _make_pathspec(patterns: list[str]) -> pathspec.PathSpec:
    """Build a pathspec from gitignore-style patterns."""
    return pathspec.PathSpec.from_lines("gitignore", patterns)


# ── TestSpecIndex ────────────────────────────────────────────────────────────


class TestSpecIndex:
    """Core lifecycle, schema, and basic operations."""

    async def test_open_creates_tables(self, tmp_path: Path) -> None:
        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            version = await idx.get_schema_version()
            assert version == SCHEMA_VERSION

    async def test_context_manager(self, tmp_path: Path) -> None:
        db_path = tmp_path / "index.db"
        async with SpecIndex(db_path) as idx:
            assert idx._conn is not None
        assert idx._conn is None  # closed after exit

    async def test_integrity_check_passes(self, tmp_path: Path) -> None:
        db_path = tmp_path / "index.db"
        async with SpecIndex(db_path) as idx:
            assert await idx.check_integrity() is True


# ── TestUpsertAndQuery ───────────────────────────────────────────────────────


class TestUpsertAndQuery:
    """Upsert specs, query them back, verify round-trip."""

    async def test_upsert_and_get_spec(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            entry = _make_entry()
            await idx.upsert_spec(entry)
            result = await idx.get_spec("test-spec")
            assert result is not None
            assert result.id == "test-spec"
            assert result.type == "task-spec"
            assert result.title == "Test Spec"

    async def test_upsert_replaces_on_conflict(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await idx.upsert_spec(_make_entry(title="V1"))
            await idx.upsert_spec(_make_entry(title="V2"))
            result = await idx.get_spec("test-spec")
            assert result is not None
            assert result.title == "V2"

    async def test_upsert_with_links(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            entry = _make_entry(id="child")
            links = [_make_link("child", "parent", "parent")]
            await idx.upsert_spec(entry, links)
            result_links = await idx.get_links(["child"], direction="outgoing")
            assert len(result_links) == 1
            assert result_links[0].to_id == "parent"

    async def test_upsert_replaces_links(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            entry = _make_entry(id="child")
            await idx.upsert_spec(entry, [_make_link("child", "old-dep")])
            await idx.upsert_spec(entry, [_make_link("child", "new-dep")])
            result_links = await idx.get_links(["child"], direction="outgoing")
            assert len(result_links) == 1
            assert result_links[0].to_id == "new-dep"

    async def test_get_spec_not_found(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            assert await idx.get_spec("nonexistent") is None

    async def test_get_spec_by_path(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await idx.upsert_spec(_make_entry(path="backend/spec/README.md"))
            result = await idx.get_spec_by_path("backend/spec/README.md")
            assert result is not None
            assert result.id == "test-spec"

    async def test_extras_preserved(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            entry = _make_entry(extras={"priority": "high", "sprint": 3})
            await idx.upsert_spec(entry)
            result = await idx.get_spec("test-spec")
            assert result is not None
            assert result.extras["priority"] == "high"
            assert result.extras["sprint"] == 3

    async def test_covers_and_tags_roundtrip(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            entry = _make_entry(
                covers=["backend/app/spec/", "backend/app/core/"],
                tags=["backend", "critical"],
            )
            await idx.upsert_spec(entry)
            result = await idx.get_spec("test-spec")
            assert result is not None
            assert result.covers == ["backend/app/spec/", "backend/app/core/"]
            assert result.tags == ["backend", "critical"]


# ── TestRemove ───────────────────────────────────────────────────────────────


class TestRemove:
    async def test_remove_spec_cascade_deletes_links(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await idx.upsert_spec(
                _make_entry(id="parent", path="p.md"),
            )
            await idx.upsert_spec(
                _make_entry(id="child", path="c.md"),
                [_make_link("child", "parent", "parent")],
            )
            await idx.remove_spec("child")

            assert await idx.get_spec("child") is None
            links = await idx.get_links(["child"])
            assert links == []

    async def test_remove_by_path(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await idx.upsert_spec(_make_entry(path="specs/test.md"))
            await idx.remove_by_path("specs/test.md")
            assert await idx.get_spec("test-spec") is None

    async def test_remove_document_by_path(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await idx.upsert_document("notes.md", "Notes", "hash123")
            await idx.remove_by_path("notes.md")
            # No crash, doc removed silently


# ── TestListAndFilter ────────────────────────────────────────────────────────


class TestListAndFilter:
    async def _seed(self, idx: SpecIndex) -> None:
        """Seed index with test data for filter tests."""
        await idx.upsert_spec(_make_entry(
            id="mod-spec", type="module-design", path="mod.md",
            title="Module Spec", status="active", tags=["backend"],
            covers=["backend/app/spec/"],
        ))
        await idx.upsert_spec(_make_entry(
            id="task-fix", type="task-spec", path="task.md",
            title="Fix Bug", status="draft", tags=["frontend"],
            covers=["frontend/src/"],
        ))
        await idx.upsert_spec(_make_entry(
            id="task-feat", type="task-spec", path="feat.md",
            title="New Feature", status="active", tags=["backend", "critical"],
            covers=["backend/app/agent/"],
        ))

    async def test_list_all(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            results = await idx.list_specs()
            assert len(results) == 3

    async def test_filter_by_type(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            results = await idx.list_specs(type="task-spec")
            assert len(results) == 2
            assert all(r.type == "task-spec" for r in results)

    async def test_filter_by_status(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            results = await idx.list_specs(status="active")
            assert len(results) == 2

    async def test_filter_by_tag(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            results = await idx.list_specs(tag="backend")
            assert len(results) == 2
            ids = {r.id for r in results}
            assert "mod-spec" in ids
            assert "task-feat" in ids

    async def test_filter_by_covers(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            results = await idx.list_specs(covers="backend/app/spec/")
            assert len(results) >= 1
            assert any(r.id == "mod-spec" for r in results)

    async def test_combined_filters(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            results = await idx.list_specs(type="task-spec", status="active")
            assert len(results) == 1
            assert results[0].id == "task-feat"


# ── TestLinks ────────────────────────────────────────────────────────────────


class TestLinks:
    async def _seed(self, idx: SpecIndex) -> None:
        await idx.upsert_spec(_make_entry(id="a", path="a.md"))
        await idx.upsert_spec(
            _make_entry(id="b", path="b.md"),
            [_make_link("b", "a", "depends-on")],
        )
        await idx.upsert_spec(
            _make_entry(id="c", path="c.md"),
            [_make_link("c", "a", "parent"), _make_link("c", "b", "references")],
        )

    async def test_get_links_all(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            links = await idx.get_links(["a"])
            # a is referenced by b (depends-on) and c (parent)
            assert len(links) == 2

    async def test_get_links_outgoing(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            links = await idx.get_links(["c"], direction="outgoing")
            assert len(links) == 2  # c → a (parent), c → b (references)

    async def test_get_links_incoming(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            links = await idx.get_links(["a"], direction="incoming")
            assert len(links) == 2  # b → a, c → a

    async def test_get_links_by_type(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            links = await idx.get_links(["a"], link_type="parent")
            assert len(links) == 1
            assert links[0].from_id == "c"

    async def test_dangling_links_allowed(self, tmp_path: Path) -> None:
        """to_id does not need to reference an existing spec."""
        async with SpecIndex(tmp_path / "index.db") as idx:
            entry = _make_entry(id="x", path="x.md")
            links = [_make_link("x", "future-spec", "depends-on")]
            await idx.upsert_spec(entry, links)  # should not raise
            result_links = await idx.get_links(["x"])
            assert len(result_links) == 1
            assert result_links[0].to_id == "future-spec"

    async def test_get_referencing_specs(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            refs = await idx.get_referencing_specs("a")
            ids = {r.id for r in refs}
            assert "b" in ids  # b depends-on a
            assert "c" in ids  # c parent a

    async def test_get_all_links(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await self._seed(idx)
            all_links = await idx.get_all_links()
            assert len(all_links) == 3  # b→a, c→a, c→b


# ── TestRebuild ──────────────────────────────────────────────────────────────


class TestRebuild:
    async def test_rebuild_from_disk(self, tmp_path: Path) -> None:
        # Create test fixtures
        _write_spec_file(tmp_path, "spec-a.md", """\
            ---
            id: spec-a
            type: module-design
            status: active
            tags:
              - backend
            ---
            # Module A

            Content for module A.
        """)
        _write_spec_file(tmp_path, "spec-b.md", """\
            ---
            id: spec-b
            type: task-spec
            depends-on:
              - spec-a
            ---
            # Task B

            Depends on module A.
        """)
        _write_spec_file(tmp_path, "notes.md", """\
            # Just Notes

            No frontmatter here.
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            stats = await idx.rebuild(tmp_path)
            assert stats.specs == 2
            assert stats.documents == 1
            assert stats.links == 1
            assert len(stats.warnings) == 0

            # Verify specs
            a = await idx.get_spec("spec-a")
            assert a is not None
            assert a.status == "active"
            assert a.tags == ["backend"]

            b = await idx.get_spec("spec-b")
            assert b is not None
            assert b.type == "task-spec"

            # Verify links
            links = await idx.get_links(["spec-b"], direction="outgoing")
            assert len(links) == 1
            assert links[0].to_id == "spec-a"
            assert links[0].type == "depends-on"

    async def test_rebuild_with_missing_id(self, tmp_path: Path) -> None:
        """Files with frontmatter but missing id should become documents with a warning."""
        _write_spec_file(tmp_path, "incomplete.md", """\
            ---
            type: task-spec
            ---
            # Incomplete

            Missing id field.
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            stats = await idx.rebuild(tmp_path)
            assert stats.specs == 0
            assert stats.documents == 1
            assert any("missing required" in w.lower() for w in stats.warnings)

    async def test_rebuild_clears_stale_data(self, tmp_path: Path) -> None:
        """Rebuild should replace old data, not append."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: the-spec
            type: task-spec
            ---
            # Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            # Insert stale data
            await idx.upsert_spec(_make_entry(id="stale", path="old.md"))

            stats = await idx.rebuild(tmp_path)
            assert stats.specs == 1

            # Stale entry should be gone
            assert await idx.get_spec("stale") is None
            assert await idx.get_spec("the-spec") is not None

    async def test_rebuild_with_custom_fields(self, tmp_path: Path) -> None:
        _write_spec_file(tmp_path, "custom.md", """\
            ---
            id: custom-spec
            type: task-spec
            priority: high
            sprint: 3
            ---
            # Custom

            Has extra fields.
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            stats = await idx.rebuild(tmp_path)
            assert stats.specs == 1

            spec = await idx.get_spec("custom-spec")
            assert spec is not None
            assert spec.extras["priority"] == "high"
            assert spec.extras["sprint"] == 3


# ── TestIncrementalUpdate ────────────────────────────────────────────────────


class TestIncrementalUpdate:
    """Verify content hash change detection for incremental operations."""

    async def test_stored_hash_matches_after_upsert(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            entry = SpecEntry(
                id="test-spec", type="task-spec", path="specs/test.md",
                title="Test", content_hash="sha256-abc123", indexed_at="2026-04-16T00:00:00",
            )
            await idx.upsert_spec(entry)
            stored = await idx.get_stored_hash("specs/test.md")
            assert stored == "sha256-abc123"

    async def test_stored_hash_for_document(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            await idx.upsert_document("notes.md", "Notes", "hash-doc-456")
            stored = await idx.get_stored_hash("notes.md")
            assert stored == "hash-doc-456"

    async def test_stored_hash_none_for_unknown_path(self, tmp_path: Path) -> None:
        async with SpecIndex(tmp_path / "index.db") as idx:
            stored = await idx.get_stored_hash("nonexistent.md")
            assert stored is None

    async def test_rebuild_updates_hash(self, tmp_path: Path) -> None:
        """After rebuild, content_hash reflects actual file content."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec

            Content v1.
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            await idx.rebuild(tmp_path)
            hash_v1 = await idx.get_stored_hash("spec.md")
            assert hash_v1 is not None

            # Modify the file
            _write_spec_file(tmp_path, "spec.md", """\
                ---
                id: my-spec
                type: task-spec
                ---
                # My Spec

                Content v2 — changed.
            """)

            await idx.rebuild(tmp_path)
            hash_v2 = await idx.get_stored_hash("spec.md")
            assert hash_v2 is not None
            assert hash_v1 != hash_v2


class TestInitialize:
    """Tests for the single-pass initialize() method."""

    async def test_fresh_db_rebuilds_and_populates(self, tmp_path: Path) -> None:
        """On a fresh DB (no tables), initialize() creates schema + rebuilds."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        idx = SpecIndex(db_path)
        stats = await idx.initialize(tmp_path)
        assert stats is not None  # rebuild happened
        assert stats.specs == 1
        assert idx.is_ready is True

        # Verify spec is actually in the index
        spec = await idx.get_spec("my-spec")
        assert spec is not None
        await idx.close()

    async def test_existing_db_matching_version_skips_rebuild(self, tmp_path: Path) -> None:
        """If version matches and integrity OK, initialize() returns None."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"

        # First: initialize to build the index
        idx1 = SpecIndex(db_path)
        await idx1.initialize(tmp_path)
        await idx1.close()

        # Second: initialize again — should skip rebuild
        idx2 = SpecIndex(db_path)
        stats = await idx2.initialize(tmp_path)
        assert stats is None  # no rebuild needed
        assert idx2.is_ready is True
        await idx2.close()

    async def test_version_mismatch_triggers_rebuild(self, tmp_path: Path) -> None:
        """Schema version mismatch causes a full rebuild."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"

        # First: create index with correct version
        async with SpecIndex(db_path) as idx:
            await idx._db.execute(
                "UPDATE _meta SET value = 'wrong' WHERE key = 'schema_version'"
            )
            await idx._db.commit()

        # Second: initialize should detect mismatch and rebuild
        idx2 = SpecIndex(db_path)
        stats = await idx2.initialize(tmp_path)
        assert stats is not None
        assert stats.specs == 1
        assert idx2.is_ready is True
        version = await idx2.get_schema_version()
        assert version == SCHEMA_VERSION
        await idx2.close()

    async def test_corrupt_db_triggers_rebuild(self, tmp_path: Path) -> None:
        """A corrupt integrity check triggers a full rebuild."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"

        # First: create a valid index
        idx1 = SpecIndex(db_path)
        await idx1.initialize(tmp_path)
        await idx1.close()

        # Second: initialize with patched integrity check returning False
        idx2 = SpecIndex(db_path)
        with patch.object(idx2, "check_integrity", new_callable=AsyncMock, return_value=False):
            stats = await idx2.initialize(tmp_path)
        assert stats is not None  # rebuild happened
        assert idx2.is_ready is True
        await idx2.close()

    async def test_is_ready_false_before_initialize(self, tmp_path: Path) -> None:
        """is_ready is False before initialize() is called."""
        db_path = tmp_path / "index.db"
        idx = SpecIndex(db_path)
        assert idx.is_ready is False

    async def test_bonsaihide_applied_during_initialize(self, tmp_path: Path) -> None:
        """bonsaihide_spec is passed through to rebuild during initialize."""
        _write_spec_file(tmp_path, "visible.md", """\
            ---
            id: visible
            type: task-spec
            ---
            # Visible
        """)
        _write_spec_file(tmp_path, "hidden.md", """\
            ---
            id: hidden
            type: task-spec
            ---
            # Hidden
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        spec = _make_pathspec(["hidden.md"])
        idx = SpecIndex(db_path)
        stats = await idx.initialize(tmp_path, bonsaihide_spec=spec)
        assert stats is not None
        assert stats.specs == 1  # only visible.md indexed
        assert await idx.get_spec("visible") is not None
        assert await idx.get_spec("hidden") is None
        await idx.close()


# ── TestFindMdFiles ──────────────────────────────────────────────────────────


class TestFindMdFiles:
    def test_finds_md_files(self, tmp_path: Path) -> None:
        (tmp_path / "a.md").write_text("# A")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "b.md").write_text("# B")
        result = _find_md_files(tmp_path)
        assert len(result) == 2

    def test_skips_hidden_dirs(self, tmp_path: Path) -> None:
        (tmp_path / ".hidden").mkdir()
        (tmp_path / ".hidden" / "secret.md").write_text("# Secret")
        (tmp_path / "visible.md").write_text("# Visible")
        result = _find_md_files(tmp_path)
        assert len(result) == 1
        assert result[0].name == "visible.md"

    def test_allows_bonsai_dir(self, tmp_path: Path) -> None:
        (tmp_path / ".bonsai").mkdir()
        (tmp_path / ".bonsai" / "spec.md").write_text("# Spec")
        result = _find_md_files(tmp_path)
        assert len(result) == 1

    def test_skips_node_modules(self, tmp_path: Path) -> None:
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "pkg.md").write_text("# Pkg")
        result = _find_md_files(tmp_path)
        assert len(result) == 0

    def test_bonsaihide_pathspec(self, tmp_path: Path) -> None:
        """Pathspec-based filtering excludes matched files."""
        (tmp_path / "include.md").write_text("# Include")
        (tmp_path / "exclude.md").write_text("# Exclude")
        spec = _make_pathspec(["exclude.md"])
        result = _find_md_files(tmp_path, spec)
        assert len(result) == 1
        assert result[0].name == "include.md"

    def test_bonsaihide_pathspec_wildcard(self, tmp_path: Path) -> None:
        """Wildcard patterns work like gitignore."""
        (tmp_path / "docs").mkdir()
        (tmp_path / "docs" / "keep.md").write_text("# Keep")
        (tmp_path / "drafts").mkdir()
        (tmp_path / "drafts" / "wip.md").write_text("# WIP")
        spec = _make_pathspec(["drafts/"])
        result = _find_md_files(tmp_path, spec)
        assert len(result) == 1
        assert result[0].name == "keep.md"

    def test_bonsaihide_pathspec_negation(self, tmp_path: Path) -> None:
        """Negation patterns (!) re-include previously excluded files."""
        (tmp_path / "a.md").write_text("# A")
        (tmp_path / "b.md").write_text("# B")
        (tmp_path / "c.md").write_text("# C")
        # Exclude all .md, then re-include b.md
        spec = _make_pathspec(["*.md", "!b.md"])
        result = _find_md_files(tmp_path, spec)
        assert len(result) == 1
        assert result[0].name == "b.md"

    def test_no_bonsaihide_spec_finds_all(self, tmp_path: Path) -> None:
        """None bonsaihide_spec means no filtering."""
        (tmp_path / "a.md").write_text("# A")
        (tmp_path / "b.md").write_text("# B")
        result = _find_md_files(tmp_path, None)
        assert len(result) == 2

    def test_skips_bonsai_internal_dirs(self, tmp_path: Path) -> None:
        """Files under BONSAI_INTERNAL_SKIP prefixes are excluded."""
        bonsai = tmp_path / ".bonsai"
        for skip in (
            "trash/specs/deleted-spec/deleted-spec.md",
            "cache/some-cache.md",
            "sessions/session-log.md",
            "plans/brainstorm-plan.md",
            "design_docs/plans/implementation.md",
        ):
            p = bonsai / skip
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(f"# {skip}")

        result = _find_md_files(tmp_path)
        paths = {str(f.relative_to(tmp_path)) for f in result}
        for skip_prefix in BONSAI_INTERNAL_SKIP:
            assert not any(p.startswith(skip_prefix) for p in paths), (
                f"Expected files under {skip_prefix!r} to be excluded"
            )

    def test_allows_non_skipped_bonsai_subdirs(self, tmp_path: Path) -> None:
        """Files in .bonsai/ subdirs NOT in the skip set are still found."""
        bonsai = tmp_path / ".bonsai"
        (bonsai / "design_docs").mkdir(parents=True)
        (bonsai / "design_docs" / "SOME_DESIGN.md").write_text("# Design")
        (bonsai / "implementation_tasks" / "spec").mkdir(parents=True)
        (bonsai / "implementation_tasks" / "spec" / "some-task.md").write_text("# Task")

        result = _find_md_files(tmp_path)
        paths = {str(f.relative_to(tmp_path)) for f in result}
        assert ".bonsai/design_docs/SOME_DESIGN.md" in paths
        assert ".bonsai/implementation_tasks/spec/some-task.md" in paths

    def test_root_files_not_affected_by_skip(self, tmp_path: Path) -> None:
        """Project-root .md files are never affected by BONSAI_INTERNAL_SKIP."""
        (tmp_path / "README.md").write_text("# README")
        result = _find_md_files(tmp_path)
        assert len(result) == 1
        assert result[0].name == "README.md"


# ── TestBuiltInSkipPaths ────────────────────────────────────────────────────


class TestBuiltInSkipPaths:
    """End-to-end: rebuild with skip paths verifies documents table."""

    async def test_skipped_files_excluded_from_documents(self, tmp_path: Path) -> None:
        """Files under every BONSAI_INTERNAL_SKIP prefix are NOT in get_all_documents()."""
        bonsai = tmp_path / ".bonsai"
        for skip_file in (
            "trash/specs/deleted-spec/deleted-spec.md",
            "cache/some-cache.md",
            "sessions/session-log.md",
            "plans/brainstorm-plan.md",
            "design_docs/plans/implementation.md",
        ):
            p = bonsai / skip_file
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(f"# {skip_file}")

        # Also create a project-root doc that should be indexed
        (tmp_path / "README.md").write_text("# README")

        db_path = bonsai / "index.db"
        async with SpecIndex(db_path) as idx:
            stats = await idx.rebuild(tmp_path)
            docs = await idx.get_all_documents()
            doc_paths = {d.path for d in docs}

            # Skipped files must not appear
            assert ".bonsai/trash/specs/deleted-spec/deleted-spec.md" not in doc_paths
            assert ".bonsai/cache/some-cache.md" not in doc_paths
            assert ".bonsai/sessions/session-log.md" not in doc_paths
            assert ".bonsai/plans/brainstorm-plan.md" not in doc_paths
            assert ".bonsai/design_docs/plans/implementation.md" not in doc_paths

            # Project-root doc is still there
            assert "README.md" in doc_paths

    async def test_non_skipped_bonsai_dirs_still_indexed(self, tmp_path: Path) -> None:
        """Files in .bonsai/ dirs NOT in the skip set appear as documents."""
        bonsai = tmp_path / ".bonsai"
        (bonsai / "design_docs").mkdir(parents=True)
        (bonsai / "design_docs" / "SOME_DESIGN.md").write_text("# Some Design")
        (bonsai / "implementation_tasks" / "spec").mkdir(parents=True)
        (bonsai / "implementation_tasks" / "spec" / "some-task.md").write_text("# Some Task")

        db_path = bonsai / "index.db"
        async with SpecIndex(db_path) as idx:
            await idx.rebuild(tmp_path)
            docs = await idx.get_all_documents()
            doc_paths = {d.path for d in docs}
            assert ".bonsai/design_docs/SOME_DESIGN.md" in doc_paths
            assert ".bonsai/implementation_tasks/spec/some-task.md" in doc_paths

    async def test_schema_version_is_3(self, tmp_path: Path) -> None:
        """SCHEMA_VERSION constant must be '3'."""
        assert SCHEMA_VERSION == "3"

    async def test_old_schema_triggers_rebuild(self, tmp_path: Path) -> None:
        """An index with version '2' triggers a full rebuild on initialize."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"

        # Create index with old schema version
        async with SpecIndex(db_path) as idx:
            await idx._db.execute(
                "UPDATE _meta SET value = '2' WHERE key = 'schema_version'"
            )
            await idx._db.commit()

        # initialize should detect mismatch and rebuild
        idx2 = SpecIndex(db_path)
        stats = await idx2.initialize(tmp_path)
        assert stats is not None  # rebuild happened
        assert stats.specs >= 1
        version = await idx2.get_schema_version()
        assert version == "3"
        await idx2.close()


# ── TestGetAllDocuments ─────────────────────────────────────────────────────


class TestGetAllDocuments:
    """Tests for the get_all_documents() query method."""

    async def test_returns_unmanaged_documents_after_rebuild(self, tmp_path: Path) -> None:
        """Rebuild with mixed .md files — only unmanaged ones in get_all_documents()."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec
        """)
        _write_spec_file(tmp_path, "notes.md", """\
            # Just Notes

            No frontmatter here.
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            stats = await idx.rebuild(tmp_path)
            assert stats.specs == 1
            assert stats.documents == 1

            docs = await idx.get_all_documents()
            assert len(docs) == 1
            assert docs[0].path == "notes.md"
            assert docs[0].title == "Just Notes"

    async def test_returns_empty_when_no_documents(self, tmp_path: Path) -> None:
        """Only managed specs — get_all_documents() returns empty list."""
        _write_spec_file(tmp_path, "spec.md", """\
            ---
            id: my-spec
            type: task-spec
            ---
            # My Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            await idx.rebuild(tmp_path)
            docs = await idx.get_all_documents()
            assert docs == []

    async def test_documents_sorted_by_path(self, tmp_path: Path) -> None:
        """Documents are returned in alphabetical path order."""
        _write_spec_file(tmp_path, "z-doc.md", "# Z Doc")
        _write_spec_file(tmp_path, "a-doc.md", "# A Doc")
        _write_spec_file(tmp_path, "m-doc.md", "# M Doc")

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            await idx.rebuild(tmp_path)
            docs = await idx.get_all_documents()
            assert len(docs) == 3
            paths = [d.path for d in docs]
            assert paths == ["a-doc.md", "m-doc.md", "z-doc.md"]

    async def test_promotion_removes_from_documents(self, tmp_path: Path) -> None:
        """Adding frontmatter to an unmanaged doc promotes it to specs."""
        _write_spec_file(tmp_path, "evolving.md", """\
            # Evolving Doc

            No frontmatter yet.
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            await idx.rebuild(tmp_path)
            docs = await idx.get_all_documents()
            assert len(docs) == 1
            assert docs[0].path == "evolving.md"

            # Add frontmatter and re-index
            _write_spec_file(tmp_path, "evolving.md", """\
                ---
                id: evolving-spec
                type: task-spec
                ---
                # Evolving Doc

                Now has frontmatter.
            """)
            await idx.rebuild(tmp_path)

            docs_after = await idx.get_all_documents()
            assert len(docs_after) == 0

            spec = await idx.get_spec("evolving-spec")
            assert spec is not None
            assert spec.path == "evolving.md"


# ── TestIsReadyGuards ───────────────────────────────────────────────────────


class TestIsReadyGuards:
    """SpecService returns empty data or raises when index.is_ready is False."""

    def _make_service(self, tmp_path: Path, *, is_ready: bool) -> SpecService:
        """Build a SpecService with a mock index at the given readiness state."""
        from app.core.config import AppConfig

        config = AppConfig(
            project_root=tmp_path,
            bonsai_dir=tmp_path / ".bonsai",
            plugin_dir=tmp_path / ".bonsai" / "plugins",
        )
        mock_index = AsyncMock(spec=SpecIndex)
        type(mock_index).is_ready = PropertyMock(return_value=is_ready)
        return SpecService(config, index=mock_index)

    async def test_list_specs_returns_empty_when_not_ready(self, tmp_path: Path) -> None:
        service = self._make_service(tmp_path, is_ready=False)
        result = await service.list_specs()
        assert result == []

    async def test_get_graph_returns_empty_when_not_ready(self, tmp_path: Path) -> None:
        service = self._make_service(tmp_path, is_ready=False)
        graph = await service.get_graph()
        assert graph.nodes == []
        assert graph.edges == []
        assert graph.documents == []

    async def test_create_spec_raises_when_not_ready(self, tmp_path: Path) -> None:
        service = self._make_service(tmp_path, is_ready=False)
        with pytest.raises(IndexNotReadyError):
            await service.create_spec(type="task-spec", path="test.md")

    async def test_update_spec_raises_when_not_ready(self, tmp_path: Path) -> None:
        service = self._make_service(tmp_path, is_ready=False)
        with pytest.raises(IndexNotReadyError):
            await service.update_spec(id="test-spec", content="# Updated")

    async def test_delete_spec_raises_when_not_ready(self, tmp_path: Path) -> None:
        service = self._make_service(tmp_path, is_ready=False)
        with pytest.raises(IndexNotReadyError):
            await service.delete_spec(id="test-spec")

    async def test_list_specs_works_when_ready(self, tmp_path: Path) -> None:
        service = self._make_service(tmp_path, is_ready=True)
        service._index.list_specs.return_value = []
        result = await service.list_specs()
        assert result == []

    async def test_get_graph_works_when_ready(self, tmp_path: Path) -> None:
        service = self._make_service(tmp_path, is_ready=True)
        service._index.get_all_specs.return_value = []
        service._index.get_all_links.return_value = []
        service._index.get_all_documents.return_value = []
        graph = await service.get_graph()
        assert graph.nodes == []


# ── TestBonsaihideFiltering ─────────────────────────────────────────────────


class TestBonsaihideFiltering:
    """Tests for .bonsaihide filtering in reindex_file(), rebuild(), and initialize()."""

    async def test_reindex_file_skips_bonsaihide_match(self, tmp_path: Path) -> None:
        """reindex_file() returns 'removed' for paths matching _bonsaihide_spec."""
        _write_spec_file(tmp_path, "hidden/secret.md", """\
            ---
            id: secret-spec
            type: task-spec
            ---
            # Secret
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            idx._bonsaihide_spec = _make_pathspec(["hidden/"])
            result = await idx.reindex_file(tmp_path, tmp_path / "hidden" / "secret.md")
            assert result == "removed"

            # Verify nothing was indexed
            assert await idx.get_spec("secret-spec") is None

    async def test_reindex_file_cleans_previously_indexed_hidden(self, tmp_path: Path) -> None:
        """A file already in the index is removed when it becomes hidden."""
        _write_spec_file(tmp_path, "docs/spec.md", """\
            ---
            id: docs-spec
            type: task-spec
            ---
            # Docs Spec
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            # First: index the file normally (no bonsaihide)
            result = await idx.reindex_file(tmp_path, tmp_path / "docs" / "spec.md")
            assert result == "spec"
            assert await idx.get_spec("docs-spec") is not None

            # Now set bonsaihide to hide docs/ and re-index
            idx._bonsaihide_spec = _make_pathspec(["docs/"])
            result = await idx.reindex_file(tmp_path, tmp_path / "docs" / "spec.md")
            assert result == "removed"
            assert await idx.get_spec("docs-spec") is None

    async def test_reindex_file_cleans_previously_indexed_document(self, tmp_path: Path) -> None:
        """An unmanaged document already in the index is removed when hidden."""
        _write_spec_file(tmp_path, "notes/readme.md", "# Notes Readme")

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            # Index as unmanaged document
            result = await idx.reindex_file(tmp_path, tmp_path / "notes" / "readme.md")
            assert result == "document"
            docs = await idx.get_all_documents()
            assert any(d.path == "notes/readme.md" for d in docs)

            # Hide and re-index
            idx._bonsaihide_spec = _make_pathspec(["notes/"])
            result = await idx.reindex_file(tmp_path, tmp_path / "notes" / "readme.md")
            assert result == "removed"
            docs = await idx.get_all_documents()
            assert not any(d.path == "notes/readme.md" for d in docs)

    async def test_reindex_file_normal_when_no_match(self, tmp_path: Path) -> None:
        """Non-hidden files are processed normally when bonsaihide is set."""
        _write_spec_file(tmp_path, "visible.md", """\
            ---
            id: visible-spec
            type: task-spec
            ---
            # Visible
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            idx._bonsaihide_spec = _make_pathspec(["hidden/"])
            result = await idx.reindex_file(tmp_path, tmp_path / "visible.md")
            assert result == "spec"
            assert await idx.get_spec("visible-spec") is not None

    async def test_rebuild_stores_bonsaihide_spec(self, tmp_path: Path) -> None:
        """rebuild() stores the passed bonsaihide_spec on the index."""
        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            assert idx._bonsaihide_spec is None

            spec = _make_pathspec(["drafts/"])
            await idx.rebuild(tmp_path, bonsaihide_spec=spec)
            assert idx._bonsaihide_spec is spec

    async def test_rebuild_sets_ready_false_during_execution(self, tmp_path: Path) -> None:
        """rebuild() clears _ready_event at the start to prevent concurrent reindex_file()."""
        _write_spec_file(tmp_path, "a.md", "# A")

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            assert idx.is_ready is True  # set by __aenter__

            ready_during_rebuild = None
            original_find = _find_md_files

            def capture_ready(*args, **kwargs):
                nonlocal ready_during_rebuild
                ready_during_rebuild = idx.is_ready
                return original_find(*args, **kwargs)

            with patch("app.spec.index._find_md_files", side_effect=capture_ready):
                await idx.rebuild(tmp_path)

            assert ready_during_rebuild is False

    async def test_initialize_stores_bonsaihide_spec(self, tmp_path: Path) -> None:
        """initialize() stores the bonsaihide_spec before opening the DB."""
        db_path = tmp_path / ".bonsai" / "index.db"
        spec = _make_pathspec(["hidden/"])
        idx = SpecIndex(db_path)
        await idx.initialize(tmp_path, bonsaihide_spec=spec)
        assert idx._bonsaihide_spec is spec
        await idx.close()

    async def test_rebuild_with_updated_patterns_excludes_new_hidden(self, tmp_path: Path) -> None:
        """Files become hidden when rebuild() is called with new patterns."""
        _write_spec_file(tmp_path, "keep.md", """\
            ---
            id: keep
            type: task-spec
            ---
            # Keep
        """)
        _write_spec_file(tmp_path, "drafts/wip.md", """\
            ---
            id: wip
            type: task-spec
            ---
            # WIP
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            # First rebuild: no filtering — both indexed
            await idx.rebuild(tmp_path)
            assert await idx.get_spec("keep") is not None
            assert await idx.get_spec("wip") is not None

            # Second rebuild: hide drafts/
            await idx.rebuild(tmp_path, bonsaihide_spec=_make_pathspec(["drafts/"]))
            assert await idx.get_spec("keep") is not None
            assert await idx.get_spec("wip") is None

    async def test_rebuild_with_updated_patterns_includes_new_visible(self, tmp_path: Path) -> None:
        """Files reappear when rebuild() is called with relaxed patterns."""
        _write_spec_file(tmp_path, "a.md", """\
            ---
            id: spec-a
            type: task-spec
            ---
            # A
        """)
        _write_spec_file(tmp_path, "b.md", """\
            ---
            id: spec-b
            type: task-spec
            ---
            # B
        """)

        db_path = tmp_path / ".bonsai" / "index.db"
        async with SpecIndex(db_path) as idx:
            # First rebuild: hide b.md
            await idx.rebuild(tmp_path, bonsaihide_spec=_make_pathspec(["b.md"]))
            assert await idx.get_spec("spec-a") is not None
            assert await idx.get_spec("spec-b") is None

            # Second rebuild: no filtering — b.md reappears
            await idx.rebuild(tmp_path)
            assert await idx.get_spec("spec-a") is not None
            assert await idx.get_spec("spec-b") is not None
