"""Session persistence — saves/loads session data to .bonsai/sessions/.

Storage layout:
  .bonsai/sessions/{bonsai_sid}.json        — metadata (small, rewritten on status change)
  .bonsai/sessions/{bonsai_sid}.events.jsonl — append-only event log (one JSON object per line)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.core.config import BONSAI_DIRNAME
from app.core.fileio import delete_file, ensure_dir, read_text, write_text

logger = logging.getLogger(__name__)


def _sessions_dir(project_root: Path) -> Path:
    """Return the sessions directory path without creating it.

    Writers should call :func:`ensure_dir` (or rely on :func:`write_text`,
    which creates parents) before writing.  Readers must guard against
    a missing directory.
    """
    return project_root / BONSAI_DIRNAME / "sessions"


def _meta_path(project_root: Path, bonsai_sid: str) -> Path:
    return _sessions_dir(project_root) / f"{bonsai_sid}.json"


def _events_path(project_root: Path, bonsai_sid: str) -> Path:
    return _sessions_dir(project_root) / f"{bonsai_sid}.events.jsonl"


def has_persisted_sessions(project_root: Path) -> bool:
    """Cheap check: does this project have at least one persisted session?

    Used by the WS handler to decide whether the project is "real" enough
    to add to the recent-projects list — folders with only background
    artifacts (model cache, etc.) shouldn't pollute it.
    """
    sessions_dir = _sessions_dir(project_root)
    if not sessions_dir.is_dir():
        return False
    return any(sessions_dir.glob("*.json"))


def save_session(project_root: Path, data: dict[str, Any]) -> None:
    """Write session metadata to .bonsai/sessions/{bonsaiSid}.json.

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
    if not sessions_dir.is_dir():
        return []
    result: list[dict[str, Any]] = []
    for path in sorted(sessions_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(read_text(path))
            # Backward compat: support both bonsaiSid and taskId
            sid = data.get("bonsaiSid") or data.get("taskId", "")
            status = data.get("status", "done")
            # Disk-only sessions with non-terminal status have no live
            # runner.  "interrupted" reflects reality (runner was killed,
            # e.g., by backend restart) and lets the UI keep flow-specific
            # affordances (goal layout, GoalFilePanel) — unlike "done",
            # which the UI treats as a fully-finished session.
            if status not in ("done", "error", "draft"):
                status = "interrupted"
            entry: dict[str, Any] = {
                "bonsaiSid": sid,
                "name": data.get("name", ""),
                "skillId": data.get("skillId"),
                "specIds": data.get("specIds", []),
                "status": status,
                "model": data.get("config", {}).get("model", ""),
                "createdAt": data.get("createdAt", ""),
                "updatedAt": data.get("updatedAt", ""),
                # "interrupted" means no live runner → not active for
                # scheduling, but the UI can still surface it.
                "active": status not in ("done", "error", "interrupted"),
                "inTracker": False,
                "metrics": data.get("metrics", {}),
            }
            # Include full config and system prompt for draft sessions
            if status == "draft":
                entry["config"] = data.get("config", {})
                entry["systemPrompt"] = data.get("systemPrompt")
                entry["sessionPrompt"] = data.get("sessionPrompt")
                entry["filePaths"] = data.get("filePaths", [])
            result.append(entry)
        except Exception:
            logger.exception("Failed to read session file %s", path)
    return result


def load_events(project_root: Path, bonsai_sid: str) -> list[dict[str, Any]]:
    """Load events from a session's .events.jsonl file."""
    events_path = _events_path(project_root, bonsai_sid)
    if not events_path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in events_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def append_event(project_root: Path, bonsai_sid: str, event: dict[str, Any]) -> None:
    """Append a single event to the session's .events.jsonl log. O(1) operation."""
    meta = _meta_path(project_root, bonsai_sid)
    if not meta.is_file():
        return
    evts = _events_path(project_root, bonsai_sid)
    try:
        ensure_dir(evts.parent)
        with evts.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, default=str) + "\n")
    except Exception:
        logger.exception("Failed to append event for session %s", bonsai_sid)


def update_session_metadata(
    project_root: Path,
    bonsai_sid: str,
    updates: dict[str, Any],
    *,
    overwrite: bool = True,
) -> None:
    """Read-modify-write session metadata JSON, merging *updates* into it.

    When *overwrite* is False, existing keys are not replaced.
    """
    path = _meta_path(project_root, bonsai_sid)
    if not path.is_file():
        return
    try:
        meta = json.loads(read_text(path))
        if overwrite:
            meta.update(updates)
        else:
            for k, v in updates.items():
                meta.setdefault(k, v)
        write_text(path, json.dumps(meta, indent=2, default=str))
    except Exception:
        logger.debug("Failed to update metadata for %s", bonsai_sid)


def list_children(project_root: Path, parent_bonsai_sid: str) -> list[dict[str, Any]]:
    """List direct child subsessions of a parent session (metadata only)."""
    sessions_dir = project_root / BONSAI_DIRNAME / "sessions"
    if not sessions_dir.is_dir():
        return []
    children = []
    for fpath in sessions_dir.glob("*.json"):
        if fpath.name.endswith(".events.jsonl"):
            continue
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("parentBonsaiSid") == parent_bonsai_sid:
            children.append(data)
    return children


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
