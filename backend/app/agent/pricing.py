"""Token-usage cost primitives.

Runtime-agnostic: ``cost()`` turns a normalized ``TokenUsage`` into USD given a
``ModelRates``. Each runtime owns its own rates (e.g. Claude's live in its model
catalog) and maps its native usage into ``TokenUsage``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenUsage:
    """Normalized token counts for a single turn, summed across API calls."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_5m_tokens: int = 0
    cache_write_1h_tokens: int = 0


@dataclass(frozen=True)
class ModelRates:
    """Per-token USD rates for one model."""

    input: float
    output: float
    cache_write_5m: float
    cache_write_1h: float
    cache_read: float


def cost(usage: TokenUsage, rates: ModelRates) -> float:
    """USD cost of ``usage`` at ``rates``."""
    return (
        usage.input_tokens * rates.input
        + usage.output_tokens * rates.output
        + usage.cache_write_5m_tokens * rates.cache_write_5m
        + usage.cache_write_1h_tokens * rates.cache_write_1h
        + usage.cache_read_tokens * rates.cache_read
    )
