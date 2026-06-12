"""Per-session artifact tracking helpers.

Pure-function utilities that mutate AgentTask.artifacts / preview_path
based on tool calls. Callers are expected to follow up with
update_session_metadata to persist, and fire ui/artifactAdded /
ui/artifactLabeled / ui/setPreviewFile notifications as appropriate.

All mutations no-op when task.ticket_id is None — artifact
tracking applies to ticket-linked sessions only.
"""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from app.agent.models import AgentTask, SessionArtifact
from app.agent.persistence import update_session_metadata


_ArtifactKind = Literal["write", "edit", "propose-change", "preview"]


def persist_artifact_state(project_root: Path, task: AgentTask) -> None:
    """Write task.artifacts + task.preview_path snapshot to the session meta JSON.

    Called by tool sites after a mutation so the state survives reload.
    No-op when the meta file doesn't exist yet — update_session_metadata
    handles that.
    """
    update_session_metadata(
        project_root,
        task.thinkrail_sid,
        {
            "artifacts": [a.model_dump(by_alias=True) for a in task.artifacts],
            "previewPath": task.preview_path,
        },
    )


def _is_inside(project_root: Path, file_path: str) -> bool:
    try:
        abs_path = (project_root / file_path).resolve()
        abs_path.relative_to(project_root.resolve())
        return True
    except ValueError:
        return False


def _to_relative(project_root: Path, path: str) -> str:
    """Return ``path`` as a project-relative string when it falls inside
    ``project_root``. Pass other inputs through unchanged.

    Agents call ``SetPreviewFile`` / ``ProposeChange`` with whatever form they
    happen to have (absolute when using ``Write``, relative when reading from
    a known path). Normalizing here keeps a single canonical form on disk so
    the same logical file doesn't show up twice in the artifact list.
    """
    try:
        abs_path = (project_root / path).resolve()
        rel = abs_path.relative_to(project_root.resolve())
        return str(rel)
    except (ValueError, OSError):
        return path


def _find_artifact(task: AgentTask, path: str, project_root: Path | None = None) -> SessionArtifact | None:
    """Look up an artifact by path. When ``project_root`` is supplied, both
    the stored path and the search path are normalized to project-relative
    form before comparison — so a legacy absolute-path entry still matches a
    new relative-path query (and vice versa)."""
    if project_root is not None:
        target = _to_relative(project_root, path)
        for a in task.artifacts:
            if _to_relative(project_root, a.path) == target:
                return a
        return None
    for a in task.artifacts:
        if a.path == path:
            return a
    return None


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def record_artifact(
    task: AgentTask,
    path: str,
    kind: _ArtifactKind,
    project_root: Path,
) -> SessionArtifact | None:
    """Append-or-update by path. Returns the resulting entry, or None on no-op.

    Latest-touch wins for kind: an existing entry's kind is overwritten with
    the new value. The kind field is informational (chip-strip indicator),
    not a state machine.
    """
    if task.ticket_id is None:
        return None
    if not _is_inside(project_root, path):
        return None

    rel_path = _to_relative(project_root, path)
    now = _now_iso()
    existing = _find_artifact(task, rel_path, project_root)
    if existing is not None:
        # Normalize legacy entries to relative form on touch.
        existing.path = rel_path
        existing.kind = kind
        existing.last_touched_at = now
        return existing
    new = SessionArtifact(
        path=rel_path,
        kind=kind,
        first_touched_at=now,
        last_touched_at=now,
    )
    task.artifacts.append(new)
    return new


def label_artifact(
    task: AgentTask,
    path: str,
    *,
    role: str | None,
    label: str | None,
    project_root: Path | None = None,
) -> SessionArtifact | None:
    """Set role and/or label on an existing entry. No-op when the path
    isn't tracked yet — agents should label after writing.

    Pass ``project_root`` to normalize the lookup so agents can label by
    either absolute or relative form regardless of how the artifact was
    originally recorded.
    """
    existing = _find_artifact(task, path, project_root)
    if existing is None:
        return None
    existing.role = role
    existing.label = label
    return existing


def set_preview(
    task: AgentTask,
    path: str | None,
    project_root: Path,
) -> None:
    """Update task.preview_path. When path is non-None and not already
    tracked, also call record_artifact with kind='preview' so the list
    and the pointer agree. When path is None, clear the pointer without
    touching the list.
    """
    if task.ticket_id is None:
        return
    if path is None:
        task.preview_path = None
        return
    if not _is_inside(project_root, path):
        return
    rel_path = _to_relative(project_root, path)
    existing = _find_artifact(task, rel_path, project_root)
    if existing is None:
        record_artifact(task, rel_path, "preview", project_root)
    task.preview_path = rel_path
