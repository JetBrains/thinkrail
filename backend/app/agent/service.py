from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from app.agent.models import AgentConfig, AgentTask
from app.agent.runner import run
from app.agent.tracker import Tracker

logger = logging.getLogger(__name__)
from app.core.config import AppConfig
from app.spec.service import SpecService


class AgentService:
    """Facade — single entry point for agent task management."""

    def __init__(self, config: AppConfig, spec_service: SpecService) -> None:
        self._config = config
        self._spec_service = spec_service
        self._tracker = Tracker()
        self._running_tasks: dict[str, asyncio.Task[Any]] = {}

    # -- public methods -------------------------------------------------------

    async def run_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        notify: Callable,
    ) -> AgentTask:
        task = self._tracker.create_task(spec_ids, config)
        spec_context = self._build_context(spec_ids)
        self._tracker.set_status(task.id, "running")
        bg_task = asyncio.create_task(
            self._run_background(task, spec_context, notify)
        )
        self._running_tasks[task.id] = bg_task
        return task

    async def interrupt_task(self, task_id: str) -> None:
        self._tracker.cancel_futures(task_id)
        bg = self._running_tasks.pop(task_id, None)
        if bg:
            bg.cancel()
        self._tracker.set_status(task_id, "error")

    def get_task(self, task_id: str) -> AgentTask:
        return self._tracker.get_task(task_id)

    def list_tasks(self) -> list[AgentTask]:
        return self._tracker.list_tasks()

    async def respond(self, task_id: str, request_id: str, response: dict) -> None:
        self._tracker.resolve_future(task_id, request_id, response)

    # -- helpers --------------------------------------------------------------

    async def _run_background(
        self,
        task: AgentTask,
        spec_context: str,
        notify: Callable,
    ) -> None:
        try:
            await run(task, spec_context, notify, self._tracker)
            self._tracker.set_status(task.id, "done")
        except Exception as exc:
            logger.exception("Agent task %s failed", task.id)
            self._tracker.set_status(task.id, "error")
            try:
                await notify(
                    "agent/error",
                    {
                        "taskId": task.id,
                        "sessionId": task.session_id or "",
                        "subtype": "crash",
                        "errors": [str(exc)],
                    },
                )
            except Exception:
                pass
        finally:
            self._running_tasks.pop(task.id, None)

    def _build_context(self, spec_ids: list[str]) -> str:
        parts = []
        for sid in spec_ids:
            detail = self._spec_service.get_spec(sid)
            parts.append(f"# {detail.title}\n\n{detail.content}")
        return "\n\n---\n\n".join(parts)
