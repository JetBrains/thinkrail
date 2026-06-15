"""Claude model registry — loads the curated catalog shipped with the package."""

from __future__ import annotations

import json
from importlib.resources import files

from app.agent.pricing import ModelRates
from app.agent.runtime.types import LabeledOption

# Tier keywords used to resolve rates for a model id that isn't an exact catalog
# entry (out-of-caps selections, dated snapshots, subagent models). "sonnet" is
# the catch-all default.
_TIERS = ("fable", "opus", "haiku", "sonnet")
_DEFAULT_TIER = "sonnet"


def _rates_from_json(pricing: dict[str, float]) -> ModelRates:
    """Per-million-token USD in JSON → per-token ``ModelRates``."""
    return ModelRates(
        input=pricing["input"] / 1_000_000,
        output=pricing["output"] / 1_000_000,
        cache_write_5m=pricing["cacheWrite5m"] / 1_000_000,
        cache_write_1h=pricing["cacheWrite1h"] / 1_000_000,
        cache_read=pricing["cacheRead"] / 1_000_000,
    )


def _tier_of(model: str) -> str:
    m = model.lower()
    for tier in _TIERS:
        if tier in m:
            return tier
    return _DEFAULT_TIER


class ClaudeModelRegistry:
    def __init__(self) -> None:
        raw = json.loads(
            files(__package__).joinpath("models.json").read_text(encoding="utf-8")
        )
        self._options: tuple[LabeledOption, ...] = tuple(
            LabeledOption(value=row["id"], label=row["label"]) for row in raw
        )
        self._rates_by_id: dict[str, ModelRates] = {
            row["id"]: _rates_from_json(row["pricing"]) for row in raw
        }
        self._rates_by_tier: dict[str, ModelRates] = {
            _tier_of(rid): rates for rid, rates in self._rates_by_id.items()
        }

    def list_options(self) -> list[LabeledOption]:
        return list(self._options)

    def rates_for(self, model: str) -> ModelRates:
        """Resolve rates for ``model``: exact id, else by tier keyword, else sonnet."""
        if model in self._rates_by_id:
            return self._rates_by_id[model]
        return self._rates_by_tier.get(_tier_of(model)) or self._rates_by_tier[_DEFAULT_TIER]
