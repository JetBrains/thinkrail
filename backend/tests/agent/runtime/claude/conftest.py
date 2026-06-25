from __future__ import annotations

import pytest

import app.agent.runtime.claude.models as models_mod


@pytest.fixture(autouse=True)
def _restore_catalog_holder():
    """Restore the process-wide catalog after each test so a test that swaps in
    a custom catalog can't leak it into sibling test files."""
    original = models_mod.catalog_holder.current
    yield
    models_mod.catalog_holder.swap(original)


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path, monkeypatch):
    """Point THINKRAIL_DATA_DIR at a per-test tmp dir so catalog cache writes
    (write_cache / refresh_catalog) never touch the developer's real ~/.tr."""
    monkeypatch.setenv("THINKRAIL_DATA_DIR", str(tmp_path / "tr-data"))
