"""Project-level settings stored in ``.bonsai/settings.json``.

Provides load / save / ensure helpers and a Pydantic model describing the
schema.  Unknown keys are preserved (``extra = "allow"``) so that future
settings or user-defined entries are not silently dropped.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.core.fileio import read_text, write_text

SETTINGS_REL_PATH = ".bonsai/settings.json"


class ProjectSettings(BaseModel, extra="allow"):
    """User-configurable project settings."""

    default_model: str = "claude-opus-4-6"
    default_effort: str = "high"
    model_refresh_interval_hours: int = 24
    event_view: str = "classic"
    # User response timeout settings
    user_respond_timeout: float = 300  # seconds; 0 = wait indefinitely
    user_respond_timeout_behavior: str = "interrupt"  # "interrupt" | "deny" | "retry"
    user_respond_retry_max_attempts: int = 3  # only used when behavior = "retry"


def _settings_path(project_root: Path) -> Path:
    return project_root / SETTINGS_REL_PATH


def load_settings(project_root: Path) -> ProjectSettings:
    """Read settings from disk, returning defaults if the file is missing."""
    path = _settings_path(project_root)
    if not path.is_file():
        return ProjectSettings()
    try:
        return ProjectSettings.model_validate_json(read_text(path))
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
    path = _settings_path(project_root)
    if path.is_file():
        return load_settings(project_root)
    settings = ProjectSettings()
    write_text(path, settings.model_dump_json(indent=2) + "\n")
    return settings
