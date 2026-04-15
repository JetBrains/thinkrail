"""REST endpoints for user profile, preferences, recent projects, and known projects."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_identity, get_server_store
from app.api.schemas import KnownProjectResponse, RecentProjectResponse, UserProfileResponse
from app.core.server_store import ServerStore
from app.rpc.auth import UserIdentity

router = APIRouter(prefix="/api", tags=["user"])

_Store = Annotated[ServerStore, Depends(get_server_store)]
_Identity = Annotated[UserIdentity, Depends(get_identity)]


@router.get("/user/profile", response_model=UserProfileResponse)
async def get_user_profile(identity: _Identity, store: _Store) -> UserProfileResponse:
    user = await store.get_user(identity.user_id)
    return UserProfileResponse(
        userId=user.id if user else identity.user_id,
        displayName=user.display_name if user else identity.display_name,
        isAdmin=user.is_admin if user else identity.is_admin,
        createdAt=user.created_at if user else None,
    )


@router.get("/user/preferences")
async def get_user_preferences(identity: _Identity, store: _Store):
    return await store.get_preferences(identity.user_id)


@router.put("/user/preferences")
async def update_user_preferences(identity: _Identity, store: _Store, patch: dict | None = None):
    return await store.update_preferences(identity.user_id, patch or {})


@router.get("/user/recent-projects", response_model=list[RecentProjectResponse])
async def get_user_recent_projects(
    identity: _Identity,
    store: _Store,
    limit: int = Query(default=10),
) -> list[RecentProjectResponse]:
    recents = await store.get_recent_projects(identity.user_id, limit=limit)
    return [
        RecentProjectResponse(path=r.project_path, name=r.name, lastOpened=r.last_opened)
        for r in recents
    ]


@router.get("/projects/known", response_model=list[KnownProjectResponse])
async def get_known_projects(identity: _Identity, store: _Store) -> list[KnownProjectResponse]:
    projects = await store.list_projects()
    return [
        KnownProjectResponse(
            path=p.path,
            name=p.name,
            registeredAt=p.registered_at,
            lastOpenedAt=p.last_opened_at,
        )
        for p in projects
    ]
