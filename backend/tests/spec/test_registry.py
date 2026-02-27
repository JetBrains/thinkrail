from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.spec.models import Link, RegistryEntry
from app.spec.registry import (
    add_entry,
    find_entry,
    read_registry,
    remove_entry,
    write_registry,
)


def _entry(**overrides) -> RegistryEntry:
    defaults = dict(id="e1", type="module-design", path="a/README.md", title="Test")
    return RegistryEntry(**(defaults | overrides))


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


class TestReadRegistry:
    def test_reads_entries_and_links(self, tmp_path: Path) -> None:
        reg = tmp_path / "registry.json"
        _write_json(reg, {
            "version": "2.0",
            "project": "test",
            "specs": [{"id": "a", "type": "module-design", "path": "a", "title": "A"}],
            "links": [{"from": "a", "to": "b", "type": "parent"}],
        })
        entries, links = read_registry(reg)
        assert len(entries) == 1
        assert entries[0].id == "a"
        assert len(links) == 1
        assert links[0].from_id == "a"

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            read_registry(tmp_path / "nope.json")

    def test_malformed_json_raises(self, tmp_path: Path) -> None:
        reg = tmp_path / "registry.json"
        reg.write_text("{bad", encoding="utf-8")
        with pytest.raises(ValueError, match="Malformed"):
            read_registry(reg)

    def test_missing_specs_key_raises(self, tmp_path: Path) -> None:
        reg = tmp_path / "registry.json"
        _write_json(reg, {"version": "2.0"})
        with pytest.raises(ValueError, match="missing 'specs'"):
            read_registry(reg)


class TestWriteRegistry:
    def test_round_trip(self, tmp_path: Path) -> None:
        reg = tmp_path / "registry.json"
        entry = _entry()
        link = Link(from_id="e1", to_id="e2", type="depends-on")
        write_registry(reg, [entry], [link])

        entries, links = read_registry(reg)
        assert len(entries) == 1
        assert entries[0].id == "e1"
        assert len(links) == 1
        assert links[0].from_id == "e1"

    def test_atomic_write_preserves_on_success(self, tmp_path: Path) -> None:
        reg = tmp_path / "registry.json"
        write_registry(reg, [], [])
        data = json.loads(reg.read_text(encoding="utf-8"))
        assert data["version"] == "2.0"
        assert data["project"] == "bonsai"


class TestFindEntry:
    def test_found(self) -> None:
        entries = [_entry(id="a"), _entry(id="b")]
        assert find_entry(entries, "b") is not None
        assert find_entry(entries, "b").id == "b"

    def test_not_found(self) -> None:
        assert find_entry([_entry()], "nope") is None


class TestAddEntry:
    def test_adds(self) -> None:
        result = add_entry([], _entry(id="new"))
        assert len(result) == 1

    def test_duplicate_raises(self) -> None:
        entries = [_entry(id="x")]
        with pytest.raises(ValueError, match="already exists"):
            add_entry(entries, _entry(id="x"))


class TestRemoveEntry:
    def test_removes(self) -> None:
        entries = [_entry(id="a"), _entry(id="b")]
        result = remove_entry(entries, "a")
        assert len(result) == 1
        assert result[0].id == "b"

    def test_not_found_raises(self) -> None:
        with pytest.raises(ValueError, match="not found"):
            remove_entry([_entry()], "nope")
