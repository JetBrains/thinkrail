"""Project-level settings stored in ``.bonsai/settings.json``.

Provides load / save / ensure helpers and a Pydantic model describing the
schema.  Unknown keys are preserved (``extra = "allow"``) so that future
settings or user-defined entries are not silently dropped.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import BONSAI_DIRNAME, SETTINGS_FILE
from app.core.fileio import write_text

SETTINGS_REL_PATH = f"{BONSAI_DIRNAME}/{SETTINGS_FILE}"


SubagentFailurePolicy = Literal["fail-fast", "wait-all"]


class TicketsSettings(BaseModel, extra="allow"):
    """Settings under the ``tickets`` namespace."""

    model_config = ConfigDict(populate_by_name=True)

    subagent_failure_policy: SubagentFailurePolicy = Field(
        default="fail-fast", alias="subagentFailurePolicy",
    )

    @field_validator("subagent_failure_policy", mode="before")
    @classmethod
    def _coerce_unknown_to_default(cls, value: object) -> object:
        """Unknown / invalid values fall back to the default rather than 422."""
        if value in ("fail-fast", "wait-all"):
            return value
        return "fail-fast"


class ProjectSettings(BaseModel, extra="allow"):
    """Per-project settings stored in ``.bonsai/settings.json``."""

    event_view: str = "classic"
    # Font scale settings
    font_size: int = 13  # base font size in px (normal view)
    compact_font_size: int = 9  # base font size in px (compact view)
    # Voice input revise behavior
    voice_revise_mode: str = "off"  # "auto" | "subsession" | "off"
    # Ticket-implement subagent execution mode (see TICKET_LIFECYCLE_DESIGN.md
    # § Implementation orchestration modes).
    tickets: TicketsSettings = Field(default_factory=TicketsSettings)


def _settings_path(project_root: Path) -> Path:
    return project_root / SETTINGS_REL_PATH


def load_settings(project_root: Path) -> ProjectSettings:
    """Return settings from disk, or defaults if the file is missing.

    Read-only — never creates ``.bonsai/settings.json``.  Use
    :func:`ensure_settings_file` or :func:`save_settings` to materialize.
    """
    path = _settings_path(project_root)
    if not path.is_file():
        return ProjectSettings()
    try:
        return ProjectSettings.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return ProjectSettings()


def save_settings(project_root: Path, data: dict[str, Any]) -> ProjectSettings:
    """Validate *data*, write to disk, and return the resulting model."""
    settings = ProjectSettings.model_validate(data)
    path = _settings_path(project_root)
    write_text(path, settings.model_dump_json(indent=2) + "\n")
    return settings


def ensure_settings_file(project_root: Path) -> ProjectSettings:
    """Create the settings file with defaults if it doesn't exist yet."""
    from app.core.project import ensure_meta_file

    bonsai_dir = project_root / BONSAI_DIRNAME
    content = ensure_meta_file(bonsai_dir, SETTINGS_FILE)
    try:
        return ProjectSettings.model_validate_json(content)
    except Exception:
        return ProjectSettings()
