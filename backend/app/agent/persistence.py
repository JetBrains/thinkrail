"""Session persistence — saves/loads session data to .specs/sessions/.

Storage layout:
  .specs/sessions/{bonsai_sid}.json        — metadata (small, rewritten on status change)
  .specs/sessions/{bonsai_sid}.events.jsonl — append-only event log (one JSON object per line)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.core.fileio import delete_file, ensure_dir, read_text, write_text

logger = logging.getLogger(__name__)


def _sessions_dir(project_root: Path) -> Path:
    d = project_root / ".specs" / "sessions"
    ensure_dir(d)
    return d


def _meta_path(project_root: Path, bonsai_sid: str) -> Path:
    return _sessions_dir(project_root) / f"{bonsai_sid}.json"


def _events_path(project_root: Path, bonsai_sid: str) -> Path:
    return _sessions_dir(project_root) / f"{bonsai_sid}.events.jsonl"


def save_session(project_root: Path, data: dict[str, Any]) -> None:
    """Write session metadata to .specs/sessions/{bonsaiSid}.json.

    Events in ``data`` are written to the separate ``.events.jsonl`` file
    (one JSON object per line) and stripped from the metadata file.
    """
    bonsai_sid = data.get("bonsaiSid") or data.get("taskId", "")
    if not bonsai_sid:
        return
    # Normalize key to bonsaiSid
    if "taskId" in data and "bonsaiSid" not in data:
        data["bonsaiSid"] = data.pop("taskId")
    # Separate events from metadata
    events = data.pop("events", None)
    try:
        write_text(_meta_path(project_root, bonsai_sid), json.dumps(data, indent=2, default=str))
    except Exception:
        logger.exception("Failed to save session metadata %s", bonsai_sid)
        return
    # Bulk-write events if provided (used by initial save / continue_session)
    evts = _events_path(project_root, bonsai_sid)
    if events:
        try:
            lines = [json.dumps(e, default=str) for e in events]
            write_text(evts, "\n".join(lines) + "\n")
        except Exception:
            logger.exception("Failed to save session events %s", bonsai_sid)
    elif not evts.is_file():
        evts.touch()


def load_session(project_root: Path, bonsai_sid: str) -> dict[str, Any] | None:
    """Load a session (metadata + events) from disk. Returns None if not found."""
    meta = _meta_path(project_root, bonsai_sid)
    if not meta.is_file():
        return None
    try:
        data = json.loads(read_text(meta))
    except Exception:
        logger.exception("Failed to load session metadata %s", bonsai_sid)
        return None
    # Backward compat: normalize taskId → bonsaiSid
    if "taskId" in data and "bonsaiSid" not in data:
        data["bonsaiSid"] = data.pop("taskId")
    # Load events from the append-only log
    evts = _events_path(project_root, bonsai_sid)
    events: list[dict[str, Any]] = []
    if evts.is_file():
        try:
            for line in read_text(evts).splitlines():
                line = line.strip()
                if line:
                    events.append(json.loads(line))
        except Exception:
            logger.exception("Failed to load session events %s", bonsai_sid)
    data["events"] = events
    return data


def list_sessions(project_root: Path) -> list[dict[str, Any]]:
    """List all sessions from disk (metadata only — no events loaded)."""
    sessions_dir = _sessions_dir(project_root)
    result: list[dict[str, Any]] = []
    for path in sorted(sessions_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(read_text(path))
            # Backward compat: support both bonsaiSid and taskId
            sid = data.get("bonsaiSid") or data.get("taskId", "")
            result.append({
                "bonsaiSid": sid,
                "name": data.get("name", ""),
                "skillId": data.get("skillId"),
                "specIds": data.get("specIds", []),
                "status": data.get("status", "done"),
                "model": data.get("config", {}).get("model", ""),
                "createdAt": data.get("createdAt", ""),
                "updatedAt": data.get("updatedAt", ""),
                "metrics": data.get("metrics", {}),
            })
        except Exception:
            logger.exception("Failed to read session file %s", path)
    return result


def append_event(project_root: Path, bonsai_sid: str, event: dict[str, Any]) -> None:
    """Append a single event to the session's .events.jsonl log. O(1) operation."""
    meta = _meta_path(project_root, bonsai_sid)
    if not meta.is_file():
        return
    evts = _events_path(project_root, bonsai_sid)
    try:
        with evts.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, default=str) + "\n")
    except Exception:
        logger.exception("Failed to append event for session %s", bonsai_sid)


def delete_session(project_root: Path, bonsai_sid: str) -> bool:
    """Delete a session (metadata + events) from disk. Returns True if deleted."""
    meta = _meta_path(project_root, bonsai_sid)
    evts = _events_path(project_root, bonsai_sid)
    deleted = False
    if meta.is_file():
        delete_file(meta)
        deleted = True
    if evts.is_file():
        delete_file(evts)
        deleted = True
    return deleted
