from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from app.core.config import AppConfig
from app.core.fileio import delete_file, ensure_dir, read_text, write_text
from app.spec.graph import build_graph
from app.spec.models import (
    Link,
    RegistryEntry,
    Spec,
    SpecDetail,
    SpecGraph,
    SpecSummary,
)
from app.spec.parser import parse_spec
from app.spec.registry import (
    add_entry,
    find_entry,
    read_registry,
    remove_entry,
    write_registry,
)
from app.spec.validator import RECOGNIZED_TYPES, validate_spec


class SpecNotFoundError(Exception):
    """Raised when a spec ID does not exist in the registry."""


class SpecService:
    """Facade — single entry point for all spec operations."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config

    @property
    def _registry_path(self) -> Path:
        return self._config.get_registry_path()

    @property
    def _root(self) -> Path:
        return self._config.get_project_root()

    # -- public methods -------------------------------------------------------

    def list_specs(self) -> list[SpecSummary]:
        entries, _ = read_registry(self._registry_path)
        return [
            SpecSummary(
                id=e.id,
                type=e.type,
                path=e.path,
                status=e.status,
                title=e.title,
                tags=e.tags,
            )
            for e in entries
        ]

    def get_spec(self, id: str) -> SpecDetail:
        entries, links = read_registry(self._registry_path)
        entry = find_entry(entries, id)
        if entry is None:
            raise SpecNotFoundError(f"Spec '{id}' not found")

        file_path = self._root / entry.path
        spec = parse_spec(file_path)

        related = [l for l in links if l.from_id == id or l.to_id == id]
        return SpecDetail(
            id=entry.id,
            type=entry.type,
            path=entry.path,
            status=entry.status,
            title=entry.title,
            tags=entry.tags,
            content=spec.content,
            links=related,
        )

    def create_spec(
        self, type: str, path: str, content: str | None = None, id: str | None = None
    ) -> SpecDetail:
        if type not in RECOGNIZED_TYPES:
            raise ValueError(f"Invalid spec type: '{type}'")

        entries, links = read_registry(self._registry_path)

        # Check for path conflicts
        if any(e.path == path for e in entries):
            raise ValueError(f"Path conflict: '{path}' already exists in registry")

        file_path = self._root / path
        file_content = content or ""

        title = _extract_title(file_content, path)
        spec_id = id if id is not None else _generate_id(title)

        # Avoid ID collision
        if find_entry(entries, spec_id) is not None:
            raise ValueError(f"Generated ID '{spec_id}' already exists")

        today = date.today().isoformat()
        entry = RegistryEntry(
            id=spec_id,
            type=type,
            path=path,
            title=title,
            status="draft",
            created=today,
            updated=today,
        )

        ensure_dir(file_path.parent)
        write_text(file_path, file_content)
        entries = add_entry(entries, entry)
        write_registry(self._registry_path, entries, links)

        return SpecDetail(
            id=entry.id,
            type=entry.type,
            path=entry.path,
            status=entry.status,
            title=entry.title,
            tags=entry.tags,
            content=file_content,
            links=[],
        )

    def update_spec(self, id: str, content: str) -> SpecDetail:
        entries, links = read_registry(self._registry_path)
        entry = find_entry(entries, id)
        if entry is None:
            raise SpecNotFoundError(f"Spec '{id}' not found")

        spec = Spec(type=entry.type, content=content)
        errors = validate_spec(spec, entry)
        if errors:
            raise ValueError(f"Validation failed: {'; '.join(errors)}")

        file_path = self._root / entry.path
        write_text(file_path, content)

        # Update the timestamp
        entry.updated = date.today().isoformat()
        write_registry(self._registry_path, entries, links)

        related = [l for l in links if l.from_id == id or l.to_id == id]
        return SpecDetail(
            id=entry.id,
            type=entry.type,
            path=entry.path,
            status=entry.status,
            title=entry.title,
            tags=entry.tags,
            content=content,
            links=related,
        )

    def delete_spec(self, id: str) -> None:
        entries, links = read_registry(self._registry_path)
        entry = find_entry(entries, id)
        if entry is None:
            raise SpecNotFoundError(f"Spec '{id}' not found")

        file_path = self._root / entry.path
        delete_file(file_path)
        entries = remove_entry(entries, id)
        # Remove links referencing this spec
        links = [l for l in links if l.from_id != id and l.to_id != id]
        write_registry(self._registry_path, entries, links)

    def get_graph(self) -> SpecGraph:
        entries, links = read_registry(self._registry_path)
        return build_graph(entries, links)


# -- helpers ------------------------------------------------------------------


def _extract_title(content: str, path: str) -> str:
    """Extract title from first Markdown heading, or derive from path."""
    if content:
        match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if match:
            return match.group(1).strip()
    return Path(path).stem.replace("_", " ").replace("-", " ").title()


def _generate_id(title: str) -> str:
    """Generate a slug ID from a title."""
    slug = title.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug
