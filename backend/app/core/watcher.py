from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from watchfiles import awatch, Change


@dataclass
class WatchHandle:
    """Opaque handle to a running file watch."""

    _task: asyncio.Task[None] = field(repr=False)


async def watch(
    paths: list[Path],
    callback: Callable[[set[tuple[Change, str]]], Any],
) -> WatchHandle:
    """Start watching *paths* for file changes.

    *callback* is called with a set of ``(change_type, path)`` tuples each time
    changes are detected.  The callback may be a coroutine function.

    Returns a :class:`WatchHandle` that can be passed to :func:`stop`.
    """

    async def _run() -> None:
        str_paths = [str(p) for p in paths]
        async for changes in awatch(*str_paths):
            result = callback(changes)
            if asyncio.iscoroutine(result):
                await result

    task = asyncio.create_task(_run())
    return WatchHandle(_task=task)


async def stop(handle: WatchHandle) -> None:
    """Cancel a running file watch."""
    handle._task.cancel()
    try:
        await handle._task
    except asyncio.CancelledError:
        pass
