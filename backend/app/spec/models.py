from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Spec(BaseModel):
    """A parsed spec file from disk."""

    type: str
    content: str
    metadata: dict[str, Any] | None = None


class RegistryEntry(BaseModel):
    """A single entry in ``.specs/registry.json``."""

    id: str
    type: str
    path: str = ""
    title: str = ""
    status: str = "draft"
    covers: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    created: str = ""
    updated: str = ""


class Link(BaseModel):
    """A relationship between two specs.

    Uses aliases so that JSON serialization produces ``from`` / ``to``
    instead of ``from_id`` / ``to_id`` (``from`` is a Python keyword).
    """

    from_id: str = Field(alias="from")
    to_id: str = Field(alias="to")
    type: str

    model_config = {"populate_by_name": True}


class SpecSummary(BaseModel):
    """Lightweight listing model returned by ``list_specs``."""

    id: str
    type: str
    path: str
    status: str
    title: str
    tags: list[str] = Field(default_factory=list)
    covers: list[str] = Field(default_factory=list)
    created: str = ""
    updated: str = ""


class SpecDetail(BaseModel):
    """Full spec with content returned by ``get_spec``."""

    id: str
    type: str
    path: str
    status: str
    title: str
    tags: list[str] = Field(default_factory=list)
    content: str = ""
    links: list[Link] = Field(default_factory=list)


class SpecGraph(BaseModel):
    """Complete spec hierarchy graph."""

    nodes: list[RegistryEntry] = Field(default_factory=list)
    edges: list[Link] = Field(default_factory=list)
