from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.models import AgentConfig, AgentResult, AgentTask
from app.agent.runner import run
from app.agent.tracker import Tracker


def _setup_mock_client(MockClient: MagicMock, messages: list) -> AsyncMock:
    """Configure MockClient to yield the given message sequence."""
    mock_instance = AsyncMock()

    async def fake_receive():
        for msg in messages:
            yield msg

    # receive_response is an async generator, so calling it should return
    # the async iterator directly (not wrapped in a coroutine).
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


class TestRunHappyPath:
    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_happy_path_returns_result(self, MockClient: MagicMock) -> None:
        """Full run: session_start -> text_delta -> tool_call_start -> tool_call_end -> done."""
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

        tracker = Tracker()
        task = tracker.create_task(["spec-1"], AgentConfig())
        tracker.set_status(task.id, "running")
        notify = AsyncMock()

        result = await run(task, "spec context here", notify, tracker)

        assert isinstance(result, AgentResult)
        assert result.task_id == task.id
        assert result.session_id == "sess-1"
        assert result.result == "Task completed"
        assert result.turns == 3
        assert result.cost_usd == 0.05

        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/sessionStart" in method_calls
        assert "agent/textDelta" in method_calls
        assert "agent/toolCallStart" in method_calls
        assert "agent/toolCallEnd" in method_calls
        assert "agent/done" in method_calls

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

        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")

        await run(task, "context", AsyncMock(), tracker)
        assert tracker.get_task(task.id).session_id == "sess-42"


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

        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")
        notify = AsyncMock()

        await run(task, "context", notify, tracker)

        opts = captured["options"]
        assert opts.can_use_tool is not None

        context = MagicMock()

        async def resolve_after_register():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.id, {})):
                tracker.resolve_future(
                    task.id, req_id, {"questions": [], "answers": {"Q?": "A"}}
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

        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")

        await run(task, "context", AsyncMock(), tracker)

        opts = captured["options"]
        context = MagicMock()

        async def resolve_allow():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.id, {})):
                tracker.resolve_future(task.id, req_id, {"behavior": "allow"})
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

        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")

        await run(task, "context", AsyncMock(), tracker)

        opts = captured["options"]
        context = MagicMock()

        async def resolve_deny():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.id, {})):
                tracker.resolve_future(
                    task.id,
                    req_id,
                    {"behavior": "deny", "message": "Not allowed", "interrupt": True},
                )
                break

        asyncio.get_event_loop().create_task(resolve_deny())

        result = await opts.can_use_tool("Bash", {"command": "rm -rf /"}, context)
        assert result.behavior == "deny"
        assert result.message == "Not allowed"
        assert result.interrupt is True


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

        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")
        notify = AsyncMock()

        result = await run(task, "context", notify, tracker)

        assert result.result == "Failed"
        method_calls = [call.args[0] for call in notify.call_args_list]
        assert "agent/error" in method_calls

    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_sdk_exception_propagates(self, MockClient: MagicMock) -> None:
        mock_instance = AsyncMock()
        mock_instance.query = AsyncMock(side_effect=RuntimeError("SDK crash"))

        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")

        with pytest.raises(RuntimeError, match="SDK crash"):
            await run(task, "context", AsyncMock(), tracker)
