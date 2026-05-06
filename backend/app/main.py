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
from starlette.exceptions import HTTPException as StarletteHTTPException


class _SPAStaticFiles(StaticFiles):
    """StaticFiles with SPA fallback: unknown non-API paths return index.html
    so client-side routes (e.g. /login, /board/...) survive direct loads
    and refreshes. Unknown paths under api/ keep their real 404."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api/"):
                return await super().get_response("index.html", scope)
            raise

from app.api import setup as setup_api
from app.core.config import get_data_dir
from app.core.app_store import AppStore
from app.rpc.server import register_routes


def _export_openapi_schema(app: FastAPI) -> None:
    """Write openapi.json next to the frontend sources for code generation."""
    import json
    # Only write in development (not when bundled as a frozen executable)
    if getattr(sys, 'frozen', False):
        return
    schema_path = Path(__file__).resolve().parents[2] / "frontend" / "openapi.json"
    try:
        schema_path.write_text(json.dumps(app.openapi(), indent=2))
    except Exception:
        logging.getLogger(__name__).debug("Could not write openapi.json", exc_info=True)


def _find_frontend_dist() -> Path | None:
    if getattr(sys, 'frozen', False):
        dist = Path(getattr(sys, '_MEIPASS', '')) / "frontend_dist"
    else:
        dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return dist if dist.is_dir() else None


def create_app() -> FastAPI:
    """Create and configure the Bonsai FastAPI application."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")

    app_store = AppStore(get_data_dir())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await app_store.open()

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
            await app_store.close()

    app = FastAPI(title="Bonsai", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    setup_api(app, app_store)
    register_routes(app, app_store=app_store)

    _export_openapi_schema(app)

    frontend_dist = _find_frontend_dist()
    if frontend_dist:
        app.mount("/", _SPAStaticFiles(directory=frontend_dist, html=True), name="frontend")

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
