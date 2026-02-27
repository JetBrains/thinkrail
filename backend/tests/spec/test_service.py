from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.config import load_config
from app.spec.service import SpecNotFoundError, SpecService, _extract_title, _generate_id


def _setup_project(tmp_path: Path) -> SpecService:
    """Create a minimal project with a registry and return a SpecService."""
    specs_dir = tmp_path / ".specs"
    specs_dir.mkdir()
    registry = {
        "version": "2.0",
        "project": "test",
        "specs": [
            {
                "id": "mod-a",
                "type": "module-design",
                "path": "mod_a/README.md",
                "title": "Module A",
                "status": "active",
                "covers": [],
                "tags": [],
                "created": "2026-01-01",
                "updated": "2026-01-01",
            }
        ],
        "links": [
            {"from": "mod-a", "to": "design-doc", "type": "parent"}
        ],
    }
    (specs_dir / "registry.json").write_text(json.dumps(registry), encoding="utf-8")

    # Create the spec file on disk
    (tmp_path / "mod_a").mkdir()
    (tmp_path / "mod_a" / "README.md").write_text("# Module A\n\nContent here.", encoding="utf-8")

    config = load_config(tmp_path)
    return SpecService(config)


class TestListSpecs:
    def test_returns_summaries(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        specs = svc.list_specs()
        assert len(specs) == 1
        assert specs[0].id == "mod-a"
        assert specs[0].title == "Module A"

    def test_empty_registry(self, tmp_path: Path) -> None:
        specs_dir = tmp_path / ".specs"
        specs_dir.mkdir()
        reg = {"version": "2.0", "project": "test", "specs": [], "links": []}
        (specs_dir / "registry.json").write_text(json.dumps(reg), encoding="utf-8")
        svc = SpecService(load_config(tmp_path))
        assert svc.list_specs() == []


class TestGetSpec:
    def test_returns_detail(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        detail = svc.get_spec("mod-a")
        assert detail.id == "mod-a"
        assert "# Module A" in detail.content
        assert len(detail.links) == 1

    def test_not_found_raises(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        with pytest.raises(SpecNotFoundError):
            svc.get_spec("nonexistent")


class TestCreateSpec:
    def test_creates_file_and_entry(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        detail = svc.create_spec("task-spec", "tasks/new_task.md", "# New Task\n\nDo things.")
        assert detail.id == "new-task"
        assert detail.title == "New Task"
        assert detail.status == "draft"
        assert (tmp_path / "tasks" / "new_task.md").exists()

        # Should now appear in list
        specs = svc.list_specs()
        ids = {s.id for s in specs}
        assert "new-task" in ids

    def test_path_conflict_raises(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        with pytest.raises(ValueError, match="Path conflict"):
            svc.create_spec("module-design", "mod_a/README.md", "# Conflict")

    def test_title_from_path_when_no_content(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        detail = svc.create_spec("task-spec", "tasks/my_feature.md")
        assert detail.title == "My Feature"

    def test_invalid_type_raises(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        with pytest.raises(ValueError, match="Invalid spec type"):
            svc.create_spec("banana", "tasks/bad.md", "# Bad")


class TestUpdateSpec:
    def test_updates_content(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        detail = svc.update_spec("mod-a", "# Module A\n\nUpdated content.")
        assert "Updated content" in detail.content
        assert detail.id == "mod-a"
        # File on disk should also be updated
        on_disk = (tmp_path / "mod_a" / "README.md").read_text(encoding="utf-8")
        assert "Updated content" in on_disk

    def test_not_found_raises(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        with pytest.raises(SpecNotFoundError):
            svc.update_spec("ghost", "content")

    def test_empty_content_raises_validation(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        with pytest.raises(ValueError, match="Validation failed"):
            svc.update_spec("mod-a", "")


class TestDeleteSpec:
    def test_deletes_file_and_entry(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        svc.delete_spec("mod-a")
        assert not (tmp_path / "mod_a" / "README.md").exists()
        assert svc.list_specs() == []

    def test_not_found_raises(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        with pytest.raises(SpecNotFoundError):
            svc.delete_spec("ghost")


class TestGetGraph:
    def test_returns_graph(self, tmp_path: Path) -> None:
        svc = _setup_project(tmp_path)
        graph = svc.get_graph()
        assert len(graph.nodes) == 1
        assert len(graph.edges) == 1


class TestHelpers:
    def test_extract_title_from_heading(self) -> None:
        assert _extract_title("# My Great Spec\n\nContent", "fallback.md") == "My Great Spec"

    def test_extract_title_from_path(self) -> None:
        assert _extract_title("", "some_feature.md") == "Some Feature"

    def test_generate_id(self) -> None:
        assert _generate_id("My Great Spec") == "my-great-spec"

    def test_generate_id_special_chars(self) -> None:
        assert _generate_id("Hello, World! (v2)") == "hello-world-v2"
