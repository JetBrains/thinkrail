"""Curated Claude model catalog: schema, bundled loader, and the process-wide
holder every reader (registry, runtime capabilities) consults.

The catalog is data, not code: model list, per-model efforts and 1M support,
pricing, the default model, the 1M flag (with its beta header), and
permission-mode labels all live in ``models.json``. The permission-mode *set*
and the effort *universe* are NOT here — those come from the installed
``claude_agent_sdk`` literals and clamp anything the catalog offers.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Awaitable, Callable
from importlib.resources import files
from pathlib import Path
from typing import Literal

import httpx

from app.core.config import ENV_PREFIX, get_data_dir

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.agent.models import to_camel

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1


class CatalogPricing(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    input: float
    output: float
    cache_write_5m: float
    cache_write_1h: float
    cache_read: float


class CatalogModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    id: str
    label: str
    hidden: bool = False
    efforts: tuple[str, ...] = ()
    context1m: bool = False
    pricing: CatalogPricing


class CatalogFlag(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    key: str
    label: str
    type: Literal["boolean"]
    default: bool
    description: str = ""
    beta: str | None = None


class PermissionModeOverlay(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    label: str | None = None
    description: str = ""
    hidden: bool = False


class CatalogDocument(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    schema_version: int
    default_model: str
    models: tuple[CatalogModel, ...]
    flags: tuple[CatalogFlag, ...] = ()
    permission_modes: dict[str, PermissionModeOverlay] = Field(default_factory=dict)


def parse_catalog(text: str) -> CatalogDocument:
    """Parse and validate catalog JSON. Raises ``ValueError`` on bad JSON,
    schema-validation failure, or an unsupported ``schemaVersion``."""
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"catalog is not valid JSON: {exc}") from exc
    try:
        doc = CatalogDocument.model_validate(raw)
    except ValidationError as exc:
        raise ValueError(f"catalog failed validation: {exc}") from exc
    if doc.schema_version != SCHEMA_VERSION:
        raise ValueError(
            f"unsupported catalog schemaVersion {doc.schema_version} "
            f"(this build understands {SCHEMA_VERSION})"
        )
    return doc


def load_bundled() -> CatalogDocument:
    """Parse the ``models.json`` shipped with the package."""
    text = files(__package__).joinpath("models.json").read_text(encoding="utf-8")
    return parse_catalog(text)


class CatalogHolder:
    """Holds the active catalog. ``swap`` is a single attribute assignment;
    readers see either the old or the new document, both valid."""

    def __init__(self, doc: CatalogDocument) -> None:
        self._current = doc

    @property
    def current(self) -> CatalogDocument:
        return self._current

    def swap(self, doc: CatalogDocument) -> None:
        self._current = doc


catalog_holder = CatalogHolder(load_bundled())


# ── Remote fetch, cache, refresh ───────────────────────────────────────────

DEFAULT_CATALOG_URL = (
    "https://raw.githubusercontent.com/JetBrains/thinkrail/main/"
    "backend/app/agent/runtime/claude/models.json"
)
_URL_ENV = f"{ENV_PREFIX}MODEL_CATALOG_URL"


def catalog_url() -> str | None:
    """The catalog source URL. ``THINKRAIL_MODEL_CATALOG_URL`` overrides the
    default; an explicitly empty value disables fetching."""
    override = os.environ.get(_URL_ENV)
    if override is None:
        return DEFAULT_CATALOG_URL
    return override or None


def cache_path() -> Path:
    return get_data_dir() / "model-catalog.json"


def read_cache() -> CatalogDocument | None:
    try:
        return parse_catalog(cache_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.debug("No usable model-catalog cache", exc_info=True)
        return None


def write_cache(doc: CatalogDocument) -> None:
    try:
        path = cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(doc.model_dump_json(by_alias=True), encoding="utf-8")
    except OSError:
        logger.debug("Failed to write model-catalog cache", exc_info=True)


async def fetch_catalog(url: str, timeout: float = 3.0) -> CatalogDocument:
    """GET and validate the catalog. Raises on network or validation failure."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return parse_catalog(resp.text)


async def refresh_catalog(
    holder: CatalogHolder,
    on_change: Callable[[], Awaitable[None]] | None = None,
) -> bool:
    """Fetch the catalog and, if it differs from the current one, cache + swap +
    notify. Returns True if a swap happened. Never raises — every failure is
    logged at debug and leaves the current catalog in place."""
    url = catalog_url()
    if not url:
        logger.debug("Model-catalog fetch disabled (empty %s)", _URL_ENV)
        return False
    try:
        fetched = await fetch_catalog(url)
    except Exception:
        logger.debug("Model-catalog fetch failed; keeping current", exc_info=True)
        return False
    if fetched == holder.current:
        return False
    write_cache(fetched)
    holder.swap(fetched)
    logger.info("Model catalog updated from %s", url)
    if on_change is not None:
        try:
            await on_change()
        except Exception:
            logger.debug("Model-catalog on_change callback failed", exc_info=True)
    return True
