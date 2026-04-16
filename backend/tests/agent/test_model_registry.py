"""Tests for app.agent.model_registry — classification and status reporting."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from app.agent.model_registry import (
    ModelInfo,
    ModelRegistry,
    _classify_current,
    _parse_version,
)


def _mi(model_id: str) -> ModelInfo:
    return ModelInfo(
        id=model_id,
        label=model_id,
        group="legacy",
        contextWindow=200_000,
        maxOutput=64_000,
        pricingTier="sonnet",
    )


class TestParseVersion:
    def test_simple_suffix(self) -> None:
        assert _parse_version("claude-opus-4-7") == (4, 7)

    def test_with_date_stamp(self) -> None:
        assert _parse_version("claude-opus-4-5-20251101") == (4, 5)

    def test_date_only_suffix_means_zero_minor(self) -> None:
        # "claude-opus-4-20250514" is Opus 4.0 (original release), not Opus 4.20250514.
        assert _parse_version("claude-opus-4-20250514") == (4, 0)

    def test_no_version_returns_none(self) -> None:
        assert _parse_version("claude-unknown") is None


class TestClassifyCurrent:
    def test_highest_version_per_family_wins(self) -> None:
        # Mirrors the actual shape of what the Anthropic API returns today:
        # a mix of plain "-X-Y", dated "-X-Y-YYYYMMDD", and legacy
        # ".0"-release "-X-YYYYMMDD" ids.
        models = [_mi(x) for x in [
            "claude-opus-4-6",
            "claude-opus-4-7",
            "claude-opus-4-5-20251101",
            "claude-opus-4-1-20250805",
            "claude-opus-4-20250514",
            "claude-sonnet-4-6",
            "claude-sonnet-4-5-20250929",
            "claude-sonnet-4-20250514",
            "claude-haiku-4-5-20251001",
        ]]
        _classify_current(models)

        currents = sorted(m.id for m in models if m.group == "current")
        assert currents == [
            "claude-haiku-4-5-20251001",
            "claude-opus-4-7",
            "claude-sonnet-4-6",
        ]

    def test_single_model_per_family(self) -> None:
        models = [_mi("claude-opus-4-7")]
        _classify_current(models)
        assert models[0].group == "current"

    def test_dated_variant_does_not_beat_undated(self) -> None:
        models = [_mi("claude-opus-4-5"), _mi("claude-opus-4-5-20251101")]
        _classify_current(models)
        # Both parse to (4, 5) — first one encountered wins as current.
        currents = [m for m in models if m.group == "current"]
        assert len(currents) == 1

    def test_unknown_family_stays_legacy(self) -> None:
        models = [_mi("claude-something-4-7")]
        _classify_current(models)
        assert models[0].group == "legacy"

    def test_missing_version_stays_legacy(self) -> None:
        models = [_mi("claude-opus-latest")]
        _classify_current(models)
        assert models[0].group == "legacy"


class TestRegistryStatus:
    def test_initial_status_is_fallback(self, tmp_path: Path) -> None:
        reg = ModelRegistry(project_root=tmp_path)
        # Trigger get_models to populate _source from the fallback branch.
        reg.get_models()
        status = reg.get_status()
        assert status["source"] == "fallback"
        assert status["error"] is None
        assert status["lastRefresh"] is None

    @pytest.mark.asyncio
    async def test_refresh_without_credential_records_error(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with patch("app.agent.model_registry.resolve_anthropic_api_key", return_value=None):
            reg = ModelRegistry(project_root=tmp_path)
            await reg.refresh()

        status = reg.get_status()
        assert status["source"] == "fallback"
        assert status["error"] is not None
        assert "api key" in status["error"].lower()
