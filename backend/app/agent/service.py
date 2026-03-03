from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from app.agent.context import build_context
from app.agent.models import AgentConfig, AgentTask
from app.agent.runner import run
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.spec.service import SpecService

logger = logging.getLogger(__name__)


class AgentService:
    """Facade — single entry point for agent session management."""

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
        skill_id: str | None = None,
    ) -> AgentTask:
        """Start a persistent agent session.

        Creates the task, launches the runner in the background (which
        opens the SDK client and enters idle), and returns immediately.
        The session waits for messages via ``send_message``.
        """
        task = self._tracker.create_task(spec_ids, config, skill_id=skill_id)
        spec_context = self._build_context_for(task)
        bg_task = asyncio.create_task(
            self._run_background(task, spec_context, notify)
        )
        self._running_tasks[task.id] = bg_task
        return task

    async def send_message(self, task_id: str, text: str) -> None:
        """Send a user message to the session, triggering a new turn."""
        task = self._tracker.get_task(task_id)
        if task.status != "idle":
            raise ValueError(
                f"Cannot send message: session is '{task.status}', expected 'idle'"
            )
        self._tracker.enqueue_message(task_id, text)

    async def interrupt_task(self, task_id: str) -> None:
        """Cancel the current turn. Session stays alive (idle)."""
        task = self._tracker.get_task(task_id)
        if task.status != "running":
            raise ValueError(
                f"Cannot interrupt: session is '{task.status}', expected 'running'"
            )
        self._tracker.cancel_futures(task_id)
        bg = self._running_tasks.get(task_id)
        if bg:
            bg.cancel()
            # Runner will catch CancelledError and the session will
            # be cleaned up. We re-launch a fresh background loop so
            # the session can accept new messages.
            try:
                await bg
            except (asyncio.CancelledError, Exception):
                pass
            self._running_tasks.pop(task_id, None)
            self._tracker.set_status(task_id, "idle")
            # Notify frontend that the turn was interrupted
            notify = self._last_notify.get(task_id)
            if notify:
                try:
                    await notify("agent/interrupted", {
                        "taskId": task_id,
                        "sessionId": task.session_id or "",
                    })
                except Exception:
                    pass
            # Re-launch the background runner for continued conversation
            spec_context = self._build_context_for(task)
            notify = self._last_notify.get(task_id)
            if notify:
                new_bg = asyncio.create_task(
                    self._run_background(task, spec_context, notify)
                )
                self._running_tasks[task_id] = new_bg

    async def end_session(self, task_id: str) -> None:
        """Gracefully close the session."""
        task = self._tracker.get_task(task_id)
        if task.status in ("done", "error"):
            return  # already finished
        self._tracker.enqueue_end_signal(task_id)

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
        # Store notify for potential re-launch after interrupt
        if not hasattr(self, "_last_notify"):
            self._last_notify: dict[str, Callable] = {}
        self._last_notify[task.id] = notify

        try:
            await run(task, spec_context, notify, self._tracker, cwd=self._config.project_root)
            self._tracker.set_status(task.id, "done")
        except asyncio.CancelledError:
            # Interrupted — don't set error, let interrupt_task handle state
            pass
        except Exception as exc:
            logger.exception("Agent task %s failed", task.id)
            if task.status not in ("done", "error"):
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
            self._last_notify.pop(task.id, None)

    def _build_context_for(self, task: AgentTask) -> str:
        return build_context(
            spec_ids=task.spec_ids,
            skill_id=task.skill_id,
            project_root=self._config.project_root,
            config=task.config,
            spec_service=self._spec_service,
            plugin_dir=self._config.plugin_dir,
        )
