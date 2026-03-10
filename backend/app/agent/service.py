from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from app.agent.context import build_context
from app.agent.models import AgentConfig, AgentTask
from app.agent.persistence import append_event, save_session, load_session, list_sessions as list_sessions_from_disk, delete_session as delete_session_from_disk, update_session_metadata
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
        self._save_event(bonsai_sid, {
            "eventType": "userMessage",
            "payload": {"text": text},
        })
        self._tracker.enqueue_message(bonsai_sid, text)

    async def interrupt_task(self, bonsai_sid: str) -> None:
        """Cancel the current turn non-destructively.

        Uses the SDK's ``client.interrupt()`` control protocol to stop the
        current generation while preserving the client, conversation context,
        and runner loop.  The runner stays alive — no re-launch needed.
        """
        task = self._tracker.get_task(bonsai_sid)
        if task.status not in ("running", "waiting"):
            # Already idle/done — nothing to interrupt
            return

        # 1. Set interrupt flag BEFORE calling client.interrupt() so the
        #    runner knows to emit agent/interrupted instead of turnComplete.
        self._tracker.set_interrupted(bonsai_sid)

        # 2. Resolve pending futures with deny+interrupt (for waiting state).
        #    Unlike cancel_futures(), this produces a clean
        #    PermissionResultDeny(interrupt=True) through the SDK.
        self._tracker.interrupt_futures(bonsai_sid)

        # 3. Interrupt the SDK turn (for running state).
        client = self._tracker.get_client(bonsai_sid)
        if client:
            try:
                await client.interrupt()
            except Exception:
                pass  # Client may already be disconnected

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
        betas: list[str] | None = None,
        effort: str | None = None,
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
        if betas is not None:
            task.config.betas = betas
        if effort is not None:
            task.config.effort = effort
        self._save_task(task)
        return {"model": task.config.model, "permissionMode": task.config.permission_mode, "betas": task.config.betas, "effort": task.config.effort}

    async def restart_session(self, bonsai_sid: str, notify: Callable) -> AgentTask:
        """End current session and resume with current (updated) config."""
        self._tracker.enqueue_end_signal(bonsai_sid)
        bg_task = self._running_tasks.get(bonsai_sid)
        if bg_task:
            try:
                await bg_task
            except Exception:
                pass
        return await self.continue_session(bonsai_sid, notify)

    async def respond(self, bonsai_sid: str, request_id: str, response: dict) -> None:
        self._tracker.resolve_future(bonsai_sid, request_id, response)
        self._save_event(bonsai_sid, {
            "eventType": "requestResolved",
            "payload": {"requestId": request_id, "response": response},
        })

    # -- session persistence --------------------------------------------------

    def _save_task(self, task: AgentTask, events: list[dict] | None = None) -> None:
        """Persist current task state to disk."""
        # Load existing metadata to preserve metrics and events
        existing = load_session(self._config.project_root, task.bonsai_sid)
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
        # Preserve metrics from disk (written by update_session_metadata)
        if existing and existing.get("metrics"):
            data["metrics"] = existing["metrics"]
        # Preserve existing events from disk if we don't have new ones
        if events is not None:
            data["events"] = events
        elif existing:
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
                "active": task.status not in ("done", "error"),
                "metrics": disk_entry.get("metrics", {}),
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
        """Resume a session using the SDK's native --resume <sessionId>.

        Reuses the same bonsai_sid. The CLI restores full conversation
        context natively — no lossy text replay needed.
        """
        if bonsai_sid in self._running_tasks:
            raise ValueError(f"Session {bonsai_sid} is already running")

        old = load_session(self._config.project_root, bonsai_sid)
        if not old:
            raise ValueError(f"Session {bonsai_sid} not found on disk")

        old_session_id = old.get("sessionId")
        # Fallback: look for sessionId in persisted events (sessionStart)
        if not old_session_id:
            for ev in old.get("events", []):
                if ev.get("eventType") == "sessionStart":
                    old_session_id = (ev.get("payload") or {}).get("sessionId", "")
                    if old_session_id:
                        break
        if not old_session_id:
            raise ValueError(
                f"Cannot resume session {bonsai_sid}: no stored sessionId"
            )

        # Re-create task with SAME bonsai_sid
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
            "sessionId": old_session_id,
            "createdAt": old.get("createdAt", task.created),
            "updatedAt": task.updated,
            "metrics": old.get("metrics", {}),
        }
        save_session(self._config.project_root, metadata)

        # Build fresh spec context (no history replay — CLI restores context)
        spec_context = self._build_context_for(task)

        bg_task = asyncio.create_task(
            self._run_background(task, spec_context, notify,
                                 resume_session_id=old_session_id)
        )
        self._running_tasks[task.bonsai_sid] = bg_task
        return task

    # -- helpers --------------------------------------------------------------

    async def _run_background(
        self,
        task: AgentTask,
        spec_context: str,
        notify: Callable,
        resume_session_id: str | None = None,
    ) -> None:
        self._last_notify[task.bonsai_sid] = notify

        # Base metrics from previous run (for cumulative tracking across resumes)
        _base_cost = 0.0
        _base_turns = 0
        _base_duration = 0
        if resume_session_id:
            _existing = load_session(self._config.project_root, task.bonsai_sid)
            if _existing and _existing.get("metrics"):
                _m = _existing["metrics"]
                _base_cost = _m.get("costUsd", 0.0)
                _base_turns = _m.get("turns", 0)
                _base_duration = _m.get("durationMs", 0)

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

            # Persist metrics to metadata on turnComplete/done/interrupted so that
            # list_all_sessions can return cost per session without loading events.
            if method in ("agent/turnComplete", "agent/done", "agent/interrupted"):
                usage = params.get("usage", {})
                ctx_tokens = (
                    usage.get("input_tokens", 0)
                    + usage.get("output_tokens", 0)
                )
                update_session_metadata(self._config.project_root, task.bonsai_sid, {
                    "metrics": {
                        "costUsd": _base_cost + params.get("costUsd", 0),
                        "turns": _base_turns + params.get("turns", 0),
                        "turnCostUsd": params.get("turnCostUsd", 0),
                        "turnTurns": params.get("turn_turns", 0),
                        "durationMs": _base_duration + params.get("durationMs", 0),
                        "contextTokens": ctx_tokens,
                        "contextMax": 1_000_000 if "context-1m-2025-08-07" in task.config.betas else 200_000,
                        "outputTokens": usage.get("output_tokens", 0),
                    },
                })

            # Persist sessionId to disk as soon as the SDK provides it,
            # so that continue_session can resume after a backend restart.
            if method == "agent/sessionStart":
                sid = params.get("sessionId", "")
                if sid:
                    update_session_metadata(self._config.project_root, task.bonsai_sid, {
                        "sessionId": sid,
                    }, overwrite=False)
        notify = _persisting_notify

        try:
            await run(task, spec_context, notify, self._tracker, cwd=self._config.project_root, plugin_dir=self._config.plugin_dir, resume_session_id=resume_session_id)
            self._tracker.set_status(task.bonsai_sid, "done")
            self._save_task(task)
            self._tracker.remove_task(task.bonsai_sid)
        except asyncio.CancelledError:
            # Should no longer happen during interrupt (uses client.interrupt() now).
            # Keep as safety net for unexpected cancellation.
            logger.warning("Runner for %s received unexpected CancelledError", task.bonsai_sid)
        except Exception as exc:
            logger.exception("Agent session %s failed", task.bonsai_sid)
            if task.status not in ("done", "error"):
                self._tracker.set_status(task.bonsai_sid, "error")
            self._save_task(task)
            self._tracker.remove_task(task.bonsai_sid)
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
