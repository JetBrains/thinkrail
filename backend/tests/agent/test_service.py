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
            task_id="t1",
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

        assert task.status == "running"
        assert task.spec_ids == ["spec-1"]

        # Wait for background task to complete
        await asyncio.sleep(0.05)

        # Task should now be done
        assert service.get_task(task.id).status == "done"
        mock_run.assert_called_once()

    @patch("app.agent.service.run")
    async def test_run_task_returns_immediately(self, mock_run: AsyncMock) -> None:
        # Make run slow to prove we don't block
        async def slow_run(*args, **kwargs):
            await asyncio.sleep(0.5)
            return AgentResult(
                task_id="t1", session_id="s1", result="done",
                cost_usd=0.0, turns=1, duration_ms=500,
            )

        mock_run.side_effect = slow_run

        service, _, spec_service = _make_service()
        spec_service.get_spec.return_value = _make_spec_detail("s1", "T", "C")

        task = await service.run_task(["s1"], AgentConfig(), AsyncMock())
        # Task is running, not done — proves we returned immediately
        assert task.status == "running"

        # Clean up: cancel the background task
        await service.interrupt_task(task.id)

    @patch("app.agent.service.run")
    async def test_error_sets_status(self, mock_run: AsyncMock) -> None:
        mock_run.side_effect = RuntimeError("boom")

        service, _, spec_service = _make_service()
        spec_service.get_spec.return_value = _make_spec_detail("s1", "T", "C")

        task = await service.run_task(["s1"], AgentConfig(), AsyncMock())
        await asyncio.sleep(0.05)

        assert service.get_task(task.id).status == "error"


class TestInterruptTask:
    @patch("app.agent.service.run")
    async def test_interrupt_cancels_and_sets_error(self, mock_run: AsyncMock) -> None:
        async def long_run(*args, **kwargs):
            await asyncio.sleep(10)
            return AgentResult(
                task_id="t1", session_id="s1", result="done",
                cost_usd=0.0, turns=1, duration_ms=10000,
            )

        mock_run.side_effect = long_run

        service, _, spec_service = _make_service()
        spec_service.get_spec.return_value = _make_spec_detail("s1", "T", "C")

        task = await service.run_task(["s1"], AgentConfig(), AsyncMock())
        assert task.status == "running"

        await service.interrupt_task(task.id)
        assert service.get_task(task.id).status == "error"


class TestGetAndListTasks:
    def test_get_task(self) -> None:
        service, _, _ = _make_service()
        # Create directly via tracker for unit test
        service._tracker.create_task(["s1"], AgentConfig())
        tasks = service.list_tasks()
        assert len(tasks) == 1

        retrieved = service.get_task(tasks[0].id)
        assert retrieved.id == tasks[0].id

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
        future = service._tracker.register_future(task.id, "req-1")

        await service.respond(task.id, "req-1", {"answer": "yes"})
        result = await future
        assert result == {"answer": "yes"}


class TestBuildContext:
    def test_builds_context_from_specs(self) -> None:
        service, _, spec_service = _make_service()
        spec_service.get_spec.side_effect = [
            _make_spec_detail("s1", "First Spec", "Content one"),
            _make_spec_detail("s2", "Second Spec", "Content two"),
        ]

        context = service._build_context(["s1", "s2"])
        assert "# First Spec" in context
        assert "Content one" in context
        assert "# Second Spec" in context
        assert "Content two" in context
        assert "---" in context
