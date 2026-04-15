from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import setup as setup_api
from app.core.config import get_data_dir
from app.core.server_store import ServerStore
from app.rpc.server import register_routes


def _find_frontend_dist() -> Path | None:
    if getattr(sys, 'frozen', False):
        dist = Path(getattr(sys, '_MEIPASS', '')) / "frontend_dist"
    else:
        dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return dist if dist.is_dir() else None


def create_app() -> FastAPI:
    """Create and configure the Bonsai FastAPI application."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")

    server_store = ServerStore(get_data_dir())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await server_store.open()

        async def _purge_loop() -> None:
            from app.core.config import load_config
            from app.core.settings import load_settings
            from app.trash.service import TrashService

            while True:
                try:
                    cfg = load_config()
                    settings = load_settings(cfg.get_project_root())
                    days = settings.trash_retention_days
                    if days and days > 0:
                        TrashService(cfg.get_project_root()).auto_purge(days)
                except Exception:
                    logging.getLogger(__name__).debug("Auto-purge tick failed", exc_info=True)
                await asyncio.sleep(3600)

        purge_task = asyncio.create_task(_purge_loop())
        try:
            yield
        finally:
            purge_task.cancel()
            await server_store.close()

    app = FastAPI(title="Bonsai", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    setup_api(app, server_store)
    register_routes(app, server_store=server_store)

    frontend_dist = _find_frontend_dist()
    if frontend_dist:
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return app


if __name__ == "__main__":
    import uvicorn
    from app.core.config import ServerSettings

    srv = ServerSettings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=srv.backend_host,
        port=srv.backend_port,
    )
