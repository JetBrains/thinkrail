"""Session persistence — saves/loads session data to .tr/sessions/.

Storage layout:
  .tr/sessions/{thinkrail_sid}.json        — metadata (small, rewritten on status change)
  .tr/sessions/{thinkrail_sid}.events.jsonl — append-only event log (one JSON object per line)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.core.config import PROJECT_DIRNAME, SESSIONS_DIR
from app.core.fileio import delete_file, ensure_dir, read_text, write_text

logger = logging.getLogger(__name__)


# ── Todo snapshot state (in-memory, incremental) ──────────────────────────────
# Per-session ordered task dict, keyed by (project_root, thinkrail_sid). Each
# entry is the same shape derive_todo_snapshot's internal table uses
# (key → {key, subject, activeForm, status}) plus a parallel ordered_keys
# list and a TaskCreate counter. Re-derived from disk on first touch after
# restart so a fresh backend doesn't lose history.
_SnapshotState = dict[str, Any]
_snapshot_cache: dict[tuple[str, str], _SnapshotState] = {}


def _sessions_dir(project_root: Path) -> Path:
    """Return the sessions directory path without creating it.

    Writers should call :func:`ensure_dir` (or rely on :func:`write_text`,
    which creates parents) before writing.  Readers must guard against
    a missing directory.
    """
    return project_root / PROJECT_DIRNAME / SESSIONS_DIR


def _safe_sid(thinkrail_sid: str) -> str:
    """Reject path-traversal characters before a session id becomes a filename,
    so a crafted id cannot escape the sessions directory."""
    if "/" in thinkrail_sid or "\\" in thinkrail_sid or ".." in thinkrail_sid:
        raise ValueError(f"Unsafe thinkrail_sid: {thinkrail_sid!r}")
    return thinkrail_sid


def _meta_path(project_root: Path, thinkrail_sid: str) -> Path:
    return _sessions_dir(project_root) / f"{_safe_sid(thinkrail_sid)}.json"


def _events_path(project_root: Path, thinkrail_sid: str) -> Path:
    return _sessions_dir(project_root) / f"{_safe_sid(thinkrail_sid)}.events.jsonl"


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
    """Write session metadata to .tr/sessions/{thinkrailSid}.json.

    Events in ``data`` are written to the separate ``.events.jsonl`` file
    (one JSON object per line) and stripped from the metadata file.
    """
    thinkrail_sid = data.get("thinkrailSid", "")
    if not thinkrail_sid:
        return
    # Separate events from metadata
    events = data.pop("events", None)
    try:
        write_text(_meta_path(project_root, thinkrail_sid), json.dumps(data, indent=2, default=str))
    except Exception:
        logger.exception("Failed to save session metadata %s", thinkrail_sid)
        return
    # Bulk-write events if provided (used by initial save / continue_session)
    evts = _events_path(project_root, thinkrail_sid)
    if events:
        try:
            lines = [json.dumps(e, default=str) for e in events]
            write_text(evts, "\n".join(lines) + "\n")
        except Exception:
            logger.exception("Failed to save session events %s", thinkrail_sid)
    elif not evts.is_file():
        evts.touch()


def load_session(project_root: Path, thinkrail_sid: str) -> dict[str, Any] | None:
    """Load a session (metadata + events) from disk. Returns None if not found."""
    meta = _meta_path(project_root, thinkrail_sid)
    if not meta.is_file():
        return None
    try:
        data = json.loads(read_text(meta))
    except Exception:
        logger.exception("Failed to load session metadata %s", thinkrail_sid)
        return None
    # Load events from the append-only log
    evts = _events_path(project_root, thinkrail_sid)
    events: list[dict[str, Any]] = []
    if evts.is_file():
        try:
            for line in read_text(evts).splitlines():
                line = line.strip()
                if line:
                    events.append(json.loads(line))
        except Exception:
            logger.exception("Failed to load session events %s", thinkrail_sid)
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
            sid = data.get("thinkrailSid", "")
            status = data.get("status", "done")
            # Disk-only sessions with non-terminal status have no live
            # runner.  "interrupted" reflects reality (runner was killed,
            # e.g., by backend restart) and lets the UI keep flow-specific
            # affordances (goal layout, GoalFilePanel) — unlike "done",
            # which the UI treats as a fully-finished session.
            if status not in ("done", "error", "draft"):
                status = "interrupted"
            entry: dict[str, Any] = {
                "thinkrailSid": sid,
                "name": data.get("name", ""),
                "skillId": data.get("skillId"),
                "specIds": data.get("specIds", []),
                "status": status,
                "model": data.get("config", {}).get("model", ""),
                # Sessions are persisted with key "ticketId" (matching
                # AgentTask.ticket_id → camelCase). The legacy
                # "metaTicketId" fallback covers any pre-rename files.
                "ticketId": data.get("ticketId") or data.get("metaTicketId"),
                "createdAt": data.get("createdAt", ""),
                "updatedAt": data.get("updatedAt", ""),
                # "interrupted" means no live runner → not active for
                # scheduling, but the UI can still surface it.
                "active": status not in ("done", "error", "interrupted"),
                "inTracker": False,
                "metrics": data.get("metrics", {}),
                # Persisted snapshot of the latest TodoWrite/Task* state.
                # The frontend uses this as a cold-cache fallback when the
                # session isn't loaded in memory, so Tasks (n/m) sub-rows
                # under collapsed/old phases survive a page reload.
                "todos": data.get("todos", []),
            }
            # Include full config and system prompt for draft sessions
            if status == "draft":
                entry["config"] = data.get("config", {})
                entry["systemPrompt"] = data.get("systemPrompt")
                entry["sessionPrompt"] = data.get("sessionPrompt")
                entry["draftInput"] = data.get("draftInput")
                entry["filePaths"] = data.get("filePaths", [])
                entry["subagentMode"] = data.get("subagentMode")
                entry["stepGate"] = data.get("stepGate")
            result.append(entry)
        except Exception:
            logger.exception("Failed to read session file %s", path)
    return result


def load_events(project_root: Path, thinkrail_sid: str) -> list[dict[str, Any]]:
    """Load events from a session's .events.jsonl file."""
    events_path = _events_path(project_root, thinkrail_sid)
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


