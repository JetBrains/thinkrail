"""Tests for app.agent.runtime.claude.models — static catalog registry."""

from __future__ import annotations

from app.agent.pricing import ModelRates, TokenUsage, cost
from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.types import LabeledOption


class TestClaudeModelRegistry:
    def test_list_options_excludes_hidden_models_in_declared_order(self) -> None:
        reg = ClaudeModelRegistry()
        values = [o.value for o in reg.list_options()]
        # Fable 5 is marked hidden in the catalog — kept for pricing, dropped
        # from the picker.
        assert values == [
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001",
        ]

    def test_list_options_returns_labeled_options(self) -> None:
        reg = ClaudeModelRegistry()
        for o in reg.list_options():
            assert isinstance(o, LabeledOption)
            assert set(LabeledOption.model_fields) == {"value", "label", "description"}

    def test_first_option_is_opus(self) -> None:
        reg = ClaudeModelRegistry()
        first = reg.list_options()[0]
        assert first.value == "claude-opus-4-8"
        assert first.label == "Opus 4.8"


class TestSupportedEfforts:
    def test_opus_supports_full_effort_set(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.supported_efforts("claude-opus-4-8") == (
            "low", "medium", "high", "xhigh", "max",
        )

    def test_sonnet_has_no_xhigh(self) -> None:
        reg = ClaudeModelRegistry()
        efforts = reg.supported_efforts("claude-sonnet-4-6")
        assert efforts == ("low", "medium", "high", "max")
        assert "xhigh" not in efforts

    def test_haiku_supports_no_effort(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.supported_efforts("claude-haiku-4-5-20251001") == ()

    def test_out_of_catalog_id_resolves_by_tier(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.supported_efforts("claude-opus-4-1-20250805") == reg.supported_efforts(
            "claude-opus-4-8"
        )

    def test_unknown_model_defaults_to_sonnet(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.supported_efforts("gpt-4o") == reg.supported_efforts("claude-sonnet-4-6")


class TestSupports1m:
    def test_opus_and_sonnet_support_1m(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.supports_1m("claude-opus-4-8") is True
        assert reg.supports_1m("claude-sonnet-4-6") is True

    def test_haiku_does_not_support_1m(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.supports_1m("claude-haiku-4-5-20251001") is False

    def test_out_of_catalog_resolves_by_tier(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.supports_1m("claude-opus-4-1-20250805") is True

    def test_hidden_model_still_resolves_capabilities(self) -> None:
        reg = ClaudeModelRegistry()
        # Fable 5 is hidden from the picker but still in the catalog.
        assert reg.supports_1m("claude-fable-5") is True
        assert "xhigh" in reg.supported_efforts("claude-fable-5")


class TestRatesFor:
    def test_exact_id_returns_per_token_rates(self) -> None:
        reg = ClaudeModelRegistry()
        # Opus: $5/$25 per MTok input/output → per-token.
        assert reg.rates_for("claude-opus-4-8") == ModelRates(
            input=5.0 / 1_000_000,
            output=25.0 / 1_000_000,
            cache_write_5m=6.25 / 1_000_000,
            cache_write_1h=10.0 / 1_000_000,
            cache_read=0.5 / 1_000_000,
        )

    def test_out_of_catalog_id_resolves_by_tier_keyword(self) -> None:
        reg = ClaudeModelRegistry()
        # An opus id not in the catalog still prices at opus rates.
        assert reg.rates_for("claude-opus-4-1-20250805") == reg.rates_for("claude-opus-4-8")

    def test_unknown_model_defaults_to_sonnet(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.rates_for("gpt-4o") == reg.rates_for("claude-sonnet-4-6")

    def test_each_tier_resolves_distinctly(self) -> None:
        reg = ClaudeModelRegistry()
        tiers = {
            reg.rates_for(m)
            for m in ("claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001")
        }
        assert len(tiers) == 4


class TestCatalogRates:
    """Lock the published per-tier dollar rates (1M input + 1M output)."""

    def _io_cost(self, model: str) -> float:
        reg = ClaudeModelRegistry()
        usage = TokenUsage(input_tokens=1_000_000, output_tokens=1_000_000)
        return cost(usage, reg.rates_for(model))

    def test_fable(self) -> None:
        assert self._io_cost("claude-fable-5") == 60.0  # $10 + $50

    def test_opus(self) -> None:
        assert self._io_cost("claude-opus-4-8") == 30.0  # $5 + $25

    def test_sonnet(self) -> None:
        assert self._io_cost("claude-sonnet-4-6") == 18.0  # $3 + $15

    def test_haiku(self) -> None:
        assert self._io_cost("claude-haiku-4-5-20251001") == 6.0  # $1 + $5

    def test_sonnet_cache_dimensions(self) -> None:
        reg = ClaudeModelRegistry()
        rates = reg.rates_for("claude-sonnet-4-6")
        n = 1_000_000
        assert cost(TokenUsage(cache_write_5m_tokens=n), rates) == 3.75
        assert cost(TokenUsage(cache_write_1h_tokens=n), rates) == 6.0
        assert round(cost(TokenUsage(cache_read_tokens=n), rates), 10) == 0.3
