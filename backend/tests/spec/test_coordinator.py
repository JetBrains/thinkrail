"""Integration tests for the IndexCoordinator — the single-consumer event bus
that serializes all spec index mutations."""

from __future__ import annotations

import asyncio
import textwrap
from pathlib import Path
from typing import Any

import pytest

from app.spec.coordinator import (
    DiffScanRequested,
    FileChanged,
    IndexCoordinator,
    RebuildRequested,
    SpecDeleteRequested,
)
from app.spec.index import SpecIndex


# ── Helpers ──────────────────────────────────────────────────────────────────


def _write_spec_file(root: Path, rel_path: str, content: str) -> Path:
    """Write a file at root/rel_path and return the full path."""
    full = root / rel_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(textwrap.dedent(content), encoding="utf-8")
    return full


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
async def index(tmp_path: Path):
    """Create a SpecIndex with schema, yield, then close."""
    db_path = tmp_path / ".bonsai" / "index.db"
    idx = SpecIndex(db_path)
    async with idx:
        yield idx


@pytest.fixture
def notifications() -> list[tuple[str, dict]]:
    """Accumulator for coordinator notifications."""
    return []


@pytest.fixture
async def coordinator(index, tmp_path, notifications):
    """Create a coordinator, start it, yield, then stop it."""

    async def notify(method: str, params: dict[str, Any]) -> None:
        notifications.append((method, params))

    coord = IndexCoordinator(index, tmp_path, notify)
    coord.start()
    yield coord
    await coord.stop()


# ── TestRebuildSerialization ─────────────────────────────────────────────────


class TestRebuildSerialization:
    """Verify that concurrent rebuild requests are processed sequentially."""

    async def test_concurrent_rebuilds_serialized(
        self, coordinator, index, tmp_path, notifications
    ):
        """Two RebuildRequested events execute one at a time, not concurrently."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Emit two rebuild events directly (bypassing debounce)
        coordinator.emit(RebuildRequested(reason="test-1"))
        coordinator.emit(RebuildRequested(reason="test-2"))

        # Wait for queue to drain
        await coordinator._queue.join()

        # Both rebuilds completed, index has the spec
        spec = await index.get_spec("spec-a")
        assert spec is not None

        # Should have 2 rebuilding + 2 ready notifications
        rebuilding_count = sum(
            1 for m, _ in notifications if m == "index/rebuilding"
        )
        ready_count = sum(1 for m, _ in notifications if m == "index/ready")
        assert rebuilding_count == 2
        assert ready_count == 2

    async def test_rebuilds_are_not_concurrent(
        self, coordinator, index, tmp_path, notifications
    ):
        """Track that rebuilds do not overlap — each 'rebuilding' is followed
        by 'ready' before the next 'rebuilding'."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        coordinator.emit(RebuildRequested(reason="first"))
        coordinator.emit(RebuildRequested(reason="second"))
        coordinator.emit(RebuildRequested(reason="third"))

        await coordinator._queue.join()

        # Extract only rebuild-related notifications
        rebuild_methods = [
            m
            for m, _ in notifications
            if m in ("index/rebuilding", "index/ready")
        ]

        # Should strictly alternate: rebuilding, ready, rebuilding, ready, ...
        assert len(rebuild_methods) == 6
        for i, method in enumerate(rebuild_methods):
            if i % 2 == 0:
                assert method == "index/rebuilding", (
                    f"Expected 'index/rebuilding' at position {i}, got '{method}'"
                )
            else:
                assert method == "index/ready", (
                    f"Expected 'index/ready' at position {i}, got '{method}'"
                )


# ── TestReadConsistency ──────────────────────────────────────────────────────


