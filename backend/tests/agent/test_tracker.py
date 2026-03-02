from __future__ import annotations

import asyncio

import pytest

from app.agent.models import AgentConfig
from app.agent.tracker import FutureNotFoundError, TaskNotFoundError, Tracker


class TestTaskLifecycle:
    def test_create_task(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["spec-1"], AgentConfig())
        assert task.status == "pending"
        assert task.spec_ids == ["spec-1"]
        assert len(task.id) > 0

    def test_get_task(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        retrieved = tracker.get_task(task.id)
        assert retrieved.id == task.id

    def test_get_task_not_found(self) -> None:
        tracker = Tracker()
        with pytest.raises(TaskNotFoundError):
            tracker.get_task("nonexistent")

    def test_list_tasks(self) -> None:
        tracker = Tracker()
        tracker.create_task(["s1"], AgentConfig())
        tracker.create_task(["s2"], AgentConfig())
        tasks = tracker.list_tasks()
        assert len(tasks) == 2

    def test_set_status_valid_transition(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")
        assert tracker.get_task(task.id).status == "running"

    def test_set_status_invalid_transition(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        with pytest.raises(ValueError, match="Invalid transition"):
            tracker.set_status(task.id, "done")  # pending -> done not allowed

    def test_set_status_updates_timestamp(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        original_updated = task.updated
        tracker.set_status(task.id, "running")
        assert tracker.get_task(task.id).updated >= original_updated

    def test_set_session_id(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_session_id(task.id, "sess-123")
        assert tracker.get_task(task.id).session_id == "sess-123"

    def test_full_lifecycle(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        assert task.status == "pending"
        tracker.set_status(task.id, "running")
        assert tracker.get_task(task.id).status == "running"
        tracker.set_status(task.id, "done")
        assert tracker.get_task(task.id).status == "done"

    def test_error_lifecycle(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.id, "running")
        tracker.set_status(task.id, "error")
        assert tracker.get_task(task.id).status == "error"


class TestFutureManagement:
    async def test_register_and_resolve(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        future = tracker.register_future(task.id, "req-1")
        tracker.resolve_future(task.id, "req-1", {"answer": "yes"})
        result = await future
        assert result == {"answer": "yes"}

    async def test_resolve_nonexistent_raises(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        with pytest.raises(FutureNotFoundError):
            tracker.resolve_future(task.id, "no-such-request", {})

    async def test_register_future_for_nonexistent_task(self) -> None:
        tracker = Tracker()
        with pytest.raises(TaskNotFoundError):
            tracker.register_future("no-task", "req-1")

    async def test_cancel_futures(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        f1 = tracker.register_future(task.id, "req-1")
        f2 = tracker.register_future(task.id, "req-2")
        tracker.cancel_futures(task.id)
        assert f1.cancelled()
        assert f2.cancelled()

    async def test_timeout_cancels_future(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        future = tracker.register_future(task.id, "req-1", timeout_seconds=0.05)
        await asyncio.sleep(0.1)
        assert future.cancelled()

    async def test_resolve_before_timeout(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        future = tracker.register_future(task.id, "req-1", timeout_seconds=5.0)
        tracker.resolve_future(task.id, "req-1", {"ok": True})
        result = await future
        assert result == {"ok": True}
