"""Tests for SessionDefaults (user-scoped, AppStore-backed)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.app_store import AppStore
from app.core.session_defaults import (
    COLD_START_EFFORT,
    COLD_START_MODEL,
    COLD_START_PERMISSION_MODE,
    SESSION_DEFAULTS_KEY,
    SessionDefaults,
    load_session_defaults,
    save_session_defaults,
)


@pytest.fixture
async def app_store(tmp_path: Path) -> AppStore:
    store = AppStore(tmp_path)
    await store.open()
    try:
        yield store
    finally:
        await store.close()


class TestSessionDefaultsModel:
    def test_cold_start_values(self) -> None:
        cfg = SessionDefaults()
        assert cfg.model == COLD_START_MODEL
        assert cfg.permission_mode == COLD_START_PERMISSION_MODE
        assert cfg.effort == COLD_START_EFFORT

    def test_accepts_camel_case_input(self) -> None:
        cfg = SessionDefaults.model_validate({
            "model": "claude-haiku-4-5",
            "permissionMode": "acceptEdits",
            "effort": "low",
        })
        assert cfg.model == "claude-haiku-4-5"
        assert cfg.permission_mode == "acceptEdits"
        assert cfg.effort == "low"

    def test_accepts_snake_case_input(self) -> None:
        cfg = SessionDefaults.model_validate({
            "model": "claude-haiku-4-5",
            "permission_mode": "acceptEdits",
            "effort": "low",
        })
        assert cfg.permission_mode == "acceptEdits"

    def test_ignores_legacy_max_turns_field(self) -> None:
        cfg = SessionDefaults.model_validate({
            "model": "claude-haiku-4-5",
            "permissionMode": "default",
            "effort": None,
            "maxTurns": 20,
        })
        assert cfg.model == "claude-haiku-4-5"
        assert not hasattr(cfg, "max_turns")

    def test_serializes_camel_case_by_alias(self) -> None:
        cfg = SessionDefaults(
            model="claude-opus-4-7",
            permission_mode="bypassPermissions",
            effort=None,
        )
        wire = cfg.model_dump(by_alias=True)
        assert "permissionMode" in wire
        assert wire["permissionMode"] == "bypassPermissions"
        assert wire["effort"] is None
        assert "maxTurns" not in wire


class TestLoadSessionDefaults:
    @pytest.mark.asyncio
    async def test_cold_start_when_key_absent(self, app_store: AppStore) -> None:
        cfg = await load_session_defaults(app_store)
        assert cfg.model == COLD_START_MODEL

    @pytest.mark.asyncio
    async def test_round_trip(self, app_store: AppStore) -> None:
        await save_session_defaults(
            app_store,
            SessionDefaults(
                model="claude-haiku-4-5",
                permission_mode="acceptEdits",
                effort="medium",
            ),
        )
        loaded = await load_session_defaults(app_store)
        assert loaded.model == "claude-haiku-4-5"
        assert loaded.permission_mode == "acceptEdits"
        assert loaded.effort == "medium"

    @pytest.mark.asyncio
    async def test_corrupt_payload_falls_back_to_cold_start(
        self, app_store: AppStore,
    ) -> None:
        # ``model`` is typed ``str`` — an int forces ``model_validate`` to
        # raise, exercising the ``except`` branch in ``load_session_defaults``.
        await app_store.set_setting(SESSION_DEFAULTS_KEY, {"model": 123})
        cfg = await load_session_defaults(app_store)
        assert cfg.model == COLD_START_MODEL
