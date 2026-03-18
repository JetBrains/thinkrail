"""Per-model token pricing and cost estimation.

Prices are in USD per token, derived from Anthropic's published rates.
Used by the runner to emit live cost estimates during streaming.
"""

from __future__ import annotations

PRICES: dict[str, dict[str, float]] = {
    "opus": {
        "input": 15.0 / 1_000_000,
        "output": 75.0 / 1_000_000,
        "cache_write": 18.75 / 1_000_000,
        "cache_read": 1.50 / 1_000_000,
    },
    "sonnet": {
        "input": 3.0 / 1_000_000,
        "output": 15.0 / 1_000_000,
        "cache_write": 3.75 / 1_000_000,
        "cache_read": 0.30 / 1_000_000,
    },
    "haiku": {
        "input": 0.80 / 1_000_000,
        "output": 4.0 / 1_000_000,
        "cache_write": 1.0 / 1_000_000,
        "cache_read": 0.08 / 1_000_000,
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
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    """Estimate cost in USD from token counts and model ID."""
    p = _resolve_tier(model)
    return (
        input_tokens * p["input"]
        + output_tokens * p["output"]
        + cache_creation_tokens * p["cache_write"]
        + cache_read_tokens * p["cache_read"]
    )
