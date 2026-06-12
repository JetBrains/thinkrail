"""Targeted unit tests for ``SubagentHooks`` correlation logic.

These tests exercise the hook helper directly — without spinning up the
full ``ClaudeRuntime.run_session`` loop — so that the
Task ToolUseBlock.id ↔ ``agent_id`` ↔ ``parent_tool_use_id`` correlation
state machine has explicit coverage.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.agent.models import AgentConfig
from app.agent.runtime.claude.hooks import SubagentHooks
from app.agent.runtime.events import RuntimeEvent
from app.agent.tracker import Tracker


class _RecordingHandler:
    """Captures every ``RuntimeEvent`` for assertions."""

    def __init__(self) -> None:
        self.events: list[RuntimeEvent] = []

    async def on_event(self, event: RuntimeEvent) -> None:
        self.events.append(event)


def _make_hooks(session_id: str = "sess-1") -> tuple[SubagentHooks, _RecordingHandler]:
    tracker = Tracker()
    task = tracker.create_task(["spec-1"], AgentConfig())
    handler = _RecordingHandler()
    hooks = SubagentHooks(task=task, handler=handler)
    hooks.session_id = session_id
    return hooks, handler


class TestStartHookEmitsEvent:
    async def test_emits_subagent_start_with_payload(self) -> None:
        hooks, handler = _make_hooks(session_id="sess-A")

        result = await hooks.start_hook(
            {"agent_id": "agent-1", "agent_type": "Explore"}, None, MagicMock()
        )

        assert result == {}
        assert len(handler.events) == 1
        ev = handler.events[0]
        assert ev.method == "agent/subagentStart"
        assert ev.params["agentId"] == "agent-1"
        assert ev.params["agentType"] == "Explore"
        assert ev.params["sessionId"] == "sess-A"
        assert ev.params["thinkrailSid"] == hooks.task.thinkrail_sid


class TestStopHookEmitsEvent:
    async def test_emits_subagent_end_with_payload(self) -> None:
        hooks, handler = _make_hooks(session_id="sess-B")

        result = await hooks.stop_hook({"agent_id": "agent-1"}, None, MagicMock())

        assert result == {}
        assert len(handler.events) == 1
        ev = handler.events[0]
        assert ev.method == "agent/subagentEnd"
        assert ev.params["agentId"] == "agent-1"
        assert ev.params["sessionId"] == "sess-B"
        assert ev.params["thinkrailSid"] == hooks.task.thinkrail_sid


class TestParentToolCorrelation:
    """The ``Task`` tool fires a ``ToolUseBlock`` with id ``X``; later the SDK
    fires ``SubagentStart(agent_id=Y)``. The hooks queue ``X`` via
    ``record_task_tool_call`` and pop it inside ``start_hook`` to build the
    ``parent_tool_use_id → agent_id`` map. That map is consumed by
    ``resolve_agent_id`` when streaming subagent messages.
    """

    async def test_records_pairing_for_resolve(self) -> None:
        hooks, _ = _make_hooks()
        hooks.record_task_tool_call("toolu_task_1")

        await hooks.start_hook(
            {"agent_id": "agent-A", "agent_type": "Explore"}, None, MagicMock()
        )

        assert hooks.resolve_agent_id("toolu_task_1") == "agent-A"

    async def test_resolve_unknown_parent_returns_none(self) -> None:
        hooks, _ = _make_hooks()
        assert hooks.resolve_agent_id("toolu_unknown") is None

    async def test_resolve_none_parent_returns_none(self) -> None:
        hooks, _ = _make_hooks()
        assert hooks.resolve_agent_id(None) is None

    async def test_multiple_starts_fifo_pairing(self) -> None:
        """Two queued Task ids + two SubagentStart calls pair up in order."""
        hooks, _ = _make_hooks()
        hooks.record_task_tool_call("toolu_first")
        hooks.record_task_tool_call("toolu_second")

        await hooks.start_hook(
            {"agent_id": "agent-1", "agent_type": "Explore"}, None, MagicMock()
        )
        await hooks.start_hook(
            {"agent_id": "agent-2", "agent_type": "general-purpose"}, None, MagicMock()
        )

        assert hooks.resolve_agent_id("toolu_first") == "agent-1"
        assert hooks.resolve_agent_id("toolu_second") == "agent-2"

    async def test_start_without_pending_task_id_does_not_register_mapping(self) -> None:
        """If a SubagentStart fires before any Task tool is queued, no mapping
        is recorded — but the hook still emits the start event."""
        hooks, handler = _make_hooks()

        await hooks.start_hook(
            {"agent_id": "agent-orphan", "agent_type": "Explore"}, None, MagicMock()
        )

        # Event still emits
        assert len(handler.events) == 1
        assert handler.events[0].params["agentId"] == "agent-orphan"
        # No parent → agent mapping registered
        assert hooks._parent_to_agent == {}


class TestActiveSubagentTracking:
    async def test_start_adds_to_active_set(self) -> None:
        hooks, _ = _make_hooks()
        await hooks.start_hook(
            {"agent_id": "agent-1", "agent_type": "Explore"}, None, MagicMock()
        )
        assert "agent-1" in hooks._active_subagent_ids

    async def test_stop_removes_from_active_set(self) -> None:
        hooks, _ = _make_hooks()
        await hooks.start_hook(
            {"agent_id": "agent-1", "agent_type": "Explore"}, None, MagicMock()
        )
        await hooks.stop_hook({"agent_id": "agent-1"}, None, MagicMock())
        assert "agent-1" not in hooks._active_subagent_ids

    async def test_stop_unknown_agent_is_noop(self) -> None:
        hooks, handler = _make_hooks()
        # discard() doesn't raise on missing keys
        await hooks.stop_hook({"agent_id": "agent-ghost"}, None, MagicMock())
        # End event still emits even if it wasn't tracked
        assert len(handler.events) == 1
        assert handler.events[0].method == "agent/subagentEnd"


class TestCloseOrphanedSubagents:
    async def test_emits_end_for_each_active_subagent(self) -> None:
        hooks, handler = _make_hooks(session_id="sess-X")
        await hooks.start_hook(
            {"agent_id": "agent-1", "agent_type": "Explore"}, None, MagicMock()
        )
        await hooks.start_hook(
            {"agent_id": "agent-2", "agent_type": "Explore"}, None, MagicMock()
        )

        # Reset captured events to focus on orphan close output
        handler.events.clear()

        await hooks.close_orphaned_subagents()

        # Two end events emitted (one per active subagent)
        end_events = [e for e in handler.events if e.method == "agent/subagentEnd"]
        assert len(end_events) == 2
        ids = {e.params["agentId"] for e in end_events}
        assert ids == {"agent-1", "agent-2"}
        # Each event carries the session_id snapshot
        for ev in end_events:
            assert ev.params["sessionId"] == "sess-X"

    async def test_clears_active_and_pending_state(self) -> None:
        hooks, _ = _make_hooks()
        await hooks.start_hook(
            {"agent_id": "agent-1", "agent_type": "Explore"}, None, MagicMock()
        )
        hooks.record_task_tool_call("toolu_pending_1")
        hooks.record_task_tool_call("toolu_pending_2")

        await hooks.close_orphaned_subagents()

        assert hooks._active_subagent_ids == set()
        assert hooks._pending_task_tool_ids == []

    async def test_no_active_subagents_emits_nothing(self) -> None:
        hooks, handler = _make_hooks()
        await hooks.close_orphaned_subagents()
        assert handler.events == []


class TestPreCompactHook:
    async def test_emits_compact_event_with_default_trigger(self) -> None:
        hooks, handler = _make_hooks(session_id="sess-pc")
        # No iterations recorded yet → preTokens = 0
        result = await hooks.pre_compact_hook({}, None, MagicMock())

        assert result == {}
        assert len(handler.events) == 1
        ev = handler.events[0]
        assert ev.method == "agent/compact"
        assert ev.params["sessionId"] == "sess-pc"
        assert ev.params["thinkrailSid"] == hooks.task.thinkrail_sid
        assert ev.params["trigger"] == "auto"
        assert ev.params["preTokens"] == 0

    async def test_uses_explicit_trigger_when_provided(self) -> None:
        hooks, handler = _make_hooks()
        await hooks.pre_compact_hook({"trigger": "manual"}, None, MagicMock())
        assert handler.events[0].params["trigger"] == "manual"

    async def test_pre_tokens_uses_last_iteration_only(self) -> None:
        """``preTokens`` is the sum of the last iteration's token fields, not
        the sum across all iterations."""
        hooks, handler = _make_hooks()
        # Mutate iterations on the instance — runtime mirrors the live list
        hooks.iterations[:] = [
            {
                "input_tokens": 1,
                "cache_creation_input_tokens": 2,
                "cache_read_input_tokens": 4,
                "output_tokens": 8,
            },
            {
                "input_tokens": 16,
                "cache_creation_input_tokens": 32,
                "cache_read_input_tokens": 64,
                "output_tokens": 128,
            },
        ]
        await hooks.pre_compact_hook({"trigger": "auto"}, None, MagicMock())

        # Last iteration sum = 16 + 32 + 64 + 128 = 240
        assert handler.events[0].params["preTokens"] == 240
