from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import create_app


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    # Isolated data dir (no real ~/.tr writes) + fetch disabled (no network).
    monkeypatch.setenv("THINKRAIL_DATA_DIR", str(tmp_path / "tr-data"))
    monkeypatch.setenv("THINKRAIL_MODEL_CATALOG_URL", "")


def test_startup_serves_full_bundled_catalog():
    """Booting the app with a clean data dir and fetch disabled must leave the
    bundled catalog in place — the model picker sees the real models."""
    app = create_app()
    with TestClient(app):  # runs the lifespan (cache-boot + background refresh)
        from app.agent.runtime.claude.models import ClaudeModelRegistry

        opts = ClaudeModelRegistry().list_options()
        ids = [o.value for o in opts]
        assert "claude-opus-4-8" in ids
        assert "claude-sonnet-4-6" in ids
        assert "claude-haiku-4-5-20251001" in ids
        # Hidden Fable 5 is excluded from the picker.
        assert "claude-fable-5" not in ids
        # Default model is first (the documented contract).
        assert ids[0] == "claude-opus-4-8"
        # "M"/test-only ids must never appear.
        assert "m" not in ids
