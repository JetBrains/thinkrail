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
from importlib.resources import files
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

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
    permission_modes: dict[str, PermissionModeOverlay] = {}


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