def append_event(project_root: Path, thinkrail_sid: str, event: dict[str, Any]) -> None:
    """Append a single event to the session's .events.jsonl log. O(1) operation.

    When the event is a Todo*/Task* tool call we additionally update the
    session's incremental todo snapshot and persist it into the metadata
    JSON so the list_sessions RPC can serve it without rescanning events.
    See app/agent/todo_snapshot.py for the derivation.
    """
    meta = _meta_path(project_root, thinkrail_sid)
    if not meta.is_file():
        return
    evts = _events_path(project_root, thinkrail_sid)
    try:
        ensure_dir(evts.parent)
        with evts.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, default=str) + "\n")
    except Exception:
        logger.exception("Failed to append event for session %s", thinkrail_sid)
        return

    from app.agent.todo_snapshot import is_todo_event
    if is_todo_event(event):
        _refresh_todo_snapshot(project_root, thinkrail_sid, event)


def _refresh_todo_snapshot(
    project_root: Path, thinkrail_sid: str, event: dict[str, Any],
) -> None:
    """Update the cached snapshot for *thinkrail_sid* with *event* and persist.

    On first use after restart the cache is hydrated from the full events
    log (which already contains *event* because :func:`append_event` writes
    it before calling this function). On subsequent calls the cached state
    is mutated in-place, so each event costs O(1) instead of O(N).

    Best-effort: failures are logged and swallowed so a snapshot bug never
    blocks event appends.
    """
    from app.agent.todo_snapshot import (
        apply_todo_event,
        build_snapshot_state,
        new_snapshot_state,
        render_snapshot,
    )

    try:
        key = (str(project_root), thinkrail_sid)
        state = _snapshot_cache.get(key)
        if state is None:
            # Hydrate from disk; the in-progress event is already present
            # in events.jsonl so we must NOT re-apply it after building.
            evts = _events_path(project_root, thinkrail_sid)
            if evts.is_file():
                events: list[dict[str, Any]] = []
                try:
                    with evts.open("r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                events.append(json.loads(line))
                            except json.JSONDecodeError:
                                continue
                except OSError:
                    events = []
                state = build_snapshot_state(events)
            else:
                state = new_snapshot_state()
                apply_todo_event(state, event)
            _snapshot_cache[key] = state
        else:
            apply_todo_event(state, event)
        update_session_metadata(
            project_root, thinkrail_sid, {"todos": render_snapshot(state)},
        )
    except Exception:
        logger.exception(
            "Failed to refresh todo snapshot for session %s", thinkrail_sid,
        )


def _evict_snapshot(project_root: Path, thinkrail_sid: str) -> None:
    """Drop the cached snapshot for a session (e.g. on delete)."""
    _snapshot_cache.pop((str(project_root), thinkrail_sid), None)


def update_session_metadata(
    project_root: Path,
    thinkrail_sid: str,
    updates: dict[str, Any],
    *,
    overwrite: bool = True,
) -> None:
    """Read-modify-write session metadata JSON, merging *updates* into it.

    When *overwrite* is False, existing keys are not replaced.
    """
    path = _meta_path(project_root, thinkrail_sid)
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
        logger.debug("Failed to update metadata for %s", thinkrail_sid)


def list_children(project_root: Path, parent_thinkrail_sid: str) -> list[dict[str, Any]]:
    """List direct child subsessions of a parent session (metadata only)."""
    sessions_dir = project_root / PROJECT_DIRNAME / SESSIONS_DIR
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
        if data.get("parentThinkrailSid") == parent_thinkrail_sid:
            children.append(data)
    return children


def delete_session(project_root: Path, thinkrail_sid: str) -> bool:
    """Delete a session (metadata + events) from disk. Returns True if deleted."""
    meta = _meta_path(project_root, thinkrail_sid)
    evts = _events_path(project_root, thinkrail_sid)
    deleted = False
    if meta.is_file():
        delete_file(meta)
        deleted = True
    if evts.is_file():
        delete_file(evts)
        deleted = True
    _evict_snapshot(project_root, thinkrail_sid)
    return deleted
