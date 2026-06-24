"""Tests for per-model capability surfacing and the SDK-boundary clamp.

Covers the fix for the unsound model/effort/context combinations (issue #62):
the picker is told what each model supports, and the runtime clamps anything
the model can't accept before it reaches the SDK.
"""

from __future__ import annotations

from pathlib import Path

from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.claude.runtime import (
    ClaudeRuntime,
    _CONTEXT_1M_FLAG,
    _effective_effort,
    _wants_1m_beta,
)
from app.core.config import AppConfig

_HAIKU = "claude-haiku-4-5-20251001"
_OPUS = "claude-opus-4-8"
_SONNET = "claude-sonnet-4-6"


def _runtime(tmp_path: Path) -> ClaudeRuntime:
    config = AppConfig(
        project_root=tmp_path,
        thinkrail_dir=tmp_path / ".tr",
        plugin_dir=tmp_path / "plugins",
    )
    return ClaudeRuntime(app_config=config)


class TestEffectiveEffort:
    def setup_method(self) -> None:
        self.reg = ClaudeModelRegistry()

    def test_auto_maps_to_none(self) -> None:
        assert _effective_effort(self.reg, _OPUS, "auto") is None

    def test_none_stays_none(self) -> None:
        assert _effective_effort(self.reg, _OPUS, None) is None

    def test_supported_effort_passes_through(self) -> None:
        assert _effective_effort(self.reg, _OPUS, "xhigh") == "xhigh"

    def test_haiku_xhigh_clamps_to_none(self) -> None:
        # The exact crash in issue #62 — Haiku rejects every effort level.
        assert _effective_effort(self.reg, _HAIKU, "xhigh") is None

    def test_sonnet_xhigh_clamps_to_none(self) -> None:
        # Sonnet 4.6 supports max but not xhigh.
        assert _effective_effort(self.reg, _SONNET, "xhigh") is None
        assert _effective_effort(self.reg, _SONNET, "max") == "max"


class TestWants1mBeta:
    def setup_method(self) -> None:
        self.reg = ClaudeModelRegistry()

    def test_default_on_for_supported_model(self) -> None:
        # Empty flags → flag defaults on; Opus supports 1M.
        assert _wants_1m_beta(self.reg, _OPUS, {}) is True

    def test_off_when_flag_disabled(self) -> None:
        assert _wants_1m_beta(self.reg, _OPUS, {_CONTEXT_1M_FLAG: False}) is False

    def test_haiku_never_gets_beta_even_when_flag_on(self) -> None:
        assert _wants_1m_beta(self.reg, _HAIKU, {_CONTEXT_1M_FLAG: True}) is False


class TestCapabilitiesModelCapabilities:
    def test_haiku_advertises_no_effort_or_1m(self, tmp_path: Path) -> None:
        caps = _runtime(tmp_path).capabilities()
        haiku = next(mc for mc in caps.model_capabilities if mc.model == _HAIKU)
        assert haiku.effort_levels == ["auto"]
        assert haiku.flags == []

    def test_opus_advertises_full_effort_and_1m(self, tmp_path: Path) -> None:
        caps = _runtime(tmp_path).capabilities()
        opus = next(mc for mc in caps.model_capabilities if mc.model == _OPUS)
        assert opus.effort_levels == ["auto", "low", "medium", "high", "xhigh", "max"]
        assert opus.flags == [_CONTEXT_1M_FLAG]

    def test_sonnet_omits_xhigh(self, tmp_path: Path) -> None:
        caps = _runtime(tmp_path).capabilities()
        sonnet = next(mc for mc in caps.model_capabilities if mc.model == _SONNET)
        assert "xhigh" not in sonnet.effort_levels
        assert sonnet.effort_levels == ["auto", "low", "medium", "high", "max"]

    def test_capabilities_only_cover_visible_models(self, tmp_path: Path) -> None:
        caps = _runtime(tmp_path).capabilities()
        models = {o.value for o in caps.models}
        cap_models = {mc.model for mc in caps.model_capabilities}
        assert cap_models == models
        assert "claude-fable-5" not in cap_models  # hidden
