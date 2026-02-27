from __future__ import annotations

from app.spec.models import Link, RegistryEntry, SpecGraph


def build_graph(entries: list[RegistryEntry], links: list[Link]) -> SpecGraph:
    """Construct a :class:`SpecGraph` from entries and links."""
    return SpecGraph(nodes=list(entries), edges=list(links))


def get_children(graph: SpecGraph, parent_id: str) -> list[RegistryEntry]:
    """Return direct children of a node (entries linked via ``parent`` type)."""
    child_ids = {
        link.from_id for link in graph.edges
        if link.type == "parent" and link.to_id == parent_id
    }
    return [n for n in graph.nodes if n.id in child_ids]


def get_dependencies(graph: SpecGraph, id: str) -> list[RegistryEntry]:
    """Return specs that *id* depends on."""
    dep_ids = {
        link.to_id for link in graph.edges
        if link.type == "depends-on" and link.from_id == id
    }
    return [n for n in graph.nodes if n.id in dep_ids]


def get_dependents(graph: SpecGraph, id: str) -> list[RegistryEntry]:
    """Return specs that depend on *id*."""
    dep_ids = {
        link.from_id for link in graph.edges
        if link.type == "depends-on" and link.to_id == id
    }
    return [n for n in graph.nodes if n.id in dep_ids]
