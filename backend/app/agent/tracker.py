from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

from app.agent.models import AgentConfig, AgentTask, SessionOutcome, TaskStatus

_END_SIGNAL = object()
"""Sentinel pushed by ``enqueue_end_signal`` to close the conversation loop."""

END_SIGNAL = _END_SIGNAL  # public alias

_VALID_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.DRAFT: {TaskStatus.INITIALIZING, TaskStatus.DONE, TaskStatus.ERROR},
    TaskStatus.INITIALIZING: {TaskStatus.IDLE, TaskStatus.DONE, TaskStatus.ERROR},
    TaskStatus.IDLE: {TaskStatus.RUNNING, TaskStatus.DONE, TaskStatus.ERROR},
    TaskStatus.RUNNING: {TaskStatus.IDLE, TaskStatus.WAITING, TaskStatus.DONE, TaskStatus.ERROR},
    TaskStatus.WAITING: {TaskStatus.RUNNING, TaskStatus.IDLE, TaskStatus.DONE, TaskStatus.ERROR},
    TaskStatus.DONE: set(),
    TaskStatus.ERROR: set(),
}


class TaskNotFoundError(Exception):
    """Raised when a thinkrail_sid does not exist."""


class FutureNotFoundError(Exception):
    """Raised when a request ID has no pending future."""


