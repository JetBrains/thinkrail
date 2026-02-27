from __future__ import annotations

from pathlib import Path


def read_text(path: Path) -> str:
    """Read and return the text contents of *path*.

    Raises ``FileNotFoundError`` if the file does not exist.
    """
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    """Write *content* to *path*, creating parent directories if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def delete_file(path: Path) -> None:
    """Delete the file at *path*.

    Raises ``FileNotFoundError`` if the file does not exist.
    """
    path.unlink()


def ensure_dir(path: Path) -> None:
    """Create *path* and all parent directories if they don't exist."""
    path.mkdir(parents=True, exist_ok=True)
