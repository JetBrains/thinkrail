"""REST endpoints for the known-projects registry.

Bonsai is single-user and localhost-only — these endpoints are
tokenless. They expose the ``AppStore`` known-projects table for the
frontend ProjectPicker. There is no per-user view; all clients see the
same global registry.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import get_app_store
from app.core.app_store import AppStore

# ── Router ─────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/projects/known", tags=["projects"])

_Store = Annotated[AppStore, Depends(get_app_store)]


# ── Schemas ────────────────────────────────────────────────────────────

class KnownProjectResponse(BaseModel):
    path: str
    name: str
    registered_at: str
    last_opened_at: str


class _RegisterBody(BaseModel):
    path: str
    name: str


class _OkResponse(BaseModel):
    ok: bool = True


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get("", response_model=list[KnownProjectResponse])
async def list_known_projects(store: _Store) -> list[KnownProjectResponse]:
    """Return all known projects, ordered by ``last_opened_at`` DESC."""
    projects = await store.list_projects()
    return [
        KnownProjectResponse(
            path=p.path,
            name=p.name,
            registered_at=p.registered_at,
            last_opened_at=p.last_opened_at,
        )
        for p in projects
    ]


@router.post("", response_model=_OkResponse)
async def register_known_project(body: _RegisterBody, store: _Store) -> _OkResponse:
    """Register or update a project (idempotent upsert)."""
    resolved = Path(body.path).expanduser().resolve()
    if not resolved.is_absolute() or not resolved.is_dir():
        raise HTTPException(status_code=422, detail="path must be an existing directory")
    await store.register_project(str(resolved), body.name)
    return _OkResponse()


@router.delete("", response_model=_OkResponse)
async def remove_known_project(
    store: _Store,
    path: str = Query(...),
) -> _OkResponse:
    """Remove a project from the registry by ``path``."""
    resolved = Path(path).expanduser().resolve()
    await store.remove_project(str(resolved))
    return _OkResponse()
