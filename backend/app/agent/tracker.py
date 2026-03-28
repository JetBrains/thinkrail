from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

from app.agent.models import AgentConfig, AgentTask, TaskStatus

_END_SIGNAL = object()
"""Sentinel pushed by ``enqueue_end_signal`` to close the conversation loop."""

END_SIGNAL = _END_SIGNAL  # public alias

_VALID_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    "draft": {"initializing", "done", "error"},
    "initializing": {"idle", "done", "error"},
    "idle": {"running", "done", "error"},
    "running": {"idle", "waiting", "done", "error"},
    "waiting": {"running", "idle", "done", "error"},
    "done": set(),
    "error": set(),
}


class TaskNotFoundError(Exception):
    """Raised when a bonsai_sid does not exist."""


class FutureNotFoundError(Exception):
    """Raised when a request ID has no pending future."""


class Tracker:
    """Session lifecycle, message queue, and asyncio.Future registry."""

    def __init__(self) -> None:
        self._tasks: dict[str, AgentTask] = {}
        self._futures: dict[str, dict[str, asyncio.Future[dict]]] = {}
        self._queues: dict[str, asyncio.Queue[Any]] = {}
        self._clients: dict[str, Any] = {}
        self._interrupted: set[str] = set()
        self._turn_text: dict[str, list[str]] = {}  # bonsai_sid → accumulated text blocks

    # -- task lifecycle -------------------------------------------------------

    def create_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        skill_id: str | None = None,
        session_prompt: str | None = None,
        name: str = "",
        bonsai_sid: str | None = None,
    ) -> AgentTask:
        task = AgentTask(
            **({"bonsai_sid": bonsai_sid} if bonsai_sid else {}),
            name=name,
            spec_ids=spec_ids,
            skill_id=skill_id,
            session_prompt=session_prompt,
            config=config,
        )
        self._tasks[task.bonsai_sid] = task
        self._queues[task.bonsai_sid] = asyncio.Queue()
        return task

    def get_task(self, bonsai_sid: str) -> AgentTask:
        try:
            return self._tasks[bonsai_sid]
        except KeyError:
            raise TaskNotFoundError(f"Session '{bonsai_sid}' not found")

    def has_task(self, bonsai_sid: str) -> bool:
        return bonsai_sid in self._tasks

    def list_tasks(self) -> list[AgentTask]:
        return list(self._tasks.values())

    def set_status(self, bonsai_sid: str, status: TaskStatus) -> None:
        task = self.get_task(bonsai_sid)
        allowed = _VALID_TRANSITIONS[task.status]
        if status not in allowed:
            raise ValueError(
                f"Invalid transition: {task.status} -> {status}"
            )
        task.status = status
        task.updated = datetime.now(UTC).isoformat()

    def set_session_id(self, bonsai_sid: str, session_id: str) -> None:
        task = self.get_task(bonsai_sid)
        task.session_id = session_id
        task.updated = datetime.now(UTC).isoformat()

    # -- live SDK client reference --------------------------------------------

    def set_client(self, bonsai_sid: str, client: Any) -> None:
        self._clients[bonsai_sid] = client

    def get_client(self, bonsai_sid: str) -> Any | None:
        return self._clients.get(bonsai_sid)

    def clear_client(self, bonsai_sid: str) -> None:
        self._clients.pop(bonsai_sid, None)

    # -- message queue --------------------------------------------------------

    def enqueue_message(self, bonsai_sid: str, text: str) -> None:
        """Push a user message onto the session's queue."""
        self.get_task(bonsai_sid)  # validate task exists
        self._queues[bonsai_sid].put_nowait(text)

    def enqueue_end_signal(self, bonsai_sid: str) -> None:
        """Push the END_SIGNAL sentinel to close the conversation loop."""
        self.get_task(bonsai_sid)  # validate task exists
        self._queues[bonsai_sid].put_nowait(_END_SIGNAL)

    async def get_next_message(self, bonsai_sid: str) -> str | object:
        """Await the next item from the session's queue.

        Returns the user message text, or ``END_SIGNAL`` if the session
        should close.
        """
        self.get_task(bonsai_sid)  # validate task exists
        return await self._queues[bonsai_sid].get()

    # -- future management ----------------------------------------------------

    def register_future(
        self, bonsai_sid: str, request_id: str, timeout_seconds: float = 300.0
    ) -> asyncio.Future[dict]:
        self.get_task(bonsai_sid)  # validate task exists
        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict] = loop.create_future()

        task_futures = self._futures.setdefault(bonsai_sid, {})
        task_futures[request_id] = future

        def _on_timeout() -> None:
            if not future.done():
                future.set_result({"behavior": "deny", "message": "Timed out waiting for user response", "interrupt": False})
                task_futures.pop(request_id, None)
                logger.warning("Future timed out for session %s request %s — auto-denied", bonsai_sid, request_id)

        loop.call_later(timeout_seconds, _on_timeout)
        return future

    def resolve_future(self, bonsai_sid: str, request_id: str, response: dict) -> None:
        task_futures = self._futures.get(bonsai_sid, {})
        future = task_futures.pop(request_id, None)
        if future is None:
            logger.warning("No pending future for session %s request %s (already resolved or timed out)", bonsai_sid, request_id)
            return
        if not future.done():
            future.set_result(response)

    def remove_task(self, bonsai_sid: str) -> None:
        """Remove a completed task and all associated state."""
        self._tasks.pop(bonsai_sid, None)
        self._queues.pop(bonsai_sid, None)
        self._futures.pop(bonsai_sid, None)
        self._clients.pop(bonsai_sid, None)
        self._interrupted.discard(bonsai_sid)
        self._turn_text.pop(bonsai_sid, None)

    def cancel_futures(self, bonsai_sid: str) -> None:
        task_futures = self._futures.pop(bonsai_sid, {})
        for future in task_futures.values():
            if not future.done():
                future.cancel()

    # -- interrupt management -------------------------------------------------

    def set_interrupted(self, bonsai_sid: str) -> None:
        """Mark session as interrupted.

        Called by ``service.interrupt_task()`` before calling
        ``client.interrupt()`` so the runner knows to emit
        ``agent/interrupted`` instead of ``agent/turnComplete``.
        """
        self._interrupted.add(bonsai_sid)

    def is_interrupted(self, bonsai_sid: str) -> bool:
        """Check whether the session has a pending interrupt flag."""
        return bonsai_sid in self._interrupted

    def clear_interrupted(self, bonsai_sid: str) -> None:
        """Clear the interrupt flag after the runner has processed it."""
        self._interrupted.discard(bonsai_sid)

    def interrupt_futures(self, bonsai_sid: str) -> None:
        """Resolve pending futures with deny + interrupt instead of cancelling.

        Unlike ``cancel_futures()`` which raises ``CancelledError``, this
        produces a clean ``PermissionResultDeny(interrupt=True)`` that tells
        the SDK to stop the turn gracefully.
        """
        task_futures = self._futures.pop(bonsai_sid, {})
        for future in task_futures.values():
            if not future.done():
                future.set_result({
                    "behavior": "deny",
                    "message": "Interrupted",
                    "interrupt": True,
                })

    # -- turn text accumulation ------------------------------------------------

    def append_turn_text(self, bonsai_sid: str, text: str) -> None:
        """Append assistant text to the current turn buffer.

        Called by the runner for each ``TextBlock`` so that ``can_use_tool``
        can inject accumulated plan content into ``ExitPlanMode`` payloads.
        """
        self._turn_text.setdefault(bonsai_sid, []).append(text)

    def get_turn_text(self, bonsai_sid: str) -> str:
        """Return accumulated assistant text for the current turn."""
        parts = self._turn_text.get(bonsai_sid, [])
        return "".join(parts)

    def clear_turn_text(self, bonsai_sid: str) -> None:
        """Clear the turn text buffer (called at the start of each query)."""
        self._turn_text.pop(bonsai_sid, None)
