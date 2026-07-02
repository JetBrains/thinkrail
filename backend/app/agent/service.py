from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Any

from app import analytics
from app.agent.context import build_context
from app.agent.exceptions import InvalidCapabilityValueError
from app.agent.models import AgentConfig, AgentTask, SessionReturnStatus, SubagentMode, SubsessionType, TaskStatus, is_quiescent, is_settled, is_streaming, is_terminal
from app.agent.persistence import append_event, save_session, load_session, list_sessions as list_sessions_from_disk, delete_session as delete_session_from_disk, update_session_metadata, load_events
from app.agent.runtime import (
    IAgentRuntime,
    LabeledOption,
    RuntimeCapabilities,
    RuntimeExecutionConfig,
    RuntimeRegistry,
    UnknownRuntimeError,
    make_handler_from_notify,
)
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.spec.service import SpecService

logger = logging.getLogger(__name__)


def _analytics_outcome(status: TaskStatus) -> str:
    """Map a terminal task status to the coarse analytics outcome."""
    if status == TaskStatus.DONE:
        return "completed"
    if status == TaskStatus.ERROR:
        return "error"
    return "cancelled"


def _files_written_bucket(count: int) -> str:
    """Bucket a written-file count to keep the analytics dimension low-cardinality."""
    if count == 0:
        return "0"
    if count <= 3:
        return "1-3"
    if count <= 10:
        return "4-10"
    return "11+"


# Skills whose system prompt should be augmented with the ticket's title and
# body. Covers all per-ticket drafting/implementing skills.
_TICKET_BODY_SKILLS: frozenset[str] = frozenset({
    "ticket-product-design",
    "ticket-technical-design",
    "ticket-amend-specs",
    "ticket-implementation-plan",
    "ticket-implement",
})


