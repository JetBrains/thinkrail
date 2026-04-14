from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

# Bonsai repo root: in dev mode, backend/app/core/config.py → ../../../ → bonsai/
# In frozen (PyInstaller) mode, use the directory containing the executable.
if getattr(sys, 'frozen', False):
    _BONSAI_ROOT = Path(sys.executable).resolve().parent
else:
    _BONSAI_ROOT = Path(__file__).resolve().parents[3]


class ServerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BONSAI_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    backend_port: int = 8000
    backend_host: str = "0.0.0.0"


def get_data_dir() -> Path:
    """Return the server-wide data directory for SQLite and global state.

    Set ``BONSAI_DATA_DIR`` environment variable (or in ``.env``) to
    override the default ``~/.bonsai/``.
    """
    env = os.environ.get("BONSAI_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / ".bonsai"


class AppConfig(BaseModel):
    project_root: Path
    bonsai_dir: Path
    plugin_dir: Path

    def get_project_root(self) -> Path:
        """Return the project root directory."""
        return self.project_root

    def get_bonsai_dir(self) -> Path:
        """Return the path to the ``.bonsai/`` directory."""
        return self.bonsai_dir

    def get_registry_path(self) -> Path:
        """Return the path to ``.bonsai/registry.json``."""
        return self.bonsai_dir / "registry.json"


def _discover_root() -> Path:
    """Walk upward from cwd looking for a ``.bonsai/`` directory."""
    current = Path.cwd().resolve()
    for parent in [current, *current.parents]:
        if (parent / ".bonsai").is_dir():
            return parent
    return current


def load_config(project_root: Path | None = None) -> AppConfig:
    """Build an ``AppConfig`` from the given project root."""
    root = project_root or _discover_root()
    return AppConfig(
        project_root=root,
        bonsai_dir=root / ".bonsai",
        plugin_dir=_BONSAI_ROOT / "claude-plugin",
    )
