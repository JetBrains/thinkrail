from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pathlib import Path

from app.agent.models import AgentConfig, AgentResult, AgentTask
from app.agent.pricing import TokenUsage, cost
from app.agent.runtime.claude import ClaudeRuntime
from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.events import make_handler_from_notify
from app.agent.runtime.types import RuntimeExecutionConfig
from app.agent.tracker import Tracker
from app.core.config import AppConfig


async def _run(
    task: AgentTask,
    spec_context: str,
    notify: Any,
    tracker: Tracker,
    cwd: Any = None,
    plugin_dir: Any = None,
    resume_session_id: str | None = None,
    config: Any = None,
    spec_service: Any = None,
    coordinator: Any = None,
) -> AgentResult:
    """Test helper that builds the runtime, exec config, and handler from
    the legacy ``run(...)`` argument shape. Keeps test bodies concise."""
    runtime = ClaudeRuntime(
        tracker=tracker,
        app_config=config if config is not None else _test_config(),
        plugin_dir=plugin_dir,
        spec_service=spec_service,
        coordinator=coordinator,
    )
    exec_config = RuntimeExecutionConfig(
        working_directory=str(cwd) if cwd else "",
        model=task.config.model,
        system_prompt=spec_context,
        resume_session_id=resume_session_id,
        permission_mode=task.config.permission_mode,
        effort=task.config.effort,
        stream_text=task.config.stream_text,
    )
    handler = make_handler_from_notify(notify)
    return await runtime.run_session(task, exec_config, handler)


def _test_config(tmp_path: Path | None = None) -> AppConfig:
    """Create a minimal AppConfig for tests."""
    root = tmp_path or Path("/tmp/thinkrail-test")
    return AppConfig(project_root=root, thinkrail_dir=root / ".tr", plugin_dir=root / "plugins")


def _setup_mock_client(MockClient: MagicMock, messages: list) -> AsyncMock:
    """Configure MockClient to yield the given message sequence."""
    mock_instance = AsyncMock()

    async def fake_receive():
        for msg in messages:
            yield msg

    mock_instance.receive_response = fake_receive
    mock_instance.query = AsyncMock()

    MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
    MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
    return mock_instance


def _setup_capturing_client(MockClient: MagicMock, messages: list) -> dict:
    """Like _setup_mock_client but also captures the ClaudeAgentOptions."""
    captured: dict[str, Any] = {}
    mock_instance = AsyncMock()

    async def fake_receive():
        for msg in messages:
            yield msg

    mock_instance.receive_response = fake_receive
    mock_instance.query = AsyncMock()

    def capture_init(options=None, **kwargs):
        captured["options"] = options
        return MockClient.return_value

    MockClient.side_effect = capture_init
    MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
    MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
    return captured


def _make_tracker_and_task() -> tuple[Tracker, AgentTask]:
    """Create a tracker with a task ready for the conversation loop."""
    tracker = Tracker()
    task = tracker.create_task(["spec-1"], AgentConfig())
    return tracker, task


def _stream_event(raw: dict) -> Any:
    """Build a mock SDK StreamEvent wrapping a raw Anthropic stream event."""
    from claude_agent_sdk.types import StreamEvent

    ev = MagicMock(spec=StreamEvent)
    ev.event = raw
    return ev


def _turn_stream(input_tokens: int, output_tokens: int) -> list:
    """One message_start + message_delta carrying a turn's token usage."""
    return [
        _stream_event({"type": "message_start", "message": {"usage": {"input_tokens": input_tokens}}}),
        _stream_event({"type": "message_delta", "usage": {"output_tokens": output_tokens}}),
    ]