class AgentService:
    """Facade — single entry point for agent session management."""

    def __init__(
        self,
        config: AppConfig,
        spec_service: SpecService,
        *,
        tracker: Tracker | None = None,
    ) -> None:
        self._config = config
        self._spec_service = spec_service
        # Tracker is project-scoped: ``ProjectContext`` owns one and shares it
        # with both the agent service and every runtime instance, so a single
        # tracker is the source of truth for per-session state.
        self._tracker = tracker if tracker is not None else Tracker()
        self._running_tasks: dict[str, asyncio.Task[Any]] = {}
        self.board_service: Any = None     # Injected by server.py
        self.runtime_registry: RuntimeRegistry | None = None  # Injected by server.py
        self.coordinator: Any = None      # Injected by server.py (IndexCoordinator)
        self._restore_draft_sessions()

    def _get_capabilities(self, task: AgentTask) -> RuntimeCapabilities | None:
        """Return the runtime's capabilities for ``task``, or ``None`` when unavailable.

        ``None`` (logged at debug) when the registry isn't wired (test
        bootstrap) or the persisted ``runtime`` no longer maps to a
        registered runtime — callers skip validation rather than crash.
        """
        if self.runtime_registry is None:
            return None
        try:
            runtime = self.runtime_registry.get(task.config.runtime)
        except UnknownRuntimeError:
            logger.debug(
                "[%s] Unknown runtime %r; skipping capability check",
                task.thinkrail_sid[:8], task.config.runtime,
            )
            return None
        return runtime.capabilities()

    def _validate_config_against_caps(self, task: AgentTask) -> None:
        """Raise :class:`InvalidCapabilityValueError` if any field on ``task.config`` is out of caps.

        No-op when caps are unavailable (test bootstrap, unknown runtime).
        Out-of-caps values are preserved on the config (draft creation /
        restore never mutate them) and only rejected here, at launch.
        """
        caps = self._get_capabilities(task)
        if caps is None:
            return
        cfg = task.config
        self._validate_config_value(task, field="model", value=cfg.model, allowed=caps.models)
        self._validate_config_value(
            task, field="permissionMode", value=cfg.permission_mode, allowed=caps.permission_modes,
        )
        self._validate_config_value(task, field="effort", value=cfg.effort, allowed=caps.effort_levels)

    def _validate_config_value(
        self, task: AgentTask, *, field: str, value: str, allowed: list[LabeledOption],
    ) -> None:
        """Raise :class:`InvalidCapabilityValueError` if *value* isn't in *allowed*."""
        allowed_values = [opt.value for opt in allowed]
        if value not in allowed_values:
            raise InvalidCapabilityValueError(
                field=field, value=value,
                runtime_type=task.config.runtime, allowed=allowed_values,
            )

    def _restore_draft_sessions(self) -> None:
        """Restore draft sessions from disk into the tracker on startup."""
        disk_sessions = list_sessions_from_disk(self._config.project_root)
        for entry in disk_sessions:
            if entry.get("status") != TaskStatus.DRAFT:
                continue
            sid = entry.get("thinkrailSid", "")
            if not sid or self._tracker.has_task(sid):
                continue
            try:
                task = AgentTask(
                    thinkrail_sid=sid,
                    name=entry.get("name", ""),
                    status=TaskStatus.DRAFT,
                    spec_ids=entry.get("specIds", []),
                    file_paths=entry.get("filePaths", []),
                    skill_id=entry.get("skillId"),
                    session_prompt=entry.get("sessionPrompt"),
                    draft_input=entry.get("draftInput"),
                    config=AgentConfig(**entry.get("config", {})),
                    ticket_id=entry.get("ticketId"),
                    subagent_mode=entry.get("subagentMode") or "step-session",
                    step_gate=entry.get("stepGate") or "approve",
                    system_prompt=entry.get("systemPrompt"),
                    created=entry.get("createdAt", ""),
                    updated=entry.get("updatedAt", ""),
                )
                self._tracker.add_task(task)
                logger.info("Restored draft session %s (%s)", sid[:8], task.name)
            except Exception:
                logger.warning("Failed to restore draft session %s", sid, exc_info=True)

    @staticmethod
    def _get_bus():
        """Lazy import to avoid circular dependency (agent → rpc → agent)."""
        from app.rpc.bus import bus
        return bus

    # -- public methods -------------------------------------------------------

    async def prepare_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        skill_id: str | None = None,
        session_prompt: str | None = None,
        name: str = "",
        ticket_id: str | None = None,
        file_paths: list[str] | None = None,
        thinkrail_sid: str | None = None,
        draft_input: str | None = None,
    ) -> AgentTask:
        """Create a draft session without starting the runner.

        Builds the system prompt and persists the task in "draft" status.
        Call ``start_draft`` to actually launch the SDK session.

        ``thinkrail_sid``, when supplied, is reused verbatim instead of
        server-minting one. ``draft_input`` carries the autosaved prompt text —
        non-context, never fed to ``build_context``.
        """
        task = self._tracker.create_task(
            spec_ids, config, skill_id=skill_id, session_prompt=session_prompt, name=name,
            thinkrail_sid=thinkrail_sid, draft_input=draft_input,
        )
        task.status = TaskStatus.DRAFT
        task.ticket_id = ticket_id
        if file_paths:
            task.file_paths = file_paths
        self._attach_to_ticket(task)
        task.system_prompt = await self._build_context_for(task)
        self._save_task(task)
        return task

    async def update_draft(
        self,
        thinkrail_sid: str,
        spec_ids: list[str] | None = None,
        skill_id: str | None = ...,  # type: ignore[assignment]
        config: AgentConfig | None = None,
        session_prompt: str | None = ...,  # type: ignore[assignment]
        name: str | None = ...,  # type: ignore[assignment]
        ticket_id: str | None = ...,  # type: ignore[assignment]
        file_paths: list[str] | None = ...,  # type: ignore[assignment]
        draft_input: str | None = ...,  # type: ignore[assignment]
        subagent_mode: str | None = None,
        step_gate: str | None = None,
    ) -> dict:
        """Update a draft session's config and rebuild its system prompt.

        Returns the structured prompt preview: ``{"full", "sections", "totalTokens"}``.
        """
        task = self._tracker.get_task(thinkrail_sid)
        if task.status != TaskStatus.DRAFT:
            raise ValueError(f"Cannot update: session is '{task.status}', expected 'draft'")
        if spec_ids is not None:
            task.spec_ids = spec_ids
        if file_paths is not ...:
            task.file_paths = file_paths if file_paths is not None else []
        if skill_id is not ...:
            task.skill_id = skill_id
        if config is not None:
            task.config = config
        if session_prompt is not ...:
            task.session_prompt = session_prompt
        if draft_input is not ...:
            task.draft_input = draft_input
        if name is not ...:
            task.name = name
        if subagent_mode is not None:
            if subagent_mode in ("step-session", "subagent"):
                task.subagent_mode = subagent_mode
        if step_gate is not None:
            if step_gate in ("approve", "autonomous"):
                task.step_gate = step_gate
        if ticket_id is not ...:
            old_ticket_id = task.ticket_id
            if old_ticket_id and old_ticket_id != ticket_id and self.board_service:
                try:
                    self.board_service.detach_session(old_ticket_id, task.thinkrail_sid)
                except Exception:
                    logger.warning("Failed to detach session from ticket %s", old_ticket_id)
            task.ticket_id = ticket_id
            if ticket_id:
                self._attach_to_ticket(task)
        # An autosave touching only draft_input/name leaves the system prompt
        # unchanged — skip the context assembly (built twice otherwise) and the
        # structured-sections rebuild the preview path doesn't consume here.
        text_only = (
            spec_ids is None
            and skill_id is ...
            and config is None
            and session_prompt is ...
            and file_paths is ...
            and ticket_id is ...
            and subagent_mode is None
            and step_gate is None
        )
        if not text_only:
            task.system_prompt = await self._build_context_for(task)
        self._save_task(task)
        if text_only:
            return {"full": task.system_prompt or "", "sections": [], "totalTokens": 0}
        return await self._build_context_structured_for(task)

    async def start_draft(
        self,
        thinkrail_sid: str,
        prompt: str | None = None,
    ) -> AgentTask:
        """Start a draft session — transitions to initializing and launches the runner.

        If *prompt* is provided it is enqueued as the first user message.
        """
        task = self._tracker.get_task(thinkrail_sid)
        if task.status != TaskStatus.DRAFT:
            raise ValueError(f"Cannot start: session is '{task.status}', expected 'draft'")
        self._validate_config_against_caps(task)
        self._tracker.set_status(thinkrail_sid, TaskStatus.INITIALIZING)
        spec_context = task.system_prompt or await self._build_context_for(task)
        if prompt is not None:
            self._tracker.enqueue_message(thinkrail_sid, prompt)
        bg_task = asyncio.create_task(
            self._run_background(task, spec_context)
        )
        self._running_tasks[task.thinkrail_sid] = bg_task
        self._save_task(task)
        return task

    async def run_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        skill_id: str | None = None,
        session_prompt: str | None = None,
        name: str = "",
        ticket_id: str | None = None,
        subagent_mode: SubagentMode | None = None,
    ) -> AgentTask:
        """Start a persistent agent session (one-step shortcut).

        Creates the task, launches the runner in the background (which
        opens the SDK client and enters idle), and returns immediately.
        The session waits for messages via ``send_message``.
        """
        task = self._tracker.create_task(
            spec_ids, config, skill_id=skill_id, session_prompt=session_prompt, name=name,
        )
        task.ticket_id = ticket_id
        if subagent_mode is not None:
            task.subagent_mode = subagent_mode
        self._validate_config_against_caps(task)
        self._attach_to_ticket(task)
        spec_context = await self._build_context_for(task)
        bg_task = asyncio.create_task(
            self._run_background(task, spec_context)
        )
        self._running_tasks[task.thinkrail_sid] = bg_task
        self._save_task(task)
        return task

    async def send_message(self, thinkrail_sid: str, text: str, *, is_markdown: bool = False) -> None:
        """Send a user message to the session, triggering a new turn."""
        from app.agent.tracker import TaskNotFoundError
        try:
            task = self._tracker.get_task(thinkrail_sid)
        except TaskNotFoundError:
            raise ValueError(
                f"Cannot send message: session '{thinkrail_sid}' is not in the live tracker "
                "(session may need to be resumed first)"
            )
        if not is_quiescent(task.status):
            raise ValueError(
                f"Cannot send message: session is '{task.status}', expected 'initializing' or 'idle'"
            )
        self._save_event(thinkrail_sid, {
            "eventType": "userMessage",
            "payload": {"text": text, "isMarkdown": is_markdown},
        })
        self._tracker.set_last_message(thinkrail_sid, text)
        self._tracker.enqueue_message(thinkrail_sid, text)

    async def interrupt_task(self, thinkrail_sid: str) -> None:
        """Cancel the current turn non-destructively.

        Delegates the runtime-specific cancel to the runtime's ``interrupt``
        hook (Claude calls ``client.interrupt()``); ``set_interrupted`` and
        ``interrupt_futures`` stay here because they are thinkrail-internal
        state, not runtime-internal. The runner stays alive — no re-launch
        needed.
        """
        task = self._tracker.get_task(thinkrail_sid)
        if not is_streaming(task.status):
            # Already idle/done — nothing to interrupt
            return

        # 1. Set interrupt flag BEFORE calling runtime.interrupt() so the
        #    runner knows to emit agent/interrupted instead of turnComplete.
        self._tracker.set_interrupted(thinkrail_sid)

        # 2. Resolve pending futures with deny+interrupt (for waiting state).
        #    Unlike cancel_futures(), this produces a clean
        #    PermissionResultDeny(interrupt=True) through the SDK.
        self._tracker.interrupt_futures(thinkrail_sid)

        # 3. Delegate the runtime-specific cancel via the registry. If the
        #    runtime can't be resolved (registry not wired, unknown runtime
        #    in config), the SDK will never produce a ResultMessage to clear
        #    the interrupted flag — roll back the tracker state before
        #    returning so the session isn't wedged into "interrupted" forever.
        try:
            runtime = self._get_runtime(task)
        except UnknownRuntimeError as exc:
            self._tracker.clear_interrupted(thinkrail_sid)
            logger.warning(
                "[%s] interrupt: runtime %r not registered: %s",
                thinkrail_sid[:8], task.config.runtime, exc,
            )
            return
        await runtime.interrupt(task, self._tracker)

    async def end_session(self, thinkrail_sid: str) -> None:
        """Gracefully close the session."""
        try:
            task = self._tracker.get_task(thinkrail_sid)
            if is_terminal(task.status):
                return  # already finished
            if task.status == TaskStatus.DRAFT:
                # Draft sessions have no runner — just clean up directly
                self._tracker.set_status(thinkrail_sid, TaskStatus.DONE)
                self._save_task(task)
                self._tracker.remove_task(thinkrail_sid)
                return
            # If the runner is blocked awaiting a user response, the end
            # signal we enqueue below would never be picked up. Resolve
            # any pending futures with deny+interrupt so the tool callback
            # returns and the runner can drain the queue.
            self._tracker.interrupt_futures(thinkrail_sid)
            self._tracker.enqueue_end_signal(thinkrail_sid)
        except Exception:
            # Task not in memory (e.g. backend restarted) — update on disk only
            existing = load_session(self._config.project_root, thinkrail_sid)
            if existing and not is_terminal(existing.get("status")):
                existing["status"] = TaskStatus.DONE
                save_session(self._config.project_root, existing)

    def get_task(self, thinkrail_sid: str) -> AgentTask:
        return self._tracker.get_task(thinkrail_sid)

    def get_last_message(self, thinkrail_sid: str) -> str | None:
        """Return the last user message sent to this session (for retry)."""
        return self._tracker.get_last_message(thinkrail_sid)

    def list_tasks(self) -> list[AgentTask]:
        return self._tracker.list_tasks()

    async def update_config(
        self,
        thinkrail_sid: str,
        model: str | None = None,
        permission_mode: str | None = None,
        effort: str | None = None,
    ) -> dict:
        """Update model and/or permission mode on a live session.

        Each non-None field is validated against the runtime's
        ``capabilities()`` and an :class:`InvalidCapabilityValueError` is
        raised on mismatch — this is an explicit user edit, so an out-of-caps
        value is rejected rather than applied.
        """
        task = self._tracker.get_task(thinkrail_sid)
        client = self._tracker.get_client(thinkrail_sid)
        if client is None:
            raise ValueError(f"No live client for session {thinkrail_sid}")
        caps = self._get_capabilities(task)
        if caps is not None:
            if model is not None:
                self._validate_config_value(task, field="model", value=model, allowed=caps.models)
            if permission_mode is not None:
                self._validate_config_value(
                    task, field="permissionMode", value=permission_mode,
                    allowed=caps.permission_modes,
                )
            if effort is not None:
                self._validate_config_value(
                    task, field="effort", value=effort, allowed=caps.effort_levels,
                )
        if model is not None:
            logger.info("[%s] update_config: set_model(%s)", thinkrail_sid[:8], model)
            await client.set_model(model)
            task.config.model = model
        if permission_mode is not None:
            logger.info("[%s] update_config: set_permission_mode(%s)", thinkrail_sid[:8], permission_mode)
            try:
                await client.set_permission_mode(permission_mode)
            except Exception:
                logger.exception("[%s] set_permission_mode(%s) FAILED", thinkrail_sid[:8], permission_mode)
                raise
            task.config.permission_mode = permission_mode
            logger.info("[%s] update_config: permission_mode updated to %s", thinkrail_sid[:8], permission_mode)
        if effort is not None:
            task.config.effort = effort
        self._save_task(task)
        return {"model": task.config.model, "permissionMode": task.config.permission_mode, "effort": task.config.effort}

    async def restart_session(self, thinkrail_sid: str) -> AgentTask:
        """End current session and resume with current (updated) config."""
        self._tracker.enqueue_end_signal(thinkrail_sid)
        bg_task = self._running_tasks.get(thinkrail_sid)
        if bg_task:
            try:
                await bg_task
            except Exception:
                pass
        return await self.continue_session(thinkrail_sid)

    async def respond(self, thinkrail_sid: str, request_id: str, response: dict) -> None:
        self._tracker.resolve_future(thinkrail_sid, request_id, response)
        self._save_event(thinkrail_sid, {
            "eventType": "requestResolved",
            "payload": {"requestId": request_id, "response": response},
        })

    # -- session persistence --------------------------------------------------

    def _save_task(self, task: AgentTask, events: list[dict] | None = None) -> None:
        """Persist current task state to disk."""
        # Load existing metadata to preserve metrics and events
        existing = load_session(self._config.project_root, task.thinkrail_sid)
        data: dict = {
            "thinkrailSid": task.thinkrail_sid,
            "name": task.name or task.thinkrail_sid[:8],
            "skillId": task.skill_id,
            "sessionPrompt": task.session_prompt,
            "draftInput": task.draft_input,
            "specIds": list(task.spec_ids),
            "filePaths": list(task.file_paths),
            "config": task.config.model_dump(by_alias=True),
            "status": task.status,
            "sessionId": task.session_id,
            "ticketId": task.ticket_id,
            "createdAt": task.created,
            "updatedAt": task.updated,
            "createdBy": task.created_by,
            "artifacts": [a.model_dump(by_alias=True) for a in task.artifacts],
            "previewPath": task.preview_path,
            "subagentMode": task.subagent_mode,
            "stepGate": task.step_gate,
        }
        if task.system_prompt is not None:
            data["systemPrompt"] = task.system_prompt
        if task.outcome is not None:
            data["outcome"] = task.outcome.model_dump(by_alias=True)
        # Preserve metrics from disk (written by update_session_metadata)
        if existing and existing.get("metrics"):
            data["metrics"] = existing["metrics"]
        else:
            # contextMax (usage-bar denominator) is unknown until the first
            # turn streams it from the runtime — seed 0 so the bar stays hidden.
            data["metrics"] = {
                "costUsd": 0, "turns": 0, "toolCalls": 0,
                "turnCostUsd": 0, "turnTurns": 0,
                "durationMs": 0, "contextTokens": 0,
                "contextMax": 0, "outputTokens": 0,
            }
        # Preserve existing events from disk if we don't have new ones
        if events is not None:
            data["events"] = events
        elif existing:
            data["events"] = existing.get("events", [])
        save_session(self._config.project_root, data)

    def _save_event(self, thinkrail_sid: str, event: dict) -> None:
        """Append an event to the persisted session file."""
        append_event(self._config.project_root, thinkrail_sid, event)

    # ── Subagent → plan-step linkage ─────────────────────────────────────
    # Used by _persisting_notify when the orchestrator (ticket-implement in
    # subagent mode) emits a Task call carrying a ``[thinkrail-step …]`` marker.

    def _mark_step_running(
        self, ticket_id: str, step_number: int, event_index: int,
    ) -> None:
        """Point ``plan.steps[step-1]`` at ``event_index`` and flip status to
        ``executing``. Best-effort — failures are logged and swallowed so a
        plan-update bug never blocks the event stream.
        """
        if not self.board_service or not self.board_service.plans.plan_exists(ticket_id):
            return
        from app.board.plan import StepStatus
        try:
            plan = self.board_service.plans.read_plan(ticket_id)
        except Exception:
            logger.debug("No plan for ticket %s; subagent linkage skipped", ticket_id)
            return
        step = next(
            (s for s in plan.all_steps() if s.number == step_number), None,
        )
        if step is None:
            return
        step.event_index = event_index
        step.status = StepStatus.EXECUTING
        try:
            self.board_service.plans.save_plan(ticket_id, plan)
        except Exception:
            logger.debug("Failed to persist plan for %s", ticket_id, exc_info=True)

    def _mark_step_finished(
        self, ticket_id: str, step_number: int, is_error: bool,
    ) -> None:
        """Flip ``plan.steps[step-1].status`` to ``done`` (or ``failed``)."""
        if not self.board_service or not self.board_service.plans.plan_exists(ticket_id):
            return
        from app.board.plan import StepStatus
        try:
            plan = self.board_service.plans.read_plan(ticket_id)
        except Exception:
            return
        step = next(
            (s for s in plan.all_steps() if s.number == step_number), None,
        )
        if step is None:
            return
        step.status = StepStatus.FAILED if is_error else StepStatus.DONE
        try:
            self.board_service.plans.save_plan(ticket_id, plan)
        except Exception:
            logger.debug("Failed to persist plan for %s", ticket_id, exc_info=True)

    def list_all_sessions(self) -> list[dict]:
        """List all sessions: in-memory active + on-disk archived."""
        # Start with disk sessions
        disk = {s["thinkrailSid"]: s for s in list_sessions_from_disk(self._config.project_root)}
        # Overlay in-memory active sessions (they have fresher status)
        for task in self._tracker.list_tasks():
            # Preserve name from disk if the in-memory task has no custom name
            disk_entry = disk.get(task.thinkrail_sid, {})
            name = task.name or disk_entry.get("name") or task.thinkrail_sid[:8]
            entry: dict[str, Any] = {
                "thinkrailSid": task.thinkrail_sid,
                "name": name,
                "skillId": task.skill_id,
                "specIds": list(task.spec_ids),
                "status": task.status,
                "model": task.config.model,
                "ticketId": task.ticket_id,
                "createdAt": task.created,
                "updatedAt": task.updated,
                "active": not is_terminal(task.status),
                "inTracker": True,
                "metrics": disk_entry.get("metrics", {}),
                "outcome": (
                    task.outcome.model_dump(by_alias=True)
                    if task.outcome is not None
                    else disk_entry.get("outcome")
                ),
            }
            if task.status == TaskStatus.DRAFT:
                entry["config"] = task.config.model_dump(by_alias=True)
                entry["systemPrompt"] = task.system_prompt
                entry["sessionPrompt"] = task.session_prompt
                entry["draftInput"] = task.draft_input
                entry["filePaths"] = list(task.file_paths)
                entry["subagentMode"] = task.subagent_mode
                entry["stepGate"] = task.step_gate
            disk[task.thinkrail_sid] = entry
        return list(disk.values())

    def get_session_data(self, thinkrail_sid: str) -> dict | None:
        """Get full session data (events included) from disk, overlaid with live tracker state."""
        data = load_session(self._config.project_root, thinkrail_sid)
        if data is None:
            return None
        # Overlay in-memory tracker state (status, pending request) for active sessions
        if self._tracker.has_task(thinkrail_sid):
            task = self._tracker.get_task(thinkrail_sid)
            data["status"] = task.status
            if task.outcome is not None:
                data["outcome"] = task.outcome.model_dump(by_alias=True)
            # Live artifacts win over disk (disk lags by one tool-call cycle)
            data["artifacts"] = [a.model_dump(by_alias=True) for a in task.artifacts]
            data["previewPath"] = task.preview_path
            data["pendingRequests"] = self._tracker.list_pending_requests(thinkrail_sid)
            # ticket-implement orchestration mode — live tracker value beats
            # whatever was on disk before the most recent update_draft.
            data["subagentMode"] = task.subagent_mode
            data["stepGate"] = task.step_gate
        else:
            # Not in tracker — correct stale status (no live runner)
            status = data.get("status", TaskStatus.DONE)
            if not is_settled(status):
                data["status"] = TaskStatus.DONE
        return data

    def patch_outcome_action(
        self, thinkrail_sid: str, action_id: str, patch: dict[str, Any]
    ) -> dict | None:
        """Apply a partial update to one outcome action and persist it.

        Called by the frontend after the user executes a queued action
        (e.g. clicking 'Add to board' on a CreateTicketAction → mark it
        applied so the button stays in the 'added' state across reloads).

        Returns the updated task as a dict, or None if the session is
        not in the tracker.
        """
        if not self._tracker.has_task(thinkrail_sid):
            return None
        task = self._tracker.patch_outcome_action(thinkrail_sid, action_id, patch)
        self._save_task(task)
        return task.model_dump(by_alias=True)

    def parent_id_of(self, thinkrail_sid: str) -> str | None:
        """The session's parent thinkrail_sid, read from tracker or disk."""
        if self._tracker.has_task(thinkrail_sid):
            return self._tracker.get_task(thinkrail_sid).parent_thinkrail_sid
        data = load_session(self._config.project_root, thinkrail_sid) or {}
        return data.get("parentThinkrailSid")

    async def _broadcast_blocked(self, parent_id: str | None) -> None:
        """Emit session/didUpdate for parent_id so blocked state refreshes live."""
        if not parent_id:
            return
        try:
            parent_payload = self.get_session_data(parent_id)
            if parent_payload is None:
                return
            parent_payload.pop("events", None)
            await self._get_bus().publish_to_project(
                str(self._config.project_root),
                "session/didUpdate",
                {"task": parent_payload},
            )
        except Exception:
            logger.debug("Failed to broadcast parent blocked for %s", parent_id, exc_info=True)

    def _is_ticket_orchestrator(self, task: AgentTask) -> bool:
        """True when this session IS its ticket's orchestrator (role, not skill)."""
        if not task.ticket_id or not self.board_service:
            return False
        try:
            ticket = self.board_service.get_ticket(task.ticket_id)
        except Exception:
            return False
        orch = ticket.orchestrator
        return bool(orch and orch.kind == "session" and orch.session_id == task.thinkrail_sid)

    async def promote_to_ticket(
        self,
        thinkrail_sid: str,
        *,
        title: str,
        body: str = "",
        type: str = "feature",
    ) -> Any:
        """Promote a standalone session into a ticket's orchestrator, keeping its transcript."""
        if self._tracker.has_task(thinkrail_sid):
            task = self._tracker.get_task(thinkrail_sid)
        else:
            data = load_session(self._config.project_root, thinkrail_sid)
            if data is None:
                raise ValueError(f"Session {thinkrail_sid!r} not found")
            if data.get("status") not in set(TaskStatus):
                data = {**data, "status": TaskStatus.IDLE}
            task = AgentTask.model_validate(data)
        if task.ticket_id:
            raise ValueError(f"Session {thinkrail_sid!r} already belongs to a ticket")
        if task.parent_thinkrail_sid:
            raise ValueError(f"Session {thinkrail_sid!r} is a subsession; cannot promote")
        if not self.board_service:
            raise RuntimeError("AgentService.board_service not wired")
        ticket = self.board_service.create_ticket(
            title=title, body=body, type=type, spawn_orchestrator=False,
        )
        self.board_service.attach_session(ticket.id, thinkrail_sid)
        self.board_service.set_orchestrator(ticket.id, thinkrail_sid)
        task.ticket_id = ticket.id
        update_session_metadata(self._config.project_root, thinkrail_sid, {"ticketId": ticket.id})
        if self._tracker.has_task(thinkrail_sid):
            self._tracker.get_task(thinkrail_sid).ticket_id = ticket.id
            self._tracker.enqueue_message(
                thinkrail_sid,
                f"This session is now the orchestrator of ticket {ticket.id} "
                f'("{title}"). Review the discussion above, then propose a stage '
                f"pipeline with propose_pipeline and drive it.",
            )
        return self.board_service.get_ticket(ticket.id)

    def trash_session(self, thinkrail_sid: str) -> None:
        """Delete a session and detach from all tickets."""
        if self.board_service:
            try:
                self.board_service.detach_session_from_all(thinkrail_sid)
            except Exception:
                logger.warning("Failed to detach session %s from tickets", thinkrail_sid)
        running = self._running_tasks.pop(thinkrail_sid, None)
        if running is not None and not running.done():
            running.cancel()
        delete_session_from_disk(self._config.project_root, thinkrail_sid)
        if self._tracker.has_task(thinkrail_sid):
            # Clear ticket_id first: cancelling the runner above triggers its
            # finally → _on_ticket_session_finished, which would otherwise
            # resume the orchestrator for a session that was just deleted.
            self._tracker.get_task(thinkrail_sid).ticket_id = None
            self._tracker.remove_task(thinkrail_sid)

    async def continue_session(self, thinkrail_sid: str) -> AgentTask:
        """Resume a session using the SDK's native --resume <sessionId>.

        Reuses the same thinkrail_sid. The CLI restores full conversation
        context natively — no lossy text replay needed.
        """
        if thinkrail_sid in self._running_tasks:
            raise ValueError(f"Session {thinkrail_sid} is already running")

        old = load_session(self._config.project_root, thinkrail_sid)
        if not old:
            raise ValueError(f"Session {thinkrail_sid} not found on disk")

        old_session_id = old.get("sessionId")
        # Fallback: look for sessionId in persisted events (sessionStart)
        if not old_session_id:
            for ev in old.get("events", []):
                if ev.get("eventType") == "sessionStart":
                    old_session_id = (ev.get("payload") or {}).get("sessionId", "")
                    if old_session_id:
                        break
        # No stored sessionId means the session never opened a CLI conversation
        # (e.g. it was restarted — say, to apply a model/effort change — while
        # still idle, before the first message). There is nothing to --resume,
        # so relaunch fresh rather than failing the restart. ``None`` flows to
        # ``run_session`` as "no resume".
        resume_session_id = old_session_id or None
        if not resume_session_id:
            logger.info(
                "[%s] continue_session: no stored sessionId; relaunching fresh",
                thinkrail_sid[:8],
            )

        # Re-create task with SAME thinkrail_sid
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
            thinkrail_sid=thinkrail_sid,
        )
        task.ticket_id = old.get("ticketId")
        task.subagent_mode = old.get("subagentMode", "step-session")
        task.step_gate = old.get("stepGate", "approve")
        self._validate_config_against_caps(task)

        # Re-hydrate artifact tracking so the right Context Panel doesn't
        # reset to empty after a backend restart.
        from app.agent.models import SessionArtifact

        for entry in old.get("artifacts", []) or []:
            try:
                task.artifacts.append(SessionArtifact.model_validate(entry))
            except Exception:
                logger.debug("Skipping malformed persisted artifact: %r", entry)
        task.preview_path = old.get("previewPath")

        # Update metadata only (don't touch events JSONL)
        metadata = {
            "thinkrailSid": thinkrail_sid,
            "name": name,
            "skillId": skill_id,
            "specIds": old_spec_ids,
            "config": old_config.model_dump(by_alias=True),
            "status": TaskStatus.INITIALIZING,
            "sessionId": resume_session_id,
            "ticketId": task.ticket_id,
            "createdAt": old.get("createdAt", task.created),
            "updatedAt": task.updated,
            "metrics": old.get("metrics", {}),
            "artifacts": [a.model_dump(by_alias=True) for a in task.artifacts],
            "previewPath": task.preview_path,
            "subagentMode": task.subagent_mode,
            "stepGate": task.step_gate,
        }
        save_session(self._config.project_root, metadata)

        # Build fresh spec context (no history replay — CLI restores context)
        spec_context = await self._build_context_for(task)

        bg_task = asyncio.create_task(
            self._run_background(task, spec_context,
                                 resume_session_id=resume_session_id)
        )
        self._running_tasks[task.thinkrail_sid] = bg_task
        return task

    # -- helpers --------------------------------------------------------------

    def _get_runtime(self, task: AgentTask) -> IAgentRuntime:
        """Look up the runtime for ``task.config.runtime`` in the registry.

        Per-runtime dependencies (tracker, spec service, coordinator) are
        wired at construction time by ``ProjectContext`` — this method is
        a pure registry lookup so the protocol surface stays minimal.
        """
        if self.runtime_registry is None:
            raise RuntimeError("AgentService.runtime_registry not wired")
        return self.runtime_registry.get(task.config.runtime)

    def _attach_to_ticket(self, task: AgentTask) -> None:
        if not task.ticket_id or not self.board_service:
            return
        try:
            self.board_service.attach_session(task.ticket_id, task.thinkrail_sid)
            if task.skill_id == "ticket-orchestrator":
                self.board_service.set_orchestrator(task.ticket_id, task.thinkrail_sid)
        except Exception:
            logger.warning("Failed to attach session to ticket %s", task.ticket_id)

    async def _run_background(
        self,
        task: AgentTask,
        spec_context: str,
        resume_session_id: str | None = None,
    ) -> None:
        # Base metrics from previous run (for cumulative tracking across resumes)
        _base_cost = 0.0
        _base_turns = 0
        _base_duration = 0
        _base_tool_calls = 0
        # Carry the last-known context window forward across a resume so the
        # bar keeps its denominator until the first turn re-reports it.
        _base_context_max = 0
        if resume_session_id:
            _existing = load_session(self._config.project_root, task.thinkrail_sid)
            if _existing and _existing.get("metrics"):
                _m = _existing["metrics"]
                _base_cost = _m.get("costUsd", 0.0)
                _base_turns = _m.get("turns", 0)
                _base_duration = _m.get("durationMs", 0)
                _base_tool_calls = _m.get("toolCalls", 0)
                _base_context_max = _m.get("contextMax", 0)

        # Mutable live metrics dict — updated incrementally by _persisting_notify
        _live_metrics: dict = {
            "costUsd": _base_cost,
            "turns": _base_turns,
            "toolCalls": _base_tool_calls,
            "turnCostUsd": 0,
            "turnTurns": 0,
            "durationMs": _base_duration,
            "contextTokens": 0,
            "contextMax": _base_context_max,
            "outputTokens": 0,
        }
        _wall_start = time.monotonic()

        # Maps SDK tool_use_id → plan step number for in-flight Task subagent
        # calls. Populated on agent/toolCallStart when the prompt carries a
        # ``[thinkrail-step …]`` marker; drained on the matching agent/toolCallEnd.
        # Scoped to one orchestrator run; restart loses the mapping (matches
        # the v2 "no per-subagent restart" limit).
        _subagent_tool_uses: dict[str, int] = {}

        # Distinct project files this session wrote/edited. Transient and
        # in-memory only — never persisted; used solely for the bucketed
        # analytics count, which works for every session (not just
        # ticket-linked ones, unlike task.artifacts).
        _written_files: set[str] = set()

        # Publish via EventBus and persist events to disk.
        _bus = self._get_bus()

        async def _persisting_notify(method: str, params: dict, request_id: str | None = None) -> None:
            await _bus.publish_to_session(
                task.thinkrail_sid, method, params, request_id=request_id,
            )
            # Subagent step linkage — when ticket-implement's orchestrator
            # fires a Task call whose prompt carries a ``[thinkrail-step …]``
            # marker, point the matching plan step at this event's index
            # and flip status to ``executing``. See TICKET_LIFECYCLE_DESIGN.md
            # § Implementation orchestration modes.
            if method == "agent/toolCallStart":
                tool_name = params.get("toolName") or ""
                tool_use_id = params.get("toolUseId") or ""
                tool_input = params.get("toolInput") or {}
                if tool_name == "Task" and task.ticket_id and tool_use_id:
                    from app.agent.subagents import parse_thinkrail_step_marker

                    prompt_text = (
                        tool_input.get("prompt")
                        or tool_input.get("description")
                        or ""
                    )
                    marker = parse_thinkrail_step_marker(str(prompt_text))
                    if marker is not None and marker["ticket_id"] == task.ticket_id:
                        event_index = len(
                            load_events(self._config.project_root, task.thinkrail_sid)
                        )
                        _subagent_tool_uses[tool_use_id] = marker["step"]
                        self._mark_step_running(
                            task.ticket_id, marker["step"], event_index,
                        )

            if method == "agent/toolCallEnd":
                tool_use_id = params.get("toolUseId") or ""
                if tool_use_id in _subagent_tool_uses and task.ticket_id:
                    step_number = _subagent_tool_uses.pop(tool_use_id)
                    is_error = bool(params.get("isError"))
                    self._mark_step_finished(
                        task.ticket_id, step_number, is_error,
                    )

            # Record artifacts for Write / Edit / NotebookEdit tool calls
            # (ticket-linked sessions only — helper guards on ticket_id).
            if method == "agent/toolCallStart":
                from app.agent.artifacts import record_artifact

                tool_name = params.get("toolName") or ""
                tool_input = params.get("toolInput") or {}
                file_path = (
                    tool_input.get("file_path")
                    or tool_input.get("notebook_path")
                )
                if file_path and tool_name in ("Write", "Edit", "NotebookEdit"):
                    _written_files.add(str(file_path))
                    artifact_kind = "write" if tool_name == "Write" else "edit"
                    artifact = record_artifact(
                        task,
                        str(file_path),
                        artifact_kind,
                        self._config.get_project_root(),
                    )
                    if artifact is not None:
                        from app.agent.artifacts import persist_artifact_state

                        persist_artifact_state(self._config.project_root, task)
                        await _bus.publish_to_session(
                            task.thinkrail_sid,
                            "ui/artifactAdded",
                            {
                                "thinkrailSid": task.thinkrail_sid,
                                "artifact": artifact.model_dump(by_alias=True),
                            },
                        )

            # Persist streaming events (skip overly frequent and ephemeral ones)
            if method.startswith("agent/") and method not in ("agent/progress", "agent/costEstimate", "agent/statusChanged"):
                event_type = method.replace("agent/", "")
                # Include requestId in persisted payload (notify injects it
                # into the WebSocket message but not into the original params dict)
                payload = {**params}
                if request_id is not None:
                    payload["requestId"] = request_id
                try:
                    self._save_event(task.thinkrail_sid, {"eventType": event_type, "payload": payload})
                except Exception:
                    logger.exception("Failed to persist event %s for session %s", method, task.thinkrail_sid)

            # Adjust cost estimates to include base cost from previous runs,
            # since the runner starts with total_cost=0 on each invocation.
            if method == "agent/costEstimate":
                if _base_cost > 0:
                    params = {
                        **params,
                        "estimatedCostUsd": _base_cost + (params.get("estimatedCostUsd") or 0),
                    }

            # -- Incremental metrics persistence --
            # Skip only high-frequency events; all others update metrics on disk.
            _SKIP_METRICS = {"agent/textDelta", "agent/progress", "agent/costEstimate", "agent/statusChanged"}
            _FULL_METRICS = {"agent/turnComplete", "agent/done", "agent/interrupted"}

            if method not in _SKIP_METRICS:
                _live_metrics["durationMs"] = _base_duration + int((time.monotonic() - _wall_start) * 1000)

                if method == "agent/toolCallEnd":
                    _live_metrics["toolCalls"] += 1

                if method in _FULL_METRICS:
                    # Prefer pre-computed contextWindow from the runtime
                    # (last iteration: input + cache + output).  Fallback
                    # uses the corrected formula on SDK-aggregated usage.
                    ctx_tokens = params.get("contextWindow", 0)
                    if not ctx_tokens:
                        usage = params.get("usage", {})
                        ctx_tokens = (
                            usage.get("input_tokens", 0)
                            + usage.get("cache_creation_input_tokens", 0)
                            + usage.get("cache_read_input_tokens", 0)
                            + usage.get("output_tokens", 0)
                        )
                    # Output tokens from last iteration (for metrics display)
                    iters = params.get("iterations") or []
                    last_out = iters[-1].get("output_tokens", 0) if iters else (
                        params.get("usage", {}).get("output_tokens", 0)
                    )
                    # contextMax is streamed by the runtime on turn-end events;
                    # carry the last-known value forward for events that omit it
                    # (e.g. agent/done).
                    ctx_max = params.get("contextMax") or _live_metrics.get("contextMax", 0)
                    _live_metrics.update({
                        "costUsd": _base_cost + params.get("costUsd", 0),
                        "turns": _base_turns + params.get("turns", 0),
                        "turnCostUsd": params.get("turnCostUsd", 0),
                        "turnTurns": params.get("turnTurns", 0),
                        "contextTokens": ctx_tokens,
                        "contextMax": ctx_max,
                        "outputTokens": last_out,
                    })

                update_session_metadata(self._config.project_root, task.thinkrail_sid, {
                    "metrics": dict(_live_metrics),
                })

            # Persist sessionId to disk as soon as the SDK provides it,
            # so that continue_session can resume after a backend restart.
            if method == "agent/sessionStart":
                sid = params.get("sessionId", "")
                if sid:
                    update_session_metadata(self._config.project_root, task.thinkrail_sid, {
                        "sessionId": sid,
                    }, overwrite=False)
        notify = _persisting_notify

        exec_config = RuntimeExecutionConfig(
            working_directory=str(self._config.project_root),
            model=task.config.model,
            system_prompt=spec_context,
            resume_session_id=resume_session_id,
            permission_mode=task.config.permission_mode,
            effort=task.config.effort,
            stream_text=task.config.stream_text,
        )
        handler = make_handler_from_notify(notify)
        runtime = self._get_runtime(task)

        try:
            await runtime.run_session(task, exec_config, handler)
            if self._tracker.has_task(task.thinkrail_sid):
                self._tracker.set_status(task.thinkrail_sid, TaskStatus.DONE)
                self._save_task(task)
                self._tracker.remove_task(task.thinkrail_sid)
        except asyncio.CancelledError:
            # Should no longer happen during interrupt (uses client.interrupt() now).
            # Keep as safety net for unexpected cancellation.
            if self._tracker.has_task(task.thinkrail_sid):
                logger.warning("Runner for %s received unexpected CancelledError", task.thinkrail_sid)
            else:
                logger.debug("Runner for %s cancelled after session deletion", task.thinkrail_sid)
        except Exception as exc:
            if not self._tracker.has_task(task.thinkrail_sid):
                logger.debug(
                    "Agent session %s failed after it was deleted",
                    task.thinkrail_sid,
                    exc_info=True,
                )
                return
            logger.exception("Agent session %s failed", task.thinkrail_sid)
            if not is_terminal(task.status):
                self._tracker.set_status(task.thinkrail_sid, TaskStatus.ERROR)
            self._save_task(task)
            self._tracker.remove_task(task.thinkrail_sid)
            try:
                await notify(
                    "agent/error",
                    {
                        "thinkrailSid": task.thinkrail_sid,
                        "sessionId": task.session_id or "",
                        "subtype": "crash",
                        "errors": [str(exc)],
                    },
                )
            except Exception:
                pass
        finally:
            self._running_tasks.pop(task.thinkrail_sid, None)
            _outcome = _analytics_outcome(task.status)
            analytics.track_event(
                analytics.AgentSessionCompletedEvent(
                    outcome=_outcome,
                    files_written_bucket=_files_written_bucket(len(_written_files)),
                )
            )
            _onboarding_step = analytics.ONBOARDING_STEP_BY_SKILL.get(task.skill_id or "")
            if _onboarding_step is not None:
                analytics.track_event(
                    analytics.OnboardingStepCompletedEvent(
                        step=_onboarding_step, outcome=_outcome,
                    )
                )
            # Notify all project clients that the session ended
            try:
                await self._get_bus().publish_to_project(
                    str(self._config.project_root),
                    "session/didEnd",
                    {
                        "thinkrailSid": task.thinkrail_sid,
                        "status": task.status,
                    },
                )
            except Exception:
                pass
            # Clean up the session topic now that the runner is done
            self._get_bus().cleanup_topic(f"session:{task.thinkrail_sid}")
            # Finalize the stage node + resume the orchestrator (if ticket-linked)
            await self._on_ticket_session_finished(task)

    async def _on_ticket_session_finished(self, task: AgentTask) -> None:
        """A ticket-linked session has ended. Finalize its stage node (if it ran
        one), refresh the ticket state for the UI, and resume the orchestrator so
        it can verify the result and launch the next ready node.

        Three kinds of finished session reach here:
          - a stage node's session  → recordRunFinish flips the node done/failed
          - an implement sub-step    → its plan step's status is updated
          - the orchestrator itself  → nothing to finalize, and we never self-resume
        """
        if not task.ticket_id or not self.board_service:
            return
        from app.board.work_node import RunStatus
        try:
            ticket = self.board_service.get_ticket(task.ticket_id)
        except Exception:
            return

        def _node_for_session(nodes: list, sid: str):
            """The node whose latest session-run is `sid`, anywhere in the tree."""
            for node in nodes:
                run = node.runs[-1] if node.runs else None
                if run is not None and run.kind == "session" and run.session_id == sid:
                    return node
                if node.children:
                    found = _node_for_session(node.children, sid)
                    if found is not None:
                        return found
            return None

        # 1. Stage node whose latest run is this session → mark it done/failed.
        node = _node_for_session(ticket.stages, task.thinkrail_sid)
        finalized_label: str | None = None
        if node is not None and node.runs and node.runs[-1].status == RunStatus.RUNNING:
            from datetime import UTC, datetime

            summary = task.outcome.summary if task.outcome else None
            try:
                self.board_service.apply(task.ticket_id, {
                    "op": "recordRunFinish",
                    "id": node.id,
                    "isError": task.status != TaskStatus.DONE,
                    "summary": summary,
                    "completedAt": datetime.now(UTC).isoformat(),
                })
                finalized_label = node.title
            except Exception:
                logger.debug("recordRunFinish failed for node %s", node.id, exc_info=True)

        # 2. Otherwise, an implement sub-step → update its plan step status.
        elif ticket.implementation_plan_path and self.board_service.plans.plan_exists(task.ticket_id):
            from app.board.plan import StepStatus
            try:
                plan = self.board_service.plans.read_plan(task.ticket_id)
                for step in plan.all_steps():
                    if step.session_id == task.thinkrail_sid:
                        self.board_service.plans.update_step_status(
                            task.ticket_id, step.number,
                            StepStatus.DONE if task.status == TaskStatus.DONE else StepStatus.FAILED,
                        )
                        break
            except Exception:
                logger.debug("plan step update failed for %s", task.ticket_id, exc_info=True)

        # 3. Refresh the UI — node/plan status changed.
        try:
            from app.board.ticket_state import publish_ticket_state
            await publish_ticket_state(
                self.board_service, str(self._config.project_root), task.ticket_id,
            )
        except Exception:
            logger.debug("publish_ticket_state failed for %s", task.ticket_id, exc_info=True)

        # 4. Resume the orchestrator so it verifies the result and advances.
        orch_sid = ticket.orchestrator.session_id if ticket.orchestrator else None
        if orch_sid and orch_sid != task.thinkrail_sid and self._tracker.has_task(orch_sid):
            label = finalized_label or task.name or task.thinkrail_sid[:8]
            status_word = "completed" if task.status == TaskStatus.DONE else f"ended with status '{task.status}'"
            self._tracker.enqueue_message(
                orch_sid,
                f"[Stage '{label}' {status_word}] Review its output against the ticket goal, "
                f"adjust the pipeline if needed, then start the next ready node "
                f"(or finalize the ticket if every stage is done).",
            )

    async def complete_node(self, ticket_id: str, node_id: str) -> None:
        """Force-complete a stage node (the UI 'Complete stage' action): mark it
        done, refresh the ticket state, and resume the orchestrator to advance —
        for when the user finalizes a stage manually instead of via the agent."""
        if not self.board_service:
            return
        from datetime import UTC, datetime
        from app.board.ops import find_node
        from app.board.work_node import RunStatus
        try:
            ticket = self.board_service.get_ticket(ticket_id)
        except Exception:
            return
        node = find_node(ticket.stages, node_id)
        if node is None:
            return
        # recordRunFinish needs an open run; synthesize one for a node that was
        # never started so a manual completion still flips it to done.
        if not node.runs or node.runs[-1].status != RunStatus.RUNNING:
            try:
                self.board_service.apply(ticket_id, {
                    "op": "recordRunStart", "id": node_id,
                    "run": {"kind": "session", "status": RunStatus.RUNNING},
                })
            except Exception:
                logger.debug("complete_node recordRunStart failed for %s", node_id, exc_info=True)
        try:
            self.board_service.apply(ticket_id, {
                "op": "recordRunFinish", "id": node_id,
                "isError": False, "completedAt": datetime.now(UTC).isoformat(),
            })
        except Exception:
            logger.debug("complete_node recordRunFinish failed for %s", node_id, exc_info=True)
            return
        try:
            from app.board.ticket_state import publish_ticket_state
            await publish_ticket_state(
                self.board_service, str(self._config.project_root), ticket_id,
            )
        except Exception:
            logger.debug("publish_ticket_state failed for %s", ticket_id, exc_info=True)
        orch_sid = ticket.orchestrator.session_id if ticket.orchestrator else None
        if orch_sid and self._tracker.has_task(orch_sid):
            self._tracker.enqueue_message(
                orch_sid,
                f"[Stage '{node.title}' marked complete by the user] Start the next "
                f"ready node (or finalize the ticket if every stage is done).",
            )

    async def _build_context_for(self, task: AgentTask) -> str:
        t0 = time.monotonic()
        session_prompt = self._augment_session_prompt(task)
        ctx = await build_context(
            spec_ids=task.spec_ids,
            skill_id=task.skill_id,
            session_prompt=session_prompt,
            project_root=self._config.project_root,
            config=task.config,
            spec_service=self._spec_service,
            plugin_dir=self._config.plugin_dir,
            file_paths=task.file_paths,
        )
        ms = int((time.monotonic() - t0) * 1000)
        logger.info("[%s] build_context: %dms (%d chars)", task.thinkrail_sid[:8], ms, len(ctx))
        return ctx

    async def _build_context_structured_for(self, task: AgentTask) -> dict:
        """Build structured section data for the prompt preview UI."""
        from app.agent.context import build_context_structured

        session_prompt = self._augment_session_prompt(task)
        return await build_context_structured(
            spec_ids=task.spec_ids,
            skill_id=task.skill_id,
            session_prompt=session_prompt,
            project_root=self._config.project_root,
            config=task.config,
            spec_service=self._spec_service,
            plugin_dir=self._config.plugin_dir,
            file_paths=task.file_paths,
        )

    def _augment_session_prompt(self, task: AgentTask) -> str | None:
        """Inject plan and ticket sections into ``task.session_prompt``.

        Plan framing depends on the session's role:
        - ``ticket-implementation-plan`` → "Existing Plan" (refine it)
        - ``ticket-implement`` → "As the orchestrator" (drives suggest_step)
        - any other skill (or none — e.g. step sessions started by approving
          a suggest_step card) → "Plan (for reference)" so step sessions
          don't act as orchestrator and re-emit suggest_step.

        Ticket title + body are injected for every drafting/implementing
        skill in :data:`_TICKET_BODY_SKILLS`.
        """
        session_prompt = task.session_prompt
        if not (task.ticket_id and self.board_service):
            return session_prompt

        try:
            ticket = self.board_service.get_ticket(task.ticket_id)
        except Exception:
            logger.debug("Failed to load ticket %s", task.ticket_id)
            return session_prompt

        if ticket.implementation_plan_path and self.board_service.plans.plan_exists(task.ticket_id):
            try:
                from app.board.plan import _render_plan
                plan = self.board_service.plans.read_plan(task.ticket_id)
                plan_text = _render_plan(plan)
                plan_section = self._render_plan_section(task.skill_id, plan_text)
                session_prompt = (
                    f"{session_prompt}\n\n{plan_section}" if session_prompt else plan_section
                )
            except Exception:
                logger.debug("Failed to inject plan for ticket %s", task.ticket_id)

        if task.skill_id in _TICKET_BODY_SKILLS:
            ticket_section = (
                "## Current Ticket\n\n"
                f"**Title:** {ticket.title}\n\n"
                f"**Current body:**\n{ticket.body or '(empty)'}\n"
            )
            session_prompt = (
                f"{session_prompt}\n\n{ticket_section}" if session_prompt else ticket_section
            )

        if task.skill_id == "ticket-implement":
            mode_section = self._render_orchestration_mode_section(task)
            if mode_section:
                session_prompt = (
                    f"{session_prompt}\n\n{mode_section}" if session_prompt else mode_section
                )

        return session_prompt

    def _render_orchestration_mode_section(self, task: AgentTask) -> str:
        """Inject mode + failure-policy guidance for ticket-implement orchestrators.

        Branches on ``task.subagent_mode`` × ``task.step_gate``; the failure
        policy comes from ``.tr/settings.json`` (``tickets.subagentFailurePolicy``).
        See TICKET_LIFECYCLE_DESIGN.md § Implementation orchestration modes.
        """
        from app.core.settings import load_settings

        if task.subagent_mode == "step-session":
            # Today's default — no new behavior to instruct; the existing
            # plan section above already told the orchestrator to use suggest_step.
            return ""

        # subagent mode
        policy = load_settings(self._config.project_root).tickets.subagent_failure_policy
        policy_line = (
            "Failure policy: **fail-fast**. On the first sibling failure, stop "
            "issuing new Task calls; in-flight siblings finish naturally."
            if policy == "fail-fast"
            else "Failure policy: **wait-all**. Gather all sibling results "
            "before reporting; report each as done or failed individually."
        )

        if task.step_gate == "approve":
            return (
                "## Subagent Mode (approve each)\n\n"
                "You drive plan execution via SDK subagents, not child sessions.\n"
                "1. Call `Plan.unblocked_steps()` mentally (look at the plan you "
                "already have): list every step whose `depends_on` is satisfied "
                "and whose status is `pending`.\n"
                "2. In a single assistant turn, emit one `suggest_step` tool call "
                "per unblocked step. The user sees one approval card per step.\n"
                "3. As each card resolves, immediately invoke "
                "`Task(subagent_type=\"ticket-step-executor\", prompt=…)`. The "
                "prompt MUST start with the line:\n\n"
                "    [thinkrail-step ticket={ticket_id} step={step_number}]\n\n"
                "    followed by the step's description and any relevant context.\n"
                "4. Await all in-flight Task calls before re-scanning for the "
                "next batch. Do not call `suggest_step` again until the current "
                "batch has finished.\n\n"
                f"{policy_line}"
            )
        # autonomous
        return (
            "## Subagent Mode (autonomous)\n\n"
            "You drive plan execution via SDK subagents with no per-step approval.\n"
            "1. Scan the plan for unblocked steps as above.\n"
            "2. Emit one `Task(subagent_type=\"ticket-step-executor\", prompt=…)` "
            "per unblocked step, in a single assistant turn. Each prompt MUST "
            "start with `[thinkrail-step ticket={ticket_id} step={step_number}]`.\n"
            "3. Do NOT emit `suggest_step` in autonomous mode — that's only "
            "for the gated variant.\n"
            "4. Await all in-flight Task calls before re-scanning for the next batch.\n\n"
            f"{policy_line}"
        )

    @staticmethod
    def _render_plan_section(skill_id: str | None, plan_text: str) -> str:
        if skill_id == "ticket-implementation-plan":
            return (
                "## Existing Plan\n\n"
                "The following plan already exists for this ticket. "
                "Review it and update/refine it based on the user's feedback. "
                "Write the updated plan back to the same file.\n\n"
                f"{plan_text}"
            )
        if skill_id == "ticket-implement":
            return (
                "## Implementation Plan\n\n"
                "The following plan is associated with this ticket. "
                "As the orchestrator, read the plan, identify the next unblocked step, "
                "and call `suggest_step` to propose it for execution.\n\n"
                f"{plan_text}"
            )
        return (
            "## Plan (for reference)\n\n"
            "The following plan is associated with this ticket. "
            "Use it as context for your work; do not act as the "
            "orchestrator (do not call `suggest_step`).\n\n"
            f"{plan_text}"
        )

    # -- subsession management --------------------------------------------------

    async def create_subsession(
        self,
        parent_thinkrail_sid: str,
        subsession_type: SubsessionType,
        context: str | None = None,
        name: str = "",
    ) -> AgentTask:
        """Create a draft subsession linked to a parent session."""
        from app.agent.context import build_parent_context

        # Validate parent exists (in tracker or on disk)
        if self._tracker.has_task(parent_thinkrail_sid):
            parent = self._tracker.get_task(parent_thinkrail_sid)
            parent_spec_ids = parent.spec_ids
            parent_config = parent.config
        else:
            parent_data = load_session(self._config.project_root, parent_thinkrail_sid)
            if parent_data is None:
                raise ValueError(f"Parent session {parent_thinkrail_sid!r} not found")
            parent_spec_ids = parent_data.get("specIds", [])
            parent_config = AgentConfig(**parent_data.get("config", {}))

        task = self._tracker.create_task(
            spec_ids=parent_spec_ids,
            config=AgentConfig(**parent_config.model_dump()),
            name=name,
        )
        task.parent_thinkrail_sid = parent_thinkrail_sid
        task.subsession_type = subsession_type
        task.subsession_context = context
        task.status = TaskStatus.DRAFT

        parent_context = build_parent_context(
            parent_sid=parent_thinkrail_sid,
            subsession_type=subsession_type,
            subsession_context=context,
            project_root=self._config.project_root,
        )
        task.session_prompt = parent_context
        task.system_prompt = await self._build_context_for(task)

        self._save_task(task)
        return task

    def request_summary(self, thinkrail_sid: str) -> None:
        """Ask the subsession agent to propose a return summary."""
        task = self._tracker.get_task(thinkrail_sid)
        task.return_status = SessionReturnStatus.PENDING
        task.updated = datetime.now(UTC).isoformat()
        self._save_task(task)
        if is_quiescent(task.status):
            summary_prompt = (
                "Please summarize the key conclusions from our discussion. "
                "Write a concise summary that captures the decision, rationale, "
                "and any action items. This will be sent back to the parent session."
            )
            self._tracker.enqueue_message(thinkrail_sid, summary_prompt)

    def approve_summary(self, thinkrail_sid: str, text: str) -> None:
        """Approve a return summary for the subsession."""
        task = self._tracker.get_task(thinkrail_sid)
        task.return_status = SessionReturnStatus.APPROVED
        task.return_summary = text
        task.updated = datetime.now(UTC).isoformat()
        self._save_task(task)

    def dismiss_summary(self, thinkrail_sid: str) -> None:
        """Dismiss the return flow without returning anything."""
        task = self._tracker.get_task(thinkrail_sid)
        task.return_status = SessionReturnStatus.DISMISSED
        task.return_summary = None
        task.updated = datetime.now(UTC).isoformat()
        self._save_task(task)

    def revise_summary(self, thinkrail_sid: str, feedback: str) -> None:
        """Ask the subsession agent to rewrite the summary with feedback."""
        task = self._tracker.get_task(thinkrail_sid)
        task.return_status = SessionReturnStatus.PENDING
        task.updated = datetime.now(UTC).isoformat()
        self._save_task(task)
        if is_quiescent(task.status):
            revision_prompt = f"Please revise the summary based on this feedback:\n\n{feedback}"
            self._tracker.enqueue_message(thinkrail_sid, revision_prompt)
