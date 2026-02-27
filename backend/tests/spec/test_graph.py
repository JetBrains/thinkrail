from __future__ import annotations

from app.spec.models import Link, RegistryEntry, SpecGraph
from app.spec.graph import build_graph, get_children, get_dependencies, get_dependents


def _entry(id: str) -> RegistryEntry:
    return RegistryEntry(id=id, type="module-design", path=f"{id}/README.md", title=id.upper())


def _link(from_id: str, to_id: str, type: str = "depends-on") -> Link:
    return Link(from_id=from_id, to_id=to_id, type=type)


class TestBuildGraph:
    def test_empty(self) -> None:
        g = build_graph([], [])
        assert g.nodes == []
        assert g.edges == []

    def test_with_data(self) -> None:
        entries = [_entry("a"), _entry("b")]
        links = [_link("a", "b")]
        g = build_graph(entries, links)
        assert len(g.nodes) == 2
        assert len(g.edges) == 1


class TestGetChildren:
    def test_returns_children(self) -> None:
        entries = [_entry("parent"), _entry("child1"), _entry("child2")]
        links = [
            _link("child1", "parent", "parent"),
            _link("child2", "parent", "parent"),
        ]
        g = build_graph(entries, links)
        children = get_children(g, "parent")
        ids = {c.id for c in children}
        assert ids == {"child1", "child2"}

    def test_no_children(self) -> None:
        g = build_graph([_entry("a")], [])
        assert get_children(g, "a") == []


class TestGetDependencies:
    def test_returns_deps(self) -> None:
        entries = [_entry("a"), _entry("b"), _entry("c")]
        links = [_link("a", "b"), _link("a", "c")]
        g = build_graph(entries, links)
        deps = get_dependencies(g, "a")
        ids = {d.id for d in deps}
        assert ids == {"b", "c"}

    def test_no_deps(self) -> None:
        g = build_graph([_entry("a")], [])
        assert get_dependencies(g, "a") == []


class TestGetDependents:
    def test_returns_dependents(self) -> None:
        entries = [_entry("a"), _entry("b"), _entry("c")]
        links = [_link("b", "a"), _link("c", "a")]
        g = build_graph(entries, links)
        deps = get_dependents(g, "a")
        ids = {d.id for d in deps}
        assert ids == {"b", "c"}

    def test_no_dependents(self) -> None:
        g = build_graph([_entry("a")], [])
        assert get_dependents(g, "a") == []
