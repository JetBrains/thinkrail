"""Model registry — fetches available models from the Anthropic API.

Provides a cached, periodically refreshed list of Claude models with
context window and pricing tier metadata.  Falls back to a hardcoded
list when the API is unreachable or no credential is available.

"Current" vs "legacy" classification is derived dynamically: the
highest-version model in each family (opus/sonnet/haiku) is tagged
"current", everything else "legacy".  This way the next Anthropic
release is reflected without a code change.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from app.core.config import BONSAI_DIRNAME, CACHE_DIR, MODELS_CACHE_FILE

from .credentials import resolve_anthropic_api_key

logger = logging.getLogger(__name__)

# ── Hardcoded fallback (used when API + cache are both unavailable) ───────

_FALLBACK: list[dict[str, Any]] = [
    {"id": "claude-opus-4-6",   "label": "Opus 4.6",   "group": "current", "contextWindow": 1_000_000, "maxOutput": 128_000, "pricingTier": "opus"},
    {"id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "group": "current", "contextWindow": 1_000_000, "maxOutput": 64_000,  "pricingTier": "sonnet"},
    {"id": "claude-haiku-4-5",  "label": "Haiku 4.5",  "group": "current", "contextWindow": 200_000,   "maxOutput": 64_000,  "pricingTier": "haiku"},
    {"id": "claude-opus-4-5",   "label": "Opus 4.5",   "group": "legacy",  "contextWindow": 200_000,   "maxOutput": 64_000,  "pricingTier": "opus"},
    {"id": "claude-opus-4-1",   "label": "Opus 4.1",   "group": "legacy",  "contextWindow": 200_000,   "maxOutput": 64_000,  "pricingTier": "opus"},
    {"id": "claude-opus-4-0",   "label": "Opus 4",     "group": "legacy",  "contextWindow": 200_000,   "maxOutput": 64_000,  "pricingTier": "opus"},
    {"id": "claude-sonnet-4-5", "label": "Sonnet 4.5", "group": "legacy",  "contextWindow": 1_000_000, "maxOutput": 64_000,  "pricingTier": "sonnet"},
    {"id": "claude-sonnet-4-0", "label": "Sonnet 4",   "group": "legacy",  "contextWindow": 1_000_000, "maxOutput": 64_000,  "pricingTier": "sonnet"},
]


@dataclass
class ModelInfo:
    id: str
    label: str
    group: str  # "current" | "legacy"
    contextWindow: int
    maxOutput: int
    pricingTier: str  # "opus" | "sonnet" | "haiku"


# Trailing date stamp (8 consecutive digits) that some model ids carry.
_DATE_SUFFIX_RE = re.compile(r"-\d{8}$")
# After date stripping, versions look like "-major-minor" (e.g. "-4-7") or
# just "-major" for the .0 release (e.g. "claude-opus-4" from
# "claude-opus-4-20250514" once the date is stripped).
_MAJOR_MINOR_RE = re.compile(r"-(\d+)-(\d+)$")
_MAJOR_ONLY_RE = re.compile(r"-(\d+)$")


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


def _derive_family(model_id: str) -> str | None:
    m = model_id.lower()
    if "opus" in m:
        return "opus"
    if "sonnet" in m:
        return "sonnet"
    if "haiku" in m:
        return "haiku"
    return None


def _parse_version(model_id: str) -> tuple[int, int] | None:
    """Extract (major, minor) from an Anthropic model id.

    Handles three shapes:
      - "claude-opus-4-7"              → (4, 7)
      - "claude-opus-4-5-20251101"     → (4, 5)   (trailing date stripped)
      - "claude-opus-4-20250514"       → (4, 0)   (date-only suffix means .0)
    """
    stripped = _DATE_SUFFIX_RE.sub("", model_id)
    m = _MAJOR_MINOR_RE.search(stripped)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = _MAJOR_ONLY_RE.search(stripped)
    if m:
        return (int(m.group(1)), 0)
    return None


def _classify_current(models: list[ModelInfo]) -> None:
    """Mark the highest-version model per family as 'current', rest as 'legacy'.

    Mutates the list in place.  Models whose id does not match the version
    pattern stay 'legacy'.
    """
    best_per_family: dict[str, tuple[tuple[int, ...], int]] = {}
    for i, m in enumerate(models):
        family = _derive_family(m.id)
        version = _parse_version(m.id)
        if family is None or version is None:
            continue
        current_best = best_per_family.get(family)
        if current_best is None or version > current_best[0]:
            best_per_family[family] = (version, i)

    winning_indices = {idx for _, idx in best_per_family.values()}
    for i, m in enumerate(models):
        m.group = "current" if i in winning_indices else "legacy"


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

    return ModelInfo(
        id=model_id,
        label=_derive_label(display_name),
        group="legacy",  # overwritten by _classify_current
        contextWindow=max_input,
        maxOutput=max_output,
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
        self._last_error: str | None = None
        self._source: str = "fallback"  # "api" | "cache" | "fallback"
        self._refresh_task: asyncio.Task[None] | None = None
        self._cache_path = project_root / BONSAI_DIRNAME / CACHE_DIR / MODELS_CACHE_FILE

    # ── Public API ────────────────────────────────────────────────────

    def get_models(self) -> list[dict[str, Any]]:
        """Return the current model list as dicts (JSON-serializable)."""
        if self._models:
            return [asdict(m) for m in self._models]
        cached = self._load_cache()
        if cached:
            self._source = "cache"
            return cached
        self._source = "fallback"
        return list(_FALLBACK)

    def get_status(self) -> dict[str, Any]:
        """Return metadata about the current model list source."""
        return {
            "source": self._source,
            "error": self._last_error,
            "lastRefresh": self._last_refresh if self._last_refresh > 0 else None,
        }

    async def refresh(self) -> list[dict[str, Any]]:
        """Fetch models from the API and update the cache."""
        models, error = await self._fetch_from_api()
        if models:
            self._models = models
            self._last_refresh = time.monotonic()
            self._last_error = None
            self._source = "api"
            self._save_cache([asdict(m) for m in models])
            logger.info("Model registry refreshed: %d models", len(models))
        else:
            self._last_error = error
            logger.warning("Model registry refresh failed: %s", error or "no models returned")
            if not self._models:
                cached = self._load_cache()
                if cached:
                    self._models = [ModelInfo(**m) for m in cached]
                    self._source = "cache"
                else:
                    self._source = "fallback"
        return self.get_models()

    async def start_periodic_refresh(self) -> None:
        """Start background periodic refresh task."""
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

    async def _fetch_from_api(self) -> tuple[list[ModelInfo], str | None]:
        """Call the Anthropic Models API.

        Returns (models, error).  On success, models is non-empty and error
        is None.  On any failure, models is empty and error is a
        user-readable string.
        """
        api_key = resolve_anthropic_api_key()
        if not api_key:
            return [], (
                "No Anthropic API key available. Set ANTHROPIC_API_KEY, or log in "
                "with `claude auth login` so Bonsai can reuse the managed key."
            )

        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            models: list[ModelInfo] = []
            for raw_model in client.models.list():
                info = _parse_model(raw_model)
                if info:
                    models.append(info)
            _classify_current(models)
            # Sort: current first, then alphabetically by id
            models.sort(key=lambda m: (0 if m.group == "current" else 1, m.id))
            return models, None
        except Exception as e:  # noqa: BLE001
            logger.exception("Failed to fetch models from Anthropic API")
            return [], f"{type(e).__name__}: {e}"

    def _load_cache(self) -> list[dict[str, Any]] | None:
        if self._cache_path.is_file():
            try:
                return json.loads(self._cache_path.read_text(encoding="utf-8"))
            except Exception:
                return None
        return None

    def _save_cache(self, data: list[dict[str, Any]]) -> None:
        # Never materialize .bonsai/ just for a background model refresh —
        # the project folder must stay clean until the user starts a
        # session (which creates .bonsai/sessions/ via append_event).
        bonsai_dir = self._project_root / BONSAI_DIRNAME
        if not bonsai_dir.is_dir():
            return
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception:
            logger.warning("Failed to save model cache", exc_info=True)
