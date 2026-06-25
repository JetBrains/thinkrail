from __future__ import annotations

import json

import pytest

from app.agent.runtime.claude.catalog import (
    CatalogDocument,
    CatalogHolder,
    parse_catalog,
)

_VALID = json.dumps({
    "schemaVersion": 1,
    "defaultModel": "claude-opus-4-8",
    "models": [
        {"id": "claude-opus-4-8", "label": "Opus 4.8", "efforts": ["high"],
         "context1m": True,
         "pricing": {"input": 5.0, "output": 25.0, "cacheWrite5m": 6.25,
                     "cacheWrite1h": 10.0, "cacheRead": 0.5}},
    ],
    "flags": [{"key": "context1m", "label": "1M", "type": "boolean",
               "default": True, "beta": "context-1m-2025-08-07"}],
    "permissionModes": {"default": {"label": "Ask first"},
                        "dontAsk": {"hidden": True}},
})


class TestParseCatalog:
    def test_parses_valid_document(self):
        doc = parse_catalog(_VALID)
        assert doc.default_model == "claude-opus-4-8"
        assert doc.models[0].pricing.cache_write_5m == 6.25
        assert doc.flags[0].beta == "context-1m-2025-08-07"
        assert doc.permission_modes["dontAsk"].hidden is True

    def test_rejects_invalid_json(self):
        with pytest.raises(ValueError):
            parse_catalog("{not json")

    def test_rejects_missing_required_field(self):
        with pytest.raises(ValueError):
            parse_catalog(json.dumps({"schemaVersion": 1, "models": []}))

    def test_rejects_unknown_schema_version(self):
        bad = json.loads(_VALID)
        bad["schemaVersion"] = 2
        with pytest.raises(ValueError):
            parse_catalog(json.dumps(bad))


class TestCatalogHolder:
    def test_swap_replaces_current(self):
        first = parse_catalog(_VALID)
        holder = CatalogHolder(first)
        assert holder.current is first
        second = parse_catalog(_VALID)
        holder.swap(second)
        assert holder.current is second
        assert isinstance(holder.current, CatalogDocument)


class TestBundled:
    def test_bundled_catalog_parses(self):
        from app.agent.runtime.claude.catalog import load_bundled

        doc = load_bundled()
        ids = [m.id for m in doc.models]
        assert "claude-opus-4-8" in ids
        assert "claude-haiku-4-5-20251001" in ids
        assert doc.default_model in ids
        # Hidden Fable 5 is retained in the catalog (rates/capability lookups).
        assert any(m.hidden for m in doc.models)
        # The 1M flag carries its beta header.
        flag = next(f for f in doc.flags if f.key == "context1m")
        assert flag.beta == "context-1m-2025-08-07"
        # dontAsk is hidden via overlay; default is labelled.
        assert doc.permission_modes["dontAsk"].hidden is True
        assert doc.permission_modes["default"].label
