"""YAML frontmatter parsing and serialization for spec files.

Provides pure functions to parse YAML frontmatter from Markdown files,
serialize metadata into frontmatter format, and extract structured link
information.  This is the lowest-level building block of the Frontmatter +
SQLite Index architecture — no dependency on SQLite, registry, or service.

Validation and link extraction delegate to the :class:`Frontmatter` Pydantic
model in ``models.py`` — the single source of truth for the frontmatter
schema.

Design reference:
    .bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md §Frontmatter Schema
"""

from __future__ import annotations

import re
from typing import Any

import yaml
from pydantic import ValidationError

from app.spec.models import (
    Frontmatter,
    RECOGNIZED_LINK_TYPES,
    RECOGNIZED_STATUSES,
    RECOGNIZED_TYPES,
    _FRONTMATTER_KEY_ORDER,
    _FRONTMATTER_LINK_FIELDS,
)


# ── Exceptions ───────────────────────────────────────────────────────────────


class FrontmatterError(Exception):
    """Raised when YAML frontmatter is malformed or cannot be parsed."""


# ── Constants (backward-compatible re-exports) ───────────────────────────────

# Re-export from models so existing ``from app.spec.frontmatter import …``
# continues to work.  The canonical definitions live on ``Frontmatter``.
__all__ = [
    "RECOGNIZED_STATUSES",
    "RECOGNIZED_TYPES",
    "RECOGNIZED_LINK_TYPES",
    "FrontmatterError",
    "parse_frontmatter",
    "serialize_frontmatter",
    "update_frontmatter",
    "extract_links",
    "validate_frontmatter",
]

# Link fields that accept lists (as opposed to ``parent`` which is a single string).
# Used to normalise single-string values to lists before passing to the model.
_LIST_LINK_FIELDS = ("depends-on", "references", "implements")

# Regex matching the opening ``---`` delimiter on its own line.
_FM_DELIM = re.compile(r"^---\s*$", re.MULTILINE)


