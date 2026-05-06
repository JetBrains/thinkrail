"""Tests for the tokenless ``/api/projects/known`` REST endpoints."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.api import setup as setup_api
from app.core.app_store import AppStore


@pytest.fixture
def app_with_store(tmp_path: Path) -> FastAPI:
    """Build a FastAPI app whose AppStore is opened/closed by the test
    lifespan, mirroring how ``create_app`` wires it in production.
    """
    store = AppStore(tmp_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await store.open()
        try:
            yield
        finally:
            await store.close()

    app = FastAPI(lifespan=lifespan)
    setup_api(app, store)
    return app


@pytest.fixture
def client(app_with_store: FastAPI) -> TestClient:
    # ``with TestClient(...)`` runs the lifespan so the AppStore opens.
    with TestClient(app_with_store) as c:
        yield c


# ── GET ────────────────────────────────────────────────────────────────


class TestGetKnownProjects:
    def test_returns_empty_list_when_none_registered(self, client: TestClient) -> None:
        resp = client.get("/api/projects/known")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_registered_projects_ordered_by_last_opened(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        proj1 = tmp_path / "proj1"
        proj2 = tmp_path / "proj2"
        proj1.mkdir()
        proj2.mkdir()
        client.post("/api/projects/known", json={"path": str(proj1), "name": "proj1"})
        time.sleep(0.002)  # ensure proj2 gets a later last_opened_at
        client.post("/api/projects/known", json={"path": str(proj2), "name": "proj2"})

        resp = client.get("/api/projects/known")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        # proj2 was registered most recently → first in the list.
        assert body[0]["path"] == str(proj2.resolve())
        assert body[0]["name"] == "proj2"
        assert "registered_at" in body[0]
        assert "last_opened_at" in body[0]


# ── POST ───────────────────────────────────────────────────────────────


class TestPostKnownProject:
    def test_register_creates_entry(self, client: TestClient, tmp_path: Path) -> None:
        proj = tmp_path / "foo"
        proj.mkdir()
        resp = client.post(
            "/api/projects/known", json={"path": str(proj), "name": "foo"}
        )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        listing = client.get("/api/projects/known").json()
        assert len(listing) == 1
        assert listing[0]["path"] == str(proj.resolve())
        assert listing[0]["name"] == "foo"

    def test_register_is_idempotent(self, client: TestClient, tmp_path: Path) -> None:
        proj = tmp_path / "foo"
        proj.mkdir()
        client.post("/api/projects/known", json={"path": str(proj), "name": "foo"})
        client.post(
            "/api/projects/known", json={"path": str(proj), "name": "foo-renamed"}
        )

        listing = client.get("/api/projects/known").json()
        assert len(listing) == 1
        assert listing[0]["path"] == str(proj.resolve())
        assert listing[0]["name"] == "foo-renamed"

    def test_register_rejects_missing_fields(self, client: TestClient) -> None:
        resp = client.post("/api/projects/known", json={"path": "/tmp/foo"})
        assert resp.status_code == 422


# ── DELETE ─────────────────────────────────────────────────────────────


class TestDeleteKnownProject:
    def test_delete_removes_entry(self, client: TestClient) -> None:
        client.post("/api/projects/known", json={"path": "/tmp/foo", "name": "foo"})
        resp = client.delete("/api/projects/known", params={"path": "/tmp/foo"})
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        listing = client.get("/api/projects/known").json()
        assert listing == []

    def test_delete_unknown_path_is_noop(self, client: TestClient) -> None:
        resp = client.delete(
            "/api/projects/known", params={"path": "/tmp/never-registered"}
        )
        assert resp.status_code == 200

    def test_delete_requires_path_query_param(self, client: TestClient) -> None:
        resp = client.delete("/api/projects/known")
        assert resp.status_code == 422


# ── Tokenless guarantee ────────────────────────────────────────────────


class TestNoTokenRequired:
    """Strongest evidence the endpoint surface is auth-free: every
    operation must succeed without any ``Authorization`` header and
    without a ``?token=`` query parameter.
    """

    def test_all_operations_work_without_token(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        proj = tmp_path / "x"
        proj.mkdir()

        # GET
        get_resp = client.get("/api/projects/known")
        assert get_resp.status_code == 200
        assert "Authorization" not in get_resp.request.headers
        assert "token" not in (get_resp.request.url.query or "")

        # POST
        post_resp = client.post(
            "/api/projects/known", json={"path": str(proj), "name": "x"}
        )
        assert post_resp.status_code == 200
        assert "Authorization" not in post_resp.request.headers
        assert "token" not in (post_resp.request.url.query or "")

        # GET again confirms the registered entry
        listing = client.get("/api/projects/known").json()
        assert len(listing) == 1

        # DELETE
        del_resp = client.delete(
            "/api/projects/known", params={"path": str(proj)}
        )
        assert del_resp.status_code == 200
        assert "Authorization" not in del_resp.request.headers
