from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

from app.agent.context import build_context
from app.agent.models import AgentConfig, AgentTask
from app.agent.persistence import append_event, save_session, load_session, list_sessions as list_sessions_from_disk, delete_session as delete_session_from_disk
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
        self._last_notify: dict[str, Callable] = {}

    def rebind_notify(self, notify: Callable) -> None:
        """Update the WebSocket callback for all running tasks.

        Called when a new WebSocket connects so that in-flight runners
        stream events to the fresh connection instead of a dead one.
        """
        for bonsai_sid in list(self._running_tasks):
            self._last_notify[bonsai_sid] = notify

    # -- public methods -------------------------------------------------------

    async def run_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        notify: Callable,
        skill_id: str | None = None,
        name: str = "",
    ) -> AgentTask:
        """Start a persistent agent session.

        Creates the task, launches the runner in the background (which
        opens the SDK client and enters idle), and returns immediately.
        The session waits for messages via ``send_message``.
        """
        task = self._tracker.create_task(spec_ids, config, skill_id=skill_id, name=name)
        spec_context = self._build_context_for(task)
        bg_task = asyncio.create_task(
            self._run_background(task, spec_context, notify)
        )
        self._running_tasks[task.bonsai_sid] = bg_task
        self._save_task(task)
        return task

    async def send_message(self, bonsai_sid: str, text: str) -> None:
        """Send a user message to the session, triggering a new turn."""
        task = self._tracker.get_task(bonsai_sid)
        if task.status != "idle":
            raise ValueError(
                f"Cannot send message: session is '{task.status}', expected 'idle'"
            )
        self._tracker.enqueue_message(bonsai_sid, text)

    async def interrupt_task(self, bonsai_sid: str) -> None:
        """Cancel the current turn. Session stays alive (idle)."""
        task = self._tracker.get_task(bonsai_sid)
        if task.status not in ("running", "waiting"):
            # Already idle/done — nothing to interrupt
            return
        self._tracker.cancel_futures(bonsai_sid)
        # Grab notify before cancelling — _run_background's finally block
        # clears _last_notify on cancellation.
        notify = self._last_notify.get(bonsai_sid)
        bg = self._running_tasks.pop(bonsai_sid, None)
        if bg:
            bg.cancel()
            try:
                await bg
            except (asyncio.CancelledError, Exception):
                pass
        self._tracker.set_status(bonsai_sid, "idle")
        # Notify frontend that the turn was interrupted
        if notify:
            try:
                await notify("agent/interrupted", {
                    "bonsaiSid": bonsai_sid,
                    "sessionId": task.session_id or "",
                })
            except Exception:
                pass
            # Re-launch the background runner for continued conversation
            spec_context = self._build_context_for(task)
            new_bg = asyncio.create_task(
                self._run_background(task, spec_context, notify)
            )
            self._running_tasks[bonsai_sid] = new_bg

    async def end_session(self, bonsai_sid: str) -> None:
        """Gracefully close the session."""
        try:
            task = self._tracker.get_task(bonsai_sid)
            if task.status in ("done", "error"):
                return  # already finished
            self._tracker.enqueue_end_signal(bonsai_sid)
        except Exception:
            # Task not in memory (e.g. backend restarted) — update on disk only
            existing = load_session(self._config.project_root, bonsai_sid)
            if existing and existing.get("status") not in ("done", "error"):
                existing["status"] = "done"
                save_session(self._config.project_root, existing)

    def get_task(self, bonsai_sid: str) -> AgentTask:
        return self._tracker.get_task(bonsai_sid)

    def list_tasks(self) -> list[AgentTask]:
        return self._tracker.list_tasks()

    async def update_config(
        self,
        bonsai_sid: str,
        model: str | None = None,
        permission_mode: str | None = None,
    ) -> dict:
        """Update model and/or permission mode on a live session."""
        task = self._tracker.get_task(bonsai_sid)
        client = self._tracker.get_client(bonsai_sid)
        if client is None:
            raise ValueError(f"No live client for session {bonsai_sid}")
        if model is not None:
            await client.set_model(model)
            task.config.model = model
        if permission_mode is not None:
            await client.set_permission_mode(permission_mode)
            task.config.permission_mode = permission_mode
        self._save_task(task)
        return {"model": task.config.model, "permissionMode": task.config.permission_mode}

    async def respond(self, bonsai_sid: str, request_id: str, response: dict) -> None:
        self._tracker.resolve_future(bonsai_sid, request_id, response)

    # -- session persistence --------------------------------------------------

    def _save_task(self, task: AgentTask, events: list[dict] | None = None) -> None:
        """Persist current task state to disk."""
        data: dict = {
            "bonsaiSid": task.bonsai_sid,
            "name": task.name or task.bonsai_sid[:8],
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
            existing = load_session(self._config.project_root, task.bonsai_sid)
            if existing:
                data["events"] = existing.get("events", [])
        save_session(self._config.project_root, data)

    def _save_event(self, bonsai_sid: str, event: dict) -> None:
        """Append an event to the persisted session file."""
        append_event(self._config.project_root, bonsai_sid, event)

    def list_all_sessions(self) -> list[dict]:
        """List all sessions: in-memory active + on-disk archived."""
        # Start with disk sessions
        disk = {s["bonsaiSid"]: s for s in list_sessions_from_disk(self._config.project_root)}
        # Overlay in-memory active sessions (they have fresher status)
        for task in self._tracker.list_tasks():
            # Preserve name from disk if the in-memory task has no custom name
            disk_entry = disk.get(task.bonsai_sid, {})
            name = task.name or disk_entry.get("name") or task.bonsai_sid[:8]
            disk[task.bonsai_sid] = {
                "bonsaiSid": task.bonsai_sid,
                "name": name,
                "skillId": task.skill_id,
                "specIds": list(task.spec_ids),
                "status": task.status,
                "model": task.config.model,
                "createdAt": task.created,
                "updatedAt": task.updated,
                "active": True,
            }
        return list(disk.values())

    def get_session_data(self, bonsai_sid: str) -> dict | None:
        """Get full session data (events included) from disk."""
        return load_session(self._config.project_root, bonsai_sid)

    def delete_session_data(self, bonsai_sid: str) -> bool:
        """Delete a session from disk."""
        return delete_session_from_disk(self._config.project_root, bonsai_sid)

    async def continue_session(
        self, bonsai_sid: str, notify: Callable
    ) -> AgentTask:
        """Continue a dead session by replaying its history as context.

        Reuses the same bonsai_sid — no new ID is created.
        """
        if bonsai_sid in self._running_tasks:
            raise ValueError(f"Session {bonsai_sid} is already running")

        old = load_session(self._config.project_root, bonsai_sid)
        if not old:
            raise ValueError(f"Session {bonsai_sid} not found on disk")

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

        # Re-create task with SAME ID
        old_config = AgentConfig(**old.get("config", {}))
        old_spec_ids = old.get("specIds", [])
        skill_id = old.get("skillId")
        name = old.get("name", "session")

        task = self._tracker.create_task(
            old_spec_ids, old_config,
            skill_id=skill_id,
            name=name,
            bonsai_sid=bonsai_sid,
        )

        # Update metadata only (don't touch events JSONL)
        metadata = {
            "bonsaiSid": bonsai_sid,
            "name": name,
            "skillId": skill_id,
            "specIds": old_spec_ids,
            "config": old_config.model_dump(by_alias=True),
            "status": "idle",
            "sessionId": None,
            "createdAt": old.get("createdAt", task.created),
            "updatedAt": task.updated,
        }
        save_session(self._config.project_root, metadata)

        # Build spec context + conversation history
        spec_context = self._build_context_for(task)
        combined_context = f"{spec_context}\n\n--- Previous conversation ---\n{history_context}" if history_context else spec_context

        bg_task = asyncio.create_task(
            self._run_background(task, combined_context, notify)
        )
        self._running_tasks[task.bonsai_sid] = bg_task
        return task

    # -- helpers --------------------------------------------------------------

    async def _run_background(
        self,
        task: AgentTask,
        spec_context: str,
        notify: Callable,
    ) -> None:
        self._last_notify[task.bonsai_sid] = notify

        # Wrap notify to read the *current* callback from _last_notify each
        # time, so that rebind_notify() transparently redirects events to a
        # new WebSocket without restarting the runner.
        async def _persisting_notify(method: str, params: dict, request_id: str | None = None) -> None:
            current = self._last_notify.get(task.bonsai_sid)
            if current:
                try:
                    await current(method, params, request_id)
                except Exception:
                    pass  # WS dead — events still persisted below
            # Persist streaming events (skip overly frequent ones)
            if method.startswith("agent/") and method not in ("agent/progress",):
                event_type = method.replace("agent/", "")
                # Include requestId in persisted payload (notify injects it
                # into the WebSocket message but not into the original params dict)
                payload = {**params}
                if request_id is not None:
                    payload["requestId"] = request_id
                try:
                    self._save_event(task.bonsai_sid, {"eventType": event_type, "payload": payload})
                except Exception:
                    logger.exception("Failed to persist event %s for session %s", method, task.bonsai_sid)
        notify = _persisting_notify

        try:
            await run(task, spec_context, notify, self._tracker, cwd=self._config.project_root, plugin_dir=self._config.plugin_dir)
            self._tracker.set_status(task.bonsai_sid, "done")
            self._save_task(task)
        except asyncio.CancelledError:
            # Interrupted — don't set error, let interrupt_task handle state
            pass
        except Exception as exc:
            logger.exception("Agent session %s failed", task.bonsai_sid)
            if task.status not in ("done", "error"):
                self._tracker.set_status(task.bonsai_sid, "error")
            self._save_task(task)
            try:
                await notify(
                    "agent/error",
                    {
                        "bonsaiSid": task.bonsai_sid,
                        "sessionId": task.session_id or "",
                        "subtype": "crash",
                        "errors": [str(exc)],
                    },
                )
            except Exception:
                pass
        finally:
            self._running_tasks.pop(task.bonsai_sid, None)
            self._last_notify.pop(task.bonsai_sid, None)

    def _build_context_for(self, task: AgentTask) -> str:
        return build_context(
            spec_ids=task.spec_ids,
            skill_id=task.skill_id,
            project_root=self._config.project_root,
            config=task.config,
            spec_service=self._spec_service,
            plugin_dir=self._config.plugin_dir,
        )
