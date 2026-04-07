"""Model registry — fetches available models from the Anthropic API.

Provides a cached, periodically refreshed list of Claude models with
context window, 1M support, and pricing tier metadata.  Falls back to
a hardcoded list when the API is unreachable.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Models in this set are tagged "current"; everything else is "legacy".
CURRENT_MODELS: set[str] = {
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
}

# ── Hardcoded fallback (used when API is unavailable + no cache) ──────────

_FALLBACK: list[dict[str, Any]] = [
    {"id": "claude-opus-4-6",   "label": "Opus 4.6",   "group": "current", "contextWindow": 200_000, "maxOutput": 128_000, "supports1M": True,  "pricingTier": "opus"},
    {"id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "group": "current", "contextWindow": 200_000, "maxOutput": 64_000,  "supports1M": True,  "pricingTier": "sonnet"},
    {"id": "claude-haiku-4-5",  "label": "Haiku 4.5",  "group": "current", "contextWindow": 200_000, "maxOutput": 64_000,  "supports1M": False, "pricingTier": "haiku"},
    {"id": "claude-opus-4-5",   "label": "Opus 4.5",   "group": "legacy",  "contextWindow": 200_000, "maxOutput": 64_000,  "supports1M": False, "pricingTier": "opus"},
    {"id": "claude-opus-4-1",   "label": "Opus 4.1",   "group": "legacy",  "contextWindow": 200_000, "maxOutput": 64_000,  "supports1M": False, "pricingTier": "opus"},
    {"id": "claude-opus-4-0",   "label": "Opus 4",     "group": "legacy",  "contextWindow": 200_000, "maxOutput": 64_000,  "supports1M": False, "pricingTier": "opus"},
    {"id": "claude-sonnet-4-5", "label": "Sonnet 4.5", "group": "legacy",  "contextWindow": 200_000, "maxOutput": 64_000,  "supports1M": True,  "pricingTier": "sonnet"},
    {"id": "claude-sonnet-4-0", "label": "Sonnet 4",   "group": "legacy",  "contextWindow": 200_000, "maxOutput": 64_000,  "supports1M": True,  "pricingTier": "sonnet"},
]


@dataclass
class ModelInfo:
    id: str
    label: str
    group: str  # "current" | "legacy"
    contextWindow: int
    maxOutput: int
    supports1M: bool
    pricingTier: str  # "opus" | "sonnet" | "haiku"


def _derive_label(display_name: str) -> str:
    """Shorten 'Claude Opus 4.6' to 'Opus 4.6'."""
    return display_name.replace("Claude ", "")


def _derive_pricing_tier(model_id: str) -> str:
    m = model_id.lower()
    if "opus" in m:
        return "opus"
    if "haiku" in m:
        return "haiku"
    return "sonnet"


def _supports_1m(capabilities: dict[str, Any]) -> bool:
    """Check if the model supports the 1M context window beta."""
    try:
        return capabilities.get("context_management", {}).get("compact_20260112", {}).get("supported", False)
    except Exception:
        return False


def _parse_model(raw: Any) -> ModelInfo | None:
    """Convert an API model object to ModelInfo, or None if not a Claude chat model."""
    model_id: str = getattr(raw, "id", "") or ""
    if not model_id.startswith("claude-"):
        return None
    # Skip deprecated / very old models
    if "claude-2" in model_id or "claude-3-" in model_id:
        return None

    display_name: str = getattr(raw, "display_name", model_id) or model_id
    max_input: int = getattr(raw, "max_input_tokens", 200_000) or 200_000
    max_output: int = getattr(raw, "max_tokens", 64_000) or 64_000
    caps: dict = getattr(raw, "capabilities", {}) or {}

    return ModelInfo(
        id=model_id,
        label=_derive_label(display_name),
        group="current" if model_id in CURRENT_MODELS else "legacy",
        contextWindow=max_input,
        maxOutput=max_output,
        supports1M=_supports_1m(caps),
        pricingTier=_derive_pricing_tier(model_id),
    )


# ── Registry singleton ────────────────────────────────────────────────────

class ModelRegistry:
    """Fetches and caches the list of available Claude models."""

    def __init__(self, project_root: Path, refresh_hours: int = 24) -> None:
        self._project_root = project_root
        self._refresh_seconds = refresh_hours * 3600
        self._models: list[ModelInfo] = []
        self._last_refresh: float = 0.0
        self._refresh_task: asyncio.Task[None] | None = None
        self._cache_path = project_root / ".bonsai" / "cache" / "models.json"

    # ── Public API ────────────────────────────────────────────────────

    def get_models(self) -> list[dict[str, Any]]:
        """Return the current model list as dicts (JSON-serializable)."""
        if self._models:
            return [asdict(m) for m in self._models]
        # Try disk cache
        cached = self._load_cache()
        if cached:
            return cached
        return list(_FALLBACK)

    async def refresh(self) -> list[dict[str, Any]]:
        """Fetch models from the API and update the cache."""
        models = await self._fetch_from_api()
        if models:
            self._models = models
            self._last_refresh = time.monotonic()
            self._save_cache([asdict(m) for m in models])
            logger.info("Model registry refreshed: %d models", len(models))
        else:
            logger.warning("Model registry refresh failed, keeping previous data")
            if not self._models:
                cached = self._load_cache()
                if cached:
                    self._models = [ModelInfo(**m) for m in cached]
        return self.get_models()

    async def start_periodic_refresh(self) -> None:
        """Start background periodic refresh task."""
        # Initial fetch
        await self.refresh()
        self._refresh_task = asyncio.create_task(self._periodic_loop())

    def stop(self) -> None:
        if self._refresh_task and not self._refresh_task.done():
            self._refresh_task.cancel()

    # ── Internal ──────────────────────────────────────────────────────

    async def _periodic_loop(self) -> None:
        while True:
            await asyncio.sleep(self._refresh_seconds)
            try:
                await self.refresh()
            except Exception:
                logger.exception("Periodic model refresh failed")

    async def _fetch_from_api(self) -> list[ModelInfo]:
        """Call the Anthropic Models API."""
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set — cannot fetch models")
            return []

        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            models: list[ModelInfo] = []
            for raw_model in client.models.list():
                info = _parse_model(raw_model)
                if info:
                    models.append(info)
            # Sort: current first, then alphabetically by id
            models.sort(key=lambda m: (0 if m.group == "current" else 1, m.id))
            return models
        except Exception:
            logger.exception("Failed to fetch models from Anthropic API")
            return []

    def _load_cache(self) -> list[dict[str, Any]] | None:
        if self._cache_path.is_file():
            try:
                return json.loads(self._cache_path.read_text(encoding="utf-8"))
            except Exception:
                return None
        return None

    def _save_cache(self, data: list[dict[str, Any]]) -> None:
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception:
            logger.warning("Failed to save model cache", exc_info=True)
