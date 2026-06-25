from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.agent.runtime.claude import catalog as cat

_DOC_A = json.dumps({"schemaVersion": 1, "defaultModel": "m",
                     "models": [{"id": "m", "label": "M",
                                 "pricing": {"input": 1, "output": 1, "cacheWrite5m": 1,
                                             "cacheWrite1h": 1, "cacheRead": 1}}]})


def test_catalog_url_default_and_disable(monkeypatch):
    monkeypatch.delenv("THINKRAIL_MODEL_CATALOG_URL", raising=False)
    assert cat.catalog_url() == cat.DEFAULT_CATALOG_URL
    monkeypatch.setenv("THINKRAIL_MODEL_CATALOG_URL", "")
    assert cat.catalog_url() is None
    monkeypatch.setenv("THINKRAIL_MODEL_CATALOG_URL", "https://example/x.json")
    assert cat.catalog_url() == "https://example/x.json"


@pytest.mark.asyncio
async def test_refresh_swaps_and_calls_on_change():
    holder = cat.CatalogHolder(cat.load_bundled())
    on_change = AsyncMock()
    with patch.object(cat, "fetch_catalog", AsyncMock(return_value=cat.parse_catalog(_DOC_A))):
        swapped = await cat.refresh_catalog(holder, on_change)
    assert swapped is True
    assert holder.current.default_model == "m"
    on_change.assert_awaited_once()


@pytest.mark.asyncio
async def test_refresh_noop_when_unchanged():
    doc = cat.load_bundled()
    holder = cat.CatalogHolder(doc)
    on_change = AsyncMock()
    with patch.object(cat, "fetch_catalog", AsyncMock(return_value=cat.load_bundled())):
        swapped = await cat.refresh_catalog(holder, on_change)
    assert swapped is False
    on_change.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_keeps_current_on_fetch_failure():
    holder = cat.CatalogHolder(cat.load_bundled())
    before = holder.current
    with patch.object(cat, "fetch_catalog", AsyncMock(side_effect=RuntimeError("offline"))):
        swapped = await cat.refresh_catalog(holder, None)
    assert swapped is False
    assert holder.current is before


@pytest.mark.asyncio
async def test_refresh_disabled_when_url_empty(monkeypatch):
    monkeypatch.setenv("THINKRAIL_MODEL_CATALOG_URL", "")
    holder = cat.CatalogHolder(cat.load_bundled())
    fetch = AsyncMock()
    with patch.object(cat, "fetch_catalog", fetch):
        swapped = await cat.refresh_catalog(holder, None)
    assert swapped is False
    fetch.assert_not_awaited()


def test_cache_path_isolated_to_tmp_data_dir(tmp_path):
    """Guard: tests must never resolve the cache to the real ~/.tr. With the
    autouse data-dir isolation fixture active, cache_path() lives under the tmp
    THINKRAIL_DATA_DIR, not the user's home."""
    import os
    from pathlib import Path
    cp = cat.cache_path()
    assert cp.name == "model-catalog.json"
    # Must be under the isolated tmp dir, never the real ~/.tr.
    assert str(cp).startswith(os.environ["THINKRAIL_DATA_DIR"])
    assert Path.home() / ".tr" not in cp.parents
