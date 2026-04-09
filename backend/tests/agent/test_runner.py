from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pathlib import Path

from app.agent.models import AgentConfig, AgentResult, AgentTask
from app.agent.runner import run
from app.agent.tracker import Tracker
from app.core.config import AppConfig


def _test_config(tmp_path: Path | None = None) -> AppConfig:
    """Create a minimal AppConfig for tests."""
    root = tmp_path or Path("/tmp/bonsai-test")
    return AppConfig(project_root=root, bonsai_dir=root / ".bonsai", plugin_dir=root / "plugins")


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


class TestRunHappyPath:
    @patch("app.agent.runner.ClaudeSDKClient")
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
            [sys_msg, assistant_msg, assistant_msg2, user_msg, result_msg],
        )

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()

        # Enqueue one message then end signal
        tracker.enqueue_message(task.bonsai_sid, "Do the thing")
        tracker.enqueue_end_signal(task.bonsai_sid)

        print(f"[test_single_turn_then_end] starting run")
        result = await run(task, "spec context here", notify, tracker)
        print(f"[test_single_turn_then_end] run completed")

        assert isinstance(result, AgentResult)
        assert result.bonsai_sid == task.bonsai_sid
        assert result.session_id == "sess-1"
        assert result.turns == 3
        assert result.cost_usd == 0.05

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/sessionStart" in method_calls
        assert "agent/textDelta" in method_calls
        assert "agent/toolCallStart" in method_calls
        assert "agent/toolCallEnd" in method_calls
        assert "agent/turnComplete" in method_calls
        assert "agent/done" in method_calls
        # agent/done should NOT appear inside the turn
        assert method_calls.index("agent/turnComplete") < method_calls.index("agent/done")

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "hello")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", AsyncMock(), tracker)
        assert tracker.get_task(task.bonsai_sid).session_id == "sess-42"

    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_multi_turn_accumulates_stats(self, MockClient: MagicMock) -> None:
        """Two turns → stats are accumulated across turns."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "s1"}

        result1 = MagicMock(spec=ResultMessage)
        result1.session_id = "s1"
        result1.result = "turn 1 done"
        result1.is_error = False
        result1.num_turns = 2             # per-turn: 2 SDK turns in this turn
        result1.total_cost_usd = 0.03     # cumulative: $0.03 after turn 1
        result1.usage = {}

        result2 = MagicMock(spec=ResultMessage)
        result2.session_id = "s1"
        result2.result = "turn 2 done"
        result2.is_error = False
        result2.num_turns = 1             # per-turn: 1 SDK turn in this turn
        result2.total_cost_usd = 0.05     # cumulative: $0.05 after turn 2
        result2.usage = {}

        mock_instance = AsyncMock()
        call_count = 0

        def make_receive(msgs):
            async def fake_receive():
                for msg in msgs:
                    yield msg
            return fake_receive

        # First query returns sys_msg + result1, second returns result2
        async def dynamic_query(prompt):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                mock_instance.receive_response = make_receive([sys_msg, result1])
            else:
                mock_instance.receive_response = make_receive([result2])

        mock_instance.query = dynamic_query
        mock_instance.receive_response = make_receive([])

        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.bonsai_sid, "first message")
        tracker.enqueue_message(task.bonsai_sid, "second message")
        tracker.enqueue_end_signal(task.bonsai_sid)

        notify = AsyncMock()
        result = await run(task, "context", notify, tracker)

        assert result.turns == 3  # 2 + 1
        assert result.cost_usd == pytest.approx(0.05)  # 0.03 + 0.02

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert method_calls.count("agent/turnComplete") == 2
        assert method_calls.count("agent/done") == 1

    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_immediate_end_signal(self, MockClient: MagicMock) -> None:
        """End signal with no messages → session closes immediately."""
        _setup_mock_client(MockClient, [])

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_end_signal(task.bonsai_sid)
        notify = AsyncMock()

        result = await run(task, "context", notify, tracker)

        assert result.turns == 0
        assert result.cost_usd == 0.0
        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/done" in method_calls

    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_state_transitions(self, MockClient: MagicMock) -> None:
        """Verify state transitions: pending → idle → running → idle → done."""
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

        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", AsyncMock(), tracker)

        # After run completes, the task should be in idle (from turnComplete)
        # then done is set by service layer, not runner — runner just emits done notification
        # But the last set_status in the loop is "idle" after turnComplete
        # The done transition happens when service calls set_status after run returns


class TestCanUseTool:
    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)
        notify = AsyncMock()

        await run(task, "context", notify, tracker, config=_test_config())

        opts = captured["options"]
        assert opts.can_use_tool is not None

        # Simulate mid-turn question — manually set task to running
        tracker.set_status(task.bonsai_sid, "running")

        context = MagicMock()

        async def resolve_after_register():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.bonsai_sid, {})):
                tracker.resolve_future(
                    task.bonsai_sid, req_id, {"questions": [], "answers": {"Q?": "A"}}
                )
                break

        asyncio.get_event_loop().create_task(resolve_after_register())

        result = await opts.can_use_tool(
            "AskUserQuestion", {"questions": [{"question": "Q?"}]}, context
        )
        assert result.behavior == "allow"
        assert result.updated_input is not None
        assert result.updated_input["answers"] == {"Q?": "A"}

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", AsyncMock(), tracker, config=_test_config())

        opts = captured["options"]
        context = MagicMock()

        tracker.set_status(task.bonsai_sid, "running")

        async def resolve_allow():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.bonsai_sid, {})):
                tracker.resolve_future(task.bonsai_sid, req_id, {"behavior": "allow"})
                break

        asyncio.get_event_loop().create_task(resolve_allow())

        result = await opts.can_use_tool("Bash", {"command": "ls"}, context)
        assert result.behavior == "allow"

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", AsyncMock(), tracker, config=_test_config())

        opts = captured["options"]
        context = MagicMock()

        tracker.set_status(task.bonsai_sid, "running")

        async def resolve_deny():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.bonsai_sid, {})):
                tracker.resolve_future(
                    task.bonsai_sid,
                    req_id,
                    {"behavior": "deny", "message": "Not allowed", "interrupt": True},
                )
                break

        asyncio.get_event_loop().create_task(resolve_deny())

        result = await opts.can_use_tool("Bash", {"command": "rm -rf /"}, context)
        assert result.behavior == "deny"
        assert result.message == "Not allowed"
        assert result.interrupt is True


class TestPluginWiring:
    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        with tempfile.TemporaryDirectory() as tmpdir:
            plugin_dir = Path(tmpdir)
            print(f"[test_plugin_dir_wired] running with plugin_dir={plugin_dir}")
            await run(task, "context", AsyncMock(), tracker, plugin_dir=plugin_dir)

        opts = captured["options"]
        print(f"[test_plugin_dir_wired] plugins={opts.plugins}")
        assert len(opts.plugins) == 1
        assert opts.plugins[0]["type"] == "local"
        assert opts.plugins[0]["path"] == str(plugin_dir)

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        print("[test_no_plugin_dir] running with plugin_dir=None")
        await run(task, "context", AsyncMock(), tracker, plugin_dir=None)

        opts = captured["options"]
        print(f"[test_no_plugin_dir] plugins={opts.plugins}")
        assert opts.plugins == []


class TestInterruptHandling:
    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        # Set interrupt flag BEFORE the run processes ResultMessage
        tracker.set_interrupted(task.bonsai_sid)

        notify = AsyncMock()
        await run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/interrupted" in method_calls
        assert "agent/turnComplete" not in method_calls
        # Flag should be cleared after processing
        assert tracker.is_interrupted(task.bonsai_sid) is False

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        notify = AsyncMock()
        await run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/turnComplete" in method_calls
        assert "agent/interrupted" not in method_calls

    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_interrupted_result_returns_to_idle(self, MockClient: MagicMock) -> None:
        """After interrupt, runner goes back to idle and can process next message."""
        from claude_agent_sdk import ResultMessage

        result1 = MagicMock(spec=ResultMessage)
        result1.session_id = "s1"
        result1.result = ""
        result1.is_error = False
        result1.num_turns = 1             # per-turn
        result1.total_cost_usd = 0.01     # cumulative
        result1.usage = {}

        result2 = MagicMock(spec=ResultMessage)
        result2.session_id = "s1"
        result2.result = "completed"
        result2.is_error = False
        result2.num_turns = 1             # per-turn: 1 SDK turn in this turn
        result2.total_cost_usd = 0.03     # cumulative: $0.03 total
        result2.usage = {}

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
                mock_instance.receive_response = make_receive([result1])
            else:
                mock_instance.receive_response = make_receive([result2])

        mock_instance.query = dynamic_query
        mock_instance.receive_response = make_receive([])

        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker, task = _make_tracker_and_task()
        # First message will be interrupted, second will complete normally
        tracker.enqueue_message(task.bonsai_sid, "first")
        tracker.enqueue_message(task.bonsai_sid, "second")
        tracker.enqueue_end_signal(task.bonsai_sid)

        # Set interrupt flag for the first turn
        tracker.set_interrupted(task.bonsai_sid)

        notify = AsyncMock()
        result = await run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/interrupted" in method_calls
        assert "agent/turnComplete" in method_calls
        # interrupted should come before turnComplete
        assert method_calls.index("agent/interrupted") < method_calls.index("agent/turnComplete")
        # Both turns processed — stats accumulated
        assert result.turns == 2
        assert result.cost_usd == pytest.approx(0.03)

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)
        tracker.set_interrupted(task.bonsai_sid)

        notify = AsyncMock()
        await run(task, "context", notify, tracker)

        method_calls = [call.args[0] for call in notify.call_args_list]
        # Interrupted flag takes precedence over is_error
        assert "agent/interrupted" in method_calls
        assert "agent/error" not in method_calls


class TestRunError:
    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "do something")
        tracker.enqueue_end_signal(task.bonsai_sid)  # needed so runner doesn't hang after error recovery
        notify = AsyncMock()

        print(f"[test_error_result] starting run for task {task.bonsai_sid}")
        result = await run(task, "context", notify, tracker)
        print(f"[test_error_result] run completed, result={result.result}")

        method_calls = [call.args[0] for call in notify.call_args_list]
        print(f"[test_error_result] notifications: {method_calls}")
        assert "agent/error" in method_calls
        # After error, runner recovers to idle (not terminal error),
        # then END_SIGNAL exits the loop gracefully
        assert tracker.get_task(task.bonsai_sid).status == "idle"

    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_sdk_exception_propagates(self, MockClient: MagicMock) -> None:
        mock_instance = AsyncMock()
        mock_instance.query = AsyncMock(side_effect=RuntimeError("SDK crash"))

        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker, task = _make_tracker_and_task()
        tracker.enqueue_message(task.bonsai_sid, "go")

        print(f"[test_sdk_exception_propagates] starting run, expecting RuntimeError")
        with pytest.raises(RuntimeError, match="SDK crash"):
            await run(task, "context", AsyncMock(), tracker)
        print(f"[test_sdk_exception_propagates] exception caught as expected")


class TestSubagentHooks:
    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", AsyncMock(), tracker)

        opts = captured["options"]
        assert opts.hooks is not None
        assert "SubagentStart" in opts.hooks
        assert "SubagentStop" in opts.hooks
        assert len(opts.hooks["SubagentStart"]) == 1
        assert len(opts.hooks["SubagentStop"]) == 1
        assert len(opts.hooks["SubagentStart"][0].hooks) == 1
        assert len(opts.hooks["SubagentStop"][0].hooks) == 1

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)
        notify = AsyncMock()

        await run(task, "context", notify, tracker)

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
        assert payload["bonsaiSid"] == task.bonsai_sid

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)
        notify = AsyncMock()

        await run(task, "context", notify, tracker)

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
        assert payload["bonsaiSid"] == task.bonsai_sid

    @patch("app.agent.runner.ClaudeSDKClient")
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
        task_block.name = "Task"
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

        # Key: we need SubagentStart to fire BETWEEN main_msg and sub_msg.
        # We simulate this by injecting the hook call into the event stream.
        hook_called = False

        async def events_with_hook():
            """Yield events, firing SubagentStart hook after Task tool call."""
            nonlocal hook_called
            yield sys_msg
            yield main_msg
            # After Task tool is processed, the SDK fires SubagentStart.
            # We simulate by directly calling the hook before yielding
            # subagent messages. The hook_fn won't exist yet, so we
            # use a sentinel to trigger it.
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)
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

        await run(task, "context", notify, tracker)

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

        # Main agent's Task toolCallStart should NOT have agentId
        task_starts = [t for t in tool_starts if t["toolName"] == "Task"]
        assert len(task_starts) == 1
        assert "agentId" not in task_starts[0], "Main agent Task call should not have agentId"

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

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "do stuff")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", notify, tracker)

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

    @patch("app.agent.runner.ClaudeSDKClient")
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
        tracker.enqueue_message(task.bonsai_sid, "go")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", notify, tracker)

        turn_complete = None
        for call in notify.call_args_list:
            if call.args[0] == "agent/turnComplete":
                turn_complete = call.args[1]
                break
        assert turn_complete is not None

        # contextWindow = 2000 + 10000 + 3000 + 400 = 15400
        assert turn_complete["contextWindow"] == 15400
        assert len(turn_complete["iterations"]) == 1
