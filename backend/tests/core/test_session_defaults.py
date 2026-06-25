"""Tests for SessionDefaults (user-scoped, AppStore-backed)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.agent.runtime import RuntimeFlag
from app.core.app_store import AppStore
from app.core.session_defaults import (
    COLD_START_EFFORT,
    COLD_START_MODEL,
    COLD_START_PERMISSION_MODE,
    SESSION_DEFAULTS_KEY,
    SessionDefaults,
    _cold_start_defaults,
    load_session_defaults,
    save_session_defaults,
)


def _flag(key: str, default: bool) -> RuntimeFlag:
    return RuntimeFlag(key=key, label=key, type="boolean", default=default)


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
            effort="high",
        )
        wire = cfg.model_dump(by_alias=True)
        assert "permissionMode" in wire
        assert wire["permissionMode"] == "bypassPermissions"
        assert wire["effort"] == "high"
        assert "maxTurns" not in wire

    def test_legacy_null_effort_coerced_to_auto(self) -> None:
        # Old persisted records stored ``effort: null``; the before-validator
        # maps it to the neutral ``"auto"`` so they load cleanly.
        cfg = SessionDefaults.model_validate({"effort": None})
        assert cfg.effort == "auto"


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


class TestColdStartSeeding:
    @pytest.mark.asyncio
    async def test_seeds_declared_flags_at_their_defaults(
        self, app_store: AppStore,
    ) -> None:
        cfg = await load_session_defaults(app_store, [_flag("context1m", True)])
        assert cfg.flags == {"context1m": True}

    @pytest.mark.asyncio
    async def test_cold_start_persists_the_record_once(
        self, app_store: AppStore,
    ) -> None:
        await load_session_defaults(app_store, [_flag("context1m", True)])
        raw = await app_store.get_setting(SESSION_DEFAULTS_KEY)
        assert raw is not None
        assert raw["flags"] == {"context1m": True}

    @pytest.mark.asyncio
    async def test_existing_record_returned_verbatim(
        self, app_store: AppStore,
    ) -> None:
        # A stored record is authoritative — no implicit flag fill once it
        # exists, even if a runtime declares a default-on flag.
        await app_store.set_setting(
            SESSION_DEFAULTS_KEY, {"model": "claude-opus-4-8", "flags": {}},
        )
        cfg = await load_session_defaults(app_store, [_flag("context1m", True)])
        assert cfg.flags == {}


class TestSaveStoresVerbatim:
    @pytest.mark.asyncio
    async def test_save_does_not_fill_flags(self, app_store: AppStore) -> None:
        await save_session_defaults(app_store, SessionDefaults(flags={}))
        raw = await app_store.get_setting(SESSION_DEFAULTS_KEY)
        assert raw["flags"] == {}

    @pytest.mark.asyncio
    async def test_save_keeps_given_flags(self, app_store: AppStore) -> None:
        await save_session_defaults(
            app_store, SessionDefaults(flags={"context1m": False}),
        )
        raw = await app_store.get_setting(SESSION_DEFAULTS_KEY)
        assert raw["flags"] == {"context1m": False}


class TestDefaultModelOverride:
    def test_cold_start_uses_supplied_default_model(self) -> None:
        d = _cold_start_defaults((), default_model="claude-sonnet-4-6")
        assert d.model == "claude-sonnet-4-6"

    def test_cold_start_falls_back_to_constant_when_none(self) -> None:
        assert _cold_start_defaults(()).model == COLD_START_MODEL

    @pytest.mark.asyncio
    async def test_load_seeds_supplied_default_model(self, app_store: AppStore) -> None:
        cfg = await load_session_defaults(app_store, (), default_model="claude-sonnet-4-6")
        assert cfg.model == "claude-sonnet-4-6"
