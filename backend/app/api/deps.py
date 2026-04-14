"""Common FastAPI dependencies — path validation and traversal protection."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, TYPE_CHECKING

from fastapi import Depends, HTTPException, Query, Request

if TYPE_CHECKING:
    from app.core.server_store import ServerStore
    from app.rpc.auth import UserIdentity


def valid_project_path(path: str = Query(...)) -> Path:
    """Resolve and validate a Bonsai project path.

    Raises 400 if the directory does not contain ``.bonsai/registry.json``.
    """
    p = Path(path).expanduser().resolve()
    if not (p / ".bonsai" / "registry.json").is_file():
        raise HTTPException(status_code=400, detail=f"Not a valid Bonsai project: {path}")
    return p


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


def get_server_store(request: Request) -> "ServerStore":
    """Return the server-wide ``ServerStore`` from ``app.state``."""
    return request.app.state.server_store


async def get_identity(
    store: Annotated["ServerStore", Depends(get_server_store)],
    token: str = Query(...),
) -> "UserIdentity":
    """Resolve a bearer token to a ``UserIdentity``, raising 401 if invalid."""
    from app.rpc.auth import authenticate_rest

    identity = await authenticate_rest(store, token)
    if identity is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return identity