class TestRunHappyPath:
    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_single_turn_then_end(self, MockClient: MagicMock) -> None:
        """One message → full event sequence → turnComplete → end signal → done."""
        from claude_agent_sdk import (
            AssistantMessage,
            ResultMessage,
            SystemMessage,
            TextBlock,
            ToolResultBlock,
            ToolUseBlock,
            UserMessage,
        )

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "sess-1"}

        text_block = MagicMock(spec=TextBlock)
        text_block.text = "Hello"
        assistant_msg = MagicMock(spec=AssistantMessage)
        assistant_msg.content = [text_block]

        tool_block = MagicMock(spec=ToolUseBlock)
        tool_block.id = "tool-1"
        tool_block.name = "Read"
        tool_block.input = {"file_path": "main.py"}
        assistant_msg2 = MagicMock(spec=AssistantMessage)
        assistant_msg2.content = [tool_block]

        tool_result = MagicMock(spec=ToolResultBlock)
        tool_result.tool_use_id = "tool-1"
        tool_result.content = "file contents"
        tool_result.is_error = False
        user_msg = MagicMock(spec=UserMessage)
        user_msg.content = [tool_result]

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "sess-1"
        result_msg.result = "Task completed"
        result_msg.is_error = False
        result_msg.num_turns = 3
        result_msg.total_cost_usd = 0.05
        result_msg.usage = {"input_tokens": 100, "output_tokens": 200}

        _setup_mock_client(
            MockClient,
            [sys_msg, assistant_msg, assistant_msg2, user_msg,
             *_turn_stream(input_tokens=100, output_tokens=200), result_msg],
        )

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()

        # Enqueue one message then end signal
        tracker.enqueue_message(task.thinkrail_sid, "Do the thing")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        result = await _run(task, "spec context here", notify, tracker)

        assert isinstance(result, AgentResult)
        assert result.thinkrail_sid == task.thinkrail_sid
        assert result.session_id == "sess-1"
        assert result.turns == 3
        # Cost is priced from the turn's tokens (not the SDK's total_cost_usd).
        rates = ClaudeModelRegistry().rates_for(task.config.model)
        assert result.cost_usd == pytest.approx(
            cost(TokenUsage(input_tokens=100, output_tokens=200), rates)
        )

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/sessionStart" in method_calls
        assert "agent/textDelta" in method_calls
        assert "agent/toolCallStart" in method_calls
        assert "agent/toolCallEnd" in method_calls
        assert "agent/turnComplete" in method_calls
        assert "agent/done" in method_calls
        # agent/done should NOT appear inside the turn
        assert method_calls.index("agent/turnComplete") < method_calls.index("agent/done")

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_session_id_set_on_tracker(self, MockClient: MagicMock) -> None:
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "sess-42"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "sess-42"
        result_msg.result = "done"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.01
        result_msg.usage = {}

        _setup_mock_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "hello")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", AsyncMock(), tracker)
        assert tracker.get_task(task.thinkrail_sid).session_id == "sess-42"

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_multi_turn_accumulates_stats(self, MockClient: MagicMock) -> None:
        """Two turns → stats are accumulated across turns."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        # total_cost_usd is set only so the runtime's debug log can format it;
        # cost is priced from the turn's tokens, not this field.
        result1 = MagicMock(spec=ResultMessage)
        result1.session_id = "s1"
        result1.result = "turn 1 done"
        result1.is_error = False
        result1.num_turns = 2             # per-turn: 2 SDK turns in this turn
        result1.total_cost_usd = 0.0
        result1.usage = {}

        result2 = MagicMock(spec=ResultMessage)
        result2.session_id = "s1"
        result2.result = "turn 2 done"
        result2.is_error = False
        result2.num_turns = 1             # per-turn: 1 SDK turn in this turn
        result2.total_cost_usd = 0.0
        result2.usage = {}

        # Turn 2 is cheaper than turn 1 — the pre-fix bug made the session total
        # drop to the cheaper turn instead of accumulating.
        turn1_usage = TokenUsage(input_tokens=200_000, output_tokens=50_000)
        turn2_usage = TokenUsage(input_tokens=10_000, output_tokens=2_000)

        mock_instance = AsyncMock()
        call_count = 0

        def make_receive(msgs):
            async def fake_receive():
                for msg in msgs:
                    yield msg
            return fake_receive

        # First query returns sys_msg + turn-1 stream + result1, second returns turn-2 stream + result2
        async def dynamic_query(prompt):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                mock_instance.receive_response = make_receive(
                    [sys_msg, *_turn_stream(turn1_usage.input_tokens, turn1_usage.output_tokens), result1]
                )
            else:
                mock_instance.receive_response = make_receive(
                    [*_turn_stream(turn2_usage.input_tokens, turn2_usage.output_tokens), result2]
                )

        mock_instance.query = dynamic_query
        mock_instance.receive_response = make_receive([])

        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "first message")
        tracker.enqueue_message(task.thinkrail_sid, "second message")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        notify = AsyncMock()
        result = await _run(task, "context", notify, tracker)

        rates = ClaudeModelRegistry().rates_for(task.config.model)
        cost1 = cost(turn1_usage, rates)
        cost2 = cost(turn2_usage, rates)

        assert result.turns == 3  # 2 + 1
        assert result.cost_usd == pytest.approx(cost1 + cost2)
        assert result.cost_usd > cost1  # accumulates; never drops to the cheaper turn

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert method_calls.count("agent/turnComplete") == 2
        assert method_calls.count("agent/done") == 1

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_immediate_end_signal(self, MockClient: MagicMock) -> None:
        """End signal with no messages → session closes immediately."""
        _setup_mock_client(MockClient, [])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_end_signal(task.thinkrail_sid)
        notify = AsyncMock()

        result = await _run(task, "context", notify, tracker)

        assert result.turns == 0
        assert result.cost_usd == 0.0
        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/done" in method_calls

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_state_transitions(self, MockClient: MagicMock) -> None:
        """Verify state transitions: initializing → (silent idle) → running → idle.

        The runtime silently sets idle on SDK ready (signaled via
        ``agent/ready``), then transitions to running on each turn and
        back to idle after turnComplete. The terminal "done" status is
        set by the service layer, not the runtime.
        """
        from claude_agent_sdk import ResultMessage

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        _setup_mock_client(MockClient, [result_msg])

        tracker, task = _make_tracker_and_task()
        assert task.status == "initializing"

        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        notify = AsyncMock()
        await _run(task, "context", notify, tracker)

        assert task.status == "idle"
        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/ready" in method_calls
        status_changes = [
            call.args[1]["status"]
            for call in notify.call_args_list
            if call.args[0] == "agent/statusChanged"
        ]
        # running (turn start) → idle (turn complete). The initial idle
        # transition on SDK ready is signaled via agent/ready, not via
        # agent/statusChanged.
        assert status_changes == ["running", "idle"]


class TestCanUseTool:
    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_ask_user_question_callback(self, MockClient: MagicMock) -> None:
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)
        notify = AsyncMock()

        await _run(task, "context", notify, tracker, config=_test_config())

        opts = captured["options"]
        assert opts.can_use_tool is not None

        # Simulate mid-turn question — manually set task to running
        tracker.set_status(task.thinkrail_sid, "running")

        context = MagicMock()

        async def resolve_after_register():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid, req_id, {"questions": [], "answers": {"Q?": "A"}}
                )
                break

        asyncio.get_event_loop().create_task(resolve_after_register())

        result = await opts.can_use_tool(
            "AskUserQuestion", {"questions": [{"question": "Q?"}]}, context
        )
        assert result.behavior == "allow"
        assert result.updated_input is not None
        assert result.updated_input["answers"] == {"Q?": "A"}

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_tool_approval_allow(self, MockClient: MagicMock) -> None:
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", AsyncMock(), tracker, config=_test_config())

        opts = captured["options"]
        context = MagicMock()

        tracker.set_status(task.thinkrail_sid, "running")

        async def resolve_allow():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(task.thinkrail_sid, req_id, {"behavior": "allow"})
                break

        asyncio.get_event_loop().create_task(resolve_allow())

        result = await opts.can_use_tool("Bash", {"command": "ls"}, context)
        assert result.behavior == "allow"

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_tool_approval_deny(self, MockClient: MagicMock) -> None:
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", AsyncMock(), tracker, config=_test_config())

        opts = captured["options"]
        context = MagicMock()

        tracker.set_status(task.thinkrail_sid, "running")

        async def resolve_deny():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(
                    task.thinkrail_sid, req_id, {"behavior": "deny", "message": "Not allowed", "interrupt": True},
                )
                break

        asyncio.get_event_loop().create_task(resolve_deny())

        result = await opts.can_use_tool("Bash", {"command": "rm -rf /"}, context)
        assert result.behavior == "deny"
        assert result.message == "Not allowed"
        assert result.interrupt is True


class TestPluginWiring:
    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_plugin_dir_wired_into_options(self, MockClient: MagicMock) -> None:
        """When plugin_dir exists, plugins list is populated."""
        from claude_agent_sdk import ResultMessage, SystemMessage
        import tempfile
        from pathlib import Path

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        with tempfile.TemporaryDirectory() as tmpdir:
            plugin_dir = Path(tmpdir)
            await _run(task, "context", AsyncMock(), tracker, plugin_dir=plugin_dir)

        opts = captured["options"]
        assert len(opts.plugins) == 1
        assert opts.plugins[0]["type"] == "local"
        assert opts.plugins[0]["path"] == str(plugin_dir)

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_no_plugin_dir_empty_plugins(self, MockClient: MagicMock) -> None:
        """When plugin_dir is None, plugins list is empty."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", AsyncMock(), tracker, plugin_dir=None)

        opts = captured["options"]
        assert opts.plugins == []


