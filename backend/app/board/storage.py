from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from app.board.models import MetaTicket
from app.core.fileio import ensure_dir, read_text


def ticket_path(base_dir: Path, ticket_id: str) -> Path:
    """Return the file path for a ticket JSON file."""
    return base_dir / f"{ticket_id}.json"


def read_ticket(path: Path) -> MetaTicket:
    """Read a single meta-ticket from a JSON file.

    Raises ``FileNotFoundError`` if the file is missing.
    Raises ``ValueError`` if the JSON is malformed.
    """
    content = read_text(path)
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed ticket JSON at {path}: {exc}") from exc
    return MetaTicket(**data)


def write_ticket(path: Path, ticket: MetaTicket) -> None:
    """Write a meta-ticket to a JSON file atomically (temp → rename)."""
    data = ticket.model_dump(by_alias=True)
    content = json.dumps(data, indent=2) + "\n"

    dir_ = path.parent
    ensure_dir(dir_)
    fd, tmp = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    os.close(fd)
    tmp_path = Path(tmp)
    try:
        tmp_path.write_text(content, encoding="utf-8")
        tmp_path.replace(path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise


def list_tickets(base_dir: Path) -> list[MetaTicket]:
    """Read all meta-ticket JSON files from the directory.

    Returns an empty list if the directory does not exist.
    Silently skips malformed files.
    """
    if not base_dir.is_dir():
        return []
    tickets: list[MetaTicket] = []
    for p in sorted(base_dir.glob("*.json")):
        try:
            tickets.append(read_ticket(p))
        except (ValueError, FileNotFoundError):
            continue
    return tickets


def delete_ticket(path: Path) -> None:
    """Delete a meta-ticket JSON file.

    Raises ``FileNotFoundError`` if the file does not exist.
    """
    path.unlink()
