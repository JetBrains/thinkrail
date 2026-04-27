#!/usr/bin/env python
"""Migrate a Bonsai project from registry.json to YAML frontmatter.

Usage:
    python scripts/migrate_registry.py [path]
    uv run python scripts/migrate_registry.py [path]

If *path* is omitted, the current working directory is used.

Steps:
1. Read registry.json entries and links
2. Inject YAML frontmatter into each spec file
3. Archive registry.json → registry.json.bak
4. Print a summary of migrated / skipped / error counts

index.db is NOT rebuilt here — it is built lazily on the next Bonsai startup.
"""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

# ── Key ordering for serialized frontmatter ─────────────────────────────────

_KEY_ORDER = [
    "id", "type", "status", "title", "parent",
    "depends-on", "references", "implements",
    "covers", "tags",
]


# ── Result ──────────────────────────────────────────────────────────────────


@dataclass
class MigrationResult:
    migrated: int = 0
    skipped: int = 0
    missing: int = 0
    errors: list[str] = field(default_factory=list)


# ── Frontmatter helpers (self-contained, no backend imports) ────────────────

import re  # noqa: E402

_FM_DELIM = re.compile(r"^---\s*$", re.MULTILINE)


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter. Returns (meta, body)."""
    stripped = text.lstrip("\n")
    if not stripped.startswith("---"):
        return {}, text
    matches = list(_FM_DELIM.finditer(text))
    if len(matches) < 2:
        return {}, text
    yaml_block = text[matches[0].end():matches[1].start()]
    body = text[matches[1].end():]
    if body.startswith("\n"):
        body = body[1:]
    try:
        parsed = yaml.safe_load(yaml_block)
    except yaml.YAMLError:
        return {}, text
    if not isinstance(parsed, dict):
        return {}, text
    return parsed or {}, body


def _serialize_frontmatter(meta: dict, body: str) -> str:
    """Serialize meta as YAML frontmatter prepended to body."""
    ordered: dict = {}
    for key in _KEY_ORDER:
        if key in meta:
            ordered[key] = meta[key]
    for key in meta:
        if key not in ordered:
            ordered[key] = meta[key]
    yaml_str = yaml.safe_dump(
        ordered, default_flow_style=False,
        sort_keys=False, allow_unicode=True,
    ).rstrip("\n")
    parts = ["---", yaml_str, "---"]
    parts.append(body if body else "")
    return "\n".join(parts)


# ── Build frontmatter from registry entry ───────────────────────────────────


def _build_frontmatter(entry: dict, outgoing_links: list[dict]) -> dict:
    meta: dict = {"id": entry["id"], "type": entry.get("type", "")}

    status = entry.get("status")
    if status and status != "draft":
        meta["status"] = status

    title = entry.get("title")
    if title:
        meta["title"] = title

    parents: list[str] = []
    depends_on: list[str] = []
    references: list[str] = []
    implements: list[str] = []

    for lnk in outgoing_links:
        to_id = lnk.get("to", "")
        ltype = lnk.get("type", "")
        if not to_id:
            continue
        if ltype == "parent":
            parents.append(to_id)
        elif ltype == "depends-on":
            depends_on.append(to_id)
        elif ltype == "references":
            references.append(to_id)
        elif ltype == "implements":
            implements.append(to_id)

    if parents:
        meta["parent"] = parents[0]
    if depends_on:
        meta["depends-on"] = depends_on
    if references:
        meta["references"] = references
    if implements:
        meta["implements"] = implements

    covers = entry.get("covers", [])
    if covers:
        meta["covers"] = covers

    tags = entry.get("tags", [])
    if tags:
        meta["tags"] = tags

    return meta


# ── Migration ───────────────────────────────────────────────────────────────


def migrate_registry(project_root: Path) -> MigrationResult:
    """Migrate registry.json → YAML frontmatter in spec files."""
    result = MigrationResult()
    registry_path = project_root / ".bonsai" / "registry.json"

    if not registry_path.exists():
        logger.info("No registry.json found — nothing to migrate")
        return result

    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        result.errors.append(f"Cannot read registry.json: {exc}")
        return result

    entries = data.get("specs", [])
    links = data.get("links", [])

    if not entries:
        logger.info("Registry has no specs — nothing to migrate")
        return result

    # Build outgoing links per spec
    outgoing: dict[str, list[dict]] = {}
    for lnk in links:
        from_id = lnk.get("from", "")
        if from_id:
            outgoing.setdefault(from_id, []).append(lnk)

    # Inject frontmatter into each spec file
    total = len(entries)
    for i, entry in enumerate(entries, 1):
        spec_id = entry.get("id", "")
        spec_path = entry.get("path", "")

        if not spec_id or not spec_path:
            result.errors.append(f"Entry {i}: missing id or path, skipped")
            continue

        file_path = project_root / spec_path
        if not file_path.exists():
            logger.warning("Spec file missing: %s (id=%s)", spec_path, spec_id)
            result.missing += 1
            continue

        try:
            content = file_path.read_text(encoding="utf-8")
        except OSError as exc:
            result.errors.append(f"Cannot read {spec_path}: {exc}")
            continue

        existing_meta, body = _parse_frontmatter(content)
        if existing_meta.get("id"):
            logger.debug("Already has frontmatter: %s — skipping", spec_path)
            result.skipped += 1
            continue

        meta = _build_frontmatter(entry, outgoing.get(spec_id, []))

        try:
            new_content = _serialize_frontmatter(meta, body)
            file_path.write_text(new_content, encoding="utf-8")
            result.migrated += 1
            logger.info("Migrated %d/%d: %s", i, total, spec_path)
        except OSError as exc:
            result.errors.append(f"Cannot write {spec_path}: {exc}")

    # Archive registry.json
    bak_path = registry_path.with_suffix(".json.bak")
    try:
        registry_path.rename(bak_path)
        logger.info("Archived registry.json → registry.json.bak")
    except OSError as exc:
        result.errors.append(f"Cannot archive registry.json: {exc}")

    logger.info(
        "Migration complete: %d migrated, %d skipped, %d missing, %d errors",
        result.migrated, result.skipped, result.missing, len(result.errors),
    )
    return result


# ── CLI ─────────────────────────────────────────────────────────────────────


def _print_summary(result: MigrationResult) -> None:
    print()
    print("=" * 60)
    print("  Registry → Frontmatter Migration Summary")
    print("=" * 60)
    print(f"  Migrated : {result.migrated}")
    print(f"  Skipped  : {result.skipped} (already have frontmatter)")
    print(f"  Missing  : {result.missing} (spec file not found on disk)")
    print(f"  Errors   : {len(result.errors)}")
    if result.errors:
        print()
        for err in result.errors:
            print(f"  ✗ {err}")
    print("=" * 60)
    print()


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]

    if args and args[0] in ("-h", "--help"):
        print(__doc__)
        return 0

    project_root = Path(args[0]).resolve() if args else Path.cwd().resolve()

    bonsai_dir = project_root / ".bonsai"
    if not bonsai_dir.is_dir():
        print(f"✗ Not a Bonsai project (no .bonsai/ directory): {project_root}")
        return 1

    registry = bonsai_dir / "registry.json"
    if not registry.exists():
        print(f"ℹ No migration needed for: {project_root}")
        print("  (registry.json not found)")
        return 0

    print(f"Migrating: {project_root}")
    print()

    result = migrate_registry(project_root)
    _print_summary(result)

    if result.errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
