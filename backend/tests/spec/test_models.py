from __future__ import annotations

import pytest

from app.spec.models import (
    Link,
    Spec,
    SpecDetail,
    SpecEntry,
    SpecGraph,
    SpecSummary,
)


class TestSpec:
    def test_markdown_spec(self) -> None:
        s = Spec(type="module-design", content="# Hello", metadata=None)
        assert s.type == "module-design"
        assert s.content == "# Hello"
        assert s.metadata is None

    def test_json_spec(self) -> None:
        meta = {"key": "value"}
        s = Spec(type="task-spec", content='{"key":"value"}', metadata=meta)
        assert s.metadata == meta


class TestSpecEntry:
    def test_required_fields(self) -> None:
        entry = SpecEntry(id="e1", type="module-design", path="a/README.md", title="Test")
        assert entry.id == "e1"
        assert entry.status == "draft"
        assert entry.covers == []
        assert entry.tags == []

    def test_all_fields(self) -> None:
        entry = SpecEntry(
            id="e2",
            type="task-spec",
            path=".bonsai/implementation_tasks/fix.txt",
            title="Fix bug",
            status="active",
            covers=["src/"],
            tags=["critical"],
        )
        assert entry.status == "active"
        assert entry.covers == ["src/"]


class TestLink:
    def test_create_with_aliases(self) -> None:
        link = Link(**{"from": "a", "to": "b", "type": "depends-on"})
        assert link.from_id == "a"
        assert link.to_id == "b"
        assert link.type == "depends-on"

    def test_create_with_field_names(self) -> None:
        link = Link(from_id="a", to_id="b", type="parent")
        assert link.from_id == "a"
        assert link.to_id == "b"

    def test_json_serialization_uses_aliases(self) -> None:
        link = Link(from_id="a", to_id="b", type="implements")
        data = link.model_dump(by_alias=True)
        assert "from" in data
        assert "to" in data
        assert data["from"] == "a"
        assert data["to"] == "b"

    def test_json_serialization_field_names(self) -> None:
        link = Link(from_id="x", to_id="y", type="parent")
        data = link.model_dump()
        assert data["from_id"] == "x"
        assert data["to_id"] == "y"


class TestSpecSummary:
    def test_from_values(self) -> None:
        s = SpecSummary(id="s1", type="module-design", path="a/b", status="active", title="T")
        assert s.id == "s1"
        assert s.tags == []


class TestSpecDetail:
    def test_with_content_and_links(self) -> None:
        link = Link(from_id="s1", to_id="s2", type="depends-on")
        d = SpecDetail(
            id="s1",
            type="module-design",
            path="a/b",
            status="active",
            title="T",
            content="# Content",
            links=[link],
        )
        assert d.content == "# Content"
        assert len(d.links) == 1
        assert d.links[0].from_id == "s1"


class TestSpecGraph:
    def test_empty_graph(self) -> None:
        g = SpecGraph()
        assert g.nodes == []
        assert g.edges == []

    def test_graph_with_data(self) -> None:
        from app.spec.models import SpecEntry
        entry = SpecEntry(id="n1", type="module-design", path="a", title="N1")
        link = Link(from_id="n1", to_id="n2", type="parent")
        g = SpecGraph(nodes=[entry], edges=[link])
        assert len(g.nodes) == 1
        assert len(g.edges) == 1
