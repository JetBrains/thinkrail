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
    "draft": {"initializing", "done", "error"},
    "initializing": {"idle", "done", "error"},
    "idle": {"running", "done", "error"},
    "running": {"idle", "waiting", "done", "error"},
    "waiting": {"running", "idle", "done", "error"},
    "done": set(),
    "error": set(),
}


class TaskNotFoundError(Exception):
    """Raised when a bonsai_sid does not exist."""


class FutureNotFoundError(Exception):
    """Raised when a request ID has no pending future."""


class Tracker:
    """Session lifecycle, message queue, and asyncio.Future registry."""

    def __init__(self) -> None:
        self._tasks: dict[str, AgentTask] = {}
        self._pending_requests: dict[str, dict[str, Any]] = {}  # bonsai_sid → pending request params
        self._futures: dict[str, dict[str, asyncio.Future[dict]]] = {}
        self._queues: dict[str, asyncio.Queue[Any]] = {}
        self._clients: dict[str, Any] = {}
        self._interrupted: set[str] = set()
        self._turn_text: dict[str, list[str]] = {}  # bonsai_sid → accumulated text blocks
        self._last_messages: dict[str, str] = {}  # bonsai_sid → last user message (for retry)
        self._approved_sigs: dict[str, set[str]] = {}  # bonsai_sid → remembered approvals

    # -- task lifecycle -------------------------------------------------------

    def create_task(
        self,
        spec_ids: list[str],
        config: AgentConfig,
        skill_id: str | None = None,
        session_prompt: str | None = None,
        name: str = "",
        bonsai_sid: str | None = None,
    ) -> AgentTask:
        task = AgentTask(
            **({"bonsai_sid": bonsai_sid} if bonsai_sid else {}),
            name=name,
            spec_ids=spec_ids,
            skill_id=skill_id,
            session_prompt=session_prompt,
            config=config,
        )
        self._tasks[task.bonsai_sid] = task
        self._queues[task.bonsai_sid] = asyncio.Queue()
        return task

    def get_task(self, bonsai_sid: str) -> AgentTask:
        try:
            return self._tasks[bonsai_sid]
        except KeyError:
            raise TaskNotFoundError(f"Session '{bonsai_sid}' not found")

    def has_task(self, bonsai_sid: str) -> bool:
        return bonsai_sid in self._tasks

    def add_task(self, task: AgentTask) -> None:
        """Add an existing task into the tracker (e.g., restoring from disk)."""
        self._tasks[task.bonsai_sid] = task
        self._queues[task.bonsai_sid] = asyncio.Queue()

    def list_tasks(self) -> list[AgentTask]:
        return list(self._tasks.values())

    def set_status(self, bonsai_sid: str, status: TaskStatus) -> None:
        task = self.get_task(bonsai_sid)
        if task.status == status:
            return
        allowed = _VALID_TRANSITIONS[task.status]
        if status not in allowed:
            raise ValueError(
                f"Invalid transition: {task.status} -> {status}"
            )
        task.status = status
        task.updated = datetime.now(UTC).isoformat()

    def set_session_id(self, bonsai_sid: str, session_id: str) -> None:
        task = self.get_task(bonsai_sid)
        task.session_id = session_id
        task.updated = datetime.now(UTC).isoformat()

    def set_outcome(self, bonsai_sid: str, outcome: SessionOutcome) -> AgentTask:
        """Attach the skill's done-screen contract to the task."""
        task = self.get_task(bonsai_sid)
        task.outcome = outcome
        task.updated = datetime.now(UTC).isoformat()
        return task

    # Fields the frontend is allowed to mutate via `session/patchOutcomeAction`.
    # Anything else (notably ``type``, ``id``, and ``skill_id``) would
    # corrupt the action — ``type`` is the discriminator and ``id`` is the
    # idempotency key — so we silently drop those keys before applying.
    _PATCHABLE_ACTION_FIELDS: frozenset[str] = frozenset({"state", "title", "body"})

    def patch_outcome_action(
        self, bonsai_sid: str, action_id: str, patch: dict[str, Any]
    ) -> AgentTask:
        """Apply a partial update to one action inside the outcome.

        Used by the frontend after a user executes a queued action — e.g.
        when 'Add to board' completes, the action moves to state='applied'.
        Only fields in :pyattr:`_PATCHABLE_ACTION_FIELDS` are honoured;
        anything else is dropped. Silent no-op if the outcome or action
        is missing.
        """
        task = self.get_task(bonsai_sid)
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

    def set_client(self, bonsai_sid: str, client: Any) -> None:
        self._clients[bonsai_sid] = client

    def get_client(self, bonsai_sid: str) -> Any | None:
        return self._clients.get(bonsai_sid)

    def clear_client(self, bonsai_sid: str) -> None:
        self._clients.pop(bonsai_sid, None)

    # -- message queue --------------------------------------------------------

    def enqueue_message(self, bonsai_sid: str, text: str) -> None:
        """Push a user message onto the session's queue."""
        self.get_task(bonsai_sid)  # validate task exists
        self._queues[bonsai_sid].put_nowait(text)

    def enqueue_end_signal(self, bonsai_sid: str) -> None:
        """Push the END_SIGNAL sentinel to close the conversation loop."""
        self.get_task(bonsai_sid)  # validate task exists
        self._queues[bonsai_sid].put_nowait(_END_SIGNAL)

    async def get_next_message(self, bonsai_sid: str) -> str | object:
        """Await the next item from the session's queue.

        Returns the user message text, or ``END_SIGNAL`` if the session
        should close.
        """
        self.get_task(bonsai_sid)  # validate task exists
        return await self._queues[bonsai_sid].get()

    # -- future management ----------------------------------------------------

    def register_future(
        self, bonsai_sid: str, request_id: str
    ) -> asyncio.Future[dict]:
        """Register a Future for a pending user response.

        The future waits indefinitely until ``resolve_future`` or
        ``cancel_futures`` is called — there is no timeout.
        """
        self.get_task(bonsai_sid)  # validate task exists
        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict] = loop.create_future()

        task_futures = self._futures.setdefault(bonsai_sid, {})
        task_futures[request_id] = future
        return future

    def resolve_future(self, bonsai_sid: str, request_id: str, response: dict) -> None:
        task_futures = self._futures.get(bonsai_sid, {})
        future = task_futures.pop(request_id, None)
        if future is None:
            logger.warning("No pending future for session %s request %s (already resolved or timed out)", bonsai_sid, request_id)
            return
        if not future.done():
            future.set_result(response)

    # -- pending request tracking -----------------------------------------------

    def set_pending_request(self, bonsai_sid: str, request: dict[str, Any]) -> None:
        self._pending_requests[bonsai_sid] = request

    def get_pending_request(self, bonsai_sid: str) -> dict[str, Any] | None:
        return self._pending_requests.get(bonsai_sid)

    def clear_pending_request(self, bonsai_sid: str) -> None:
        self._pending_requests.pop(bonsai_sid, None)

    # -- remembered approvals -------------------------------------------------

    def is_tool_approved(self, bonsai_sid: str, signature: str) -> bool:
        return signature in self._approved_sigs.get(bonsai_sid, set())

    def remember_approval(self, bonsai_sid: str, signature: str) -> None:
        self._approved_sigs.setdefault(bonsai_sid, set()).add(signature)

    def remove_task(self, bonsai_sid: str) -> None:
        """Remove a completed task and all associated state."""
        self._tasks.pop(bonsai_sid, None)
        self._queues.pop(bonsai_sid, None)
        self._futures.pop(bonsai_sid, None)
        self._clients.pop(bonsai_sid, None)
        self._interrupted.discard(bonsai_sid)
        self._turn_text.pop(bonsai_sid, None)
        self._pending_requests.pop(bonsai_sid, None)
        self._last_messages.pop(bonsai_sid, None)

    def cancel_futures(self, bonsai_sid: str) -> None:
        task_futures = self._futures.pop(bonsai_sid, {})
        for future in task_futures.values():
            if not future.done():
                future.cancel()

    # -- interrupt management -------------------------------------------------

    def set_interrupted(self, bonsai_sid: str) -> None:
        """Mark session as interrupted.

        Called by ``service.interrupt_task()`` before calling
        ``client.interrupt()`` so the runner knows to emit
        ``agent/interrupted`` instead of ``agent/turnComplete``.
        """
        self._interrupted.add(bonsai_sid)

    def is_interrupted(self, bonsai_sid: str) -> bool:
        """Check whether the session has a pending interrupt flag."""
        return bonsai_sid in self._interrupted

    def clear_interrupted(self, bonsai_sid: str) -> None:
        """Clear the interrupt flag after the runner has processed it."""
        self._interrupted.discard(bonsai_sid)

    def interrupt_futures(self, bonsai_sid: str) -> None:
        """Resolve pending futures with deny + interrupt instead of cancelling.

        Unlike ``cancel_futures()`` which raises ``CancelledError``, this
        produces a clean ``PermissionResultDeny(interrupt=True)`` that tells
        the SDK to stop the turn gracefully.
        """
        task_futures = self._futures.pop(bonsai_sid, {})
        for future in task_futures.values():
            if not future.done():
                future.set_result({
                    "behavior": "deny",
                    "message": "Interrupted",
                    "interrupt": True,
                })

    # -- last message (for retry) ------------------------------------------------

    def set_last_message(self, bonsai_sid: str, text: str) -> None:
        """Store the last user message for potential retry."""
        self._last_messages[bonsai_sid] = text

    def get_last_message(self, bonsai_sid: str) -> str | None:
        """Return the last user message, or None if no message was sent."""
        return self._last_messages.get(bonsai_sid)

    # -- turn text accumulation ------------------------------------------------

    def append_turn_text(self, bonsai_sid: str, text: str) -> None:
        """Append assistant text to the current turn buffer.

        Called by the runner for each ``TextBlock`` so that ``can_use_tool``
        can inject accumulated plan content into ``ExitPlanMode`` payloads.
        """
        self._turn_text.setdefault(bonsai_sid, []).append(text)

    def get_turn_text(self, bonsai_sid: str) -> str:
        """Return accumulated assistant text for the current turn."""
        parts = self._turn_text.get(bonsai_sid, [])
        return "".join(parts)

    def clear_turn_text(self, bonsai_sid: str) -> None:
        """Clear the turn text buffer (called at the start of each query)."""
        self._turn_text.pop(bonsai_sid, None)