class TestInterruptHandling:
    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_interrupt_emits_interrupted_not_turn_complete(self, MockClient: MagicMock) -> None:
        """When interrupt flag is set, ResultMessage emits agent/interrupted."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = ""
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.01
        result_msg.usage = {}

        _setup_mock_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        # Set interrupt flag BEFORE the runtime processes ResultMessage
        tracker.set_interrupted(task.thinkrail_sid)

        notify = AsyncMock()
        await _run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/interrupted" in method_calls
        assert "agent/turnComplete" not in method_calls
        # Flag should be cleared after processing
        assert tracker.is_interrupted(task.thinkrail_sid) is False

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_normal_result_emits_turn_complete(self, MockClient: MagicMock) -> None:
        """Without interrupt flag, ResultMessage emits agent/turnComplete."""
        from claude_agent_sdk import ResultMessage

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "done"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.01
        result_msg.usage = {}

        _setup_mock_client(MockClient, [result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        notify = AsyncMock()
        await _run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/turnComplete" in method_calls
        assert "agent/interrupted" not in method_calls

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_interrupted_result_returns_to_idle(self, MockClient: MagicMock) -> None:
        """After interrupt, runtime goes back to idle and can process next message."""
        from claude_agent_sdk import ResultMessage

        # total_cost_usd set only for the runtime's debug log formatting; cost
        # is priced from tokens.
        result1 = MagicMock(spec=ResultMessage)
        result1.session_id = "s1"
        result1.result = ""
        result1.is_error = False
        result1.num_turns = 1             # per-turn
        result1.total_cost_usd = 0.0
        result1.usage = {}

        result2 = MagicMock(spec=ResultMessage)
        result2.session_id = "s1"
        result2.result = "completed"
        result2.is_error = False
        result2.num_turns = 1             # per-turn: 1 SDK turn in this turn
        result2.total_cost_usd = 0.0
        result2.usage = {}

        # Both turns accrue cost (the interrupted turn's tokens count too).
        turn1_usage = TokenUsage(input_tokens=5_000, output_tokens=1_000)
        turn2_usage = TokenUsage(input_tokens=3_000, output_tokens=600)

        mock_instance = AsyncMock()
        call_count = 0

        def make_receive(msgs):
            async def fake_receive():
                for msg in msgs:
                    yield msg
            return fake_receive

        async def dynamic_query(prompt):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                mock_instance.receive_response = make_receive(
                    [*_turn_stream(turn1_usage.input_tokens, turn1_usage.output_tokens), result1]
                )
            else:
                mock_instance.receive_response = make_receive(
                    [*_turn_stream(turn2_usage.input_tokens, turn2_usage.output_tokens), result2]
                )

        mock_instance.query = dynamic_query
        mock_instance.receive_response = make_receive([])

        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker, task = _make_tracker_and_task()
        # First message will be interrupted, second will complete normally
        tracker.enqueue_message(task.thinkrail_sid, "first")
        tracker.enqueue_message(task.thinkrail_sid, "second")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        # Set interrupt flag for the first turn
        tracker.set_interrupted(task.thinkrail_sid)

        notify = AsyncMock()
        result = await _run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/interrupted" in method_calls
        assert "agent/turnComplete" in method_calls
        # interrupted should come before turnComplete
        assert method_calls.index("agent/interrupted") < method_calls.index("agent/turnComplete")
        # Both turns processed — stats accumulated
        assert result.turns == 2
        rates = ClaudeModelRegistry().rates_for(task.config.model)
        assert result.cost_usd == pytest.approx(cost(turn1_usage, rates) + cost(turn2_usage, rates))

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_interrupt_error_result_treated_as_interrupt(self, MockClient: MagicMock) -> None:
        """If ResultMessage.is_error and interrupted flag set, emit interrupted not error."""
        from claude_agent_sdk import ResultMessage

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "cancelled"
        result_msg.is_error = True
        result_msg.num_turns = 0
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        _setup_mock_client(MockClient, [result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)
        tracker.set_interrupted(task.thinkrail_sid)

        notify = AsyncMock()
        await _run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        # Interrupted flag takes precedence over is_error
        assert "agent/interrupted" in method_calls
        assert "agent/error" not in method_calls


class TestRunError:
    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_error_result(self, MockClient: MagicMock) -> None:
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "Failed"
        result_msg.is_error = True
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.01
        result_msg.usage = {}

        _setup_mock_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "do something")
        tracker.enqueue_end_signal(task.thinkrail_sid)  # needed so runtime doesn't hang after error recovery
        notify = AsyncMock()

        await _run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/error" in method_calls
        # After error, runtime recovers to idle (not terminal error),
        # then END_SIGNAL exits the loop gracefully
        assert tracker.get_task(task.thinkrail_sid).status == "idle"

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_sdk_exception_propagates(self, MockClient: MagicMock) -> None:
        mock_instance = AsyncMock()
        mock_instance.query = AsyncMock(side_effect=RuntimeError("SDK crash"))

        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")

        with pytest.raises(RuntimeError, match="SDK crash"):
            await _run(task, "context", AsyncMock(), tracker)


class TestSubagentHooks:
    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_subagent_hooks_registered(self, MockClient: MagicMock) -> None:
        """Verify SubagentStart and SubagentStop hooks are wired into options."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", AsyncMock(), tracker)

        opts = captured["options"]
        assert opts.hooks is not None
        assert "SubagentStart" in opts.hooks
        assert "SubagentStop" in opts.hooks
        assert len(opts.hooks["SubagentStart"]) == 1
        assert len(opts.hooks["SubagentStop"]) == 1
        assert len(opts.hooks["SubagentStart"][0].hooks) == 1
        assert len(opts.hooks["SubagentStop"][0].hooks) == 1

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_subagent_start_emits_notification(self, MockClient: MagicMock) -> None:
        """SubagentStart hook emits agent/subagentStart notification."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)
        notify = AsyncMock()

        await _run(task, "context", notify, tracker)

        # Extract the hook callback and invoke it
        hook_fn = captured["options"].hooks["SubagentStart"][0].hooks[0]
        mock_input = {"agent_id": "agent-42", "agent_type": "Explore"}

        result = await hook_fn(mock_input, None, MagicMock())

        assert result == {}

        # Find the subagentStart notification
        start_calls = [
            call for call in notify.call_args_list
            if call.args[0] == "agent/subagentStart"
        ]
        assert len(start_calls) == 1
        payload = start_calls[0].args[1]
        assert payload["agentId"] == "agent-42"
        assert payload["agentType"] == "Explore"
        assert payload["thinkrailSid"] == task.thinkrail_sid

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_subagent_stop_emits_notification(self, MockClient: MagicMock) -> None:
        """SubagentStop hook emits agent/subagentEnd notification."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)
        notify = AsyncMock()

        await _run(task, "context", notify, tracker)

        # Extract the hook callback and invoke it
        hook_fn = captured["options"].hooks["SubagentStop"][0].hooks[0]
        mock_input = {"agent_id": "agent-42"}

        result = await hook_fn(mock_input, None, MagicMock())

        assert result == {}

        # Find the subagentEnd notification
        end_calls = [
            call for call in notify.call_args_list
            if call.args[0] == "agent/subagentEnd"
        ]
        assert len(end_calls) == 1
        payload = end_calls[0].args[1]
        assert payload["agentId"] == "agent-42"
        assert payload["thinkrailSid"] == task.thinkrail_sid

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_subagent_agent_id_mapping_end_to_end(self, MockClient: MagicMock) -> None:
        """Full integration: Task tool → SubagentStart hook → subagent messages get agentId."""
        from claude_agent_sdk import (
            AssistantMessage,
            ResultMessage,
            SystemMessage,
            TextBlock,
            ToolResultBlock,
            ToolUseBlock,
            UserMessage,
        )

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        # Main agent: Task tool call
        task_block = MagicMock(spec=ToolUseBlock)
        task_block.id = "toolu_task_1"
        task_block.name = "Agent"
        task_block.input = {"prompt": "explore", "subagent_type": "Explore", "description": "test"}
        main_msg = MagicMock(spec=AssistantMessage)
        main_msg.parent_tool_use_id = None
        main_msg.content = [task_block]

        # Subagent text
        sub_text = MagicMock(spec=TextBlock)
        sub_text.text = "from subagent"
        sub_msg = MagicMock(spec=AssistantMessage)
        sub_msg.parent_tool_use_id = "toolu_task_1"
        sub_msg.content = [sub_text]

        # Subagent tool call
        sub_tool = MagicMock(spec=ToolUseBlock)
        sub_tool.id = "toolu_sub_1"
        sub_tool.name = "Bash"
        sub_tool.input = {"command": "ls"}
        sub_msg2 = MagicMock(spec=AssistantMessage)
        sub_msg2.parent_tool_use_id = "toolu_task_1"
        sub_msg2.content = [sub_tool]

        # Subagent tool result
        sub_result = MagicMock(spec=ToolResultBlock)
        sub_result.tool_use_id = "toolu_sub_1"
        sub_result.content = "file1.py"
        sub_result.is_error = False
        sub_user = MagicMock(spec=UserMessage)
        sub_user.parent_tool_use_id = "toolu_task_1"
        sub_user.content = [sub_result]

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        async def events_with_hook():
            """Yield events, firing SubagentStart hook after Task tool call."""
            yield sys_msg
            yield main_msg
            # After Task tool is processed, the SDK fires SubagentStart.
            # We simulate by directly calling the hook before yielding
            # subagent messages.
            yield sub_msg      # These arrive after SubagentStart
            yield sub_msg2
            yield sub_user
            yield result_msg

        mock_instance = AsyncMock()
        mock_instance.receive_response = events_with_hook
        mock_instance.query = AsyncMock()

        captured: dict[str, Any] = {}

        def capture_init(options=None, **kwargs):
            captured["options"] = options
            return MockClient.return_value

        MockClient.side_effect = capture_init
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)
        notify = AsyncMock()

        # We need SubagentStart to fire after the Task tool call is processed
        # but before sub_msg is processed. We'll do this by wrapping
        # receive_response to call the hook at the right time.
        original_events = events_with_hook

        async def events_with_hook_injection():
            idx = 0
            async for ev in original_events():
                yield ev
                idx += 1
                # After yielding main_msg (idx=2), fire SubagentStart
                if idx == 2 and "options" in captured:
                    hook_fn = captured["options"].hooks["SubagentStart"][0].hooks[0]
                    await hook_fn(
                        {"agent_id": "agent-X", "agent_type": "Explore"},
                        "some-uuid", MagicMock(),
                    )

        mock_instance.receive_response = events_with_hook_injection

        await _run(task, "context", notify, tracker)

        # Collect notifications
        text_deltas = [
            c.args[1] for c in notify.call_args_list
            if c.args[0] == "agent/textDelta"
        ]
        tool_starts = [
            c.args[1] for c in notify.call_args_list
            if c.args[0] == "agent/toolCallStart"
        ]
        tool_ends = [
            c.args[1] for c in notify.call_args_list
            if c.args[0] == "agent/toolCallEnd"
        ]

        # Main agent's Agent toolCallStart should NOT have agentId
        agent_starts = [t for t in tool_starts if t["toolName"] == "Agent"]
        assert len(agent_starts) == 1
        assert "agentId" not in agent_starts[0], "Main agent Agent call should not have agentId"

        # Subagent's textDelta should have agentId
        assert len(text_deltas) == 1
        assert text_deltas[0].get("agentId") == "agent-X", \
            f"Subagent textDelta should have agentId=agent-X, got {text_deltas[0]}"

        # Subagent's toolCallStart (Bash) should have agentId
        bash_starts = [t for t in tool_starts if t["toolName"] == "Bash"]
        assert len(bash_starts) == 1
        assert bash_starts[0].get("agentId") == "agent-X", \
            f"Subagent toolCallStart should have agentId=agent-X, got {bash_starts[0]}"

        # Subagent's toolCallEnd should have agentId
        assert len(tool_ends) == 1
        assert tool_ends[0].get("agentId") == "agent-X", \
            f"Subagent toolCallEnd should have agentId=agent-X, got {tool_ends[0]}"


