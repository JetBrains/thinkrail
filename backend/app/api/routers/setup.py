"""REST endpoints for first-user bootstrap setup (no auth required)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.deps import get_server_store
from app.api.schemas import SetupResponse, SetupStatusResponse
from typing import Annotated
from fastapi import Depends
from app.core.server_store import ServerStore

router = APIRouter(prefix="/api/setup", tags=["setup"])

_Store = Annotated[ServerStore, Depends(get_server_store)]


class _SetupBody(BaseModel):
    userId: str
    name: str


@router.get("/status", response_model=SetupStatusResponse)
async def setup_status(store: _Store) -> SetupStatusResponse:
    count = await store.user_count()
    return SetupStatusResponse(needsSetup=count == 0)


@router.post("", response_model=SetupResponse)
async def setup_first_user(body: _SetupBody, store: _Store) -> SetupResponse | JSONResponse:
    count = await store.user_count()
    if count > 0:
        return JSONResponse(status_code=403, content={"error": "Setup already completed"})
    user = await store.create_user(body.userId, body.name, is_admin=True)
    token = await store.create_token(body.userId)
    return SetupResponse(userId=user.id, displayName=user.display_name, token=token)
