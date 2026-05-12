"""Lazy auto-creation of ``.bonsai/`` meta-files and subdirectories.

Every known meta-file has a default-content factory.  When any code path
reads a meta-file via :func:`ensure_meta_file`, the file is created with
sensible defaults if it does not yet exist on disk.

The ``.bonsai/`` directory itself is never created eagerly — it appears
on disk only when a writer calls :func:`ensure_meta_file` or
:func:`ensure_meta_dir` for the first time.  Empty / pre-init project
folders stay clean until the user actually starts working.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from app.core.config import SETTINGS_FILE
from app.core.fileio import ensure_dir, read_text, write_text

# ---------------------------------------------------------------------------
# Default-content factories
# ---------------------------------------------------------------------------
# Each callable receives the ``.bonsai/`` directory and returns the file
# content as a string.


def _default_settings(bonsai_dir: Path) -> str:
    # Lazy import to avoid circular dependency with settings.py
    from app.core.settings import ProjectSettings

    return ProjectSettings().model_dump_json(indent=2) + "\n"


_DEFAULT_FACTORIES: dict[str, Callable[[Path], str]] = {
    SETTINGS_FILE: _default_settings,
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def ensure_meta_file(bonsai_dir: Path, rel_path: str) -> str:
    """Read ``.bonsai/{rel_path}`` if it exists; create it with defaults otherwise.

    Returns the file content (existing or freshly generated).
    Raises :class:`ValueError` if *rel_path* is not a known meta-file.
    """
    file_path = bonsai_dir / rel_path
    if file_path.is_file():
        return read_text(file_path)

    factory = _DEFAULT_FACTORIES.get(rel_path)
    if factory is None:
        raise ValueError(f"Unknown meta-file: {rel_path}")

    content = factory(bonsai_dir)
    write_text(file_path, content)
    return content


def ensure_meta_dir(bonsai_dir: Path, name: str) -> Path:
    """Ensure ``.bonsai/{name}/`` exists.  Returns the directory path."""
    dir_path = bonsai_dir / name
    ensure_dir(dir_path)
    return dir_path
