"""ProjectContext — per-project service container with unified lifecycle.

Owns all per-project state (index, coordinator, watcher, and application
services).  One ``ProjectContext`` per project, cached in a single
``_projects`` dict in ``server.py``.

No FastAPI dependencies — this is a pure service container.

Design reference:
    .tr/coordinator-lifecycle-redesign/design-doc.md
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
from app.core.thinkrailhide import load_thinkrailhide
from app.core.config import AppConfig, get_index_path
from app.core.watcher import WatchHandle
from app.spec.coordinator import (
    DiffScanRequested,
    IndexCoordinator,
    RebuildRequested,
)
from app.spec.index import SpecIndex
from app.spec.service import SpecService

if TYPE_CHECKING:
    from app.rpc.bus import EventBus

logger = logging.getLogger(__name__)

# Type alias for the watcher factory callable passed from server.py.
# Signature: (key, config, spec_service, coordinator) -> WatchHandle
WatcherFactory = Callable[
    [str, AppConfig, SpecService, IndexCoordinator],
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
    agent_service ↔ board_service, etc.) happens automatically inside the
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
        self._board_service: BoardService | None = None
        self._runtime_registry: RuntimeRegistry | None = None
        self._tracker: Tracker | None = None

    # ── Lazy service properties ───────────────────────────────────────────

    @property
    def spec_service(self) -> SpecService:
        """Spec service — wires coordinator.spec_service on creation."""
        if self._spec_service is None:
            svc = SpecService(self.config, index=self.index)
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
        """Agent service — wires coordinator, board, and runtime registry.

        agent_service ⟷ runtime registry form a dependency cycle (the service
        holds the registry; each runtime holds the service back, for
        nested-session tools like start_node). We break it by creating the
        service first — it doesn't touch the registry until run time — then
        building the registry with the service injected into each runtime's
        constructor (the same DI path as spec_service / coordinator).
        """
        if self._agent_service is None:
            svc = AgentService(self.config, self.spec_service, tracker=self.tracker)
            svc.coordinator = self.coordinator
            svc.board_service = self.board_service
            self._runtime_registry = self._build_runtime_registry(svc)
            svc.runtime_registry = self._runtime_registry
            self.board_service.agent_service = svc

            async def _spawn_and_kick(ticket_id: str, title: str) -> None:
                from app.agent.models import SessionConfig

                task = await svc.run_task(
                    spec_ids=[], config=SessionConfig(),
                    skill_id="ticket-orchestrator", ticket_id=ticket_id,
                    name=f"Orchestrate: {title}",
                )
                # run_task leaves the session idle; send the bootstrap turn so
                # the orchestrator reads the ticket and proposes the pipeline.
                await svc.send_message(
                    task.thinkrail_sid,
                    "A new ticket has been created. Read its description, then "
                    "run intake: ask 1–2 questions focused only on the essence "
                    "(what is this about) — do NOT ask design or implementation "
                    "questions. Co-write an ultra-brief description (3 words to "
                    "2 short sentences) via SuggestDescription. Once the "
                    "description is settled, choose the pipeline with ONE "
                    "AskUserQuestion carrying two questions — Q1 base pipeline "
                    "(Full / Simplified / Inlined brainstorming) and Q2 additional "
                    "stages as checkboxes (market research, UI-mockups, "
                    "AI-criticism, …) — then call propose_pipeline with the "
                    "composed DAG. Do NOT dispatch any stages until the user "
                    "has chosen a pipeline.",
                )

            def _spawn_orchestrator(ticket_id: str, title: str) -> str | None:
                """Fire-and-forget the ticket-orchestrator session for a new ticket.

                Returns None — ``ticket.orchestrator`` is set when the session
                attaches (see AgentService._attach_to_ticket). No running loop
                (e.g. unit tests) → no spawn.
                """
                import asyncio

                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    return None
                loop.create_task(_spawn_and_kick(ticket_id, title))
                return None

            self.board_service.on_ticket_created = _spawn_orchestrator
            self._agent_service = svc
        return self._agent_service

    @property
    def board_service(self) -> BoardService:
        """Board service."""
        if self._board_service is None:
            self._board_service = BoardService(self.config)
        return self._board_service

    @property
    def runtime_registry(self) -> RuntimeRegistry:
        """Runtime registry — built as part of agent_service.

        Each runtime holds a back-reference to agent_service (for
        nested-session tools), so the registry is constructed inside the
        agent_service property with that reference injected. Accessing the
        registry first just builds agent_service, which caches it here.
        """
        if self._runtime_registry is None:
            _ = self.agent_service  # builds + caches self._runtime_registry
        assert self._runtime_registry is not None
        return self._runtime_registry

    def _build_runtime_registry(self, agent_service: AgentService) -> RuntimeRegistry:
        """Construct the registry with every runtime dependency wired in
        (tracker, spec service, coordinator, agent service). Runtimes are
        protocol-stateless; per-runtime warmup (e.g. Claude model-list
        refresh) is lazy and triggered internally on first use."""
        reg = RuntimeRegistry()
        reg.register(
            ClaudeRuntime(
                app_config=self.config,
                plugin_dir=self.config.plugin_dir,
                tracker=self.tracker,
                spec_service=self.spec_service,
                coordinator=self.coordinator,
                agent_service=agent_service,
            )
        )
        return reg

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Open index and check schema version.

        Called once by the first connection.  Fast (<10 ms) — just opens
        the SQLite DB and probes ``_meta.schema_version``.  Heavy work
        (rebuild, diff scan) is delegated to :meth:`start_services`.
        """
        thinkrailhide_spec = load_thinkrailhide(self.project_root)
        self._thinkrailhide_spec = thinkrailhide_spec

        try:
            needs_rebuild = await self.index.open_and_check(thinkrailhide_spec)
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
                    thinkrailhide_spec=self._thinkrailhide_spec, reason="init",
                ))
            else:
                await self._notify_fn("index/ready", {})
                self.coordinator.emit(DiffScanRequested())
            del self._needs_rebuild

        # Start watcher (first call only)
        if self.watcher_handle is None and self._watcher_factory is not None:
            self.watcher_handle = await self._watcher_factory(
                self.key, self.config, self.spec_service, self.coordinator,
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
