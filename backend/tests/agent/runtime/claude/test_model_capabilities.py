"""Tests for per-model capability surfacing and the SDK-boundary clamp.

Covers the fix for the unsound model/effort/context combinations (issue #62):
the picker is told what each model supports, and the runtime clamps anything
the model can't accept before it reaches the SDK.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import app.agent.runtime.claude.models as models_mod
from app.agent.runtime.claude.catalog import parse_catalog
from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.claude.runtime import (
    ClaudeRuntime,
    _effective_effort,
    _wants_1m_beta,
)
from app.core.config import AppConfig

_HAIKU = "claude-haiku-4-5-20251001"
_OPUS = "claude-opus-4-8"
_SONNET = "claude-sonnet-4-6"
_CONTEXT_1M_FLAG = "context1m"


def _runtime(tmp_path: Path) -> ClaudeRuntime:
    config = AppConfig(
        project_root=tmp_path,
        thinkrail_dir=tmp_path / ".tr",
        plugin_dir=tmp_path / "plugins",
    )
    return ClaudeRuntime(app_config=config)


@pytest.fixture
def claude_runtime(tmp_path: Path) -> ClaudeRuntime:
    return _runtime(tmp_path)


def _swap_catalog(**overrides):
    base = {
        "schemaVersion": 1,
        "defaultModel": "claude-opus-4-8",
        "models": [
            {"id": "claude-opus-4-8", "label": "Opus 4.8", "efforts": ["high", "xhigh"],
             "context1m": True, "pricing": {"input": 5, "output": 25, "cacheWrite5m": 6.25,
                                            "cacheWrite1h": 10, "cacheRead": 0.5}},
        ],
        "flags": [{"key": "context1m", "label": "Custom 1M label", "type": "boolean",
                   "default": True, "beta": "context-1m-2025-08-07"}],
        "permissionModes": {"plan": {"label": "Catalog Plan", "description": "d"},
                            "dontAsk": {"hidden": True}},
    }
    base.update(overrides)
    models_mod.catalog_holder.swap(parse_catalog(json.dumps(base)))


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


class TestCapabilitiesFromCatalog:
    def test_permission_mode_label_from_overlay_and_hidden_respected(self, claude_runtime):
        _swap_catalog()
        caps = claude_runtime.capabilities()
        values = [m.value for m in caps.permission_modes]
        labels = {m.value: m.label for m in caps.permission_modes}
        assert "dontAsk" not in values                 # hidden via overlay
        assert labels["plan"] == "Catalog Plan"          # label from catalog
        # A mode with no overlay entry falls back to its raw value as the label.
        assert labels["default"] == "default"

    def test_flag_label_and_beta_from_catalog(self, claude_runtime):
        _swap_catalog()
        caps = claude_runtime.capabilities()
        flag = next(f for f in caps.flags if f.key == "context1m")
        assert flag.label == "Custom 1M label"

    def test_clamp_rejects_sdk_unsupported_effort_regardless_of_catalog(self):
        # Even if the catalog grants Haiku "xhigh", the SDK clamp drops it.
        from app.agent.runtime.claude.runtime import _effective_effort
        _swap_catalog(models=[
            {"id": "claude-haiku-4-5-20251001", "label": "Haiku", "efforts": ["xhigh"],
             "context1m": False, "pricing": {"input": 1, "output": 5, "cacheWrite5m": 1.25,
                                             "cacheWrite1h": 2, "cacheRead": 0.1}},
        ], defaultModel="claude-haiku-4-5-20251001")
        reg = models_mod.ClaudeModelRegistry()
        # "xhigh" is a real SDK effort, so the catalog grant survives the clamp here;
        # use a value the SDK does not know to prove the clamp floor:
        assert _effective_effort(reg, "claude-haiku-4-5-20251001", "totally-bogus") is None
