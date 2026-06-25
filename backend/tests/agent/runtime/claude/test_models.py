"""Tests for app.agent.runtime.claude.models — catalog-holder-backed registry."""

from __future__ import annotations

from app.agent.runtime.claude.catalog import parse_catalog
from app.agent.runtime.claude.models import ClaudeModelRegistry

import app.agent.runtime.claude.models as models_mod
import json


def _registry(doc_dict) -> ClaudeModelRegistry:
    """Build a registry over a custom catalog by swapping the module holder."""
    models_mod.catalog_holder.swap(parse_catalog(json.dumps(doc_dict)))
    return ClaudeModelRegistry()


_DOC = {
    "schemaVersion": 1,
    "defaultModel": "claude-opus-4-8",
    "models": [
        {"id": "claude-fable-5", "label": "Fable 5", "hidden": True, "efforts": ["high"],
         "context1m": True, "pricing": {"input": 10, "output": 50, "cacheWrite5m": 12.5,
                                        "cacheWrite1h": 20, "cacheRead": 1.0}},
        {"id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "efforts": ["low", "high"],
         "context1m": True, "pricing": {"input": 3, "output": 15, "cacheWrite5m": 3.75,
                                        "cacheWrite1h": 6, "cacheRead": 0.3}},
        {"id": "claude-opus-4-8", "label": "Opus 4.8", "efforts": ["high", "max"],
         "context1m": True, "pricing": {"input": 5, "output": 25, "cacheWrite5m": 6.25,
                                        "cacheWrite1h": 10, "cacheRead": 0.5}},
    ],
}


class TestListOptions:
    def test_excludes_hidden_and_puts_default_first(self):
        reg = _registry(_DOC)
        values = [o.value for o in reg.list_options()]
        assert "claude-fable-5" not in values           # hidden
        assert values[0] == "claude-opus-4-8"            # default first
        assert values == ["claude-opus-4-8", "claude-sonnet-4-6"]

    def test_default_model_returns_catalog_default(self):
        assert _registry(_DOC).default_model() == "claude-opus-4-8"

    def test_default_model_clamps_when_missing(self):
        doc = json.loads(json.dumps(_DOC))
        doc["defaultModel"] = "claude-ghost-9"           # not in models
        reg = _registry(doc)
        # First visible model, in declared order, becomes the default.
        assert reg.default_model() == "claude-sonnet-4-6"
        assert reg.list_options()[0].value == "claude-sonnet-4-6"

    def test_default_model_clamps_when_hidden(self):
        doc = json.loads(json.dumps(_DOC))
        doc["defaultModel"] = "claude-fable-5"           # hidden
        assert _registry(doc).default_model() == "claude-sonnet-4-6"


class TestLookups:
    def test_rates_supported_efforts_supports_1m(self):
        reg = _registry(_DOC)
        assert reg.rates_for("claude-opus-4-8").input == 5 / 1_000_000
        assert reg.supported_efforts("claude-sonnet-4-6") == ("low", "high")
        assert reg.supports_1m("claude-opus-4-8") is True
        # tier fallback: an unknown opus snapshot resolves via the "opus" tier
        assert reg.supports_1m("claude-opus-4-8-20990101") is True