# ── Parsing ──────────────────────────────────────────────────────────────────


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Parse YAML frontmatter from the beginning of *text*.

    Returns ``(frontmatter_dict, body)`` where *body* is the Markdown
    content after the closing ``---`` delimiter.

    If the text has no valid frontmatter (no opening/closing ``---``),
    returns ``({}, text)`` without error.

    Raises :class:`FrontmatterError` if delimiters are found but the
    YAML between them is malformed.
    """
    # Must start with ``---`` (possibly preceded by whitespace-only lines,
    # but most commonly the very first line).
    stripped = text.lstrip("\n")
    if not stripped.startswith("---"):
        return {}, text

    matches = list(_FM_DELIM.finditer(text))
    if len(matches) < 2:
        # Only one ``---`` — no closing delimiter, treat as no frontmatter.
        return {}, text

    open_match = matches[0]
    close_match = matches[1]

    yaml_block = text[open_match.end() : close_match.start()]
    body = text[close_match.end() :]

    # Strip exactly one leading newline from body (the line after closing ---)
    if body.startswith("\n"):
        body = body[1:]

    try:
        parsed = yaml.safe_load(yaml_block)
    except yaml.YAMLError as exc:
        raise FrontmatterError(f"Malformed YAML frontmatter: {exc}") from exc

    if parsed is None:
        # Empty YAML block between delimiters.
        return {}, body

    if not isinstance(parsed, dict):
        raise FrontmatterError(
            f"Frontmatter must be a YAML mapping, got {type(parsed).__name__}"
        )

    return parsed, body


# ── Serialization ────────────────────────────────────────────────────────────


def _sort_meta_keys(meta: dict[str, Any]) -> dict[str, Any]:
    """Return *meta* with keys in canonical order.

    Standard keys appear first (in ``_FRONTMATTER_KEY_ORDER``), followed by
    any custom keys in their original insertion order.
    """
    ordered: dict[str, Any] = {}
    for key in _FRONTMATTER_KEY_ORDER:
        if key in meta:
            ordered[key] = meta[key]
    for key in meta:
        if key not in ordered:
            ordered[key] = meta[key]
    return ordered


def serialize_frontmatter(meta: dict[str, Any], body: str) -> str:
    """Serialize *meta* as YAML frontmatter prepended to *body*.

    Keys are emitted in canonical order (see :data:`_KEY_ORDER`).
    The result is a complete Markdown file:

    .. code-block:: text

        ---
        id: my-spec
        type: module-design
        ---
        # My Spec

        Content here...
    """
    ordered = _sort_meta_keys(meta)
    yaml_str = yaml.safe_dump(
        ordered,
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
    )
    # yaml.safe_dump always adds a trailing newline; strip it so we
    # control the exact delimiter layout.
    yaml_str = yaml_str.rstrip("\n")

    parts = ["---", yaml_str, "---"]
    if body:
        parts.append(body)
    else:
        # Ensure file ends with a newline even when body is empty.
        parts.append("")

    return "\n".join(parts)


# ── Update helper ────────────────────────────────────────────────────────────


def update_frontmatter(text: str, updates: dict[str, Any]) -> str:
    """Merge *updates* into the existing frontmatter of *text*.

    Parses the current frontmatter, applies the updates (overwriting
    matching keys, adding new keys), and re-serializes.  The Markdown
    body is preserved exactly.

    If *text* has no frontmatter, a new frontmatter block is created
    from *updates* and prepended to the body.
    """
    meta, body = parse_frontmatter(text)
    meta.update(updates)
    return serialize_frontmatter(meta, body)


# ── Link extraction ──────────────────────────────────────────────────────────


def extract_links(meta: dict[str, Any]) -> list[tuple[str, str]]:
    """Extract outgoing link relationships from frontmatter *meta*.

    Returns a list of ``(link_type, target_id)`` tuples.  Each link
    field (``parent``, ``depends-on``, ``references``, ``implements``)
    can be either a single string or a list of strings.

    Delegates to :meth:`Frontmatter.extract_links` when the input can
    be parsed into a valid ``Frontmatter`` model.  Falls back to manual
    extraction for raw/invalid dicts so callers never get an exception.

    Example::

        >>> extract_links({"parent": "design-doc", "depends-on": ["a", "b"]})
        [("parent", "design-doc"), ("depends-on", "a"), ("depends-on", "b")]
    """
    # Normalise single-string list-link fields to lists before passing to
    # the model (YAML ``depends-on: single`` produces a str, not a list).
    # ``parent`` is str | None on the model so must NOT be wrapped.
    normalised = dict(meta)
    for field_name in _LIST_LINK_FIELDS:
        value = normalised.get(field_name)
        if isinstance(value, str):
            normalised[field_name] = [value] if value else []

    try:
        fm = Frontmatter(**normalised)
        return fm.extract_links()
    except ValidationError:
        # Fallback: manual extraction for dicts that don't pass validation
        # (e.g. missing ``id`` / ``type``).
        links: list[tuple[str, str]] = []
        for field, link_type in _FRONTMATTER_LINK_FIELDS.items():
            value = meta.get(field)
            if value is None:
                continue
            if isinstance(value, str):
                if value:
                    links.append((link_type, value))
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and item:
                        links.append((link_type, item))
        return links


# ── Validation ───────────────────────────────────────────────────────────────


def validate_frontmatter(meta: dict[str, Any]) -> list[str]:
    """Validate frontmatter fields and return a list of error messages.

    An empty list means the frontmatter is valid.  Delegates to the
    :class:`Frontmatter` Pydantic model for structural validation, then
    converts ``ValidationError`` messages into the same string-list
    format used by the original manual implementation.

    Checks:

    - Required: ``id`` (non-empty string), ``type`` (recognized value)
    - Optional: ``status`` must be a recognized value if present
    - Optional: ``covers``, ``tags`` must be lists if present
    - Optional: link fields must be strings or lists of strings
    """
    errors: list[str] = []

    # ── Pre-validation (non-string / non-list types the model can't coerce) ──
    for field_name in ("covers", "tags"):
        value = meta.get(field_name)
        if value is not None and not isinstance(value, list):
            errors.append(f"Field '{field_name}' must be a list, got {type(value).__name__}")

    for field_name in _FRONTMATTER_LINK_FIELDS:
        value = meta.get(field_name)
        if value is None:
            continue
        if isinstance(value, str):
            pass  # valid — single string
        elif isinstance(value, list):
            for i, item in enumerate(value):
                if not isinstance(item, str):
                    errors.append(
                        f"Field '{field_name}[{i}]' must be a string, "
                        f"got {type(item).__name__}"
                    )
        else:
            errors.append(
                f"Field '{field_name}' must be a string or list of strings, "
                f"got {type(value).__name__}"
            )

    # ── Normalise for model construction ─────────────────────────────────
    # ``parent`` is str | None on the model; only list-link fields need wrapping.
    normalised = dict(meta)
    for field_name in _LIST_LINK_FIELDS:
        value = normalised.get(field_name)
        if isinstance(value, str):
            normalised[field_name] = [value] if value else []

    # ── Model validation ─────────────────────────────────────────────────
    try:
        Frontmatter(**normalised)
    except ValidationError as exc:
        for err in exc.errors():
            loc = err.get("loc", ())
            field_label = ".".join(str(p) for p in loc) if loc else "unknown"
            err_type = err.get("type", "")

            if field_label == "id" and (
                "missing" in err_type or "string" in err_type or "value_error" in err_type
            ):
                errors.append("Missing or empty required field 'id'")
            elif field_label == "type" and "missing" in err_type:
                errors.append("Missing or empty required field 'type'")
            elif field_label == "type" and "literal" in err_type:
                spec_type = meta.get("type", "")
                errors.append(
                    f"Unrecognized spec type '{spec_type}'. "
                    f"Expected one of: {', '.join(sorted(RECOGNIZED_TYPES))}"
                )
            elif field_label == "status" and "literal" in err_type:
                status = meta.get("status", "")
                errors.append(
                    f"Invalid status '{status}'. "
                    f"Expected one of: {', '.join(sorted(RECOGNIZED_STATUSES))}"
                )
            else:
                # Generic fallback — use Pydantic's message directly.
                errors.append(f"{field_label}: {err.get('msg', str(err))}")

    return errors
