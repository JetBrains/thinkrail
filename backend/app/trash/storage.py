"""Low-level file operations for the trash system.

Trash layout:
  .bonsai/trash/{type}/{id}/
    <original files>
    _trash.json   — sidecar with { trashedAt, originalDir }
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path


def move_to_trash(
    trash_dir: Path,
    item_type: str,
    item_id: str,
    source_files: list[Path],
    original_dir: str,
) -> None:
    """Move files into trash and write a _trash.json sidecar."""
    dest = trash_dir / item_type / item_id
    dest.mkdir(parents=True, exist_ok=True)

    for src in source_files:
        if src.is_file():
            shutil.move(str(src), str(dest / src.name))

    sidecar = dest / "_trash.json"
    sidecar.write_text(
        json.dumps(
            {"trashedAt": datetime.now(UTC).isoformat(), "originalDir": original_dir},
            indent=2,
        ),
        encoding="utf-8",
    )


def restore_from_trash(trash_dir: Path, item_type: str, item_id: str) -> None:
    """Restore trashed files to their original directory."""
    src_dir = trash_dir / item_type / item_id
    sidecar = src_dir / "_trash.json"
    if not sidecar.is_file():
        raise FileNotFoundError(f"Trashed item not found: {item_type}/{item_id}")

    info = json.loads(sidecar.read_text(encoding="utf-8"))
    original = Path(info["originalDir"])
    original.mkdir(parents=True, exist_ok=True)

    for f in src_dir.iterdir():
        if f.name == "_trash.json":
            continue
        shutil.move(str(f), str(original / f.name))

    shutil.rmtree(src_dir)


def list_trashed(trash_dir: Path, item_type: str | None = None) -> list[dict]:
    """List trashed items. If item_type is given, filter to that type only."""
    results: list[dict] = []
    if not trash_dir.is_dir():
        return results

    type_dirs = [trash_dir / item_type] if item_type else list(trash_dir.iterdir())
    for type_dir in type_dirs:
        if not type_dir.is_dir():
            continue
        for item_dir in sorted(type_dir.iterdir()):
            sidecar = item_dir / "_trash.json"
            if not sidecar.is_file():
                continue
            info = json.loads(sidecar.read_text(encoding="utf-8"))
            results.append({
                "type": type_dir.name,
                "id": item_dir.name,
                "trashedAt": info["trashedAt"],
                "originalDir": info["originalDir"],
            })
    return results


def purge_trashed(trash_dir: Path, item_type: str, item_id: str) -> None:
    """Permanently delete a trashed item."""
    item_dir = trash_dir / item_type / item_id
    if not item_dir.is_dir():
        raise FileNotFoundError(f"Trashed item not found: {item_type}/{item_id}")
    shutil.rmtree(item_dir)
