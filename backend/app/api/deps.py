"""Common FastAPI dependencies — path validation and traversal protection."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import HTTPException, Query, Request

if TYPE_CHECKING:
    from app.core.app_store import AppStore


def valid_file_in_project(
    project: str = Query(...),
    path: str = Query(...),
) -> tuple[Path, Path]:
    """Resolve a relative *path* inside *project*, preventing path traversal.

    Returns ``(project_root, absolute_file_path)``.

    Raises 400 if the resolved file path escapes the project root.
    """
    root = Path(project).expanduser().resolve()
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    return root, resolved


def get_app_store(request: Request) -> "AppStore":
    """Return the app-wide ``AppStore`` from ``app.state``."""
    return request.app.state.app_store
