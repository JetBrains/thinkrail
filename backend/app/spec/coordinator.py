"""IndexCoordinator — serializes all index mutations through a single-consumer event bus.

Only the coordinator's consumer task calls mutating methods on SpecIndex.
The file watcher, agent tools, and init code are pure event producers.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

import pathspec

from app.spec.index import SpecIndex, _find_md_files

if TYPE_CHECKING:
    from app.spec.service import SpecService

logger = logging.getLogger(__name__)


# ── Event types ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class IndexEvent:
    """Base class for coordinator events."""

    pass


@dataclass(frozen=True)
class FileChanged(IndexEvent):
    """File watcher detected a .md file change."""

    path: Path
    deleted: bool = False


@dataclass(frozen=True)
class RebuildRequested(IndexEvent):
    """Full rebuild requested (init, .bonsaihide change, manual)."""

    bonsaihide_spec: pathspec.PathSpec | None = None
    reason: str = ""


@dataclass(frozen=True)
class DiffScanRequested(IndexEvent):
    """Background incremental scan of all files (cold start catch-up)."""

    pass


@dataclass(frozen=True)
class SpecDeleteRequested(IndexEvent):
    """Agent requested spec deletion via MCP tool.

    The future is tracked externally by the coordinator's ``request_delete``
    method — not stored in the event — so the frozen dataclass stays clean.
    """

    spec_id: str


# ── Type aliases ─────────────────────────────────────────────────────────────

# Notification callback signature: (method, params) -> awaitable
NotifyFn = Callable[[str, dict[str, Any]], Awaitable[None]]


# ── IndexCoordinator ─────────────────────────────────────────────────────────


class IndexCoordinator:
    """Serializes all SpecIndex mutations through a single asyncio.Queue consumer.

    Only the consumer task (:meth:`_consume` loop) calls mutating methods on
    SpecIndex.  All other code (watcher, agent tools, init) emits events to
    the queue.
    """

    def __init__(
        self,
        index: SpecIndex,
        project_root: Path,
        notify_fn: NotifyFn,
    ) -> None:
        self._index = index
        self._project_root = project_root
        self._notify = notify_fn
        self._queue: asyncio.Queue[IndexEvent] = asyncio.Queue()
        self._consumer_task: asyncio.Task[None] | None = None
        self._delete_futures: dict[int, asyncio.Future[None]] = {}

        # Injected post-creation (like TrashService pattern in server.py)
        self.spec_service: SpecService | None = None

        # Debounce state for rebuild requests
        self._rebuild_timer: asyncio.TimerHandle | None = None
        self._pending_rebuild: RebuildRequested | None = None

    # ── Lifecycle ────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the consumer task."""
        if self._consumer_task is None or self._consumer_task.done():
            self._consumer_task = asyncio.create_task(
                self._consume(), name="index-coordinator"
            )

    async def stop(self) -> None:
        """Stop the consumer task gracefully."""
        if self._consumer_task and not self._consumer_task.done():
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass
            self._consumer_task = None

        # Cancel any pending rebuild timer
        if self._rebuild_timer is not None:
            self._rebuild_timer.cancel()
            self._rebuild_timer = None

    # ── Event emission (called by producers) ─────────────────────────────

    def emit(self, event: IndexEvent) -> None:
        """Enqueue an event for processing.  Non-blocking."""
        self._queue.put_nowait(event)

    def update_bonsaihide_spec(self, spec: pathspec.PathSpec | None) -> None:
        """Refresh the index's ``.bonsaihide`` rules synchronously.

        Called from the watcher when ``.bonsaihide`` changes, *before* any
        same-batch ``FileChanged`` events are enqueued.  The single-consumer
        invariant is preserved: events queued before this call were already
        emitted by a producer that observed the *old* rules, and the consumer
        reads ``_bonsaihide_spec`` only when dispatching, so any not-yet-
        dispatched events will see the new rules.

        A debounced ``request_rebuild`` is still needed afterwards to evict
        previously-indexed entries that the new rules now hide.
        """
        self._index.set_bonsaihide_spec(spec)

    def request_rebuild(
        self,
        bonsaihide_spec: pathspec.PathSpec | None = None,
        reason: str = "",
    ) -> None:
        """Request a rebuild with 500ms debounce for rapid .bonsaihide edits.

        Multiple calls within 500ms coalesce — only the latest
        *bonsaihide_spec* is used when the rebuild finally fires.
        """
        self._pending_rebuild = RebuildRequested(
            bonsaihide_spec=bonsaihide_spec,
            reason=reason,
        )

        # Cancel any existing timer
        if self._rebuild_timer is not None:
            self._rebuild_timer.cancel()

        # Schedule the actual emit after 500ms quiescence
        loop = asyncio.get_running_loop()
        self._rebuild_timer = loop.call_later(0.5, self._fire_rebuild)

    def _fire_rebuild(self) -> None:
        """Timer callback — emit the pending RebuildRequested event."""
        if self._pending_rebuild is not None:
            self._queue.put_nowait(self._pending_rebuild)
            self._pending_rebuild = None
            self._rebuild_timer = None

    async def request_delete(self, spec_id: str) -> None:
        """Request spec deletion and wait for the coordinator to process it.

        Raises any exception that occurred during deletion.
        """
        future: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        event = SpecDeleteRequested(spec_id=spec_id)
        self._delete_futures[id(event)] = future
        self._queue.put_nowait(event)
        return await future

    # ── Consumer loop ────────────────────────────────────────────────────

    async def _consume(self) -> None:
        """Main consumer loop — processes events sequentially."""
        while True:
            try:
                event = await self._queue.get()
                try:
                    await self._dispatch(event)
                except Exception:
                    logger.exception("Error processing %s", type(event).__name__)
                finally:
                    self._queue.task_done()
            except asyncio.CancelledError:
                break

    async def _dispatch(self, event: IndexEvent) -> None:
        """Route an event to its handler."""
        if isinstance(event, FileChanged):
            await self._handle_file_changed(event)
        elif isinstance(event, RebuildRequested):
            await self._handle_rebuild(event)
        elif isinstance(event, DiffScanRequested):
            await self._handle_diff_scan(event)
        elif isinstance(event, SpecDeleteRequested):
            await self._handle_spec_delete(event)
        else:
            logger.warning("Unknown event type: %s", type(event).__name__)

    # ── Event handlers ───────────────────────────────────────────────────

    async def _handle_file_changed(self, event: FileChanged) -> None:
        """Process a single file change — reindex and notify."""
        result = await self._index.reindex_file(self._project_root, event.path)

        rel_path = str(event.path.relative_to(self._project_root))

        if result == "spec":
            spec = await self._index.get_spec_by_path(rel_path)
            if spec:
                await self._notify("spec/didChange", {"id": spec.id, "changes": {}})
        elif result == "document":
            await self._notify("docs/didChange", {})
        elif result == "removed" and event.deleted:
            # File was deleted — notify about document changes
            await self._notify("docs/didChange", {})

    async def _handle_rebuild(self, event: RebuildRequested) -> None:
        """Full transactional rebuild — drain stale FileChanged events first."""
        # Drain stale FileChanged events (they're moot since we're re-scanning everything)
        self._drain_file_events()

        logger.info("Starting index rebuild (reason: %s)", event.reason or "requested")
        await self._notify("index/rebuilding", {})

        try:
            await self._index.rebuild(self._project_root, event.bonsaihide_spec)
        except Exception:
            logger.exception("Rebuild failed")
            raise
        finally:
            await self._notify("index/ready", {})

    async def _handle_diff_scan(self, _event: DiffScanRequested) -> None:
        """Background incremental scan — reindex files that changed while server was down."""
        logger.info("Starting differential scan")

        try:
            md_files = await asyncio.to_thread(
                _find_md_files, self._project_root, self._index._bonsaihide_spec
            )

            # Track paths seen on disk so we can detect offline deletions
            seen_paths: set[str] = set()

            for file_path in md_files:
                rel_path = str(file_path.relative_to(self._project_root))
                seen_paths.add(rel_path)

                result = await self._index.reindex_file(
                    self._project_root, file_path
                )

                if result == "spec":
                    spec = await self._index.get_spec_by_path(rel_path)
                    if spec:
                        await self._notify(
                            "spec/didChange", {"id": spec.id, "changes": {}}
                        )
                elif result == "document":
                    await self._notify("docs/didChange", {})

            # Purge index entries for files deleted while server was down
            indexed_paths = await self._index.get_all_indexed_paths()
            stale_paths = indexed_paths - seen_paths
            if stale_paths:
                logger.info(
                    "Differential scan: removing %d stale entries", len(stale_paths)
                )
                for stale_path in stale_paths:
                    await self._index.remove_by_path(stale_path)
                # Batch-notify after all removals
                await self._notify("docs/didChange", {})
        except Exception:
            logger.exception("Differential scan failed")

    async def _handle_spec_delete(self, event: SpecDeleteRequested) -> None:
        """Handle spec deletion request from agent tools.

        When ``spec_service`` is set, performs the full delete flow: move file
        to trash, clean dangling references in other specs, and remove from the
        index.  Falls back to index-only removal when no service is available.
        """
        future = self._delete_futures.pop(id(event), None)
        try:
            if self.spec_service is not None:
                # Full flow: file move to trash + dangling ref cleanup + index removal
                await self.spec_service.delete_spec(event.spec_id)
            else:
                # Fallback: just remove from index
                await self._index.remove_spec(event.spec_id)

            await self._notify("spec/didDelete", {"id": event.spec_id})

            if future and not future.done():
                future.set_result(None)
        except Exception as exc:
            if future and not future.done():
                future.set_exception(exc)
            raise

    # ── Helpers ──────────────────────────────────────────────────────────

    def _drain_file_events(self) -> None:
        """Remove FileChanged events from the queue, preserve other event types.

        Called before a full rebuild to discard stale incremental updates.
        """
        preserved: list[IndexEvent] = []
        while not self._queue.empty():
            try:
                event = self._queue.get_nowait()
                if not isinstance(event, FileChanged):
                    preserved.append(event)
                self._queue.task_done()
            except asyncio.QueueEmpty:
                break

        # Re-enqueue non-FileChanged events
        for event in preserved:
            self._queue.put_nowait(event)
