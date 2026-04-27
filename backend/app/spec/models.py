"""Pydantic models for the spec module — domain objects, index entries, and API payloads.

``Frontmatter`` is the **single source of truth** for the YAML frontmatter
schema.  All validation, link extraction, and key-ordering logic lives on the
model.  Other modules should derive constants (e.g. ``RECOGNIZED_TYPES``) from
the model's ``Literal`` annotations rather than maintaining separate sets.
"""

from __future__ import annotations

from typing import Any, Literal, get_args

from pydantic import BaseModel, Field, ValidationError, field_validator  # noqa: F401 – re-exported


class Spec(BaseModel):
    """A parsed spec file from disk."""

    type: str
    content: str
    metadata: dict[str, Any] | None = None



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


class SpecEntry(BaseModel):
    """A row in the SQLite ``specs`` table (derived from frontmatter).

    A row in the SQLite ``specs`` table (derived from frontmatter).  Adds
    ``extras`` (custom frontmatter fields), ``content_hash`` (for
    incremental re-indexing), and ``indexed_at`` (timestamp).
    """

    id: str
    type: str
    path: str
    title: str
    status: str = "draft"
    covers: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    extras: dict[str, Any] = Field(default_factory=dict)
    content_hash: str = ""
    indexed_at: str = ""


# ── Frontmatter model (single source of truth) ──────────────────────────────

# Type and status literals — the canonical set of recognised values.
SpecType = Literal[
    "goal-and-requirements",
    "architecture-design",
    "module-design",
    "submodule-design",
    "task-spec",
]

SpecStatus = Literal["draft", "active", "stale", "done", "deprecated"]

# Canonical key ordering for YAML serialization.
_FRONTMATTER_KEY_ORDER: list[str] = [
    "id",
    "type",
    "status",
    "title",
    "parent",
    "depends-on",
    "references",
    "implements",
    "covers",
    "tags",
]

# Fields that carry outgoing links to other specs.
_FRONTMATTER_LINK_FIELDS: dict[str, str] = {
    "parent": "parent",
    "depends-on": "depends-on",
    "references": "references",
    "implements": "implements",
}


class Frontmatter(BaseModel):
    """Validated YAML frontmatter — single source of truth for the schema.

    Construct with ``Frontmatter(**meta_dict)`` to validate.  On invalid
    input a ``pydantic.ValidationError`` is raised.

    Design notes:
    - ``extra = "allow"`` lets custom fields (e.g. ``priority: high``) pass
      through without error.
    - ``populate_by_name = True`` accepts both ``depends_on=`` (Python) and
      ``depends-on=`` (YAML alias).
    - ``Literal`` type annotations replace the old ``RECOGNIZED_TYPES`` /
      ``RECOGNIZED_STATUSES`` frozensets.
    """

    model_config = {"extra": "allow", "populate_by_name": True}

    id: str
    type: SpecType
    status: SpecStatus = "draft"

    @field_validator("id")
    @classmethod
    def _id_must_be_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("id must be a non-empty string")
        return v
    title: str = ""
    parent: str | None = None
    depends_on: list[str] = Field(default_factory=list, alias="depends-on")
    references: list[str] = Field(default_factory=list)
    implements: list[str] = Field(default_factory=list)
    covers: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)

    # ── Methods ───────────────────────────────────────────────────────

    def extract_links(self) -> list[tuple[str, str]]:
        """Return ``(link_type, target_id)`` tuples from link fields."""
        links: list[tuple[str, str]] = []
        if self.parent:
            links.append(("parent", self.parent))
        for dep in self.depends_on:
            if dep:
                links.append(("depends-on", dep))
        for ref in self.references:
            if ref:
                links.append(("references", ref))
        for impl in self.implements:
            if impl:
                links.append(("implements", impl))
        return links

    def to_ordered_dict(self) -> dict[str, Any]:
        """Serialize to dict with canonical key order for YAML output.

        Standard fields appear first (in ``_FRONTMATTER_KEY_ORDER``),
        followed by any extra (custom) fields in their original order.
        """
        # Build a raw dict using aliases (hyphenated keys) for YAML compat.
        raw: dict[str, Any] = {}
        raw["id"] = self.id
        raw["type"] = self.type
        if self.status != "draft":
            raw["status"] = self.status
        if self.title:
            raw["title"] = self.title
        if self.parent is not None:
            raw["parent"] = self.parent
        if self.depends_on:
            raw["depends-on"] = self.depends_on
        if self.references:
            raw["references"] = self.references
        if self.implements:
            raw["implements"] = self.implements
        if self.covers:
            raw["covers"] = self.covers
        if self.tags:
            raw["tags"] = self.tags

        # Append extra (custom) fields in their original order.
        if self.model_extra:
            for key, value in self.model_extra.items():
                raw[key] = value

        # Re-sort into canonical order.
        ordered: dict[str, Any] = {}
        for key in _FRONTMATTER_KEY_ORDER:
            if key in raw:
                ordered[key] = raw[key]
        for key in raw:
            if key not in ordered:
                ordered[key] = raw[key]
        return ordered

    def to_spec_entry(self, path: str, content_hash: str, indexed_at: str) -> SpecEntry:
        """Convert to a :class:`SpecEntry` for SQLite indexing."""
        # Collect extra fields (anything not in the known schema).
        known_keys = {
            "id", "type", "status", "title", "parent",
            "depends-on", "depends_on", "references", "implements",
            "covers", "tags",
        }
        extras = {
            k: v for k, v in (self.model_extra or {}).items()
            if k not in known_keys
        }
        return SpecEntry(
            id=self.id,
            type=self.type,
            path=path,
            title=self.title,
            status=self.status,
            covers=self.covers,
            tags=self.tags,
            extras=extras,
            content_hash=content_hash,
            indexed_at=indexed_at,
        )


# ── Derived constants (backward compatibility) ──────────────────────────────

RECOGNIZED_TYPES: frozenset[str] = frozenset(
    get_args(Frontmatter.model_fields["type"].annotation)
)
RECOGNIZED_STATUSES: frozenset[str] = frozenset(
    get_args(Frontmatter.model_fields["status"].annotation)
)
RECOGNIZED_LINK_TYPES: frozenset[str] = frozenset(_FRONTMATTER_LINK_FIELDS.values())


class DocumentEntry(BaseModel):
    """A row in the SQLite documents table — an unmanaged .md file."""

    path: str  # relative to project root
    title: str  # from first # heading or filename


class SpecGraph(BaseModel):
    """Complete spec hierarchy graph."""

    nodes: list[SpecEntry] = Field(default_factory=list)
    edges: list[Link] = Field(default_factory=list)
    documents: list[DocumentEntry] = Field(default_factory=list)
