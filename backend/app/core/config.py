from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

# Two anchors are needed in frozen (PyInstaller) mode:
#   * _BUNDLE_ROOT — bundled resources (claude-plugin/, frontend dist). Lives at
#     sys._MEIPASS, which PyInstaller sets to the temp extraction dir (onefile)
#     or _internal/ (directory bundle). Looking next to the launcher misses this.
#   * _ENV_DIR — user-facing .env override. Stays next to the launcher so a user
#     can drop a .env beside the binary to override defaults.
# In dev mode both collapse to the repo root.
if getattr(sys, 'frozen', False):
    _BUNDLE_ROOT = Path(getattr(sys, '_MEIPASS', Path(sys.executable).resolve().parent))
    _ENV_DIR = Path(sys.executable).resolve().parent
else:
    _BUNDLE_ROOT = Path(__file__).resolve().parents[3]
    _ENV_DIR = _BUNDLE_ROOT


class ServerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    backend_port: int = 8000
    backend_host: str = "127.0.0.1"


def get_data_dir() -> Path:
    """Return the server-wide data directory for SQLite and global state.

    Set ``BONSAI_DATA_DIR`` environment variable (or in ``.env``) to
    override the default ``~/.bonsai/``.
    """
    env = os.environ.get("BONSAI_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / ".bonsai"


def get_index_path(project_root: Path) -> Path:
    """Compute the ``index.db`` path for a project, outside the repo.

    Returns a path under the server data directory::

        ~/.bonsai/indexes/<sha256-of-project-root>[:16]/index.db

    This follows the VS Code / Bazel pattern for per-project caches
    stored in a central location, keyed by a hash of the project path.
    The directory is created if it doesn't exist.
    """
    data_dir = get_data_dir()
    project_hash = hashlib.sha256(
        str(project_root.resolve()).encode()
    ).hexdigest()[:16]
    index_dir = data_dir / "indexes" / project_hash
    index_dir.mkdir(parents=True, exist_ok=True)
    return index_dir / "index.db"


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
        plugin_dir=_BUNDLE_ROOT / "claude-plugin",
    )
