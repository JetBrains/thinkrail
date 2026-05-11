"""Project-level settings stored in ``.bonsai/settings.json``.

Provides load / save / ensure helpers and a Pydantic model describing the
schema.  Unknown keys are preserved (``extra = "allow"``) so that future
settings or user-defined entries are not silently dropped.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.core.config import BONSAI_DIRNAME
from app.core.fileio import write_text

SETTINGS_REL_PATH = f"{BONSAI_DIRNAME}/settings.json"


class ProjectSettings(BaseModel, extra="allow"):
    """User-configurable project settings."""

    default_model: str = "claude-opus-4-6"
    default_effort: str = "high"
    model_refresh_interval_hours: int = 24
    event_view: str = "classic"
    # Font scale settings
    font_size: int = 13  # base font size in px (normal view)
    compact_font_size: int = 9  # base font size in px (compact view)
    # User response timeout settings
    user_respond_timeout: float = 300  # seconds; 0 = wait indefinitely
    user_respond_timeout_behavior: str = "interrupt"  # "interrupt" | "deny" | "retry"
    user_respond_retry_max_attempts: int = 3  # only used when behavior = "retry"
    # Trash auto-purge
    trash_retention_days: int = 30  # 0 or null to disable auto-purge
    # Voice input revise behavior
    voice_revise_mode: str = "off"  # "auto" | "subsession" | "off"


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
    content = ensure_meta_file(bonsai_dir, "settings.json")
    try:
        return ProjectSettings.model_validate_json(content)
    except Exception:
        return ProjectSettings()
