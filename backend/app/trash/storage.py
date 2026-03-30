"""Trash storage — soft-delete for sessions and tickets.

Layout::

    <trash_dir>/
        sessions/
            <item_id>/
                <filename>          # copied files
                _trash_meta.json    # original_dir, trashed_at
        tickets/
            <item_id>/
                <filename>
                _trash_meta.json

Functions
---------
move_to_trash   — move files into trash bucket
restore_from_trash — move files back to their original location
list_trashed    — enumerate trashed items (optionally filtered by type)
purge_trashed   — permanently delete a trashed item
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


_META_FILENAME = "_trash_meta.json"


def _item_dir(trash_dir: Path, item_type: str, item_id: str) -> Path:
    return trash_dir / item_type / item_id


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def move_to_trash(
    trash_dir: Path,
    item_type: str,
    item_id: str,
    source_files: list[Path],
    original_dir: Path,
) -> Path:
    """Move *source_files* into the trash bucket for *item_id*.

    Creates ``<trash_dir>/<item_type>/<item_id>/`` and copies each file
    from *source_files* there, then deletes the originals.  A
    ``_trash_meta.json`` file is written alongside the files recording the
    original directory and the timestamp.

    Parameters
    ----------
    trash_dir:
        Root trash directory (e.g. ``.bonsai/trash``).
    item_type:
        ``"sessions"`` or ``"tickets"`` (or any other string).
    item_id:
        Unique identifier for the item.
    source_files:
        List of existing file paths to move.  Non-existent paths are silently
        skipped.
    original_dir:
        Directory where the files lived, stored in metadata for restore.

    Returns
    -------
    Path
        The trash bucket directory for this item.

    Raises
    ------
    FileExistsError
        If the trash bucket for this item already exists (item already trashed).
    """
    dest = _item_dir(trash_dir, item_type, item_id)
    if dest.exists():
        raise FileExistsError(f"Item already in trash: {item_type}/{item_id}")
    dest.mkdir(parents=True, exist_ok=False)

    for src in source_files:
        if src.is_file():
            shutil.copy2(src, dest / src.name)
            src.unlink()

    meta: dict[str, Any] = {
        "item_type": item_type,
        "item_id": item_id,
        "original_dir": str(original_dir),
        "trashed_at": datetime.now(UTC).isoformat(),
    }
    (dest / _META_FILENAME).write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return dest


def restore_from_trash(
    trash_dir: Path,
    item_type: str,
    item_id: str,
) -> Path:
    """Move a trashed item back to its original location.

    Reads ``_trash_meta.json`` from the trash bucket to determine where to
    restore the files, then moves each file (except the meta file) back.
    The trash bucket directory is removed after a successful restore.

    Returns
    -------
    Path
        The original directory the files were restored to.

    Raises
    ------
    FileNotFoundError
        If the trash bucket for *item_id* does not exist.
    ValueError
        If ``_trash_meta.json`` is missing or malformed.
    """
    src_dir = _item_dir(trash_dir, item_type, item_id)
    if not src_dir.is_dir():
        raise FileNotFoundError(f"Trashed item not found: {item_type}/{item_id}")

    meta_path = src_dir / _META_FILENAME
    if not meta_path.is_file():
        raise ValueError(f"Missing trash metadata for {item_type}/{item_id}")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed trash metadata for {item_type}/{item_id}: {exc}") from exc

    original_dir = Path(meta["original_dir"])
    original_dir.mkdir(parents=True, exist_ok=True)

    for f in src_dir.iterdir():
        if f.name == _META_FILENAME:
            continue
        dest = original_dir / f.name
        shutil.move(str(f), dest)

    shutil.rmtree(src_dir)
    return original_dir


def list_trashed(
    trash_dir: Path,
    item_type: str | None = None,
) -> list[dict[str, Any]]:
    """List all trashed items, optionally filtered by *item_type*.

    Each entry is the parsed content of the item's ``_trash_meta.json``.

    Returns an empty list if *trash_dir* does not exist or contains no
    trashed items.
    """
    if not trash_dir.is_dir():
        return []

    results: list[dict[str, Any]] = []

    type_dirs: list[Path]
    if item_type is not None:
        type_dir = trash_dir / item_type
        type_dirs = [type_dir] if type_dir.is_dir() else []
    else:
        type_dirs = [d for d in sorted(trash_dir.iterdir()) if d.is_dir()]

    for type_dir in type_dirs:
        for item_dir in sorted(type_dir.iterdir()):
            if not item_dir.is_dir():
                continue
            meta_path = item_dir / _META_FILENAME
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                results.append(meta)
            except (json.JSONDecodeError, OSError):
                continue

    return results


def purge_trashed(
    trash_dir: Path,
    item_type: str,
    item_id: str,
) -> None:
    """Permanently delete a trashed item from the trash bucket.

    Raises
    ------
    FileNotFoundError
        If the trash bucket for *item_id* does not exist.
    """
    dest = _item_dir(trash_dir, item_type, item_id)
    if not dest.is_dir():
        raise FileNotFoundError(f"Trashed item not found: {item_type}/{item_id}")
    shutil.rmtree(dest)
