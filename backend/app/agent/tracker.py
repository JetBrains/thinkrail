from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from app.agent.models import AgentConfig, AgentTask, TaskStatus

_VALID_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    "pending": {"running"},
    "running": {"done", "error"},
    "done": set(),
    "error": set(),
}


class TaskNotFoundError(Exception):
    """Raised when a task ID does not exist."""


class FutureNotFoundError(Exception):
    """Raised when a request ID has no pending future."""


class Tracker:
    """Task lifecycle and asyncio.Future registry for pending requests."""

    def __init__(self) -> None:
        self._tasks: dict[str, AgentTask] = {}
        self._futures: dict[str, dict[str, asyncio.Future[dict]]] = {}

    # -- task lifecycle -------------------------------------------------------

    def create_task(self, spec_ids: list[str], config: AgentConfig) -> AgentTask:
        task = AgentTask(spec_ids=spec_ids, config=config)
        self._tasks[task.id] = task
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

    # -- future management ----------------------------------------------------

    def register_future(
        self, task_id: str, request_id: str, timeout_seconds: float = 30.0
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
            raise FutureNotFoundError(
                f"No pending future for task '{task_id}', request '{request_id}'"
            )
        if not future.done():
            future.set_result(response)

    def cancel_futures(self, task_id: str) -> None:
        task_futures = self._futures.pop(task_id, {})
        for future in task_futures.values():
            if not future.done():
                future.cancel()
