"""Path helpers for per-ticket artifact files under ``.bonsai/tickets/``.

Each ticket gets a folder keyed by stable ID (``mt_xxxxxxxx``); the four
brainstorm artifacts live inside.
"""
from __future__ import annotations

from pathlib import Path

from app.board.models import ArtifactKind

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
    return project_root / ".bonsai" / "tickets" / ticket_id


def artifact_path(project_root: Path, ticket_id: str, kind: ArtifactKind) -> Path:
    return ticket_dir(project_root, ticket_id) / ARTIFACT_FILENAMES[kind]


def ensure_ticket_dir(project_root: Path, ticket_id: str) -> Path:
    """Idempotent: create the per-ticket folder if missing, return its path."""
    d = ticket_dir(project_root, ticket_id)
    d.mkdir(parents=True, exist_ok=True)
    return d
