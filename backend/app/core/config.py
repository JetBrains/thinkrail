from __future__ import annotations

import hashlib
import os
import socket
import sys
from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

# Probe up to +PORT_PROBE_RANGE from the requested port when it's busy. Matches
# the developer-facing run.sh preflight so the standalone binary and the dev
# shell script use the same fallback window.
PORT_PROBE_RANGE = 10

# Name of the per-project meta directory (also reused as the server-wide
# data dir name under ``~/``).  Single source of truth — every join like
# ``project_root / ".bonsai" / ...`` should reference this constant.
BONSAI_DIRNAME = ".bonsai"

# Subdirectories under ``project_root / .bonsai / ...``.  Use these instead
# of string literals so that any future rename happens in one place.
SESSIONS_DIR = "sessions"
PLANS_DIR = "plans"
META_TICKETS_DIR = "meta-tickets"
SPEC_DRAFTS_DIR = "spec-drafts"
SPEC_PATCHES_DIR = "spec-patches"
TRASH_DIR = "trash"
CACHE_DIR = "cache"
IMPLEMENTATION_TASKS_DIR = "implementation_tasks"
DESIGN_DOCS_DIR = "design_docs"

# Subdirectory under the server-wide data dir (``~/.bonsai/indexes/...``).
INDEXES_DIR = "indexes"

# Well-known filenames inside ``.bonsai/`` (or its subdirectories).
SETTINGS_FILE = "settings.json"
INDEX_DB_FILE = "index.db"
APP_DB_FILE = "bonsai.db"
MODELS_CACHE_FILE = "models.json"
# Manifest tracking spec-draft entries inside ``spec-drafts/<ticket>/``.
MANIFEST_FILE = "manifest.json"
# Sidecar written next to each trashed item describing the original location.
TRASH_SIDECAR_FILE = "_trash.json"

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


def find_free_port(
    start: int,
    host: str = "127.0.0.1",
    probe_range: int = PORT_PROBE_RANGE,
) -> int:
    """Return the first bindable TCP port in ``[start, start + probe_range]``.

    Raises ``OSError`` if every port in the range is occupied. There is a
    small TOCTOU window between probing and the caller's subsequent bind —
    acceptable here because the only failure mode is uvicorn raising on
    startup, which is the existing pre-fix behaviour.
    """
    last_err: OSError | None = None
    for port in range(start, start + probe_range + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            # Match uvicorn's bind semantics: it sets reuse_address=True on
            # POSIX. Without this, a port lingering in TIME_WAIT would look
            # busy to us but bindable to uvicorn, advancing the port number
            # for no reason on fast restarts.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
            except OSError as exc:
                last_err = exc
                continue
            return port
    raise OSError(
        f"No free port between {start} and {start + probe_range} on {host}"
    ) from last_err


def get_data_dir() -> Path:
    """Return the server-wide data directory for SQLite and global state.

    Set ``BONSAI_DATA_DIR`` environment variable (or in ``.env``) to
    override the default ``~/.bonsai/``.
    """
    env = os.environ.get("BONSAI_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / BONSAI_DIRNAME


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
    index_dir = data_dir / INDEXES_DIR / project_hash
    index_dir.mkdir(parents=True, exist_ok=True)
    return index_dir / INDEX_DB_FILE


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
        if (parent / BONSAI_DIRNAME).is_dir():
            return parent
    return current


def load_config(project_root: Path | None = None) -> AppConfig:
    """Build an ``AppConfig`` from the given project root."""
    root = project_root or _discover_root()
    return AppConfig(
        project_root=root,
        bonsai_dir=root / BONSAI_DIRNAME,
        plugin_dir=_BUNDLE_ROOT / "claude-plugin",
    )