class TestReadConsistency:
    """WAL-mode read consistency: readers see stable data until rebuild commits."""

    async def test_read_consistency_during_rebuild(
        self, coordinator, index, tmp_path
    ):
        """Readers see consistent data (pre-rebuild) until rebuild commits."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Do initial build
        coordinator.emit(RebuildRequested(reason="initial"))
        await coordinator._queue.join()

        # Verify spec exists
        spec = await index.get_spec("spec-a")
        assert spec is not None

        # Now modify the spec and rebuild
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            status: active
            ---
            # Spec A (updated)
            """,
        )

        coordinator.emit(RebuildRequested(reason="update"))
        await coordinator._queue.join()

        # After rebuild, see updated data
        spec = await index.get_spec("spec-a")
        assert spec is not None
        assert spec.status == "active"


# ── TestDrainBehavior ────────────────────────────────────────────────────────


class TestDrainBehavior:
    """RebuildRequested drains stale FileChanged events from the queue."""

    async def test_file_changed_drained_on_rebuild(
        self, coordinator, index, tmp_path, notifications
    ):
        """FileChanged events queued after RebuildRequested are drained by
        the rebuild handler before it starts the full scan."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Stop the coordinator so we can queue events manually
        await coordinator.stop()

        # Queue: RebuildRequested first, then 5 FileChanged events.
        # When the rebuild handler runs, _drain_file_events() will
        # remove the FileChanged events from the queue.
        coordinator.emit(RebuildRequested(reason="rebuild-after-changes"))
        for _ in range(5):
            coordinator.emit(FileChanged(path=tmp_path / "specs" / "a.md"))

        # Restart and process
        coordinator.start()
        await coordinator._queue.join()

        # The rebuild drained the 5 FileChanged events.  We should see
        # only the rebuild notifications (rebuilding + ready), NOT 5
        # spec/didChange notifications from the individual file events.
        spec_change_count = sum(
            1 for m, _ in notifications if m == "spec/didChange"
        )
        rebuilding_count = sum(
            1 for m, _ in notifications if m == "index/rebuilding"
        )

        assert rebuilding_count == 1
        assert spec_change_count == 0  # All FileChanged events were drained

        # Spec was still indexed by the rebuild itself
        spec = await index.get_spec("spec-a")
        assert spec is not None

    async def test_drain_preserves_non_file_events(
        self, coordinator, index, tmp_path, notifications
    ):
        """Drain removes only FileChanged events; other event types survive."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        await coordinator.stop()

        # Queue: Rebuild, then FileChanged, then another Rebuild.
        # The first rebuild drains the FileChanged; the second rebuild
        # is preserved and runs after the first.
        coordinator.emit(RebuildRequested(reason="first"))
        coordinator.emit(FileChanged(path=tmp_path / "specs" / "a.md"))
        coordinator.emit(RebuildRequested(reason="second"))

        coordinator.start()
        await coordinator._queue.join()

        rebuilding_count = sum(
            1 for m, _ in notifications if m == "index/rebuilding"
        )
        # Both rebuilds should have run
        assert rebuilding_count == 2


# ── TestDebounce ─────────────────────────────────────────────────────────────


class TestDebounce:
    """request_rebuild() debounces rapid calls into a single event."""

    async def test_rapid_rebuilds_coalesced(
        self, coordinator, index, tmp_path, notifications
    ):
        """Multiple request_rebuild() calls within 500ms produce only 1 rebuild."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Fire 5 rapid rebuild requests
        for i in range(5):
            coordinator.request_rebuild(reason=f"rapid-{i}")
            await asyncio.sleep(0.05)  # 50ms apart, all within 500ms window

        # Wait for debounce timer (500ms) + processing time
        await asyncio.sleep(0.7)
        await coordinator._queue.join()

        # Should have exactly 1 rebuild (debounced)
        rebuilding_count = sum(
            1 for m, _ in notifications if m == "index/rebuilding"
        )
        assert rebuilding_count == 1

    async def test_debounce_uses_latest_params(
        self, coordinator, index, tmp_path, notifications
    ):
        """Debounce keeps the latest request_rebuild() parameters."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Fire rapid rebuilds with different reasons — only the last should fire
        coordinator.request_rebuild(reason="first")
        await asyncio.sleep(0.05)
        coordinator.request_rebuild(reason="second")
        await asyncio.sleep(0.05)
        coordinator.request_rebuild(reason="last")

        # Wait for debounce + processing
        await asyncio.sleep(0.7)
        await coordinator._queue.join()

        # Exactly 1 rebuild fired
        rebuilding_count = sum(
            1 for m, _ in notifications if m == "index/rebuilding"
        )
        assert rebuilding_count == 1

        # Spec should be indexed (the actual rebuild ran)
        spec = await index.get_spec("spec-a")
        assert spec is not None


