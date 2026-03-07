"""Tests for native SDK resume (--resume <sessionId>) in the agent module."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.models import AgentConfig, AgentResult
from app.agent.runner import run
from app.agent.service import AgentService
from app.agent.tracker import Tracker
from app.spec.models import SpecDetail


def _make_spec_detail(id: str, title: str, content: str) -> SpecDetail:
    return SpecDetail(
        id=id, type="module-design", path=f"specs/{id}/README.md",
        status="active", title=title, content=content,
    )


def _make_service() -> tuple[AgentService, MagicMock, MagicMock]:
    config = MagicMock()
    spec_service = MagicMock()
    service = AgentService(config, spec_service)
    return service, config, spec_service


def _setup_capturing_client(MockClient: MagicMock, messages: list) -> dict:
    captured: dict = {}
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


# -- Runner tests: resume_session_id param ------------------------------------


class TestRunnerResumeParam:
    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_resume_session_id_passed_to_options(self, MockClient: MagicMock) -> None:
        """When resume_session_id is set, ClaudeAgentOptions.resume gets the value."""
        from claude_agent_sdk import ResultMessage, SystemMessage

        sys_msg = MagicMock(spec=SystemMessage)
        sys_msg.subtype = "init"
        sys_msg.data = {"session_id": "new-sess"}

        result_msg = MagicMock(spec=ResultMessage)
        result_msg.session_id = "new-sess"
        result_msg.result = "ok"
        result_msg.is_error = False
        result_msg.num_turns = 1
        result_msg.total_cost_usd = 0.0
        result_msg.usage = {}

        captured = _setup_capturing_client(MockClient, [sys_msg, result_msg])

        tracker = Tracker()
        task = tracker.create_task(["spec-1"], AgentConfig())
        tracker.enqueue_message(task.bonsai_sid, "hello")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", AsyncMock(), tracker, resume_session_id="old-sess-123")

        opts = captured["options"]
        assert opts.resume == "old-sess-123"

    @patch("app.agent.runner.ClaudeSDKClient")
    async def test_no_resume_by_default(self, MockClient: MagicMock) -> None:
        """When resume_session_id is not set, ClaudeAgentOptions.resume is None."""
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
        task = tracker.create_task(["spec-1"], AgentConfig())
        tracker.enqueue_message(task.bonsai_sid, "hello")
        tracker.enqueue_end_signal(task.bonsai_sid)

        await run(task, "context", AsyncMock(), tracker)

        opts = captured["options"]
        assert opts.resume is None


# -- Service tests: continue_session ------------------------------------------


class TestContinueSession:
    @patch("app.agent.service.run")
    @patch("app.agent.service.load_session")
    @patch("app.agent.service.save_session")
    async def test_continue_uses_native_resume(
        self, mock_save: MagicMock, mock_load: MagicMock, mock_run: AsyncMock
    ) -> None:
        """continue_session passes stored sessionId to runner as resume_session_id."""
        mock_load.return_value = {
            "bonsaiSid": "sid-1",
            "name": "test session",
            "skillId": None,
            "specIds": ["spec-1"],
            "config": {"model": "claude-sonnet-4-6", "maxTurns": 25, "permissionMode": "default", "streamText": True},
            "status": "done",
            "sessionId": "cli-session-abc",
            "createdAt": "2026-03-07T00:00:00",
            "updatedAt": "2026-03-07T00:00:00",
            "events": [],
        }
        mock_run.return_value = AgentResult(
            bonsai_sid="sid-1", session_id="cli-session-new",
            result="done", cost_usd=0.0, turns=0, duration_ms=0,
        )

        service, config, spec_service = _make_service()
        spec_service.get_spec.return_value = _make_spec_detail("spec-1", "T", "C")
        notify = AsyncMock()

        task = await service.continue_session("sid-1", notify)
        assert task.bonsai_sid == "sid-1"
        assert task.status == "idle"

        # Wait for background task
        await asyncio.sleep(0.05)

        # Verify run was called with resume_session_id
        mock_run.assert_called_once()
        call_kwargs = mock_run.call_args
        assert call_kwargs.kwargs.get("resume_session_id") == "cli-session-abc"

    @patch("app.agent.service.load_session")
    async def test_continue_missing_session_id_raises(self, mock_load: MagicMock) -> None:
        """If stored session has no sessionId, raise ValueError."""
        mock_load.return_value = {
            "bonsaiSid": "sid-1",
            "name": "old session",
            "skillId": None,
            "specIds": [],
            "config": {},
            "status": "done",
            "sessionId": None,
            "events": [],
        }

        service, _, _ = _make_service()

        with pytest.raises(ValueError, match="no stored sessionId"):
            await service.continue_session("sid-1", AsyncMock())

    @patch("app.agent.service.load_session")
    async def test_continue_session_not_found_raises(self, mock_load: MagicMock) -> None:
        """If session doesn't exist on disk, raise ValueError."""
        mock_load.return_value = None

        service, _, _ = _make_service()

        with pytest.raises(ValueError, match="not found on disk"):
            await service.continue_session("nonexistent", AsyncMock())

    async def test_continue_already_running_raises(self) -> None:
        """If session is already running, raise ValueError."""
        service, _, _ = _make_service()
        service._running_tasks["sid-1"] = MagicMock()

        with pytest.raises(ValueError, match="already running"):
            await service.continue_session("sid-1", AsyncMock())

    @patch("app.agent.service.load_session")
    async def test_continue_empty_session_id_raises(self, mock_load: MagicMock) -> None:
        """Empty string sessionId should also raise."""
        mock_load.return_value = {
            "bonsaiSid": "sid-1",
            "name": "old",
            "skillId": None,
            "specIds": [],
            "config": {},
            "status": "done",
            "sessionId": "",
            "events": [],
        }

        service, _, _ = _make_service()

        with pytest.raises(ValueError, match="no stored sessionId"):
            await service.continue_session("sid-1", AsyncMock())
