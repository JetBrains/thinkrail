from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.analytics import consent, service
from app.analytics.models import (
    AnalyticsConsent,
    AppStartedEvent,
    BoardViewedEvent,
    SpecsViewedEvent,
    UpgradeStartedEvent,
)
from app.core.app_store import AppStore


def _events(sent: MagicMock) -> list[str]:
    """The ``event`` discriminator of each payload handed to the sink."""
    return [call.args[0]["event"] for call in sent.call_args_list]


class TestInitialize:
    async def test_fresh_install_seeds_enabled_and_emits(
        self, app_store: AppStore, sent: MagicMock
    ) -> None:
        await service.initialize(app_store)

        record = await consent.load_consent(app_store)
        assert record is not None and record.enabled and record.installation_id
        assert _events(sent) == ["app_installed", "app_started"]

    async def test_app_installed_only_on_first_run(
        self, app_store: AppStore, sent: MagicMock
    ) -> None:
        await service.initialize(app_store)
        sent.reset_mock()
        await service.initialize(app_store)
        assert _events(sent) == ["app_started"]

    async def test_no_analytics_install_seeds_disabled_no_network(
        self, app_store: AppStore, sent: MagicMock,
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        meta = tmp_path / "install.json"
        meta.write_text(json.dumps({"analytics": False}))
        monkeypatch.setattr(service, "INSTALL_METADATA_PATH", meta)

        await service.initialize(app_store)

        record = await consent.load_consent(app_store)
        assert record is not None and record.enabled is False and record.installation_id is None
        assert sent.call_count == 0

    async def test_upgrade_does_not_flip_runtime_opt_out(
        self, app_store: AppStore, sent: MagicMock,
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Prior runtime opt-out is persisted; the install flag now says enabled
        # (as `thinkrail upgrade` re-running install.sh would). The AppStore
        # record is authoritative: initialize must not re-enable.
        await consent.save_consent(
            app_store, AnalyticsConsent(enabled=False, installation_id=None)
        )
        meta = tmp_path / "install.json"
        meta.write_text(json.dumps({"analytics": True}))
        monkeypatch.setattr(service, "INSTALL_METADATA_PATH", meta)

        await service.initialize(app_store)

        assert service._state is not None and service._state.enabled is False
        assert sent.call_count == 0
        record = await consent.load_consent(app_store)
        assert record is not None and record.enabled is False

    async def test_first_run_prints_notice(
        self, app_store: AppStore, sent: MagicMock, capsys: pytest.CaptureFixture[str]
    ) -> None:
        await service.initialize(app_store)
        assert "analytics enabled" in capsys.readouterr().out

    async def test_never_raises_on_failure(self, sent: MagicMock) -> None:
        broken = MagicMock()
        broken.get_setting.side_effect = RuntimeError("db down")
        # Must swallow the error — startup can never crash on analytics.
        await service.initialize(broken)
        assert sent.call_count == 0


class TestTrackEvent:
    async def test_noop_when_uninitialized(self, sent: MagicMock) -> None:
        service.track_event(BoardViewedEvent())
        assert sent.call_count == 0

    async def test_opt_out_stops_network(self, app_store: AppStore, sent: MagicMock) -> None:
        await service.initialize(app_store)
        sent.reset_mock()
        await consent.opt_out(app_store)
        await service.reload_state(app_store)
        service.track_event(BoardViewedEvent())
        assert sent.call_count == 0

    async def test_stamps_id_and_env(self, app_store: AppStore, sent: MagicMock) -> None:
        await service.initialize(app_store)
        installation_id = service._state.installation_id
        sent.reset_mock()

        service.track_event(AppStartedEvent())
        payload = sent.call_args.args[0]
        assert payload["installationId"] == installation_id
        assert payload["channel"] == service._ENV["channel"]
        assert payload["version"] == service._ENV["version"]
        assert payload["os"] == service._ENV["os"]
        assert payload["arch"] == service._ENV["arch"]

    async def test_feature_event_not_stamped_with_env(
        self, app_store: AppStore, sent: MagicMock
    ) -> None:
        await service.initialize(app_store)
        sent.reset_mock()
        service.track_event(SpecsViewedEvent())
        payload = sent.call_args.args[0]
        assert set(payload) == {"event", "installationId"}
        assert payload["event"] == "specs_viewed"
        assert payload["installationId"]


class TestNoopSink:
    def test_real_sink_does_not_raise(self) -> None:
        # The default sink drops events; it must never raise or touch the net.
        assert service._send({"event": "app_started", "installationId": "x"}) is None


class TestEmitOneshot:
    def test_sends_when_enabled(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, sent: MagicMock
    ) -> None:
        monkeypatch.setattr(service, "get_data_dir", lambda: tmp_path)
        asyncio.run(_seed(tmp_path, enabled=True))
        service.emit_oneshot(UpgradeStartedEvent())
        assert _events(sent) == ["upgrade_started"]

    def test_skips_when_disabled(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, sent: MagicMock
    ) -> None:
        monkeypatch.setattr(service, "get_data_dir", lambda: tmp_path)
        asyncio.run(_seed(tmp_path, enabled=False))
        service.emit_oneshot(UpgradeStartedEvent())
        assert sent.call_count == 0


async def _seed(data_dir: Path, *, enabled: bool) -> None:
    store = AppStore(data_dir)
    await store.open()
    try:
        if enabled:
            await consent.opt_in(store)
        else:
            await consent.opt_out(store)
    finally:
        await store.close()
