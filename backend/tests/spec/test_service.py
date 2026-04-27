"""Tests for SpecService — facade for spec operations.

All tests use the async index backend with a real ``SpecIndex``
to verify the frontmatter + SQLite path.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import load_config
from app.spec.frontmatter import serialize_frontmatter
from app.spec.index import SpecIndex
from app.spec.service import SpecNotFoundError, SpecService, _extract_title, _generate_id
from app.trash.service import TrashService


class TestHelpers:
    def test_extract_title_from_heading(self) -> None:
        assert _extract_title("# My Great Spec\n\nContent", "fallback.md") == "My Great Spec"

    def test_extract_title_from_path(self) -> None:
        assert _extract_title("", "some_feature.md") == "Some Feature"

    def test_generate_id(self) -> None:
        assert _generate_id("My Great Spec") == "my-great-spec"

    def test_generate_id_special_chars(self) -> None:
        assert _generate_id("Hello, World! (v2)") == "hello-world-v2"


# ── Index backend (async) ────────────────────────────────────────────────────


async def _setup_index_project(tmp_path: Path) -> tuple[SpecService, SpecIndex]:
    """Create a project with an index-backed SpecService and a seeded spec."""
    config = load_config(tmp_path)
    db_path = tmp_path / ".bonsai" / "index.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Create a seeded spec on disk before initializing the index
    (tmp_path / "mod_a").mkdir(exist_ok=True)
    content = serialize_frontmatter(
        {"id": "mod-a", "type": "module-design", "status": "active", "title": "Module A"},
        "# Module A\n\nContent here.\n",
    )
    (tmp_path / "mod_a" / "README.md").write_text(content, encoding="utf-8")

    index = SpecIndex(db_path)
    await index.initialize(tmp_path)

    svc = SpecService(config, index=index)
    return svc, index


class TestIndexBackendList:
    async def test_list_specs_returns_summaries(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            specs = await svc.list_specs()
            assert len(specs) >= 1
            assert any(s.id == "mod-a" for s in specs)
        finally:
            await index.close()

    async def test_list_specs_filters_by_type(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            specs = await svc.list_specs(type="module-design")
            assert all(s.type == "module-design" for s in specs)
            empty = await svc.list_specs(type="task-spec")
            mod_a_ids = {s.id for s in empty}
            assert "mod-a" not in mod_a_ids
        finally:
            await index.close()

    async def test_list_specs_filters_by_status(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            active = await svc.list_specs(status="active")
            assert any(s.id == "mod-a" for s in active)
            drafts = await svc.list_specs(status="draft")
            assert all(s.id != "mod-a" for s in drafts)
        finally:
            await index.close()


class TestIndexBackendGetSpec:
    async def test_get_spec_returns_detail(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            detail = await svc.get_spec("mod-a")
            assert detail.id == "mod-a"
            assert detail.type == "module-design"
            assert "# Module A" in detail.content
        finally:
            await index.close()

    async def test_get_spec_not_found_raises(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            with pytest.raises(SpecNotFoundError):
                await svc.get_spec("nonexistent")
        finally:
            await index.close()


class TestIndexBackendCreate:
    async def test_create_spec_writes_frontmatter(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            detail = await svc.create_spec("task-spec", "tasks/fix.md", "# Fix Bug\n\nDetails.")
            assert detail.id == "fix-bug"
            assert detail.status == "draft"

            # File on disk should have frontmatter
            on_disk = (tmp_path / "tasks" / "fix.md").read_text(encoding="utf-8")
            assert on_disk.startswith("---\n")
            assert "id: fix-bug" in on_disk
            assert "type: task-spec" in on_disk

            # Should be in index
            entry = await index.get_spec("fix-bug")
            assert entry is not None
        finally:
            await index.close()


class TestIndexBackendUpdate:
    async def test_update_preserves_frontmatter(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            detail = await svc.update_spec("mod-a", "# Module A\n\nUpdated content.\n")
            assert "Updated content" in detail.content

            # Frontmatter should be preserved on disk
            on_disk = (tmp_path / "mod_a" / "README.md").read_text(encoding="utf-8")
            assert "id: mod-a" in on_disk
            assert "Updated content" in on_disk
        finally:
            await index.close()


class TestIndexBackendDelete:
    async def test_delete_removes_from_index(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            await svc.delete_spec("mod-a")
            assert not (tmp_path / "mod_a" / "README.md").exists()
            assert await index.get_spec("mod-a") is None
        finally:
            await index.close()


class TestIndexBackendGraph:
    async def test_get_graph_returns_entries_and_links(self, tmp_path: Path) -> None:
        svc, index = await _setup_index_project(tmp_path)
        try:
            graph = await svc.get_graph()
            assert len(graph.nodes) >= 1
            assert any(n.id == "mod-a" for n in graph.nodes)
        finally:
            await index.close()


class TestGetGraphWithDocuments:
    """Tests for get_graph() including unmanaged documents."""

    async def test_graph_includes_documents(self, tmp_path: Path) -> None:
        """get_graph() returns unmanaged docs alongside specs."""
        svc, index = await _setup_index_project(tmp_path)
        try:
            # Add an unmanaged document
            notes_path = tmp_path / "notes.md"
            notes_path.write_text("# Project Notes\n\nSome notes.\n", encoding="utf-8")
            await index.rebuild(tmp_path)

            graph = await svc.get_graph()
            assert len(graph.documents) >= 1
            doc_paths = [d.path for d in graph.documents]
            assert "notes.md" in doc_paths
        finally:
            await index.close()

    async def test_graph_documents_empty_by_default(self, tmp_path: Path) -> None:
        """When no unmanaged docs exist, graph.documents is empty."""
        svc, index = await _setup_index_project(tmp_path)
        try:
            graph = await svc.get_graph()
            assert graph.documents == []
        finally:
            await index.close()