class TestIterationTracking:
    """Context window is computed from the last iteration (API call), not the
    cumulative turn totals."""

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_multi_iteration_context_window(self, MockClient: MagicMock) -> None:
        """A turn with 3 API calls (tool-use loop) emits iterations array
        and contextWindow based on the last iteration only."""
        from claude_agent_sdk import ResultMessage, SystemMessage
        from claude_agent_sdk.types import StreamEvent

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        # Three iterations of message_start + message_delta
        def _stream_event(raw: dict) -> StreamEvent:
            ev = MagicMock(spec=StreamEvent)
            ev.event = raw
            return ev

        iter1_start = _stream_event({
            "type": "message_start",
            "message": {"usage": {
                "input_tokens": 5000,
                "cache_read_input_tokens": 40000,
                "cache_creation_input_tokens": 5000,
            }},
        })
        iter1_delta = _stream_event({
            "type": "message_delta",
            "usage": {"output_tokens": 500},
        })
        iter2_start = _stream_event({
            "type": "message_start",
            "message": {"usage": {
                "input_tokens": 6000,
                "cache_read_input_tokens": 40000,
                "cache_creation_input_tokens": 6000,
            }},
        })
        iter2_delta = _stream_event({
            "type": "message_delta",
            "usage": {"output_tokens": 600},
        })
        iter3_start = _stream_event({
            "type": "message_start",
            "message": {"usage": {
                "input_tokens": 7000,
                "cache_read_input_tokens": 40000,
                "cache_creation_input_tokens": 7000,
            }},
        })
        iter3_delta = _stream_event({
            "type": "message_delta",
            "usage": {"output_tokens": 700},
        })

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "done"
        result_msg.is_error = False
        result_msg.num_turns = 3
        result_msg.total_cost_usd = 0.10
        result_msg.usage = {
            "input_tokens": 18000,
            "output_tokens": 1800,
            "cache_read_input_tokens": 120000,
            "cache_creation_input_tokens": 18000,
        }

        _setup_mock_client(MockClient, [
            sys_msg,
            iter1_start, iter1_delta,
            iter2_start, iter2_delta,
            iter3_start, iter3_delta,
            result_msg,
        ])

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        tracker.enqueue_message(task.thinkrail_sid, "do stuff")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", notify, tracker)

        # Find the turnComplete notification
        turn_complete = None
        for call in notify.call_args_list:
            if call.args[0] == "agent/turnComplete":
                turn_complete = call.args[1]
                break
        assert turn_complete is not None, "agent/turnComplete should have been emitted"

        # iterations array should have 3 entries
        iters = turn_complete["iterations"]
        assert len(iters) == 3

        # Each iteration has the correct token counts
        assert iters[0]["input_tokens"] == 5000
        assert iters[0]["cache_read_input_tokens"] == 40000
        assert iters[0]["cache_creation_input_tokens"] == 5000
        assert iters[0]["output_tokens"] == 500
        assert iters[2]["input_tokens"] == 7000
        assert iters[2]["output_tokens"] == 700

        # contextWindow = last iteration total (NOT sum of all iterations)
        # Last iter: 7000 + 40000 + 7000 + 700 = 54700
        expected_ctx = 7000 + 40000 + 7000 + 700
        assert turn_complete["contextWindow"] == expected_ctx

        # Verify it's NOT the sum of all iterations
        sum_all = sum(
            it["input_tokens"] + it["cache_read_input_tokens"]
            + it["cache_creation_input_tokens"] + it["output_tokens"]
            for it in iters
        )
        assert sum_all > expected_ctx, "Sum of all iterations should exceed last-iteration context"

    @patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
    async def test_single_iteration_context_window(self, MockClient: MagicMock) -> None:
        """A simple turn with one API call correctly computes contextWindow."""
        from claude_agent_sdk import ResultMessage, SystemMessage
        from claude_agent_sdk.types import StreamEvent

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        def _stream_event(raw: dict) -> StreamEvent:
            ev = MagicMock(spec=StreamEvent)
            ev.event = raw
            return ev

        start = _stream_event({
            "type": "message_start",
            "message": {"usage": {
                "input_tokens": 2000,
                "cache_read_input_tokens": 10000,
                "cache_creation_input_tokens": 3000,
            }},
        })
        delta = _stream_event({
            "type": "message_delta",
            "usage": {"output_tokens": 400},
        })

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.02
        result_msg.usage = {"input_tokens": 2000, "output_tokens": 400}

        _setup_mock_client(MockClient, [sys_msg, start, delta, result_msg])

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", notify, tracker)

        turn_complete = None
        for call in notify.call_args_list:
            if call.args[0] == "agent/turnComplete":
                turn_complete = call.args[1]
                break
        assert turn_complete is not None

        # contextWindow = 2000 + 10000 + 3000 + 400 = 15400
        assert turn_complete["contextWindow"] == 15400
        assert len(turn_complete["iterations"]) == 1


