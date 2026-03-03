from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.core.config import AppConfig, load_config
from app.rpc.server import register_routes, start_watcher, stop_watcher


def create_app(project_root: str | None = None) -> FastAPI:
    """Create and configure the Bonsai FastAPI application."""
    from pathlib import Path

    root = Path(project_root) if project_root else None
    config = load_config(project_root=root)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        handle = await start_watcher(config)
        yield
        await stop_watcher(handle)

    app = FastAPI(title="Bonsai", lifespan=lifespan)
    register_routes(app, config)
    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
    )
