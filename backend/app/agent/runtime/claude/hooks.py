"""Subagent / PreCompact hook helpers for the Claude runtime.

The Claude SDK invokes ``SubagentStart`` / ``SubagentStop`` / ``PreCompact``
hooks during a session; bonsai needs to (a) emit unified ``RuntimeEvent`` s
to the handler so the frontend can render subagent blocks, and (b) correlate
``parent_tool_use_id`` (an SDK identifier) with our internal ``agent_id`` so
streamed assistant / tool messages can be grouped under the right subagent.

``SubagentHooks`` owns the correlation state for one session and exposes
the three SDK callbacks as bound methods. The runtime mutates
``session_id`` and ``iterations`` on the instance as the session
progresses; the hooks read those at call time.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.agent.runtime.events import RuntimeEvent

if TYPE_CHECKING:
    from app.agent.models import AgentTask
    from app.agent.runtime.events import AgentEventHandler

logger = logging.getLogger(__name__)


class SubagentHooks:
    """Per-session subagent / PreCompact hook state and callbacks.

    Constructed once per ``run_session`` invocation. The runtime updates
    ``session_id`` after the SDK init message fires, and replaces
    ``iterations`` with the current turn's list at the start of each turn
    (the list is mutated in place during the turn, so the hooks always see
    the live state).
    """

    def __init__(self, task: AgentTask, handler: AgentEventHandler) -> None:
        self.task = task
        self.handler = handler
        self.session_id: str = ""
        self.iterations: list[dict[str, Any]] = []
        # Subagents whose Start fired but whose Stop hasn't — used to emit
        # synthetic SubagentStop events when a turn is interrupted.
        self._active_subagent_ids: set[str] = set()
        # Maps SDK ``parent_tool_use_id`` → our ``agent_id`` so streamed
        # assistant / tool events can be grouped under the right subagent.
        self._parent_to_agent: dict[str, str] = {}
        # Queue of Task ToolUseBlock.id values awaiting a SubagentStart hook.
        # Each Task tool call triggers exactly one SubagentStart in order.
        self._pending_task_tool_ids: list[str] = []

    async def _emit(self, method: str, params: dict[str, Any]) -> None:
        await self.handler.on_event(RuntimeEvent(method=method, params=params))

    async def start_hook(
        self, hook_input: Any, tool_use_id: str | None, context: Any
    ) -> dict[str, Any]:
        agent_id = hook_input["agent_id"]
        self._active_subagent_ids.add(agent_id)
        if self._pending_task_tool_ids:
            parent_id = self._pending_task_tool_ids.pop(0)
            self._parent_to_agent[parent_id] = agent_id
        await self._emit("agent/subagentStart", {
            "bonsaiSid": self.task.bonsai_sid,
            "sessionId": self.session_id,
            "agentId": agent_id,
            "agentType": hook_input["agent_type"],
        })
        return {}

    async def stop_hook(
        self, hook_input: Any, tool_use_id: str | None, context: Any
    ) -> dict[str, Any]:
        self._active_subagent_ids.discard(hook_input["agent_id"])
        await self._emit("agent/subagentEnd", {
            "bonsaiSid": self.task.bonsai_sid,
            "sessionId": self.session_id,
            "agentId": hook_input["agent_id"],
        })
        return {}

    async def pre_compact_hook(
        self, hook_input: Any, tool_use_id: str | None, context: Any
    ) -> dict[str, Any]:
        trigger = hook_input.get("trigger", "auto")
        pre_tokens = 0
        if self.iterations:
            last = self.iterations[-1]
            pre_tokens = (
                last.get("input_tokens", 0)
                + last.get("cache_creation_input_tokens", 0)
                + last.get("cache_read_input_tokens", 0)
                + last.get("output_tokens", 0)
            )
        await self._emit("agent/compact", {
            "bonsaiSid": self.task.bonsai_sid,
            "sessionId": self.session_id,
            "trigger": trigger,
            "preTokens": pre_tokens,
        })
        return {}

    def record_task_tool_call(self, tool_use_id: str) -> None:
        """Queue a Task ToolUseBlock.id so the next SubagentStart can correlate."""
        self._pending_task_tool_ids.append(tool_use_id)

    def resolve_agent_id(self, parent_tool_use_id: str | None) -> str | None:
        """Resolve SDK ``parent_tool_use_id`` to our ``agent_id``."""
        if parent_tool_use_id is None:
            return None
        return self._parent_to_agent.get(parent_tool_use_id)

    async def close_orphaned_subagents(self) -> None:
        """Emit synthetic ``agent/subagentEnd`` for any subagents still open.

        The SDK's ``SubagentStop`` hook isn't guaranteed to fire when a turn
        is interrupted mid-flight, so the runtime calls this on the
        interrupted path to keep the frontend's block state consistent.
        """
        for orphan_id in list(self._active_subagent_ids):
            await self._emit("agent/subagentEnd", {
                "bonsaiSid": self.task.bonsai_sid,
                "sessionId": self.session_id,
                "agentId": orphan_id,
            })
        self._active_subagent_ids.clear()
        self._pending_task_tool_ids.clear()
