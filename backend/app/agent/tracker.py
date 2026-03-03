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
    "idle": {"running", "done", "error"},
    "running": {"idle", "done", "error"},
    "done": set(),
    "error": set(),
}


class TaskNotFoundError(Exception):
    """Raised when a task ID does not exist."""


class FutureNotFoundError(Exception):
    """Raised when a request ID has no pending future."""


class Tracker:
    """Session lifecycle, message queue, and asyncio.Future registry."""

    def __init__(self) -> None:
        self._tasks: dict[str, AgentTask] = {}
        self._futures: dict[str, dict[str, asyncio.Future[dict]]] = {}
        self._queues: dict[str, asyncio.Queue[Any]] = {}

    # -- task lifecycle -------------------------------------------------------

    def create_task(
        self, spec_ids: list[str], config: AgentConfig, skill_id: str | None = None
    ) -> AgentTask:
        task = AgentTask(spec_ids=spec_ids, skill_id=skill_id, config=config)
        self._tasks[task.id] = task
        self._queues[task.id] = asyncio.Queue()
        return task

    def get_task(self, task_id: str) -> AgentTask:
        try:
            return self._tasks[task_id]
        except KeyError:
            raise TaskNotFoundError(f"Task '{task_id}' not found")

    def list_tasks(self) -> list[AgentTask]:
        return list(self._tasks.values())

    def set_status(self, task_id: str, status: TaskStatus) -> None:
        task = self.get_task(task_id)
        allowed = _VALID_TRANSITIONS[task.status]
        if status not in allowed:
            raise ValueError(
                f"Invalid transition: {task.status} -> {status}"
            )
        task.status = status
        task.updated = datetime.now(UTC).isoformat()

    def set_session_id(self, task_id: str, session_id: str) -> None:
        task = self.get_task(task_id)
        task.session_id = session_id
        task.updated = datetime.now(UTC).isoformat()

    # -- message queue --------------------------------------------------------

    def enqueue_message(self, task_id: str, text: str) -> None:
        """Push a user message onto the session's queue."""
        self.get_task(task_id)  # validate task exists
        self._queues[task_id].put_nowait(text)

    def enqueue_end_signal(self, task_id: str) -> None:
        """Push the END_SIGNAL sentinel to close the conversation loop."""
        self.get_task(task_id)  # validate task exists
        self._queues[task_id].put_nowait(_END_SIGNAL)

    async def get_next_message(self, task_id: str) -> str | object:
        """Await the next item from the session's queue.

        Returns the user message text, or ``END_SIGNAL`` if the session
        should close.
        """
        self.get_task(task_id)  # validate task exists
        return await self._queues[task_id].get()

    # -- future management ----------------------------------------------------

    def register_future(
        self, task_id: str, request_id: str, timeout_seconds: float = 300.0
    ) -> asyncio.Future[dict]:
        self.get_task(task_id)  # validate task exists
        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict] = loop.create_future()

        task_futures = self._futures.setdefault(task_id, {})
        task_futures[request_id] = future

        def _on_timeout() -> None:
            if not future.done():
                future.cancel()
                task_futures.pop(request_id, None)

        loop.call_later(timeout_seconds, _on_timeout)
        return future

    def resolve_future(self, task_id: str, request_id: str, response: dict) -> None:
        task_futures = self._futures.get(task_id, {})
        future = task_futures.pop(request_id, None)
        if future is None:
            # Future already resolved, timed out, or cancelled — not an error,
            # just a late response from the frontend.
            logger.warning("No pending future for task %s request %s (already resolved or timed out)", task_id, request_id)
            return
        if not future.done():
            future.set_result(response)

    def cancel_futures(self, task_id: str) -> None:
        task_futures = self._futures.pop(task_id, {})
        for future in task_futures.values():
            if not future.done():
                future.cancel()