class TestClaudeRuntimeCapabilities:
    """``capabilities()`` projects three default-first LabeledOption lists."""

    def test_returns_three_lists(self) -> None:
        caps = ClaudeRuntime(app_config=_test_config()).capabilities()
        assert len(caps.permission_modes) > 0
        assert len(caps.effort_levels) > 0
        assert len(caps.models) > 0

    def test_lists_are_sourced_from_the_sdk(self) -> None:
        from typing import get_args

        from claude_agent_sdk import EffortLevel, PermissionMode

        caps = ClaudeRuntime(app_config=_test_config()).capabilities()
        # Permission modes are exactly the SDK's accepted set, in SDK order
        # (``default`` first — the runtime default).
        assert [p.value for p in caps.permission_modes] == list(get_args(PermissionMode))
        assert caps.permission_modes[0].value == "default"
        # Effort levels are the SDK's set with ThinkRail's ``"auto"`` (= SDK
        # ``effort=None``) leading.
        assert [e.value for e in caps.effort_levels] == ["auto", *get_args(EffortLevel)]
        assert caps.effort_levels[0].value == "auto"
        assert caps.models[0].value == "claude-fable-5"

    def test_permission_labels_are_the_sdk_values(self) -> None:
        # No custom labels — the SDK value doubles as the display label.
        caps = ClaudeRuntime(app_config=_test_config()).capabilities()
        assert all(p.label == p.value for p in caps.permission_modes)

    def test_models_are_value_label_only(self) -> None:
        caps = ClaudeRuntime(app_config=_test_config()).capabilities()
        assert set(caps.models[0].model_dump().keys()) == {"value", "label"}


@patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
class TestEffortBoundary:
    """``effort="auto"`` maps to the SDK's ``effort=None``; other values pass through."""

    async def _captured_options(self, MockClient: MagicMock, effort: str) -> Any:
        from claude_agent_sdk import ResultMessage

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}
        captured = _setup_capturing_client(MockClient, [result_msg])

        tracker = Tracker()
        task = tracker.create_task(["spec-1"], AgentConfig(effort=effort))
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)
        await _run(task, "context", AsyncMock(), tracker)
        return captured["options"]

    async def test_auto_becomes_none(self, MockClient: MagicMock) -> None:
        options = await self._captured_options(MockClient, "auto")
        assert options.effort is None

    async def test_explicit_effort_passes_through(self, MockClient: MagicMock) -> None:
        options = await self._captured_options(MockClient, "high")
        assert options.effort == "high"


@patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
class TestContext1mFlag:
    """The ``context1m`` flag gates the 1M-context beta (default on)."""

    async def _betas_for(self, MockClient: MagicMock, flags: dict) -> list:
        from claude_agent_sdk import ResultMessage

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}
        captured = _setup_capturing_client(MockClient, [result_msg])

        tracker = Tracker()
        task = tracker.create_task(["spec-1"], AgentConfig(flags=flags))
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)
        await _run(task, "context", AsyncMock(), tracker)
        return captured["options"].betas

    async def test_default_requests_1m_beta(self, MockClient: MagicMock) -> None:
        # Absent flag → the flag's default (True) → beta sent.
        assert "context-1m-2025-08-07" in await self._betas_for(MockClient, {})

    async def test_flag_off_disables_beta(self, MockClient: MagicMock) -> None:
        assert await self._betas_for(MockClient, {"context1m": False}) == []

    def test_runtime_declares_the_flag(self, MockClient: MagicMock) -> None:
        caps = ClaudeRuntime(app_config=_test_config()).capabilities()
        flag = next(f for f in caps.flags if f.key == "context1m")
        assert flag.type == "boolean"
        assert flag.default is True


