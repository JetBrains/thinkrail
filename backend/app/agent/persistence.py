"""Session persistence — saves/loads session data to .specs/sessions/ as JSON files."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _sessions_dir(project_root: Path) -> Path:
    d = project_root / ".specs" / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_session(project_root: Path, data: dict[str, Any]) -> None:
    """Write session data to .specs/sessions/{taskId}.json."""
    task_id = data.get("taskId", "")
    if not task_id:
        return
    path = _sessions_dir(project_root) / f"{task_id}.json"
    try:
        path.write_text(json.dumps(data, indent=2, default=str))
    except Exception:
        logger.exception("Failed to save session %s", task_id)


def load_session(project_root: Path, task_id: str) -> dict[str, Any] | None:
    """Load a single session from disk. Returns None if not found."""
    path = _sessions_dir(project_root) / f"{task_id}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        logger.exception("Failed to load session %s", task_id)
        return None


def list_sessions(project_root: Path) -> list[dict[str, Any]]:
    """List all sessions from disk (metadata only — no events/messages)."""
    sessions_dir = _sessions_dir(project_root)
    result: list[dict[str, Any]] = []
    for path in sorted(sessions_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text())
            # Return metadata only — strip events/messages for list view
            result.append({
                "taskId": data.get("taskId", ""),
                "name": data.get("name", ""),
                "skillId": data.get("skillId"),
                "specIds": data.get("specIds", []),
                "status": data.get("status", "done"),
                "model": data.get("config", {}).get("model", ""),
                "createdAt": data.get("createdAt", ""),
                "updatedAt": data.get("updatedAt", ""),
                "metrics": data.get("metrics", {}),
                "continuedFrom": data.get("continuedFrom"),
            })
        except Exception:
            logger.exception("Failed to read session file %s", path)
    return result


def delete_session(project_root: Path, task_id: str) -> bool:
    """Delete a session file from disk. Returns True if deleted."""
    path = _sessions_dir(project_root) / f"{task_id}.json"
    if path.is_file():
        path.unlink()
        return True
    return False
