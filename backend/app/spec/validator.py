"""Spec validation — structural and link integrity checks.

Validates spec entries and link graphs using ``SpecEntry`` (from the
SQLite index) rather than the removed ``RegistryEntry`` model.
"""

from __future__ import annotations

from app.spec.models import (
    Link,
    RECOGNIZED_LINK_TYPES,
    RECOGNIZED_TYPES,
    Spec,
    SpecEntry,
)


def validate_spec(spec: Spec, entry: SpecEntry) -> list[str]:
    """Validate a single spec's structure and fields.

    Returns a list of error messages (empty means valid).
    """
    errors: list[str] = []

    if not entry.id:
        errors.append("Spec entry missing 'id'")
    if not entry.type:
        errors.append("Spec entry missing 'type'")
    elif entry.type not in RECOGNIZED_TYPES:
        errors.append(f"Unrecognized spec type: {entry.type}")
    if not entry.path:
        errors.append("Spec entry missing 'path'")
    if not entry.title:
        errors.append("Spec entry missing 'title'")
    if not spec.content:
        errors.append("Spec content is empty")

    return errors


def validate_links(links: list[Link], entries: list[SpecEntry]) -> list[str]:
    """Validate link integrity across the spec graph.

    Returns a list of error messages (empty means valid).
    """
    errors: list[str] = []
    entry_ids = {e.id for e in entries}

    for link in links:
        if link.from_id == link.to_id:
            errors.append(f"Self-link detected: {link.from_id}")
        if link.from_id not in entry_ids:
            errors.append(f"Link source '{link.from_id}' not found in specs")
        if link.to_id not in entry_ids:
            errors.append(f"Link target '{link.to_id}' not found in specs")
        if link.type not in RECOGNIZED_LINK_TYPES:
            errors.append(f"Unrecognized link type: {link.type}")

    return errors
