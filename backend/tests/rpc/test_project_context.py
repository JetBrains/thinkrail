"""Integration tests for ProjectContext lifecycle.

Tests use real temp SQLite databases (no mocking the DB) and verify
the full create → start → use → shutdown lifecycle.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import load_config
from app.rpc.project_context import ProjectContext
from app.spec.index import SpecIndex


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_ctx(tmp_path: Path, **kwargs) -> ProjectContext:
    """Create a ProjectContext with a real temp DB and no-op notify."""
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir(parents=True, exist_ok=True)
    config = load_config(project_root=tmp_path)
    notify_fn = kwargs.pop("notify_fn", AsyncMock())
    return ProjectContext(
        key=str(tmp_path),
        project_root=tmp_path,
        config=config,
        notify_fn=notify_fn,
        **kwargs,
    )


# ── Tests ────────────────────────────────────────────────────────────────────


class TestBasicLifecycle:
    """Create context → start() → access lazy services → shutdown()."""

    async def test_start_opens_index_and_shutdown_closes(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)

        # Before start: index not ready
        assert not ctx.index.is_ready

        await ctx.start()

        # After start: index connection is open (open_and_check was called)
        assert ctx.index._conn is not None

        # Access lazy services — should not raise
        _ = ctx.spec_service
        _ = ctx.board_service
        _ = ctx.runtime_registry

        await ctx.shutdown()

        # After shutdown: index connection closed
        assert ctx.index._conn is None

    async def test_shutdown_is_idempotent(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()
        await ctx.shutdown()
        # Second shutdown should not raise
        await ctx.shutdown()

    async def test_start_services_starts_coordinator(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        # Coordinator not yet started
        assert ctx.coordinator._consumer_task is None

        await ctx.start_services()

        # Coordinator consumer task now running
        assert ctx.coordinator._consumer_task is not None
        assert not ctx.coordinator._consumer_task.done()

        await ctx.shutdown()


class TestSharedContext:
    """Two connections share a context via connection_count."""

    async def test_context_survives_first_disconnect(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()
        await ctx.start_services()

        # Simulate two connections
        ctx.connection_count = 2

        # First disconnect
        ctx.connection_count -= 1
        assert ctx.connection_count == 1
        # Context still alive — don't call shutdown

        # Access services — should still work
        specs = await ctx.spec_service.list_specs()
        assert isinstance(specs, list)

        # Second disconnect — triggers shutdown
        ctx.connection_count -= 1
        assert ctx.connection_count == 0
        await ctx.shutdown()

        # Index closed
        assert ctx.index._conn is None


class TestFailedStart:
    """Mock index.open_and_check() to raise — verify clean teardown."""

    async def test_failed_start_cleans_up(self, tmp_path: Path) -> None:
        notify_fn = AsyncMock()
        ctx = _make_ctx(tmp_path, notify_fn=notify_fn)

        with patch.object(
            SpecIndex, "open_and_check", side_effect=RuntimeError("DB corrupt"),
        ):
            with pytest.raises(RuntimeError, match="DB corrupt"):
                await ctx.start()

        # Cleanup ran: coordinator stopped (no task to cancel but stop() ran)
        assert ctx.coordinator._consumer_task is None

        # Notify was called with index/ready so frontend can proceed
        notify_fn.assert_called_with("index/ready", {})

    async def test_failed_start_leaves_no_orphan_tasks(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)

        # Collect tasks before
        tasks_before = {t for t in asyncio.all_tasks() if not t.done()}

        with patch.object(
            SpecIndex, "open_and_check", side_effect=RuntimeError("boom"),
        ):
            with pytest.raises(RuntimeError):
                await ctx.start()

        # No new tasks leaked
        tasks_after = {t for t in asyncio.all_tasks() if not t.done()}
        leaked = tasks_after - tasks_before
        assert not leaked, f"Orphan tasks after failed start: {leaked}"


class TestLazyServiceCaching:
    """Lazy properties create services once and cache them."""

    async def test_spec_service_cached(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        svc1 = ctx.spec_service
        svc2 = ctx.spec_service
        assert svc1 is svc2

        await ctx.shutdown()

    async def test_agent_service_cached(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        svc1 = ctx.agent_service
        svc2 = ctx.agent_service
        assert svc1 is svc2

        await ctx.shutdown()

    async def test_all_services_are_distinct_instances(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        services = [
            ctx.spec_service,
            ctx.agent_service,
            ctx.board_service,
            ctx.runtime_registry,
        ]
        # All are distinct objects
        ids = [id(s) for s in services]
        assert len(set(ids)) == len(ids)

        await ctx.shutdown()


class TestCrossInjection:
    """Lazy property getters wire cross-dependencies automatically."""

    async def test_agent_service_has_coordinator(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        assert ctx.agent_service.coordinator is ctx.coordinator

        await ctx.shutdown()

    async def test_agent_service_has_board_service(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        assert ctx.agent_service.board_service is ctx.board_service

        await ctx.shutdown()

    async def test_agent_service_has_runtime_registry(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        assert ctx.agent_service.runtime_registry is ctx.runtime_registry

        await ctx.shutdown()

    async def test_coordinator_has_spec_service(self, tmp_path: Path) -> None:
        ctx = _make_ctx(tmp_path)
        await ctx.start()

        # Accessing spec_service wires coordinator.spec_service
        _ = ctx.spec_service
        assert ctx.coordinator.spec_service is ctx.spec_service

        await ctx.shutdown()

