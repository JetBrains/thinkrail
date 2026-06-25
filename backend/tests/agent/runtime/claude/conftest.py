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
