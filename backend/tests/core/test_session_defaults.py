"""Tests for SessionDefaults (user-scoped, AppStore-backed)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.app_store import AppStore
from app.core.session_defaults import (
    COLD_START_EFFORT,
    COLD_START_MAX_TURNS,
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
        assert cfg.max_turns == COLD_START_MAX_TURNS

    def test_accepts_camel_case_input(self) -> None:
        cfg = SessionDefaults.model_validate({
            "model": "claude-haiku-4-5",
            "permissionMode": "acceptEdits",
            "effort": "low",
            "maxTurns": 20,
        })
        assert cfg.model == "claude-haiku-4-5"
        assert cfg.permission_mode == "acceptEdits"
        assert cfg.effort == "low"
        assert cfg.max_turns == 20

    def test_accepts_snake_case_input(self) -> None:
        cfg = SessionDefaults.model_validate({
            "model": "claude-haiku-4-5",
            "permission_mode": "acceptEdits",
            "effort": "low",
            "max_turns": 20,
        })
        assert cfg.permission_mode == "acceptEdits"
        assert cfg.max_turns == 20

    def test_serializes_camel_case_by_alias(self) -> None:
        cfg = SessionDefaults(
            model="claude-opus-4-7",
            permission_mode="bypassPermissions",
            effort=None,
            max_turns=100,
        )
        wire = cfg.model_dump(by_alias=True)
        assert "permissionMode" in wire
        assert "maxTurns" in wire
        assert wire["permissionMode"] == "bypassPermissions"
        assert wire["maxTurns"] == 100
        assert wire["effort"] is None


class TestLoadSessionDefaults:
    @pytest.mark.asyncio
    async def test_cold_start_when_key_absent(self, app_store: AppStore) -> None:
        cfg = await load_session_defaults(app_store)
        assert cfg.model == COLD_START_MODEL
        assert cfg.max_turns == COLD_START_MAX_TURNS

    @pytest.mark.asyncio
    async def test_round_trip(self, app_store: AppStore) -> None:
        await save_session_defaults(
            app_store,
            SessionDefaults(
                model="claude-haiku-4-5",
                permission_mode="acceptEdits",
                effort="medium",
                max_turns=10,
            ),
        )
        loaded = await load_session_defaults(app_store)
        assert loaded.model == "claude-haiku-4-5"
        assert loaded.permission_mode == "acceptEdits"
        assert loaded.effort == "medium"
        assert loaded.max_turns == 10

    @pytest.mark.asyncio
    async def test_corrupt_payload_falls_back_to_cold_start(
        self, app_store: AppStore,
    ) -> None:
        # Write garbage that isn't a valid SessionDefaults.
        await app_store.set_setting(SESSION_DEFAULTS_KEY, {"foo": "bar", "max_turns": "not-an-int"})
        cfg = await load_session_defaults(app_store)
        assert cfg.model == COLD_START_MODEL
        assert cfg.max_turns == COLD_START_MAX_TURNS