class Tracker:
    """Session lifecycle, message queue, and asyncio.Future registry."""

    def __init__(self) -> None:
        self._tasks: dict[str, AgentTask] = {}
        self._pending_requests: dict[str, list[dict[str, Any]]] = {}  # thinkrail_sid → list of pending requests (in insertion order)
        self._futures: dict[str, dict[str, asyncio.Future[dict]]] = {}
        self._queues: dict[str, asyncio.Queue[Any]] = {}
        self._clients: dict[str, Any] = {}
        self._interrupted: set[str] = set()
        self._turn_text: dict[str, list[str]] = {}  # thinkrail_sid → accumulated text blocks
        self._last_messages: dict[str, str] = {}  # thinkrail_sid → last user message (for retry)
        self._approved_sigs: dict[str, set[str]] = {}  # thinkrail_sid → remembered approvals

    # -- task lifecycle -------------------------------------------------------

    def create_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        skill_id: str | None = None,
        session_prompt: str | None = None,
        name: str = "",
        thinkrail_sid: str | None = None,
        draft_input: str | None = None,
    ) -> AgentTask:
        task = AgentTask(
            **({"thinkrail_sid": thinkrail_sid} if thinkrail_sid else {}),
            name=name,
            spec_ids=spec_ids,
            skill_id=skill_id,
            session_prompt=session_prompt,
            draft_input=draft_input,
            config=config,
        )
        self._tasks[task.thinkrail_sid] = task
        self._queues[task.thinkrail_sid] = asyncio.Queue()
        return task

    def get_task(self, thinkrail_sid: str) -> AgentTask:
        try:
            return self._tasks[thinkrail_sid]
        except KeyError:
            raise TaskNotFoundError(f"Session '{thinkrail_sid}' not found")

    def has_task(self, thinkrail_sid: str) -> bool:
        return thinkrail_sid in self._tasks

    def add_task(self, task: AgentTask) -> None:
        """Add an existing task into the tracker (e.g., restoring from disk)."""
        self._tasks[task.thinkrail_sid] = task
        self._queues[task.thinkrail_sid] = asyncio.Queue()

    def list_tasks(self) -> list[AgentTask]:
        return list(self._tasks.values())

    def set_status(self, thinkrail_sid: str, status: TaskStatus) -> None:
        task = self.get_task(thinkrail_sid)
        if task.status == status:
            return
        allowed = _VALID_TRANSITIONS[task.status]
        if status not in allowed:
            raise ValueError(
                f"Invalid transition: {task.status} -> {status}"
            )
        task.status = status
        task.updated = datetime.now(UTC).isoformat()

    def set_session_id(self, thinkrail_sid: str, session_id: str) -> None:
        task = self.get_task(thinkrail_sid)
        task.session_id = session_id
        task.updated = datetime.now(UTC).isoformat()

    def set_outcome(self, thinkrail_sid: str, outcome: SessionOutcome) -> AgentTask:
        """Attach the skill's done-screen contract to the task."""
        task = self.get_task(thinkrail_sid)
        task.outcome = outcome
        task.updated = datetime.now(UTC).isoformat()
        return task

    # Fields the frontend is allowed to mutate via `session/patchOutcomeAction`.
    # Anything else (notably ``type``, ``id``, and ``skill_id``) would
    # corrupt the action — ``type`` is the discriminator and ``id`` is the
    # idempotency key — so we silently drop those keys before applying.
    _PATCHABLE_ACTION_FIELDS: frozenset[str] = frozenset({"state", "title", "body"})

    def patch_outcome_action(
        self, thinkrail_sid: str, action_id: str, patch: dict[str, Any]
    ) -> AgentTask:
        """Apply a partial update to one action inside the outcome.

        Used by the frontend after a user executes a queued action — e.g.
        when 'Add to board' completes, the action moves to state='applied'.
        Only fields in :pyattr:`_PATCHABLE_ACTION_FIELDS` are honoured;
        anything else is dropped. Silent no-op if the outcome or action
        is missing.
        """
        task = self.get_task(thinkrail_sid)
        if task.outcome is None:
            return task
        safe_patch = {
            k: v for k, v in patch.items() if k in self._PATCHABLE_ACTION_FIELDS
        }
        if not safe_patch:
            return task
        for i, action in enumerate(task.outcome.actions):
            if action.id == action_id:
                updated = action.model_copy(update=safe_patch)
                task.outcome.actions[i] = updated
                task.updated = datetime.now(UTC).isoformat()
                break
        return task

    # -- live SDK client reference --------------------------------------------

    def set_client(self, thinkrail_sid: str, client: Any) -> None:
        self._clients[thinkrail_sid] = client

    def get_client(self, thinkrail_sid: str) -> Any | None:
        return self._clients.get(thinkrail_sid)

    def clear_client(self, thinkrail_sid: str) -> None:
        self._clients.pop(thinkrail_sid, None)

    # -- message queue --------------------------------------------------------

    def enqueue_message(self, thinkrail_sid: str, text: str) -> None:
        """Push a user message onto the session's queue."""
        self.get_task(thinkrail_sid)  # validate task exists
        self._queues[thinkrail_sid].put_nowait(text)

    def enqueue_end_signal(self, thinkrail_sid: str) -> None:
        """Push the END_SIGNAL sentinel to close the conversation loop."""
        self.get_task(thinkrail_sid)  # validate task exists
        self._queues[thinkrail_sid].put_nowait(_END_SIGNAL)

    async def get_next_message(self, thinkrail_sid: str) -> str | object:
        """Await the next item from the session's queue.

        Returns the user message text, or ``END_SIGNAL`` if the session
        should close.
        """
        self.get_task(thinkrail_sid)  # validate task exists
        return await self._queues[thinkrail_sid].get()

    # -- future management ----------------------------------------------------

    def register_future(
        self, thinkrail_sid: str, request_id: str
    ) -> asyncio.Future[dict]:
        """Register a Future for a pending user response.

        The future waits indefinitely until ``resolve_future`` or
        ``cancel_futures`` is called — there is no timeout.
        """
        self.get_task(thinkrail_sid)  # validate task exists
        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict] = loop.create_future()

        task_futures = self._futures.setdefault(thinkrail_sid, {})
        task_futures[request_id] = future
        return future

    def resolve_future(self, thinkrail_sid: str, request_id: str, response: dict) -> None:
        task_futures = self._futures.get(thinkrail_sid, {})
        future = task_futures.pop(request_id, None)
        if future is None:
            logger.warning("No pending future for session %s request %s (already resolved or timed out)", thinkrail_sid, request_id)
            return
        if not future.done():
            future.set_result(response)

    # -- pending request tracking -----------------------------------------------

    def add_pending_request(self, thinkrail_sid: str, request: dict[str, Any]) -> None:
        """Append a pending request to the session's queue.

        Multiple concurrent requests are supported (used by ticket-implement's
        subagent mode when the orchestrator emits several suggest_step cards
        in one assistant turn). Requests are identified by ``requestId`` for
        resolution; the order in this list is the order they appear in the UI.
        """
        self._pending_requests.setdefault(thinkrail_sid, []).append(request)

    def list_pending_requests(self, thinkrail_sid: str) -> list[dict[str, Any]]:
        """Return a snapshot copy of the session's pending requests."""
        return list(self._pending_requests.get(thinkrail_sid, []))

    def remove_pending_request(self, thinkrail_sid: str, request_id: str) -> None:
        """Remove the request matching ``request_id``; no-op if not found."""
        bucket = self._pending_requests.get(thinkrail_sid)
        if not bucket:
            return
        self._pending_requests[thinkrail_sid] = [
            r for r in bucket if r.get("requestId") != request_id
        ]
        if not self._pending_requests[thinkrail_sid]:
            self._pending_requests.pop(thinkrail_sid, None)

    # -- remembered approvals -------------------------------------------------

    def is_tool_approved(self, thinkrail_sid: str, signature: str) -> bool:
        return signature in self._approved_sigs.get(thinkrail_sid, set())

    def remember_approval(self, thinkrail_sid: str, signature: str) -> None:
        self._approved_sigs.setdefault(thinkrail_sid, set()).add(signature)

    def remove_task(self, thinkrail_sid: str) -> None:
        """Remove a completed task and all associated state."""
        self._tasks.pop(thinkrail_sid, None)
        self._queues.pop(thinkrail_sid, None)
        self._futures.pop(thinkrail_sid, None)
        self._clients.pop(thinkrail_sid, None)
        self._interrupted.discard(thinkrail_sid)
        self._turn_text.pop(thinkrail_sid, None)
        self._pending_requests.pop(thinkrail_sid, None)
        self._last_messages.pop(thinkrail_sid, None)

    def cancel_futures(self, thinkrail_sid: str) -> None:
        task_futures = self._futures.pop(thinkrail_sid, {})
        for future in task_futures.values():
            if not future.done():
                future.cancel()

    # -- interrupt management -------------------------------------------------

    def set_interrupted(self, thinkrail_sid: str) -> None:
        """Mark session as interrupted.

        Called by ``service.interrupt_task()`` before calling
        ``client.interrupt()`` so the runner knows to emit
        ``agent/interrupted`` instead of ``agent/turnComplete``.
        """
        self._interrupted.add(thinkrail_sid)

    def is_interrupted(self, thinkrail_sid: str) -> bool:
        """Check whether the session has a pending interrupt flag."""
        return thinkrail_sid in self._interrupted

    def clear_interrupted(self, thinkrail_sid: str) -> None:
        """Clear the interrupt flag after the runner has processed it."""
        self._interrupted.discard(thinkrail_sid)

    def interrupt_futures(self, thinkrail_sid: str) -> None:
        """Resolve pending futures with deny + interrupt instead of cancelling.

        Unlike ``cancel_futures()`` which raises ``CancelledError``, this
        produces a clean ``PermissionResultDeny(interrupt=True)`` that tells
        the SDK to stop the turn gracefully.
        """
        task_futures = self._futures.pop(thinkrail_sid, {})
        for future in task_futures.values():
            if not future.done():
                future.set_result({
                    "behavior": "deny",
                    "message": "Interrupted",
                    "interrupt": True,
                })

    # -- last message (for retry) ------------------------------------------------

    def set_last_message(self, thinkrail_sid: str, text: str) -> None:
        """Store the last user message for potential retry."""
        self._last_messages[thinkrail_sid] = text

    def get_last_message(self, thinkrail_sid: str) -> str | None:
        """Return the last user message, or None if no message was sent."""
        return self._last_messages.get(thinkrail_sid)

    # -- turn text accumulation ------------------------------------------------

    def append_turn_text(self, thinkrail_sid: str, text: str) -> None:
        """Append assistant text to the current turn buffer.

        Called by the runner for each ``TextBlock`` so that ``can_use_tool``
        can inject accumulated plan content into ``ExitPlanMode`` payloads.
        """
        self._turn_text.setdefault(thinkrail_sid, []).append(text)

    def get_turn_text(self, thinkrail_sid: str) -> str:
        """Return accumulated assistant text for the current turn."""
        parts = self._turn_text.get(thinkrail_sid, [])
        return "".join(parts)

    def clear_turn_text(self, thinkrail_sid: str) -> None:
        """Clear the turn text buffer (called at the start of each query)."""
        self._turn_text.pop(thinkrail_sid, None)
