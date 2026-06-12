"""Tests for app.agent.pricing — model pricing and cost estimation."""

from app.agent.pricing import PRICES, _resolve_tier, estimate_cost


class TestResolveTier:
    def test_fable_model(self):
        assert _resolve_tier("claude-fable-5") is PRICES["fable"]

    def test_opus_model(self):
        assert _resolve_tier("claude-opus-4-6") is PRICES["opus"]

    def test_opus_case_insensitive(self):
        assert _resolve_tier("Claude-Opus-4-6") is PRICES["opus"]

    def test_haiku_model(self):
        assert _resolve_tier("claude-haiku-4-5-20251001") is PRICES["haiku"]

    def test_sonnet_model(self):
        assert _resolve_tier("claude-sonnet-4-6") is PRICES["sonnet"]

    def test_unknown_defaults_to_sonnet(self):
        assert _resolve_tier("some-unknown-model") is PRICES["sonnet"]


class TestEstimateCost:
    def test_input_only(self):
        cost = estimate_cost("claude-sonnet-4-6", input_tokens=1_000_000, output_tokens=0)
        assert cost == 3.0  # $3/M input tokens for sonnet

    def test_output_only(self):
        cost = estimate_cost("claude-sonnet-4-6", input_tokens=0, output_tokens=1_000_000)
        assert cost == 15.0  # $15/M output tokens for sonnet

    def test_cache_write_5m(self):
        cost = estimate_cost("claude-sonnet-4-6", input_tokens=0, output_tokens=0,
                             cache_creation_5m_tokens=1_000_000)
        assert cost == 3.75  # $3.75/M 5m cache write for sonnet

    def test_cache_write_1h(self):
        cost = estimate_cost("claude-sonnet-4-6", input_tokens=0, output_tokens=0,
                             cache_creation_1h_tokens=1_000_000)
        assert cost == 6.0  # $6/M 1h cache write for sonnet (2x input)

    def test_cache_read(self):
        cost = estimate_cost("claude-sonnet-4-6", input_tokens=0, output_tokens=0,
                             cache_read_tokens=1_000_000)
        assert cost == 0.30  # $0.30/M cache read for sonnet

    def test_mixed_tokens(self):
        # input_tokens is non-cached, cache fields are separate additive categories
        cost = estimate_cost(
            "claude-sonnet-4-6",
            input_tokens=10_000,
            output_tokens=5_000,
            cache_creation_5m_tokens=20_000,
            cache_creation_1h_tokens=5_000,
            cache_read_tokens=50_000,
        )
        expected = (
            10_000 * 3.0 / 1_000_000       # non-cached input
            + 5_000 * 15.0 / 1_000_000     # output
            + 20_000 * 3.75 / 1_000_000    # 5m cache write
            + 5_000 * 6.0 / 1_000_000      # 1h cache write
            + 50_000 * 0.30 / 1_000_000    # cache read
        )
        assert abs(cost - expected) < 1e-10

    def test_fable_pricing(self):
        cost = estimate_cost("claude-fable-5", input_tokens=1_000_000, output_tokens=1_000_000)
        assert cost == 60.0  # $10 input + $50 output

    def test_fable_cache_pricing(self):
        cost = estimate_cost(
            "claude-fable-5",
            input_tokens=0,
            output_tokens=0,
            cache_creation_5m_tokens=1_000_000,
            cache_creation_1h_tokens=1_000_000,
            cache_read_tokens=1_000_000,
        )
        assert cost == 33.50  # $12.50 5m write + $20 1h write + $1 read

    def test_opus_pricing(self):
        cost = estimate_cost("claude-opus-4-6", input_tokens=1_000_000, output_tokens=1_000_000)
        assert cost == 30.0  # $5 input + $25 output

    def test_haiku_pricing(self):
        cost = estimate_cost("claude-haiku-4-5", input_tokens=1_000_000, output_tokens=1_000_000)
        assert cost == 6.0  # $1 input + $5 output

    def test_zero_tokens(self):
        cost = estimate_cost("claude-sonnet-4-6", input_tokens=0, output_tokens=0)
        assert cost == 0.0
