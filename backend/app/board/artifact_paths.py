"""Path helpers for per-ticket artifact files under ``.tr/tickets/``.

Each ticket gets a folder keyed by stable ID (``mt_xxxxxxxx``); the four
brainstorm artifacts live inside.
"""
from __future__ import annotations

from pathlib import Path

from app.board.models import ArtifactKind
from app.core.config import PROJECT_DIRNAME, TICKETS_DIR

ARTIFACT_FILENAMES: dict[ArtifactKind, str] = {
    "product_design": "product-design.md",
    "technical_design": "technical-design.md",
    "history": "history.patch",
    "implementation_plan": "implementation-plan.md",
}

# Legacy filename for the all-time amendment log. Renamed to "history.patch"
# because the file contains amendments from every phase, not only the
# amend-specs phase. Auto-migration happens in storage._reconcile_with_disk.
LEGACY_HISTORY_FILENAME = "spec-diff.patch"


def ticket_dir(project_root: Path, ticket_id: str) -> Path:
    return project_root / PROJECT_DIRNAME / TICKETS_DIR / ticket_id


def artifact_path(project_root: Path, ticket_id: str, kind: ArtifactKind) -> Path:
    return ticket_dir(project_root, ticket_id) / ARTIFACT_FILENAMES[kind]


def ensure_ticket_dir(project_root: Path, ticket_id: str) -> Path:
    """Idempotent: create the per-ticket folder if missing, return its path."""
    d = ticket_dir(project_root, ticket_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


_FILENAME_TO_KIND: dict[str, ArtifactKind] = {
    filename: kind for kind, filename in ARTIFACT_FILENAMES.items()
}


def resolve_ticket_artifact(
    project_root: Path, file_path: str,
) -> tuple[str, ArtifactKind] | None:
    """Return (ticket_id, kind) when ``file_path`` is a per-ticket artifact.

    Matches paths shaped ``<meta-dir>/tickets/<id>/<known-artifact-filename>``.
    """
    try:
        rel = (project_root / file_path).resolve().relative_to(project_root.resolve())
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) != 4 or parts[0] != PROJECT_DIRNAME or parts[1] != TICKETS_DIR:
        return None
    kind = _FILENAME_TO_KIND.get(parts[3])
    if kind is None:
        return None
    return parts[2], kind
