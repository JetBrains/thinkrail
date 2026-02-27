import asyncio
from pathlib import Path

import pytest

from app.core.watcher import watch, stop


@pytest.mark.asyncio
async def test_watch_detects_file_creation(tmp_path: Path) -> None:
    """watch() should fire the callback when a file is created."""
    received: list[set] = []
    event = asyncio.Event()

    def on_change(changes: set) -> None:
        received.append(changes)
        event.set()

    handle = await watch([tmp_path], on_change)
    try:
        # Give watcher a moment to initialize
        await asyncio.sleep(0.1)
        (tmp_path / "new_file.txt").write_text("hello", encoding="utf-8")
        # Wait for callback (timeout after 5 seconds)
        await asyncio.wait_for(event.wait(), timeout=5.0)
        assert len(received) >= 1
    finally:
        await stop(handle)


@pytest.mark.asyncio
async def test_stop_cancels_watcher(tmp_path: Path) -> None:
    """stop() should cleanly cancel the watcher task."""
    handle = await watch([tmp_path], lambda changes: None)
    assert not handle._task.done()
    await stop(handle)
    assert handle._task.done()
