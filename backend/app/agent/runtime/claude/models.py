"""Claude model registry — reads the active catalog from ``catalog_holder``.

Stateless over the holder: every method consults ``catalog_holder.current`` at
call time, so a background catalog swap is reflected immediately.
"""

from __future__ import annotations

from app.agent.pricing import ModelRates
from app.agent.runtime.claude.catalog import CatalogModel, CatalogPricing, catalog_holder
from app.agent.runtime.types import LabeledOption

# Tier keywords resolve rates / capability facts for an id that isn't an exact
# catalog entry (out-of-caps selections, dated snapshots, subagent models).
# "sonnet" is the catch-all default.
_TIERS = ("fable", "opus", "haiku", "sonnet")
_DEFAULT_TIER = "sonnet"

# Irreducible fallback if the catalog somehow has no models at all.
_FALLBACK_MODEL = "claude-opus-4-8"


def _rates(pricing: CatalogPricing) -> ModelRates:
    """Per-million-token USD → per-token ``ModelRates``."""
    return ModelRates(
        input=pricing.input / 1_000_000,
        output=pricing.output / 1_000_000,
        cache_write_5m=pricing.cache_write_5m / 1_000_000,
        cache_write_1h=pricing.cache_write_1h / 1_000_000,
        cache_read=pricing.cache_read / 1_000_000,
    )


def _tier_of(model: str) -> str:
    m = model.lower()
    for tier in _TIERS:
        if tier in m:
            return tier
    return _DEFAULT_TIER


class ClaudeModelRegistry:
    """Reader over the active catalog. Construction is cheap; it holds no copy."""

    def default_model(self) -> str:
        """The default model id: the catalog ``defaultModel`` when it is present
        and visible, else the first visible model, else ``_FALLBACK_MODEL``."""
        doc = catalog_holder.current
        visible = [m for m in doc.models if not m.hidden]
        ids = {m.id for m in visible}
        if doc.default_model in ids:
            return doc.default_model
        if visible:
            return visible[0].id
        return _FALLBACK_MODEL

    def list_options(self) -> list[LabeledOption]:
        """Visible models, default first, the rest in declared order. Hidden
        entries stay in the catalog (rates / capability lookups) but are dropped
        from the picker."""
        doc = catalog_holder.current
        default = self.default_model()
        visible = [m for m in doc.models if not m.hidden]
        ordered = sorted(visible, key=lambda m: 0 if m.id == default else 1)
        return [LabeledOption(value=m.id, label=m.label) for m in ordered]

    def _resolve(self, model: str) -> CatalogModel | None:
        """The catalog entry for ``model``: exact id, else by tier keyword, else
        the sonnet default. ``None`` only if the catalog has no models at all."""
        models = catalog_holder.current.models
        for m in models:
            if m.id == model:
                return m
        by_tier: dict[str, CatalogModel] = {}
        for m in models:
            by_tier.setdefault(_tier_of(m.id), m)
        return by_tier.get(_tier_of(model)) or by_tier.get(_DEFAULT_TIER)

    def rates_for(self, model: str) -> ModelRates:
        """Resolve rates for ``model`` (exact id → tier → sonnet)."""
        m = self._resolve(model)
        # Zero rates rather than crash if the catalog is somehow empty.
        return _rates(m.pricing) if m else ModelRates(0.0, 0.0, 0.0, 0.0, 0.0)

    def supported_efforts(self, model: str) -> tuple[str, ...]:
        """Effort levels ``model`` accepts (excluding the always-available
        ``auto``), resolved exact id → tier → sonnet."""
        m = self._resolve(model)
        return tuple(m.efforts) if m else ()

    def supports_1m(self, model: str) -> bool:
        """Whether ``model`` supports the 1M-token context window, resolved
        exact id → tier → sonnet."""
        m = self._resolve(model)
        return bool(m.context1m) if m else False