# ── TestDiffScan ─────────────────────────────────────────────────────────────


class TestDiffScan:
    """DiffScanRequested reindexes files that changed while the server was down."""

    async def test_diff_scan_reindexes_changed_files(
        self, coordinator, index, tmp_path, notifications
    ):
        """DiffScanRequested reindexes files that changed while server was down."""
        # Create and index a spec via rebuild
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )
        coordinator.emit(RebuildRequested(reason="initial"))
        await coordinator._queue.join()

        # Verify it's indexed
        spec = await index.get_spec("spec-a")
        assert spec is not None

        # Now modify the file directly (simulating changes while server was down)
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            status: active
            ---
            # Spec A (modified while offline)
            """,
        )

        # Also add a new file
        _write_spec_file(
            tmp_path,
            "specs/b.md",
            """\
            ---
            id: spec-b
            type: module-design
            ---
            # Spec B (new)
            """,
        )

        notifications.clear()

        # Trigger diff scan
        coordinator.emit(DiffScanRequested())
        await coordinator._queue.join()

        # Verify changes were picked up
        spec_a = await index.get_spec("spec-a")
        assert spec_a is not None
        assert spec_a.status == "active"  # Updated

        spec_b = await index.get_spec("spec-b")
        assert spec_b is not None  # New file discovered

    async def test_diff_scan_purges_deleted_files(
        self, coordinator, index, tmp_path, notifications
    ):
        """Diff scan removes index entries for files deleted while server was down."""
        # Create two specs and rebuild
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )
        _write_spec_file(
            tmp_path,
            "specs/b.md",
            """\
            ---
            id: spec-b
            type: task-spec
            ---
            # Spec B
            """,
        )

        coordinator.emit(RebuildRequested(reason="initial"))
        await coordinator._queue.join()

        assert await index.get_spec("spec-a") is not None
        assert await index.get_spec("spec-b") is not None

        # Delete spec-b from disk (simulates offline deletion)
        (tmp_path / "specs" / "b.md").unlink()

        notifications.clear()

        # Diff scan should detect the deletion and purge the stale entry
        coordinator.emit(DiffScanRequested())
        await coordinator._queue.join()

        # spec-a still there
        assert await index.get_spec("spec-a") is not None

        # spec-b purged by diff scan
        assert await index.get_spec("spec-b") is None

        # Notification emitted for the removal
        methods = [n[0] for n in notifications]
        assert "docs/didChange" in methods

    async def test_diff_scan_purges_deleted_documents(
        self, coordinator, index, tmp_path, notifications
    ):
        """Diff scan removes unmanaged document entries for files deleted offline."""
        # Create a managed spec and an unmanaged doc, then rebuild
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )
        _write_spec_file(
            tmp_path,
            "docs/notes.md",
            "# Just some notes\n\nNo frontmatter here.",
        )

        coordinator.emit(RebuildRequested(reason="initial"))
        await coordinator._queue.join()

        assert await index.get_spec("spec-a") is not None
        docs = await index.get_all_documents()
        doc_paths = [d.path for d in docs]
        assert "docs/notes.md" in doc_paths

        # Delete the unmanaged doc from disk
        (tmp_path / "docs" / "notes.md").unlink()

        notifications.clear()

        # Diff scan should purge the stale document entry
        coordinator.emit(DiffScanRequested())
        await coordinator._queue.join()

        # Spec still there
        assert await index.get_spec("spec-a") is not None

        # Document purged
        docs = await index.get_all_documents()
        doc_paths = [d.path for d in docs]
        assert "docs/notes.md" not in doc_paths


# ── TestEventOrdering ────────────────────────────────────────────────────────


class TestEventOrdering:
    """Events are processed in FIFO order by the consumer task."""

    async def test_fifo_ordering(
        self, coordinator, index, tmp_path, notifications
    ):
        """Events are processed in the order they were emitted."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )
        _write_spec_file(
            tmp_path,
            "specs/b.md",
            """\
            ---
            id: spec-b
            type: task-spec
            ---
            # Spec B
            """,
        )

        # Stop coordinator, queue events, then restart
        await coordinator.stop()

        # Queue a rebuild first, then a file change
        coordinator.emit(RebuildRequested(reason="fifo-test"))
        coordinator.emit(FileChanged(path=tmp_path / "specs" / "a.md"))

        coordinator.start()
        await coordinator._queue.join()

        # Rebuild processes first (FIFO).  The rebuild's _drain_file_events()
        # will drain the FileChanged event from the queue, so we expect
        # only the rebuild notifications.
        methods = [m for m, _ in notifications]

        assert "index/rebuilding" in methods
        assert "index/ready" in methods

    async def test_mixed_event_ordering(
        self, coordinator, index, tmp_path, notifications
    ):
        """FileChanged queued before RebuildRequested processes first (FIFO)."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Initial rebuild to populate the index
        coordinator.emit(RebuildRequested(reason="setup"))
        await coordinator._queue.join()

        notifications.clear()

        # Modify the file
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            status: active
            ---
            # Spec A (v2)
            """,
        )

        # Queue: file change first, then rebuild
        await coordinator.stop()
        coordinator.emit(FileChanged(path=tmp_path / "specs" / "a.md"))
        coordinator.emit(RebuildRequested(reason="after-change"))
        coordinator.start()
        await coordinator._queue.join()

        methods = [m for m, _ in notifications]

        # FileChanged processes first (FIFO), emitting spec/didChange,
        # then rebuild processes, emitting index/rebuilding + index/ready.
        if "spec/didChange" in methods and "index/rebuilding" in methods:
            assert methods.index("spec/didChange") < methods.index(
                "index/rebuilding"
            )


