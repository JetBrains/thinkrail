from __future__ import annotations

import asyncio
import logging
import time
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
        self.board_service: Any = None   # Injected by server.py
        self.trash_service: Any = None  # Injected by server.py

    def rebind_notify(self, notify: Callable) -> None:
        """Update the WebSocket callback for all running tasks.

        Called when a new WebSocket connects so that in-flight runners
        stream events to the fresh connection instead of a dead one.
        """
        for bonsai_sid in list(self._running_tasks):
            self._last_notify[bonsai_sid] = notify

    # -- public methods -------------------------------------------------------

    def prepare_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        skill_id: str | None = None,
        session_prompt: str | None = None,
        name: str = "",
        meta_ticket_id: str | None = None,
    ) -> AgentTask:
        """Create a draft session without starting the runner.

        Builds the system prompt and persists the task in "draft" status.
        Call ``start_draft`` to actually launch the SDK session.
        """
        task = self._tracker.create_task(
            spec_ids, config, skill_id=skill_id, session_prompt=session_prompt, name=name,
        )
        task.status = "draft"
        task.meta_ticket_id = meta_ticket_id
        self._attach_to_ticket(task)
        task.system_prompt = self._build_context_for(task)
        self._save_task(task)
        return task

    def update_draft(
        self,
        bonsai_sid: str,
        spec_ids: list[str] | None = None,
        skill_id: str | None = ...,  # type: ignore[assignment]
        config: AgentConfig | None = None,
        session_prompt: str | None = ...,  # type: ignore[assignment]
        name: str | None = ...,  # type: ignore[assignment]
        meta_ticket_id: str | None = ...,  # type: ignore[assignment]
    ) -> str:
        """Update a draft session's config and rebuild its system prompt.

        Returns the new system prompt string.
        """
        task = self._tracker.get_task(bonsai_sid)
        if task.status != "draft":
            raise ValueError(f"Cannot update: session is '{task.status}', expected 'draft'")
        if spec_ids is not None:
            task.spec_ids = spec_ids
        if skill_id is not ...:
            task.skill_id = skill_id
        if config is not None:
            task.config = config
        if session_prompt is not ...:
            task.session_prompt = session_prompt
        if name is not ...:
            task.name = name
        if meta_ticket_id is not ...:
            old_ticket_id = task.meta_ticket_id
            if old_ticket_id and old_ticket_id != meta_ticket_id and self.board_service:
                try:
                    self.board_service.detach_session(old_ticket_id, task.bonsai_sid)
                except Exception:
                    logger.warning("Failed to detach session from ticket %s", old_ticket_id)
            task.meta_ticket_id = meta_ticket_id
            if meta_ticket_id:
                self._attach_to_ticket(task)
        task.system_prompt = self._build_context_for(task)
        self._save_task(task)
        return task.system_prompt

    async def start_draft(
        self,
        bonsai_sid: str,
        notify: Callable,
        prompt: str | None = None,
    ) -> AgentTask:
        """Start a draft session — transitions to initializing and launches the runner.

        If *prompt* is provided it is enqueued as the first user message.
        """
        task = self._tracker.get_task(bonsai_sid)
        if task.status != "draft":
            raise ValueError(f"Cannot start: session is '{task.status}', expected 'draft'")
        self._tracker.set_status(bonsai_sid, "initializing")
        spec_context = task.system_prompt or self._build_context_for(task)
        if prompt:
            self._tracker.enqueue_message(bonsai_sid, prompt)
        bg_task = asyncio.create_task(
            self._run_background(task, spec_context, notify)
        )
        self._running_tasks[task.bonsai_sid] = bg_task
        self._save_task(task)
        return task

    async def run_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        notify: Callable,
        skill_id: str | None = None,
        session_prompt: str | None = None,
        name: str = "",
        meta_ticket_id: str | None = None,
    ) -> AgentTask:
        """Start a persistent agent session (one-step shortcut).

        Creates the task, launches the runner in the background (which
        opens the SDK client and enters idle), and returns immediately.
        The session waits for messages via ``send_message``.
        """
        task = self._tracker.create_task(
            spec_ids, config, skill_id=skill_id, session_prompt=session_prompt, name=name,
        )
        task.meta_ticket_id = meta_ticket_id
        self._attach_to_ticket(task)
        spec_context = self._build_context_for(task)
        bg_task = asyncio.create_task(
            self._run_background(task, spec_context, notify)
        )
        self._running_tasks[task.bonsai_sid] = bg_task
        self._save_task(task)
        return task

    async def send_message(self, bonsai_sid: str, text: str, *, is_markdown: bool = False) -> None:
        """Send a user message to the session, triggering a new turn."""
        task = self._tracker.get_task(bonsai_sid)
        if task.status not in ("initializing", "idle"):
            raise ValueError(
                f"Cannot send message: session is '{task.status}', expected 'initializing' or 'idle'"
            )
        self._save_event(bonsai_sid, {
            "eventType": "userMessage",
            "payload": {"text": text, "isMarkdown": is_markdown},
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
            if task.status == "draft":
                # Draft sessions have no runner — just clean up directly
                self._tracker.set_status(bonsai_sid, "done")
                self._save_task(task)
                self._tracker.remove_task(bonsai_sid)
                return
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
            "sessionPrompt": task.session_prompt,
            "specIds": list(task.spec_ids),
            "config": task.config.model_dump(by_alias=True),
            "status": task.status,
            "sessionId": task.session_id,
            "metaTicketId": task.meta_ticket_id,
            "createdAt": task.created,
            "updatedAt": task.updated,
        }
        if task.system_prompt is not None:
            data["systemPrompt"] = task.system_prompt
        # Preserve metrics from disk (written by update_session_metadata)
        if existing and existing.get("metrics"):
            data["metrics"] = existing["metrics"]
        else:
            data["metrics"] = {
                "costUsd": 0, "turns": 0, "toolCalls": 0,
                "turnCostUsd": 0, "turnTurns": 0,
                "durationMs": 0, "contextTokens": 0,
                "contextMax": 200_000, "outputTokens": 0,
            }
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
            entry: dict[str, Any] = {
                "bonsaiSid": task.bonsai_sid,
                "name": name,
                "skillId": task.skill_id,
                "specIds": list(task.spec_ids),
                "status": task.status,
                "model": task.config.model,
                "metaTicketId": task.meta_ticket_id,
                "createdAt": task.created,
                "updatedAt": task.updated,
                "active": task.status not in ("done", "error"),
                "metrics": disk_entry.get("metrics", {}),
            }
            if task.status == "draft":
                entry["config"] = task.config.model_dump(by_alias=True)
                entry["systemPrompt"] = task.system_prompt
                entry["sessionPrompt"] = task.session_prompt
            disk[task.bonsai_sid] = entry
        return list(disk.values())

    def get_session_data(self, bonsai_sid: str) -> dict | None:
        """Get full session data (events included) from disk."""
        return load_session(self._config.project_root, bonsai_sid)

    def trash_session(self, bonsai_sid: str) -> None:
        """Soft-delete a session: detach from tickets, move to trash."""
        if self.board_service:
            try:
                self.board_service.detach_session_from_all(bonsai_sid)
            except Exception:
                logger.warning("Failed to detach session %s from tickets", bonsai_sid)
        if self.trash_service:
            self.trash_service.trash_session(bonsai_sid)
        else:
            # Fallback: hard-delete if no trash service
            delete_session_from_disk(self._config.project_root, bonsai_sid)
        # Clean up in-memory state if still tracked
        if self._tracker.has_task(bonsai_sid):
            self._tracker.remove_task(bonsai_sid)
            self._running_tasks.pop(bonsai_sid, None)

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
        session_prompt = old.get("sessionPrompt")
        name = old.get("name", "session")

        task = self._tracker.create_task(
            old_spec_ids, old_config,
            skill_id=skill_id,
            session_prompt=session_prompt,
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
            "status": "initializing",
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

    def _attach_to_ticket(self, task: AgentTask) -> None:
        """Auto-attach session to meta-ticket and set orchestrator if applicable."""
        if not task.meta_ticket_id or not self.board_service:
            return
        try:
            self.board_service.attach_session(task.meta_ticket_id, task.bonsai_sid)
            ticket = self.board_service.get_ticket(task.meta_ticket_id)
            if ticket.plan_path and (task.name.startswith("Execute:") or task.name.startswith("Orchestrate:")):
                self.board_service.set_orchestrator(task.meta_ticket_id, task.bonsai_sid)
        except Exception:
            logger.warning("Failed to attach session to ticket %s", task.meta_ticket_id)

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
        _base_tool_calls = 0
        if resume_session_id:
            _existing = load_session(self._config.project_root, task.bonsai_sid)
            if _existing and _existing.get("metrics"):
                _m = _existing["metrics"]
                _base_cost = _m.get("costUsd", 0.0)
                _base_turns = _m.get("turns", 0)
                _base_duration = _m.get("durationMs", 0)
                _base_tool_calls = _m.get("toolCalls", 0)

        # Mutable live metrics dict — updated incrementally by _persisting_notify
        _live_metrics: dict = {
            "costUsd": _base_cost,
            "turns": _base_turns,
            "toolCalls": _base_tool_calls,
            "turnCostUsd": 0,
            "turnTurns": 0,
            "durationMs": _base_duration,
            "contextTokens": 0,
            "contextMax": 200_000,
            "outputTokens": 0,
        }
        _wall_start = time.monotonic()

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
            # Persist streaming events (skip overly frequent and ephemeral ones)
            if method.startswith("agent/") and method not in ("agent/progress", "agent/costEstimate"):
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

            # -- Incremental metrics persistence --
            # Skip only high-frequency events; all others update metrics on disk.
            _SKIP_METRICS = {"agent/textDelta", "agent/progress", "agent/costEstimate"}
            _FULL_METRICS = {"agent/turnComplete", "agent/done", "agent/interrupted"}

            if method not in _SKIP_METRICS:
                _live_metrics["durationMs"] = _base_duration + int((time.monotonic() - _wall_start) * 1000)

                if method == "agent/toolCallEnd":
                    _live_metrics["toolCalls"] += 1

                if method in _FULL_METRICS:
                    usage = params.get("usage", {})
                    ctx_tokens = (
                        usage.get("input_tokens", 0)
                        + usage.get("output_tokens", 0)
                    )
                    _live_metrics.update({
                        "costUsd": _base_cost + params.get("costUsd", 0),
                        "turns": _base_turns + params.get("turns", 0),
                        "turnCostUsd": params.get("turnCostUsd", 0),
                        "turnTurns": params.get("turn_turns", 0),
                        "contextTokens": ctx_tokens,
                        "contextMax": 1_000_000 if "context-1m-2025-08-07" in task.config.betas else 200_000,
                        "outputTokens": usage.get("output_tokens", 0),
                    })

                update_session_metadata(self._config.project_root, task.bonsai_sid, {
                    "metrics": dict(_live_metrics),
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
            await run(task, spec_context, notify, self._tracker, cwd=self._config.project_root, plugin_dir=self._config.plugin_dir, resume_session_id=resume_session_id, config=self._config)
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
            # Notify orchestrator if this was a step session
            await self._notify_orchestrator_on_step_complete(task)

    async def _notify_orchestrator_on_step_complete(self, task: AgentTask) -> None:
        """If this session belongs to a meta-ticket with an orchestrator, notify it."""
        if not task.meta_ticket_id or not self.board_service:
            return
        try:
            ticket = self.board_service.get_ticket(task.meta_ticket_id)
            orch_sid = ticket.orchestrator_session_id
            if not orch_sid or orch_sid == task.bonsai_sid:
                return  # Don't notify self, or no orchestrator

            # Update the plan step that matches this session
            if ticket.plan_path and self.board_service.plans.plan_exists(task.meta_ticket_id):
                plan = self.board_service.plans.read_plan(task.meta_ticket_id)
                for step in plan.all_steps():
                    if step.session_id == task.bonsai_sid:
                        new_status = "done" if task.status == "done" else "failed"
                        self.board_service.plans.update_step_status(
                            task.meta_ticket_id, step.number, new_status,
                        )
                        break

            # Inject a message into the orchestrator session
            if self._tracker.has_task(orch_sid):
                status_word = "completed successfully" if task.status == "done" else f"ended with status: {task.status}"
                msg = f"[Step session {task.name or task.bonsai_sid[:8]} {status_word}]"
                self._tracker.enqueue_message(orch_sid, msg)
        except Exception:
            logger.debug("Failed to notify orchestrator for ticket %s", task.meta_ticket_id)

    def _build_context_for(self, task: AgentTask) -> str:
        t0 = time.monotonic()

        # Inject plan content into session prompt for sessions linked to a ticket with a plan
        session_prompt = task.session_prompt
        if task.meta_ticket_id and self.board_service:
            try:
                ticket = self.board_service.get_ticket(task.meta_ticket_id)
                if ticket.plan_path and self.board_service.plans.plan_exists(task.meta_ticket_id):
                    from app.board.plan import _render_plan
                    plan = self.board_service.plans.read_plan(task.meta_ticket_id)
                    plan_text = _render_plan(plan)
                    plan_section = (
                        "## Implementation Plan\n\n"
                        "The following plan is associated with this ticket. "
                        "As the orchestrator, read the plan, identify the next unblocked step, "
                        "and call `suggest_step` to propose it for execution.\n\n"
                        f"{plan_text}"
                    )
                    session_prompt = (
                        f"{session_prompt}\n\n{plan_section}" if session_prompt else plan_section
                    )
            except Exception:
                logger.debug("Failed to inject plan for ticket %s", task.meta_ticket_id)

        # Inject ticket title + body for describe sessions
        if task.meta_ticket_id and self.board_service and task.skill_id == "ticket-describe":
            try:
                ticket = self.board_service.get_ticket(task.meta_ticket_id)
                ticket_section = (
                    "## Current Ticket\n\n"
                    f"**Title:** {ticket.title}\n\n"
                    f"**Current body:**\n{ticket.body or '(empty)'}\n"
                )
                session_prompt = (
                    f"{session_prompt}\n\n{ticket_section}" if session_prompt else ticket_section
                )
            except Exception:
                logger.debug("Failed to inject ticket for %s", task.meta_ticket_id)

        ctx = build_context(
            spec_ids=task.spec_ids,
            skill_id=task.skill_id,
            session_prompt=session_prompt,
            project_root=self._config.project_root,
            config=task.config,
            spec_service=self._spec_service,
            plugin_dir=self._config.plugin_dir,
        )
        ms = int((time.monotonic() - t0) * 1000)
        logger.info("[%s] build_context: %dms (%d chars)", task.bonsai_sid[:8], ms, len(ctx))
        return ctx
