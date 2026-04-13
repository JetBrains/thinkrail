from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from app.core.project import ensure_meta_file
from app.spec.models import Link, RegistryEntry


def read_registry(path: Path) -> tuple[list[RegistryEntry], list[Link]]:
    """Read and parse ``registry.json``.

    Returns (entries, links).
    Creates the file with empty defaults if it does not exist.
    Raises ``ValueError`` if the JSON is malformed or missing required keys.
    """
    content = ensure_meta_file(path.parent, "registry.json")
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed registry JSON: {exc}") from exc

    if "specs" not in data:
        raise ValueError("Registry missing 'specs' key")

    entries = [RegistryEntry(**item) for item in data["specs"]]
    links = [Link(**item) for item in data.get("links", [])]
    return entries, links


def write_registry(
    path: Path,
    entries: list[RegistryEntry],
    links: list[Link],
    *,
    version: str = "2.0",
    project: str = "bonsai",
) -> None:
    """Write ``registry.json`` atomically (write temp → rename).

    Preserves ``version`` and ``project`` fields.
    """
    data = {
        "version": version,
        "project": project,
        "specs": [e.model_dump() for e in entries],
        "links": [l.model_dump(by_alias=True) for l in links],
    }
    content = json.dumps(data, indent=2) + "\n"

    # Atomic write: write to a temp file in the same directory, then rename.
    dir_ = path.parent
    dir_.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    os.close(fd)
    tmp_path = Path(tmp)
    try:
        tmp_path.write_text(content, encoding="utf-8")
        tmp_path.replace(path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise


def find_entry(entries: list[RegistryEntry], id: str) -> RegistryEntry | None:
    """Lookup a single entry by ID. Returns ``None`` if not found."""
    for entry in entries:
        if entry.id == id:
            return entry
    return None


def add_entry(entries: list[RegistryEntry], entry: RegistryEntry) -> list[RegistryEntry]:
    """Add an entry. Raises ``ValueError`` if the ID already exists."""
    if find_entry(entries, entry.id) is not None:
        raise ValueError(f"Entry with id '{entry.id}' already exists")
    return [*entries, entry]


def remove_entry(entries: list[RegistryEntry], id: str) -> list[RegistryEntry]:
    """Remove an entry by ID. Raises ``ValueError`` if not found."""
    result = [e for e in entries if e.id != id]
    if len(result) == len(entries):
        raise ValueError(f"Entry with id '{id}' not found")
    return result