@patch("app.agent.runtime.claude.runtime.ClaudeSDKClient")
class TestContextMaxStreaming:
    """The runtime reads the context window from the live client and streams it."""

    async def test_turn_complete_carries_runtime_context_max(self, MockClient: MagicMock) -> None:
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}
        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        mock_instance = _setup_mock_client(MockClient, [sys_msg, result_msg])
        mock_instance.get_context_usage = AsyncMock(return_value={"rawMaxTokens": 1_000_000})

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", notify, tracker)

        turn_complete = next(
            c.args[1] for c in notify.call_args_list if c.args[0] == "agent/turnComplete"
        )
        assert turn_complete["contextMax"] == 1_000_000

    async def test_context_usage_failure_keeps_zero(self, MockClient: MagicMock) -> None:
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}
        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "s1"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        mock_instance = _setup_mock_client(MockClient, [sys_msg, result_msg])
        mock_instance.get_context_usage = AsyncMock(side_effect=RuntimeError("not connected"))

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        tracker.enqueue_message(task.thinkrail_sid, "go")
        tracker.enqueue_end_signal(task.thinkrail_sid)

        await _run(task, "context", notify, tracker)

        turn_complete = next(
            c.args[1] for c in notify.call_args_list if c.args[0] == "agent/turnComplete"
        )
        assert turn_complete["contextMax"] == 0


