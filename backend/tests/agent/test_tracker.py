from __future__ import annotations

import asyncio

import pytest

from app.agent.models import AgentConfig
from app.agent.tracker import (
    END_SIGNAL,
    FutureNotFoundError,
    TaskNotFoundError,
    Tracker,
)


class TestTaskLifecycle:
    def test_create_task(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["spec-1"], AgentConfig())
        assert task.status == "idle"
        assert task.spec_ids == ["spec-1"]
        assert len(task.bonsai_sid) > 0

    def test_get_task(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        retrieved = tracker.get_task(task.bonsai_sid)
        assert retrieved.bonsai_sid == task.bonsai_sid

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
        tracker.set_status(task.bonsai_sid, "running")
        assert tracker.get_task(task.bonsai_sid).status == "running"

    def test_set_status_invalid_transition(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.bonsai_sid, "done")
        with pytest.raises(ValueError, match="Invalid transition"):
            tracker.set_status(task.bonsai_sid, "running")  # done -> running not allowed

    def test_set_status_updates_timestamp(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        original_updated = task.updated
        tracker.set_status(task.bonsai_sid, "running")
        assert tracker.get_task(task.bonsai_sid).updated >= original_updated

    def test_set_session_id(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_session_id(task.bonsai_sid, "sess-123")
        assert tracker.get_task(task.bonsai_sid).session_id == "sess-123"

    def test_full_lifecycle(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        assert task.status == "idle"
        tracker.set_status(task.bonsai_sid, "running")
        assert tracker.get_task(task.bonsai_sid).status == "running"
        tracker.set_status(task.bonsai_sid, "idle")
        assert tracker.get_task(task.bonsai_sid).status == "idle"
        tracker.set_status(task.bonsai_sid, "done")
        assert tracker.get_task(task.bonsai_sid).status == "done"

    def test_error_lifecycle(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.bonsai_sid, "running")
        tracker.set_status(task.bonsai_sid, "error")
        assert tracker.get_task(task.bonsai_sid).status == "error"

    def test_idle_to_running(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.bonsai_sid, "running")
        assert tracker.get_task(task.bonsai_sid).status == "running"

    def test_running_to_idle(self) -> None:
        """Turn completes -> back to idle."""
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.bonsai_sid, "running")
        tracker.set_status(task.bonsai_sid, "idle")
        assert tracker.get_task(task.bonsai_sid).status == "idle"

    def test_idle_to_done(self) -> None:
        """Graceful session close from idle."""
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_status(task.bonsai_sid, "done")
        assert tracker.get_task(task.bonsai_sid).status == "done"


class TestMessageQueue:
    def test_create_task_creates_queue(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        assert task.bonsai_sid in tracker._queues

    def test_enqueue_message(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.enqueue_message(task.bonsai_sid, "hello")
        assert not tracker._queues[task.bonsai_sid].empty()

    def test_enqueue_message_nonexistent_task(self) -> None:
        tracker = Tracker()
        with pytest.raises(TaskNotFoundError):
            tracker.enqueue_message("no-task", "hello")

    def test_enqueue_end_signal(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.enqueue_end_signal(task.bonsai_sid)
        assert not tracker._queues[task.bonsai_sid].empty()

    def test_enqueue_end_signal_nonexistent_task(self) -> None:
        tracker = Tracker()
        with pytest.raises(TaskNotFoundError):
            tracker.enqueue_end_signal("no-task")

    async def test_get_next_message_text(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.enqueue_message(task.bonsai_sid, "hello world")
        msg = await tracker.get_next_message(task.bonsai_sid)
        assert msg == "hello world"

    async def test_get_next_message_end_signal(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.enqueue_end_signal(task.bonsai_sid)
        msg = await tracker.get_next_message(task.bonsai_sid)
        assert msg is END_SIGNAL

    async def test_get_next_message_ordering(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.enqueue_message(task.bonsai_sid, "first")
        tracker.enqueue_message(task.bonsai_sid, "second")
        tracker.enqueue_end_signal(task.bonsai_sid)
        assert await tracker.get_next_message(task.bonsai_sid) == "first"
        assert await tracker.get_next_message(task.bonsai_sid) == "second"
        assert await tracker.get_next_message(task.bonsai_sid) is END_SIGNAL

    async def test_get_next_message_nonexistent_task(self) -> None:
        tracker = Tracker()
        with pytest.raises(TaskNotFoundError):
            await tracker.get_next_message("no-task")

    async def test_get_next_message_blocks_until_enqueued(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())

        async def delayed_enqueue():
            await asyncio.sleep(0.05)
            tracker.enqueue_message(task.bonsai_sid, "delayed")

        asyncio.get_event_loop().create_task(delayed_enqueue())
        msg = await tracker.get_next_message(task.bonsai_sid)
        assert msg == "delayed"


class TestFutureManagement:
    async def test_register_and_resolve(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        future = tracker.register_future(task.bonsai_sid, "req-1")
        tracker.resolve_future(task.bonsai_sid, "req-1", {"answer": "yes"})
        result = await future
        assert result == {"answer": "yes"}

    async def test_resolve_nonexistent_logs_warning(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        # Should not raise — logs a warning and returns silently
        tracker.resolve_future(task.bonsai_sid, "no-such-request", {})

    async def test_register_future_for_nonexistent_task(self) -> None:
        tracker = Tracker()
        with pytest.raises(TaskNotFoundError):
            tracker.register_future("no-task", "req-1")

    async def test_cancel_futures(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        f1 = tracker.register_future(task.bonsai_sid, "req-1")
        f2 = tracker.register_future(task.bonsai_sid, "req-2")
        tracker.cancel_futures(task.bonsai_sid)
        assert f1.cancelled()
        assert f2.cancelled()

    async def test_timeout_auto_denies_future(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        future = tracker.register_future(task.bonsai_sid, "req-1", timeout_seconds=0.05)
        await asyncio.sleep(0.1)
        assert future.done()
        result = future.result()
        assert result["behavior"] == "deny"
        assert "Timed out" in result["message"]
        assert result["interrupt"] is False

    async def test_resolve_before_timeout(self) -> None:
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        future = tracker.register_future(task.bonsai_sid, "req-1", timeout_seconds=5.0)
        tracker.resolve_future(task.bonsai_sid, "req-1", {"ok": True})
        result = await future
        assert result == {"ok": True}


class TestInterruptManagement:
    def test_interrupt_flag_lifecycle(self) -> None:
        """set_interrupted → is_interrupted True → clear → False."""
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())

        assert tracker.is_interrupted(task.bonsai_sid) is False

        tracker.set_interrupted(task.bonsai_sid)
        assert tracker.is_interrupted(task.bonsai_sid) is True

        tracker.clear_interrupted(task.bonsai_sid)
        assert tracker.is_interrupted(task.bonsai_sid) is False

    def test_is_interrupted_unknown_session(self) -> None:
        """Unknown session returns False, doesn't raise."""
        tracker = Tracker()
        assert tracker.is_interrupted("nonexistent") is False

    def test_clear_interrupted_unknown_session(self) -> None:
        """Clearing an unknown session is a no-op."""
        tracker = Tracker()
        tracker.clear_interrupted("nonexistent")  # should not raise

    async def test_interrupt_futures_resolves_with_deny(self) -> None:
        """interrupt_futures resolves with deny+interrupt=True, not cancel."""
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        f1 = tracker.register_future(task.bonsai_sid, "req-1")
        f2 = tracker.register_future(task.bonsai_sid, "req-2")

        tracker.interrupt_futures(task.bonsai_sid)

        # Futures should be resolved (not cancelled)
        assert not f1.cancelled()
        assert not f2.cancelled()
        assert f1.done()
        assert f2.done()

        r1 = f1.result()
        assert r1["behavior"] == "deny"
        assert r1["message"] == "Interrupted"
        assert r1["interrupt"] is True

        r2 = f2.result()
        assert r2["behavior"] == "deny"
        assert r2["interrupt"] is True

    async def test_interrupt_futures_empty_is_noop(self) -> None:
        """interrupt_futures on session with no futures doesn't raise."""
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.interrupt_futures(task.bonsai_sid)  # should not raise

    async def test_interrupt_futures_skips_already_done(self) -> None:
        """Already-resolved futures are not touched by interrupt_futures."""
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        f1 = tracker.register_future(task.bonsai_sid, "req-1")
        tracker.resolve_future(task.bonsai_sid, "req-1", {"ok": True})

        f2 = tracker.register_future(task.bonsai_sid, "req-2")
        tracker.interrupt_futures(task.bonsai_sid)

        assert f1.result() == {"ok": True}  # unchanged
        assert f2.result()["behavior"] == "deny"  # interrupted

    def test_remove_task_clears_interrupted(self) -> None:
        """remove_task also cleans up the interrupt flag."""
        tracker = Tracker()
        task = tracker.create_task(["s1"], AgentConfig())
        tracker.set_interrupted(task.bonsai_sid)
        assert tracker.is_interrupted(task.bonsai_sid) is True

        tracker.remove_task(task.bonsai_sid)
        assert tracker.is_interrupted(task.bonsai_sid) is False
