"""Tests for app.agent.runtime.claude.models — classification and status."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from app.agent.runtime.claude.models import (
    ClaudeModelRegistry,
    _ClaudeRow,
    _classify_current,
    _parse_version,
)


def _row(model_id: str, context_window: int = 200_000) -> _ClaudeRow:
    return _ClaudeRow(
        id=model_id,
        label=model_id,
        group="legacy",
        context_window=context_window,
        max_output=64_000,
        pricing_tier="sonnet",
    )


class TestParseVersion:
    def test_simple_suffix(self) -> None:
        assert _parse_version("claude-opus-4-7") == (4, 7)

    def test_with_date_stamp(self) -> None:
        assert _parse_version("claude-opus-4-5-20251101") == (4, 5)

    def test_date_only_suffix_means_zero_minor(self) -> None:
        assert _parse_version("claude-opus-4-20250514") == (4, 0)

    def test_no_version_returns_none(self) -> None:
        assert _parse_version("claude-unknown") is None


class TestClassifyCurrent:
    def test_highest_version_per_family_wins(self) -> None:
        models = [_row(x) for x in [
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
        models = [_row("claude-opus-4-7")]
        _classify_current(models)
        assert models[0].group == "current"

    def test_dated_variant_does_not_beat_undated(self) -> None:
        models = [_row("claude-opus-4-5"), _row("claude-opus-4-5-20251101")]
        _classify_current(models)
        currents = [m for m in models if m.group == "current"]
        assert len(currents) == 1

    def test_unknown_family_stays_legacy(self) -> None:
        models = [_row("claude-something-4-7")]
        _classify_current(models)
        assert models[0].group == "legacy"

    def test_missing_version_stays_legacy(self) -> None:
        models = [_row("claude-opus-latest")]
        _classify_current(models)
        assert models[0].group == "legacy"


class TestRegistryStatus:
    def test_initial_status_is_fallback(self, tmp_path: Path) -> None:
        reg = ClaudeModelRegistry(project_root=tmp_path)
        reg.list_models()
        status = reg.models_status()
        assert status["source"] == "fallback"
        assert status["error"] is None
        assert status["lastRefresh"] is None

    @pytest.mark.asyncio
    async def test_refresh_without_credential_records_error(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with patch("app.agent.runtime.claude.models.resolve_anthropic_api_key", return_value=None):
            reg = ClaudeModelRegistry(project_root=tmp_path)
            await reg.refresh_models()

        status = reg.models_status()
        assert status["source"] == "fallback"
        assert status["error"] is not None
        assert "api key" in status["error"].lower()


class TestSaveCacheLazyBonsai:
    def test_save_cache_skips_when_bonsai_missing(self, tmp_path: Path) -> None:
        reg = ClaudeModelRegistry(project_root=tmp_path)
        reg._save_cache([{"id": "claude-x"}])
        assert not (tmp_path / ".bonsai").exists()

    def test_save_cache_writes_when_bonsai_exists(self, tmp_path: Path) -> None:
        (tmp_path / ".bonsai").mkdir()
        reg = ClaudeModelRegistry(project_root=tmp_path)
        reg._save_cache([{"id": "claude-x"}])
        assert (tmp_path / ".bonsai" / "cache" / "models.json").is_file()
