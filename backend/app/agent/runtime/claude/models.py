"""Claude model registry — fetches available models from the Anthropic API.

Private to the Claude runtime. Returns neutral ``ModelInfo`` so that
``IAgentRuntime.list_models`` consumers stay SDK-agnostic.

Provides a cached, periodically refreshed list of Claude models with
context window, pricing tier, and capability flags. Falls back to a
hardcoded list when the API is unreachable or no credential is available.

"Current" vs "legacy" classification is derived dynamically: the
highest-version model in each family (opus/sonnet/haiku) is tagged
"current", everything else "legacy".
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.agent.runtime.types import (
    DEFAULT_CONTEXT_WINDOW,
    ModelInfo,
)
from app.core.config import BONSAI_DIRNAME, CACHE_DIR, MODELS_CACHE_FILE

from .credentials import resolve_anthropic_api_key

logger = logging.getLogger(__name__)


def _log_refresh_exception(task: asyncio.Task[Any]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.warning("Background Claude model refresh raised", exc_info=exc)

# ── Hardcoded fallback (used when API + cache are both unavailable) ───────
# Cache JSON uses camelCase keys for on-disk back-compat; the in-memory
# ``_ClaudeRow`` dataclass is snake_case like the rest of the codebase.

_FALLBACK: list[dict[str, Any]] = [
    {"id": "claude-opus-4-7",   "label": "Opus 4.7",   "group": "current", "contextWindow": 1_000_000, "maxOutput": 128_000, "pricingTier": "opus"},
    {"id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "group": "current", "contextWindow": 1_000_000, "maxOutput": 64_000,  "pricingTier": "sonnet"},
    {"id": "claude-haiku-4-5",  "label": "Haiku 4.5",  "group": "current", "contextWindow": 200_000,   "maxOutput": 64_000,  "pricingTier": "haiku"},
]


@dataclass
class _ClaudeRow:
    """Mutable internal row used during API parsing + classification.

    Kept private to this module; the public surface (``list_models``) projects
    to neutral ``ModelInfo``.
    """

    id: str
    label: str
    group: str  # "current" | "legacy" — mutated by _classify_current
    context_window: int
    max_output: int
    pricing_tier: str  # "opus" | "sonnet" | "haiku"

    def to_model_info(self) -> ModelInfo:
        return ModelInfo(
            id=self.id,
            label=self.label,
            group=self.group,
            context_window=self.context_window,
            max_output=self.max_output,
            pricing_tier=self.pricing_tier,
        )


# ── On-disk JSON shape ────────────────────────────────────────────────────
# Cache files were written with camelCase keys before the refactor; keep the
# wire format unchanged so users with an existing ``.bonsai/cache/models.json``
# still load without a migration.

def _row_to_cache_dict(row: _ClaudeRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "label": row.label,
        "group": row.group,
        "contextWindow": row.context_window,
        "maxOutput": row.max_output,
        "pricingTier": row.pricing_tier,
    }


def _cache_dict_to_row(d: dict[str, Any]) -> _ClaudeRow:
    return _ClaudeRow(
        id=d["id"],
        label=d["label"],
        group=d["group"],
        context_window=d["contextWindow"],
        max_output=d["maxOutput"],
        pricing_tier=d["pricingTier"],
    )


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


def _classify_current(models: list[_ClaudeRow]) -> None:
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


def _parse_model(raw: Any) -> _ClaudeRow | None:
    """Convert an API model object to _ClaudeRow, or None if not a Claude chat model."""
    model_id: str = getattr(raw, "id", "") or ""
    if not model_id.startswith("claude-"):
        return None
    # Skip deprecated / very old models
    if "claude-2" in model_id or "claude-3-" in model_id:
        return None

    display_name: str = getattr(raw, "display_name", model_id) or model_id
    max_input: int = getattr(raw, "max_input_tokens", 200_000) or 200_000
    max_output: int = getattr(raw, "max_tokens", 64_000) or 64_000

    return _ClaudeRow(
        id=model_id,
        label=_derive_label(display_name),
        group="legacy",  # overwritten by _classify_current
        context_window=max_input,
        max_output=max_output,
        pricing_tier=_derive_pricing_tier(model_id),
    )


# ── Registry ──────────────────────────────────────────────────────────────


class ClaudeModelRegistry:
    """Fetches and caches the list of available Claude models.

    Private to the Claude runtime — the public surface (``list_models``,
    ``refresh_models``, ``models_status``, ``get_context_window``) is
    re-exposed via ``IAgentRuntime`` on ``ClaudeRuntime``.

    ``list_models`` returns a cached projection; the cache is invalidated
    only when ``_rows`` mutates inside ``refresh_models``, so per-event
    callers (``_get_context_max``) don't repeatedly rebuild Pydantic
    models.

    Lazy lifecycle: the first call to ``list_models`` kicks off a one-shot
    background ``refresh_models`` so subsequent calls see live data. No
    periodic loop, no protocol-level startup/shutdown — the registry is
    stateful internally but presents itself as a pure lookup.
    """

    def __init__(self, project_root: Path) -> None:
        self._project_root = project_root
        self._rows: list[_ClaudeRow] = []
        self._last_refresh: float = 0.0
        self._last_error: str | None = None
        self._source: str = "fallback"  # "api" | "cache" | "fallback"
        self._cache_path = project_root / BONSAI_DIRNAME / CACHE_DIR / MODELS_CACHE_FILE
        # Cached projection; invalidated by setting to None.
        self._projection: tuple[ModelInfo, ...] | None = None
        self._index_by_id: dict[str, ModelInfo] | None = None
        # One-shot background refresh handle. Kicked off on first
        # ``list_models`` call; we hold the reference so the task isn't GC'd.
        self._initial_refresh: asyncio.Task[Any] | None = None

    # ── Public API ────────────────────────────────────────────────────

    def list_models(self) -> list[ModelInfo]:
        """Return the current model list as neutral ``ModelInfo`` objects.

        First call also schedules a one-shot background refresh so the
        cached list catches up with the live Anthropic API without
        blocking the caller.
        """
        self._maybe_schedule_initial_refresh()
        return list(self._ensure_projection())

    def models_status(self) -> dict[str, Any]:
        """Return metadata about the current model list source."""
        return {
            "source": self._source,
            "error": self._last_error,
            "lastRefresh": self._last_refresh if self._last_refresh > 0 else None,
        }

    def get_context_window(self, model_id: str) -> int:
        """Look up the context window for ``model_id`` within this runtime.

        Consults the live/cached/fallback list first; returns the conservative
        neutral default when the id is unknown. The runtime is the single
        source of truth — callers must not maintain their own model→window
        tables.
        """
        self._ensure_projection()
        idx = self._index_by_id
        if idx is None:
            return DEFAULT_CONTEXT_WINDOW
        hit = idx.get(model_id)
        if hit is None:
            return DEFAULT_CONTEXT_WINDOW
        return hit.context_window

    async def refresh_models(self) -> list[ModelInfo]:
        """Fetch models from the API and update the cache."""
        rows, error = await self._fetch_from_api()
        if rows:
            self._rows = rows
            self._last_refresh = time.monotonic()
            self._last_error = None
            self._source = "api"
            self._invalidate_projection()
            self._save_cache([_row_to_cache_dict(r) for r in rows])
            logger.info("Claude model registry refreshed: %d models", len(rows))
        else:
            self._last_error = error
            logger.warning("Claude model registry refresh failed: %s", error or "no models returned")
            if not self._rows:
                cached = self._load_cache()
                if cached:
                    self._rows = [_cache_dict_to_row(d) for d in cached]
                    self._source = "cache"
                    self._invalidate_projection()
                else:
                    self._source = "fallback"
        return self.list_models()

    # ── Projection cache ──────────────────────────────────────────────

    def _invalidate_projection(self) -> None:
        self._projection = None
        self._index_by_id = None

    def _ensure_projection(self) -> tuple[ModelInfo, ...]:
        """Materialise the neutral projection once per row-set change."""
        if self._projection is not None:
            return self._projection
        if self._rows:
            models = tuple(r.to_model_info() for r in self._rows)
        else:
            cached = self._load_cache()
            if cached:
                self._source = "cache"
                models = tuple(_cache_dict_to_row(d).to_model_info() for d in cached)
            else:
                self._source = "fallback"
                models = tuple(_cache_dict_to_row(d).to_model_info() for d in _FALLBACK)
        self._projection = models
        self._index_by_id = {m.id: m for m in models}
        return models

    # ── Lazy initial refresh ─────────────────────────────────────────

    def _maybe_schedule_initial_refresh(self) -> None:
        """Kick off a one-shot background refresh on first use.

        No-op once the task has been scheduled — the periodic refresh
        loop is intentionally gone; callers can hit the ``models/refresh``
        RPC if they want fresher data after this initial pass.
        """
        if self._initial_refresh is not None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No event loop yet (e.g. tests calling list_models from sync code).
            # The next call from inside the loop will schedule it.
            return
        self._initial_refresh = loop.create_task(self._safe_refresh())
        self._initial_refresh.add_done_callback(_log_refresh_exception)

    async def _safe_refresh(self) -> None:
        try:
            await self.refresh_models()
        except Exception:
            logger.exception("Initial Claude model refresh failed")

    # ── Internal ──────────────────────────────────────────────────────

    async def _fetch_from_api(self) -> tuple[list[_ClaudeRow], str | None]:
        """Call the Anthropic Models API.

        Returns (rows, error).  On success, rows is non-empty and error
        is None.  On any failure, rows is empty and error is a
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
            rows: list[_ClaudeRow] = []
            for raw_model in client.models.list():
                info = _parse_model(raw_model)
                if info:
                    rows.append(info)
            _classify_current(rows)
            # Sort: current first, then alphabetically by id
            rows.sort(key=lambda m: (0 if m.group == "current" else 1, m.id))
            return rows, None
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
            logger.warning("Failed to save Claude model cache", exc_info=True)
