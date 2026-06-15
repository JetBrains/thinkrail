"""Tests for the ``/api/fs`` filesystem utility endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from starlette.testclient import TestClient

from app.api.routers import fs as fs_router
from app.core.config import PRODUCT_NAME


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(fs_router.router)
    return app


class TestDefaultRoot:
    def test_returns_home_product_dir(self) -> None:
        client = TestClient(_app())
        resp = client.get("/api/fs/default-root")
        assert resp.status_code == 200
        assert resp.json() == {"root": str(Path.home() / PRODUCT_NAME)}
