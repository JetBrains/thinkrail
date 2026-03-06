from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agent.models import AgentConfig, AgentResult
from app.agent.service import AgentService
from app.agent.tracker import TaskNotFoundError
from app.spec.models import SpecDetail


def _make_spec_detail(id: str, title: str, content: str) -> SpecDetail:
    return SpecDetail(
        id=id,
        type="module-design",
        path=f"specs/{id}/README.md",
        status="active",
        title=title,
        content=content,
    )


def _make_service() -> tuple[AgentService, MagicMock, MagicMock]:
    config = MagicMock()
    spec_service = MagicMock()
    service = AgentService(config, spec_service)
    return service, config, spec_service


class TestRunTask:
    @patch("app.agent.service.run")
    async def test_creates_task_and_launches_background(self, mock_run: AsyncMock) -> None:
        mock_run.return_value = AgentResult(
            bonsai_sid="t1",
            session_id="s1",
            result="done",
            cost_usd=0.0,
            turns=1,
            duration_ms=100,
        )

        service, _, spec_service = _make_service()
        spec_service.get_spec.return_value = _make_spec_detail(
            "spec-1", "Test Spec", "# Content"
        )

        notify = AsyncMock()
        task = await service.run_task(["spec-1"], AgentConfig(), notify)

        assert task.status == "idle"
        assert task.spec_ids == ["spec-1"]

        # Wait for background task to complete
        await asyncio.sleep(0.05)

        mock_run.assert_called_once()

    @patch("app.agent.service.run")
    async def test_run_task_returns_immediately(self, mock_run: AsyncMock) -> None:
        async def slow_run(*args, **kwargs):
            await asyncio.sleep(0.5)
            return AgentResult(
                bonsai_sid="t1", session_id="s1", result="done",
                cost_usd=0.0, turns=1, duration_ms=500,
            )

        mock_run.side_effect = slow_run

        service, _, spec_service = _make_service()
        spec_service.get_spec.return_value = _make_spec_detail("s1", "T", "C")

        task = await service.run_task(["s1"], AgentConfig(), AsyncMock())
        # Task starts as pending — runner transitions to idle/running
        assert task.status == "idle"

        # Clean up
        bg = service._running_tasks.get(task.bonsai_sid)
        if bg:
            bg.cancel()
            try:
                await bg
            except (asyncio.CancelledError, Exception):
                pass

    @patch("app.agent.service.run")
    async def test_error_sets_status(self, mock_run: AsyncMock) -> None:
        mock_run.side_effect = RuntimeError("boom")

        service, _, spec_service = _make_service()
        spec_service.get_spec.return_value = _make_spec_detail("s1", "T", "C")

        task = await service.run_task(["s1"], AgentConfig(), AsyncMock())
        await asyncio.sleep(0.05)

        assert task.status == "error"


class TestSendMessage:
    async def test_send_message_enqueues(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        # task starts idle — ready for messages

        await service.send_message(task.bonsai_sid, "hello")

        msg = service._tracker._queues[task.bonsai_sid].get_nowait()
        assert msg == "hello"

    async def test_send_message_while_running_raises(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "running")
        with pytest.raises(ValueError, match="expected 'idle'"):
            await service.send_message(task.bonsai_sid, "hello")

    async def test_send_message_when_done_raises(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "done")
        with pytest.raises(ValueError, match="expected 'idle'"):
            await service.send_message(task.bonsai_sid, "hello")


class TestEndSession:
    async def test_end_session_enqueues_signal(self) -> None:
        from app.agent.tracker import END_SIGNAL

        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        # task starts idle

        await service.end_session(task.bonsai_sid)

        msg = service._tracker._queues[task.bonsai_sid].get_nowait()
        assert msg is END_SIGNAL

    async def test_end_already_done_is_noop(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "done")

        # Should not raise
        await service.end_session(task.bonsai_sid)


class TestGetAndListTasks:
    def test_get_task(self) -> None:
        service, _, _ = _make_service()
        service._tracker.create_task(["s1"], AgentConfig())
        tasks = service.list_tasks()
        assert len(tasks) == 1

        retrieved = service.get_task(tasks[0].bonsai_sid)
        assert retrieved.bonsai_sid == tasks[0].bonsai_sid

    def test_get_nonexistent_raises(self) -> None:
        service, _, _ = _make_service()
        with pytest.raises(TaskNotFoundError):
            service.get_task("nonexistent")

    def test_list_empty(self) -> None:
        service, _, _ = _make_service()
        assert service.list_tasks() == []


class TestRespond:
    async def test_respond_delegates_to_tracker(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        future = service._tracker.register_future(task.bonsai_sid, "req-1")

        await service.respond(task.bonsai_sid, "req-1", {"answer": "yes"})
        result = await future
        assert result == {"answer": "yes"}


class TestRespondPersistsEvent:
    async def test_respond_saves_request_resolved_event(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        future = service._tracker.register_future(task.bonsai_sid, "req-1")

        service._save_event = MagicMock()
        await service.respond(task.bonsai_sid, "req-1", {"behavior": "allow"})

        service._save_event.assert_called_once_with(
            task.bonsai_sid,
            {
                "eventType": "requestResolved",
                "payload": {"requestId": "req-1", "response": {"behavior": "allow"}},
            },
        )
        result = await future
        assert result == {"behavior": "allow"}


class TestBuildContext:
    def test_builds_context_from_specs(self) -> None:
        from pathlib import Path
        from app.agent.context import build_context

        spec_service = MagicMock()
        spec_service.get_spec.side_effect = [
            _make_spec_detail("s1", "First Spec", "Content one"),
            _make_spec_detail("s2", "Second Spec", "Content two"),
        ]

        context = build_context(
            spec_ids=["s1", "s2"],
            skill_id=None,
            project_root=Path("/tmp/test-project"),
            config=AgentConfig(),
            spec_service=spec_service,
            plugin_dir=Path("/tmp/plugins"),
        )
        assert "### First Spec" in context
        assert "Content one" in context
        assert "### Second Spec" in context
        assert "Content two" in context
        assert "---" in context
        assert "## Project" in context
        assert "/tmp/test-project" in context
