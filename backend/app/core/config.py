from __future__ import annotations

import hashlib
import os
import socket
import sys
from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

# User-facing product name.  Single source of truth for window titles, CLI
# banners, and any string shown to a human.
PRODUCT_NAME = "ThinkRail"

# Lowercase technical slug used to namespace MCP servers, env vars, and the
# user config dir.  Kept separate from ``PRODUCT_NAME`` so renaming the display
# name never silently changes protocol identifiers or on-disk paths.
APP_SLUG = "thinkrail"
# Prefix for this app's own MCP server names (e.g. ``thinkrail-vis``).
MCP_PREFIX = f"{APP_SLUG}-"
# Prefix for environment variables (e.g. ``THINKRAIL_DATA_DIR``).
ENV_PREFIX = f"{APP_SLUG.upper()}_"
# Name of the per-user config dir under ``~/.config/`` (update metadata, etc.).
CONFIG_DIRNAME = APP_SLUG

# Installer metadata written by ``install.sh`` (channel, version, prefix,
# analytics opt-out). Read by the self-upgrade path and by analytics seeding.
INSTALL_METADATA_PATH = Path.home() / ".config" / CONFIG_DIRNAME / "install.json"

# Probe up to +PORT_PROBE_RANGE from the requested port when it's busy. Matches
# the developer-facing run.sh preflight so the standalone binary and the dev
# shell script use the same fallback window.
PORT_PROBE_RANGE = 10

# Name of the per-project meta directory.  Single source of truth — every
# join like ``project_root / PROJECT_DIRNAME / ...`` should reference this
# constant, never a string literal.
PROJECT_DIRNAME = ".tr"

# Name of the server-wide data dir under ``~/`` (SQLite + global state).
DATA_DIRNAME = ".tr"

# Subdirectories under ``project_root / .tr / ...``.  Use these instead
# of string literals so that any future rename happens in one place.
SESSIONS_DIR = "sessions"
TICKETS_DIR = "tickets"
TRASH_DIR = "trash"
CACHE_DIR = "cache"
IMPLEMENTATION_TASKS_DIR = "implementation_tasks"
DESIGN_DOCS_DIR = "design_docs"
# Legacy: retained as no-op constants so old trash data can still be listed/purged.
# No new code should write under these paths.
PLANS_DIR = "plans"
SPEC_DRAFTS_DIR = "spec-drafts"
SPEC_PATCHES_DIR = "spec-patches"

# Subdirectory under the server-wide data dir (``~/.tr/indexes/...``).
INDEXES_DIR = "indexes"

# Well-known filenames inside ``.tr/`` (or its subdirectories).
SETTINGS_FILE = "settings.json"
INDEX_DB_FILE = "index.db"
APP_DB_FILE = "tr.db"
# Manifest tracking spec-draft entries inside ``spec-drafts/<ticket>/``.
MANIFEST_FILE = "manifest.json"
# Sidecar written next to each trashed item describing the original location.
TRASH_SIDECAR_FILE = "_trash.json"
# Project-root ignore file (gitignore-style) listing paths to hide from spec
# indexing and the file tree.
HIDE_FILE = f".{APP_SLUG}hide"

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

    Set the ``THINKRAIL_DATA_DIR`` environment variable (or in ``.env``) to
    override the default ``~/.tr/``.
    """
    env = os.environ.get(f"{ENV_PREFIX}DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / DATA_DIRNAME


def get_index_path(project_root: Path) -> Path:
    """Compute the ``index.db`` path for a project, outside the repo.

    Returns a path under the server data directory::

        ~/.tr/indexes/<sha256-of-project-root>[:16]/index.db

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
    thinkrail_dir: Path
    plugin_dir: Path

    def get_project_root(self) -> Path:
        """Return the project root directory."""
        return self.project_root

    def get_thinkrail_dir(self) -> Path:
        """Return the path to the ``.tr/`` directory."""
        return self.thinkrail_dir


def _discover_root() -> Path:
    """Walk upward from cwd looking for a project meta directory."""
    current = Path.cwd().resolve()
    for parent in [current, *current.parents]:
        if (parent / PROJECT_DIRNAME).is_dir():
            return parent
    return current


def load_config(project_root: Path | None = None) -> AppConfig:
    """Build an ``AppConfig`` from the given project root."""
    root = project_root or _discover_root()
    return AppConfig(
        project_root=root,
        thinkrail_dir=root / PROJECT_DIRNAME,
        plugin_dir=_BUNDLE_ROOT / "claude-plugin",
    )
