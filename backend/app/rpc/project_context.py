"""ProjectContext — per-project service container with unified lifecycle.

Owns all per-project state (index, coordinator, watcher, and application
services).  One ``ProjectContext`` per project, cached in a single
``_projects`` dict in ``server.py``.

No FastAPI dependencies — this is a pure service container.

Design reference:
    .bonsai/coordinator-lifecycle-redesign/design-doc.md
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

import pathspec

from app.agent.runtime import RuntimeRegistry
from app.agent.runtime.claude import ClaudeRuntime
from app.agent.service import AgentService
from app.agent.tracker import Tracker
from app.board.service import BoardService
from app.core.bonsaihide import load_bonsaihide
from app.core.config import AppConfig, get_index_path
from app.core.watcher import WatchHandle
from app.spec.coordinator import (
    DiffScanRequested,
    IndexCoordinator,
    RebuildRequested,
)
from app.spec.index import SpecIndex
from app.spec.service import SpecService
from app.trash.service import TrashService
from app.vis.service import VisualizationService

if TYPE_CHECKING:
    from app.rpc.bus import EventBus

logger = logging.getLogger(__name__)

# Type alias for the watcher factory callable passed from server.py.
# Signature: (key, config, spec_service, vis_service, coordinator) -> WatchHandle
WatcherFactory = Callable[
    [str, AppConfig, SpecService, VisualizationService, IndexCoordinator],
    Awaitable[WatchHandle],
]

# Type alias for notification callbacks: (method, params) -> awaitable
NotifyFn = Callable[[str, dict[str, Any]], Awaitable[None]]


# ── ProjectContext ────────────────────────────────────────────────────────────


class ProjectContext:
    """Per-project service container with unified lifecycle.

    Created lightweight (no I/O) at construction.  Call :meth:`start` once
    under a lock on first connection, :meth:`shutdown` when the last
    connection disconnects.

    Services are created lazily on first access and cached for the
    lifetime of the context.  Cross-injection (coordinator ↔ spec_service,
    agent_service ↔ trash_service, etc.) happens automatically inside the
    property getters.
    """

    def __init__(
        self,
        key: str,
        project_root: Path,
        config: AppConfig,
        *,
        notify_fn: NotifyFn,
        watcher_factory: WatcherFactory | None = None,
    ) -> None:
        self.key = key
        self.project_root = project_root
        self.config = config
        self.connection_count: int = 0
        self.watcher_handle: WatchHandle | None = None

        # Core infrastructure (created here, started in start())
        db_path = get_index_path(project_root)
        self.index = SpecIndex(db_path)
        self.coordinator = IndexCoordinator(self.index, project_root, notify_fn)

        # Watcher factory — set by server.py, called during start()
        self._watcher_factory = watcher_factory
        self._notify_fn = notify_fn

        # Lazy service backing fields
        self._spec_service: SpecService | None = None
        self._agent_service: AgentService | None = None
        self._vis_service: VisualizationService | None = None
        self._board_service: BoardService | None = None
        self._trash_service: TrashService | None = None
        self._runtime_registry: RuntimeRegistry | None = None
        self._tracker: Tracker | None = None

    # ── Lazy service properties ───────────────────────────────────────────

    @property
    def trash_service(self) -> TrashService:
        """Trash service — stateless, created on first access."""
        if self._trash_service is None:
            self._trash_service = TrashService(project_root=self.project_root)
        return self._trash_service

    @property
    def spec_service(self) -> SpecService:
        """Spec service — wires coordinator.spec_service and trash on creation."""
        if self._spec_service is None:
            svc = SpecService(self.config, index=self.index)
            svc.trash_service = self.trash_service
            # Wire spec_service into coordinator for full delete flow
            self.coordinator.spec_service = svc
            self._spec_service = svc
        return self._spec_service

    @property
    def tracker(self) -> Tracker:
        """Project-scoped session tracker, shared with every runtime."""
        if self._tracker is None:
            self._tracker = Tracker()
        return self._tracker

    @property
    def agent_service(self) -> AgentService:
        """Agent service — wires coordinator, trash, board, runtime_registry."""
        if self._agent_service is None:
            svc = AgentService(self.config, self.spec_service, tracker=self.tracker)
            svc.coordinator = self.coordinator
            svc.trash_service = self.trash_service
            svc.board_service = self.board_service
            svc.runtime_registry = self.runtime_registry
            self._agent_service = svc
        return self._agent_service

    @property
    def vis_service(self) -> VisualizationService:
        """Visualization service — created on first access."""
        if self._vis_service is None:
            self._vis_service = VisualizationService(
                self.config, spec_service=self.spec_service,
            )
        return self._vis_service

    @property
    def board_service(self) -> BoardService:
        """Board service — wires trash on creation."""
        if self._board_service is None:
            svc = BoardService(self.config)
            svc.trash_service = self.trash_service
            self._board_service = svc
        return self._board_service

    @property
    def runtime_registry(self) -> RuntimeRegistry:
        """Runtime registry — created on first access.

        Runtimes are constructed once here with all of their dependencies
        wired in (tracker, spec service, coordinator). Runtimes are
        protocol-stateless; any per-runtime warmup (e.g. Claude model-list
        refresh) is lazy and triggered internally on first use.
        """
        if self._runtime_registry is None:
            reg = RuntimeRegistry()
            reg.register(
                ClaudeRuntime(
                    app_config=self.config,
                    plugin_dir=self.config.plugin_dir,
                    tracker=self.tracker,
                    spec_service=self.spec_service,
                    coordinator=self.coordinator,
                )
            )
            self._runtime_registry = reg
        return self._runtime_registry

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Open index and check schema version.

        Called once by the first connection.  Fast (<10 ms) — just opens
        the SQLite DB and probes ``_meta.schema_version``.  Heavy work
        (rebuild, diff scan) is delegated to :meth:`start_services`.
        """
        bonsaihide_spec = load_bonsaihide(self.project_root)
        self._bonsaihide_spec = bonsaihide_spec

        try:
            needs_rebuild = await self.index.open_and_check(bonsaihide_spec)
            self._needs_rebuild = needs_rebuild
        except Exception:
            logger.exception("ProjectContext.start() failed for %s", self.key)
            await self._cleanup()
            try:
                await self._notify_fn("index/ready", {})
            except Exception:
                pass
            raise

    async def start_services(self) -> None:
        """Start coordinator, watcher, and model registry.

        Called after the first connection subscribes to topics, so
        coordinator notifications reach the frontend.  Idempotent —
        second connection's call is a no-op.
        """
        # Start coordinator consumer task (idempotent)
        self.coordinator.start()

        # Emit init event (only on first call)
        if hasattr(self, "_needs_rebuild"):
            if self._needs_rebuild:
                self.coordinator.emit(RebuildRequested(
                    bonsaihide_spec=self._bonsaihide_spec, reason="init",
                ))
            else:
                await self._notify_fn("index/ready", {})
                self.coordinator.emit(DiffScanRequested())
            del self._needs_rebuild

        # Start watcher (first call only)
        if self.watcher_handle is None and self._watcher_factory is not None:
            self.watcher_handle = await self._watcher_factory(
                self.key, self.config, self.spec_service,
                self.vis_service, self.coordinator,
            )

        # No runtime-level startup handshake — runtimes are protocol-stateless.
        # Any per-runtime warmup (e.g. Claude model-list refresh) is the
        # runtime's internal concern, triggered lazily on first use.

    async def shutdown(self) -> None:
        """Stop watcher, coordinator, close index. Reverse order of start().

        Called when the last connection disconnects.
        """
        await self._cleanup()

    async def _cleanup(self) -> None:
        """Best-effort cleanup of all resources — safe to call multiple times."""
        # 1. Stop watcher
        if self.watcher_handle is not None:
            try:
                from app.core.watcher import stop

                await stop(self.watcher_handle)
            except Exception:
                logger.debug("Error stopping watcher", exc_info=True)
            self.watcher_handle = None

        # 2. Stop coordinator
        try:
            await self.coordinator.stop()
        except Exception:
            logger.debug("Error stopping coordinator", exc_info=True)

        # 3. Close index
        try:
            await self.index.close()
        except Exception:
            logger.debug("Error closing index", exc_info=True)

        # No runtime-level shutdown — runtimes are protocol-stateless.