class TestClaudeRuntimeInterrupt:
    """Direct unit tests for ``ClaudeRuntime.interrupt`` (plan 02 task 5).

    The method is the public hook ``AgentService.interrupt_task`` calls after
    setting thinkrail-internal state (``set_interrupted`` / ``interrupt_futures``).
    Tracker state changes still belong to the service layer — runtime.interrupt
    only delivers the SDK-specific cancel.
    """

    async def test_calls_client_interrupt_when_present(self) -> None:
        runtime = ClaudeRuntime(app_config=_test_config())
        tracker, task = _make_tracker_and_task()
        mock_client = AsyncMock()
        tracker.set_client(task.thinkrail_sid, mock_client)

        await runtime.interrupt(task, tracker)

        mock_client.interrupt.assert_awaited_once()

    async def test_noop_when_no_client(self) -> None:
        runtime = ClaudeRuntime(app_config=_test_config())
        tracker, task = _make_tracker_and_task()
        # No client registered for this sid

        # Should not raise
        await runtime.interrupt(task, tracker)

    async def test_swallows_client_interrupt_exception(self) -> None:
        runtime = ClaudeRuntime(app_config=_test_config())
        tracker, task = _make_tracker_and_task()
        mock_client = AsyncMock()
        mock_client.interrupt.side_effect = RuntimeError("client gone")
        tracker.set_client(task.thinkrail_sid, mock_client)

        # Should not raise — disconnected clients are expected
        await runtime.interrupt(task, tracker)
        mock_client.interrupt.assert_awaited_once()


# ``TestListSkills`` was moved to ``test_skills.py`` by the Step 8 refactor
# (skill discovery now lives in ``ClaudeSkillRegistry``).