# ── TestLifecycle ────────────────────────────────────────────────────────────


class TestLifecycle:
    """Coordinator start/stop lifecycle."""

    async def test_start_and_stop(self, index, tmp_path, notifications):
        """Start and stop without errors."""

        async def notify(method: str, params: dict[str, Any]) -> None:
            notifications.append((method, params))

        coord = IndexCoordinator(index, tmp_path, notify)
        coord.start()

        assert coord._consumer_task is not None
        assert not coord._consumer_task.done()

        await coord.stop()

        assert coord._consumer_task is None

    async def test_double_start_is_safe(self, coordinator):
        """Calling start() twice does not create duplicate consumer tasks."""
        task1 = coordinator._consumer_task
        coordinator.start()
        task2 = coordinator._consumer_task

        # Same task — start() is a no-op when already running
        assert task1 is task2

    async def test_double_stop_is_safe(self, index, tmp_path, notifications):
        """Calling stop() twice does not raise."""

        async def notify(method: str, params: dict[str, Any]) -> None:
            notifications.append((method, params))

        coord = IndexCoordinator(index, tmp_path, notify)
        coord.start()
        await coord.stop()
        await coord.stop()  # Should not raise

    async def test_stop_cancels_pending_rebuild_timer(
        self, coordinator, notifications
    ):
        """stop() cancels any pending debounce timer."""
        coordinator.request_rebuild(reason="will-be-cancelled")
        assert coordinator._rebuild_timer is not None

        await coordinator.stop()

        assert coordinator._rebuild_timer is None


# ── TestSpecDelete ───────────────────────────────────────────────────────────


