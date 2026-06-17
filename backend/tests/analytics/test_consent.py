from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.analytics import consent
from app.analytics.consent import (
    ANALYTICS_KEY,
    get_status,
    load_consent,
    opt_in,
    opt_out,
    save_consent,
)
from app.analytics.models import AnalyticsConsent
from app.core.app_store import AppStore


class TestPersistence:
    async def test_round_trip(self, app_store: AppStore) -> None:
        await save_consent(app_store, AnalyticsConsent(enabled=True, installation_id="abc"))
        loaded = await load_consent(app_store)
        assert loaded is not None
        assert loaded.enabled is True
        assert loaded.installation_id == "abc"

    async def test_load_missing_returns_none(self, app_store: AppStore) -> None:
        assert await load_consent(app_store) is None

    async def test_corrupt_payload_treated_as_miss(self, app_store: AppStore) -> None:
        await app_store.set_setting(ANALYTICS_KEY, {"enabled": {"not": "a bool"}})
        assert await load_consent(app_store) is None


class TestMutations:
    async def test_opt_in_mints_id_and_enables(self, app_store: AppStore) -> None:
        installation_id = await opt_in(app_store)
        assert installation_id
        record = await load_consent(app_store)
        assert record is not None
        assert record.enabled is True
        assert record.installation_id == installation_id

    async def test_opt_out_clears_id_and_disables(self, app_store: AppStore) -> None:
        await opt_in(app_store)
        await opt_out(app_store)
        record = await load_consent(app_store)
        assert record is not None
        assert record.enabled is False
        assert record.installation_id is None

    async def test_reenable_mints_fresh_id(self, app_store: AppStore) -> None:
        first = await opt_in(app_store)
        await opt_out(app_store)
        second = await opt_in(app_store)
        assert first != second


class TestStatus:
    async def test_default_posture_when_absent(self, app_store: AppStore) -> None:
        status = await get_status(app_store)
        assert status.enabled is True
        assert status.installation_id is None

    async def test_returns_stored_record(self, app_store: AppStore) -> None:
        await opt_out(app_store)
        status = await get_status(app_store)
        assert status.enabled is False


class TestRunCli:
    def test_enable_then_status(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # run_cli is sync (asyncio.run) and opens its own AppStore via get_data_dir.
        monkeypatch.setattr(consent, "get_data_dir", lambda: tmp_path)
        assert consent.run_cli("enable") == 0
        assert consent.run_cli("status") == 0
        out = capsys.readouterr().out
        assert "enabled" in out

        async def _stored() -> AnalyticsConsent | None:
            store = AppStore(tmp_path)
            await store.open()
            try:
                return await load_consent(store)
            finally:
                await store.close()

        record = asyncio.run(_stored())
        assert record is not None and record.enabled is True and record.installation_id
