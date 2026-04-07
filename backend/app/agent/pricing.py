"""Per-model token pricing and cost estimation.

Prices are in USD per token, derived from Anthropic's published rates.
Used by the runner to emit live cost estimates during streaming.

Pricing source: https://platform.claude.com/docs/en/about-claude/pricing
Updated: 2026-04-07 (Opus 4.5+, Sonnet 4+, Haiku 4.5 rates)
"""

from __future__ import annotations

PRICES: dict[str, dict[str, float]] = {
    "opus": {
        "input": 5.0 / 1_000_000,
        "output": 25.0 / 1_000_000,
        "cache_write_5m": 6.25 / 1_000_000,
        "cache_write_1h": 10.0 / 1_000_000,
        "cache_read": 0.50 / 1_000_000,
    },
    "sonnet": {
        "input": 3.0 / 1_000_000,
        "output": 15.0 / 1_000_000,
        "cache_write_5m": 3.75 / 1_000_000,
        "cache_write_1h": 6.0 / 1_000_000,
        "cache_read": 0.30 / 1_000_000,
    },
    "haiku": {
        "input": 1.0 / 1_000_000,
        "output": 5.0 / 1_000_000,
        "cache_write_5m": 1.25 / 1_000_000,
        "cache_write_1h": 2.0 / 1_000_000,
        "cache_read": 0.10 / 1_000_000,
    },
}


def _resolve_tier(model: str) -> dict[str, float]:
    """Map model ID string to pricing tier."""
    m = model.lower()
    if "opus" in m:
        return PRICES["opus"]
    if "haiku" in m:
        return PRICES["haiku"]
    return PRICES["sonnet"]  # default fallback


def estimate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_5m_tokens: int = 0,
    cache_creation_1h_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    """Estimate cost in USD from token counts and model ID.

    ``input_tokens`` is the non-cached input count (the API reports cached
    tokens separately in ``cache_creation_input_tokens`` and
    ``cache_read_input_tokens``).
    """
    p = _resolve_tier(model)
    return (
        input_tokens * p["input"]
        + output_tokens * p["output"]
        + cache_creation_5m_tokens * p["cache_write_5m"]
        + cache_creation_1h_tokens * p["cache_write_1h"]
        + cache_read_tokens * p["cache_read"]
    )
