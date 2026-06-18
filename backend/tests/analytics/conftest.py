from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.analytics import service
from app.core.app_store import AppStore


@pytest.fixture
async def app_store(tmp_path: Path) -> AsyncIterator[AppStore]:
    store = AppStore(tmp_path)
    await store.open()
    try:
        yield store
    finally:
        await store.close()


@pytest.fixture(autouse=True)
def reset_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> AsyncIterator[None]:
    """Isolate the module singleton and never read the real install.json."""
    service._state = None
    monkeypatch.setattr(service, "INSTALL_METADATA_PATH", tmp_path / "no-install.json")
    yield
    service._state = None


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Replace the transport sink so emitted payloads can be asserted."""
    m = MagicMock()
    monkeypatch.setattr(service, "_send", m)
    return m