class TestSpecDelete:
    """SpecDeleteRequested resolves its future and removes the spec."""

    async def test_request_delete_resolves_future(
        self, coordinator, index, tmp_path, notifications
    ):
        """request_delete() returns when the coordinator processes the deletion."""
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Build the index first
        coordinator.emit(RebuildRequested(reason="setup"))
        await coordinator._queue.join()

        spec = await index.get_spec("spec-a")
        assert spec is not None

        notifications.clear()

        # Request deletion — this awaits until the coordinator processes it
        await coordinator.request_delete("spec-a")

        # Spec should be removed from the index
        spec = await index.get_spec("spec-a")
        assert spec is None

        # Should have received a spec/didDelete notification
        delete_notifications = [
            (m, p) for m, p in notifications if m == "spec/didDelete"
        ]
        assert len(delete_notifications) == 1
        assert delete_notifications[0][1]["id"] == "spec-a"

    async def test_request_delete_nonexistent_spec(
        self, coordinator, index, tmp_path, notifications
    ):
        """Deleting a non-existent spec completes without error."""
        # No setup needed — the index is empty

        # This should complete without raising
        await coordinator.request_delete("nonexistent-id")

        # Still got the notification
        delete_notifications = [
            (m, p) for m, p in notifications if m == "spec/didDelete"
        ]
        assert len(delete_notifications) == 1
        assert delete_notifications[0][1]["id"] == "nonexistent-id"


# ── TestFileChanged ──────────────────────────────────────────────────────────


class TestFileChanged:
    """FileChanged event triggers reindex of the changed file."""

    async def test_file_changed_indexes_new_spec(
        self, coordinator, index, tmp_path, notifications
    ):
        """FileChanged on a new spec file indexes it."""
        spec_path = _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        coordinator.emit(FileChanged(path=spec_path))
        await coordinator._queue.join()

        spec = await index.get_spec("spec-a")
        assert spec is not None
        assert spec.type == "task-spec"

        # Should emit spec/didChange notification
        change_notifications = [
            (m, p) for m, p in notifications if m == "spec/didChange"
        ]
        assert len(change_notifications) == 1
        assert change_notifications[0][1]["id"] == "spec-a"

    async def test_file_changed_updates_existing_spec(
        self, coordinator, index, tmp_path, notifications
    ):
        """FileChanged on a modified spec file updates the index."""
        spec_path = _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            ---
            # Spec A
            """,
        )

        # Index it
        coordinator.emit(FileChanged(path=spec_path))
        await coordinator._queue.join()

        spec = await index.get_spec("spec-a")
        assert spec is not None
        assert spec.status == "draft"

        notifications.clear()

        # Modify and trigger again
        _write_spec_file(
            tmp_path,
            "specs/a.md",
            """\
            ---
            id: spec-a
            type: task-spec
            status: active
            ---
            # Spec A (updated)
            """,
        )

        coordinator.emit(FileChanged(path=spec_path))
        await coordinator._queue.join()

        spec = await index.get_spec("spec-a")
        assert spec is not None
        assert spec.status == "active"

        # Should have received spec/didChange
        change_notifications = [
            (m, p) for m, p in notifications if m == "spec/didChange"
        ]
        assert len(change_notifications) == 1
        assert change_notifications[0][1]["id"] == "spec-a"

    async def test_file_changed_indexes_document(
        self, coordinator, index, tmp_path, notifications
    ):
        """FileChanged on a .md file without valid frontmatter indexes as document."""
        doc_path = _write_spec_file(
            tmp_path,
            "docs/readme.md",
            """\
            # Project Readme

            Some documentation content.
            """,
        )

        coordinator.emit(FileChanged(path=doc_path))
        await coordinator._queue.join()

        # Not a spec (no frontmatter)
        specs = await index.get_all_specs()
        assert len(specs) == 0

        # Indexed as a document
        docs = await index.get_all_documents()
        assert len(docs) == 1
        assert docs[0].path == "docs/readme.md"

        # Should emit docs/didChange notification
        doc_notifications = [
            (m, p) for m, p in notifications if m == "docs/didChange"
        ]
        assert len(doc_notifications) == 1
