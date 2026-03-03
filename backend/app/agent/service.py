from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

from app.agent.context import build_context
from app.agent.models import AgentConfig, AgentTask
from app.agent.persistence import save_session, load_session, list_sessions as list_sessions_from_disk, delete_session as delete_session_from_disk
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
        self._save_task(task)
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

    # -- session persistence --------------------------------------------------

    def _save_task(self, task: AgentTask, events: list[dict] | None = None) -> None:
        """Persist current task state to disk."""
        data: dict = {
            "taskId": task.id,
            "name": getattr(task, "_name", task.id[:8]),
            "skillId": task.skill_id,
            "specIds": list(task.spec_ids),
            "config": task.config.model_dump(by_alias=True),
            "status": task.status,
            "sessionId": task.session_id,
            "createdAt": task.created,
            "updatedAt": task.updated,
        }
        # Preserve existing events from disk if we don't have new ones
        if events is not None:
            data["events"] = events
        else:
            existing = load_session(self._config.project_root, task.id)
            if existing:
                data["events"] = existing.get("events", [])
        save_session(self._config.project_root, data)

    def save_event(self, task_id: str, event: dict) -> None:
        """Append an event to the persisted session file."""
        task = self._tracker.get_task(task_id)
        existing = load_session(self._config.project_root, task_id)
        events = existing.get("events", []) if existing else []
        events.append(event)
        self._save_task(task, events=events)

    def list_all_sessions(self) -> list[dict]:
        """List all sessions: in-memory active + on-disk archived."""
        # Start with disk sessions
        disk = {s["taskId"]: s for s in list_sessions_from_disk(self._config.project_root)}
        # Overlay in-memory active sessions (they have fresher status)
        for task in self._tracker.list_tasks():
            disk[task.id] = {
                "taskId": task.id,
                "name": getattr(task, "_name", task.id[:8]),
                "skillId": task.skill_id,
                "specIds": list(task.spec_ids),
                "status": task.status,
                "model": task.config.model,
                "createdAt": task.created,
                "updatedAt": task.updated,
                "active": True,
            }
        return list(disk.values())

    def get_session_data(self, task_id: str) -> dict | None:
        """Get full session data (events included) from disk."""
        return load_session(self._config.project_root, task_id)

    def delete_session_data(self, task_id: str) -> bool:
        """Delete a session from disk."""
        return delete_session_from_disk(self._config.project_root, task_id)

    async def continue_session(
        self, task_id: str, notify: Callable
    ) -> AgentTask:
        """Continue a dead session by replaying its history as context."""
        old = load_session(self._config.project_root, task_id)
        if not old:
            raise ValueError(f"Session {task_id} not found on disk")

        # Build context from old conversation
        context_parts = []
        for ev in old.get("events", []):
            et = ev.get("eventType", "")
            payload = ev.get("payload", {})
            if et == "textDelta":
                context_parts.append(f"Assistant: {payload.get('text', '')}")
            elif et == "toolCallStart":
                context_parts.append(f"Tool: {payload.get('toolName', '')} {json.dumps(payload.get('toolInput', ''))}")
            elif et == "toolCallEnd":
                output = payload.get("output", "")
                if len(output) > 500:
                    output = output[:500] + "..."
                context_parts.append(f"Result: {output}")

        history_context = "\n".join(context_parts)

        # Create new task with old config
        old_config = AgentConfig(**old.get("config", {}))
        old_spec_ids = old.get("specIds", [])
        skill_id = old.get("skillId")

        task = self._tracker.create_task(old_spec_ids, old_config, skill_id=skill_id)
        task._name = old.get("name", "continued")  # type: ignore[attr-defined]

        # Build spec context + conversation history
        spec_context = self._build_context_for(task)
        combined_context = f"{spec_context}\n\n--- Previous conversation ---\n{history_context}" if history_context else spec_context

        # Save with link to old session
        data = {
            "taskId": task.id,
            "name": f"{old.get('name', 'session')} (continued)",
            "skillId": skill_id,
            "specIds": old_spec_ids,
            "config": old_config.model_dump(by_alias=True),
            "status": "idle",
            "sessionId": None,
            "createdAt": task.created,
            "updatedAt": task.updated,
            "continuedFrom": task_id,
            "events": [],
        }
        save_session(self._config.project_root, data)

        bg_task = asyncio.create_task(
            self._run_background(task, combined_context, notify)
        )
        self._running_tasks[task.id] = bg_task
        return task

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

        # Wrap notify to also persist events to disk
        _original_notify = notify
        async def _persisting_notify(method: str, params: dict, request_id: str | None = None) -> None:
            await _original_notify(method, params, request_id)
            # Persist streaming events (skip overly frequent ones)
            if method.startswith("agent/") and method not in ("agent/progress",):
                event_type = method.replace("agent/", "")
                try:
                    self.save_event(task.id, {"eventType": event_type, "payload": params})
                except Exception:
                    pass
        notify = _persisting_notify

        try:
            await run(task, spec_context, notify, self._tracker, cwd=self._config.project_root)
            self._tracker.set_status(task.id, "done")
            self._save_task(task)
        except asyncio.CancelledError:
            # Interrupted — don't set error, let interrupt_task handle state
            pass
        except Exception as exc:
            logger.exception("Agent task %s failed", task.id)
            if task.status not in ("done", "error"):
                self._tracker.set_status(task.id, "error")
            self._save_task(task)
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
