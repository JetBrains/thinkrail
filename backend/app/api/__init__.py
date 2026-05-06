"""REST API — registers all routers and exception handlers on the FastAPI app."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI
    from app.core.app_store import AppStore


def setup(app: "FastAPI", app_store: "AppStore") -> None:
    """Register all REST routers and exception handlers."""
    from app.api.errors import register_handlers
    from app.api.routers.files import router as files_router
    from app.api.routers.fs import router as fs_router
    from app.api.routers.project import router as project_router
    from app.api.routers.projects_known import router as projects_known_router
    from app.api.routers.server_info import router as server_info_router

    app.state.app_store = app_store

    register_handlers(app)
    app.include_router(projects_known_router)
    app.include_router(project_router)
    app.include_router(files_router)
    app.include_router(fs_router)
    app.include_router(server_info_router)
