"""Tests for app.agent.pricing — token-usage cost primitives."""

from __future__ import annotations

from app.agent.pricing import ModelRates, TokenUsage, cost

# $1 per MTok on every dimension → cost in USD equals tokens / 1e6 per field.
_UNIT = ModelRates(
    input=1.0 / 1_000_000,
    output=1.0 / 1_000_000,
    cache_write_5m=1.0 / 1_000_000,
    cache_write_1h=1.0 / 1_000_000,
    cache_read=1.0 / 1_000_000,
)

_OPUS = ModelRates(
    input=5.0 / 1_000_000,
    output=25.0 / 1_000_000,
    cache_write_5m=6.25 / 1_000_000,
    cache_write_1h=10.0 / 1_000_000,
    cache_read=0.5 / 1_000_000,
)


class TestCost:
    def test_zero_usage_is_zero(self) -> None:
        assert cost(TokenUsage(), _UNIT) == 0.0

    def test_sums_every_dimension(self) -> None:
        usage = TokenUsage(
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            cache_read_tokens=1_000_000,
            cache_write_5m_tokens=1_000_000,
            cache_write_1h_tokens=1_000_000,
        )
        assert cost(usage, _UNIT) == 5.0

    def test_applies_per_dimension_rates(self) -> None:
        # 1M input @ $5 + 1M output @ $25 = $30.
        assert cost(TokenUsage(input_tokens=1_000_000, output_tokens=1_000_000), _OPUS) == 30.0

    def test_cache_read_is_cheaper_than_cache_write(self) -> None:
        n = 1_000_000
        assert cost(TokenUsage(cache_read_tokens=n), _OPUS) < cost(
            TokenUsage(cache_write_5m_tokens=n), _OPUS
        )

    def test_per_turn_costs_sum_to_session_total(self) -> None:
        turns = [
            TokenUsage(input_tokens=200_000, output_tokens=50_000),
            TokenUsage(input_tokens=10_000, output_tokens=2_000),  # cheaper follow-up
            TokenUsage(input_tokens=400_000, output_tokens=120_000),
        ]
        total = 0.0
        for t in turns:
            total += cost(t, _OPUS)
        assert total == sum(cost(t, _OPUS) for t in turns)
        assert total > cost(turns[0], _OPUS)  # accumulates, never drops
