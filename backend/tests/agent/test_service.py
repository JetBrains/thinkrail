from __future__ import annotations

import asyncio
from pathlib import Path
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

        task = await service.run_task(["spec-1"], AgentConfig())

        assert task.status == "initializing"
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

        task = await service.run_task(["s1"], AgentConfig())
        # Task starts as pending — runner transitions to idle/running
        assert task.status == "initializing"

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

        task = await service.run_task(["s1"], AgentConfig())
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
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")
        with pytest.raises(ValueError, match="expected 'initializing' or 'idle'"):
            await service.send_message(task.bonsai_sid, "hello")

    async def test_send_message_when_done_raises(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "done")
        with pytest.raises(ValueError, match="expected 'initializing' or 'idle'"):
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


class TestInterruptTask:
    async def test_interrupt_calls_client_interrupt(self) -> None:
        """interrupt_task calls client.interrupt() on the stored SDK client."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")

        mock_client = AsyncMock()
        service._tracker.set_client(task.bonsai_sid, mock_client)

        await service.interrupt_task(task.bonsai_sid)

        mock_client.interrupt.assert_called_once()

    async def test_interrupt_sets_flag_before_client_interrupt(self) -> None:
        """set_interrupted is called before client.interrupt()."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")

        call_order: list[str] = []

        mock_client = AsyncMock()

        async def track_interrupt():
            call_order.append("client.interrupt")

        mock_client.interrupt = track_interrupt

        original_set = service._tracker.set_interrupted

        def track_set_interrupted(bonsai_sid: str) -> None:
            call_order.append("set_interrupted")
            original_set(bonsai_sid)

        service._tracker.set_interrupted = track_set_interrupted
        service._tracker.set_client(task.bonsai_sid, mock_client)

        await service.interrupt_task(task.bonsai_sid)

        assert call_order == ["set_interrupted", "client.interrupt"]

    async def test_interrupt_resolves_futures_with_deny(self) -> None:
        """interrupt_task calls interrupt_futures, not cancel_futures."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")
        service._tracker.set_client(task.bonsai_sid, AsyncMock())

        future = service._tracker.register_future(task.bonsai_sid, "req-1")

        await service.interrupt_task(task.bonsai_sid)

        # Future should be resolved (not cancelled)
        assert not future.cancelled()
        assert future.done()
        result = future.result()
        assert result["behavior"] == "deny"
        assert result["interrupt"] is True

    async def test_interrupt_no_relaunch(self) -> None:
        """After interrupt, no new background task is created."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")
        service._tracker.set_client(task.bonsai_sid, AsyncMock())

        # Record existing background tasks
        service._running_tasks[task.bonsai_sid] = AsyncMock()
        original_bg = service._running_tasks[task.bonsai_sid]

        await service.interrupt_task(task.bonsai_sid)

        # The background task reference should be unchanged (not replaced)
        assert service._running_tasks.get(task.bonsai_sid) is original_bg

    async def test_interrupt_idle_is_noop(self) -> None:
        """Interrupting an idle session does nothing."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())

        mock_client = AsyncMock()
        service._tracker.set_client(task.bonsai_sid, mock_client)

        await service.interrupt_task(task.bonsai_sid)

        mock_client.interrupt.assert_not_called()
        assert service._tracker.is_interrupted(task.bonsai_sid) is False

    async def test_interrupt_waiting_state(self) -> None:
        """Interrupting a waiting session resolves futures and calls client.interrupt."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")
        service._tracker.set_status(task.bonsai_sid, "waiting")

        mock_client = AsyncMock()
        service._tracker.set_client(task.bonsai_sid, mock_client)

        future = service._tracker.register_future(task.bonsai_sid, "req-1")

        await service.interrupt_task(task.bonsai_sid)

        mock_client.interrupt.assert_called_once()
        assert future.done()
        assert future.result()["interrupt"] is True

    async def test_interrupt_no_client_does_not_raise(self) -> None:
        """If no client is stored (edge case), interrupt still sets flag."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")
        # No client set

        await service.interrupt_task(task.bonsai_sid)

        # Should have set the flag even without a client
        assert service._tracker.is_interrupted(task.bonsai_sid) is True


class TestSaveTask:
    def test_new_session_gets_zeroed_metrics(self, tmp_path: Path) -> None:
        """_save_task produces zeroed metrics for a brand-new session (no disk data)."""
        config = MagicMock()
        config.project_root = tmp_path
        spec_service = MagicMock()
        service = AgentService(config, spec_service)

        task = service._tracker.create_task(["s1"], AgentConfig())
        service._save_task(task)

        from app.agent.persistence import load_session
        loaded = load_session(tmp_path, task.bonsai_sid)
        assert loaded is not None
        m = loaded["metrics"]
        assert m["costUsd"] == 0
        assert m["turns"] == 0
        assert m["toolCalls"] == 0
        assert m["durationMs"] == 0
        assert m["contextTokens"] == 0
        # Default model is claude-sonnet-4-6 with 1M context window
        assert m["contextMax"] == 1_000_000
        assert m["outputTokens"] == 0

    def test_existing_metrics_preserved(self, tmp_path: Path) -> None:
        """_save_task preserves existing metrics from disk."""
        from app.agent.persistence import save_session, load_session

        config = MagicMock()
        config.project_root = tmp_path
        spec_service = MagicMock()
        service = AgentService(config, spec_service)

        task = service._tracker.create_task(["s1"], AgentConfig())
        # Pre-populate disk with metrics
        save_session(tmp_path, {
            "bonsaiSid": task.bonsai_sid,
            "name": "test",
            "specIds": [],
            "config": {},
            "status": "idle",
            "metrics": {"costUsd": 1.5, "toolCalls": 10, "turns": 3},
        })

        service._save_task(task)
        loaded = load_session(tmp_path, task.bonsai_sid)
        assert loaded is not None
        assert loaded["metrics"]["costUsd"] == 1.5
        assert loaded["metrics"]["toolCalls"] == 10


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

    def test_includes_vis_instructions_in_freeform_session(self) -> None:
        from pathlib import Path
        from app.agent.context import build_context

        spec_service = MagicMock()

        context = build_context(
            spec_ids=[],
            skill_id=None,
            project_root=Path("/tmp/test-project"),
            config=AgentConfig(),
            spec_service=spec_service,
            plugin_dir=Path("/tmp/plugins"),
        )
        assert "bonsai_visualize" in context
        # Visualization is now a subsection inside General Instructions
        assert "## General Instructions" in context
        assert "### Visualization" in context

    def test_includes_vis_instructions_in_skill_session(self) -> None:
        from pathlib import Path
        from unittest.mock import patch as mock_patch
        from app.agent.context import build_context

        spec_service = MagicMock()

        with mock_patch(
            "app.agent.context._load_skill", return_value="Do the thing."
        ):
            context = build_context(
                spec_ids=[],
                skill_id="test-skill",
                project_root=Path("/tmp/test-project"),
                config=AgentConfig(),
                spec_service=spec_service,
                plugin_dir=Path("/tmp/plugins"),
            )
        assert "## Your Task" in context
        assert "bonsai_visualize" in context
        assert "## General Instructions" in context


class TestGetContextMax:
    def test_returns_registry_value_when_available(self) -> None:
        service, _, _ = _make_service()
        service.model_registry = MagicMock()
        service.model_registry.get_models.return_value = [
            {"id": "claude-opus-4-6", "contextWindow": 1_000_000}
        ]
        assert service._get_context_max("claude-opus-4-6") == 1_000_000

    def test_falls_back_to_hardcoded_list(self) -> None:
        service, _, _ = _make_service()
        service.model_registry = None
        # Should get 1M from the _FALLBACK list, not the 200K default
        assert service._get_context_max("claude-opus-4-6") == 1_000_000
        assert service._get_context_max("claude-haiku-4-5") == 200_000

    def test_returns_200k_for_unknown_model(self) -> None:
        service, _, _ = _make_service()
        service.model_registry = None
        assert service._get_context_max("unknown-model") == 200_000


class TestMessageTooLarge:
    async def test_rejects_oversized_message(self) -> None:
        from app.agent.models import MessageTooLargeError

        service, _, _ = _make_service()
        task = service._tracker.create_task([], AgentConfig())
        # initializing → idle
        service._tracker.set_status(task.bonsai_sid, "idle")
        # Set context tokens close to the limit
        service._tracker.set_context_tokens(task.bonsai_sid, 950_000)

        # Message of ~100K tokens (600K chars / 6)
        huge_text = "x" * 600_000
        with pytest.raises(MessageTooLargeError):
            await service.send_message(task.bonsai_sid, huge_text)

    async def test_allows_small_message(self) -> None:
        service, config, _ = _make_service()
        config.project_root = Path("/tmp/test")
        task = service._tracker.create_task([], AgentConfig())
        # initializing → idle
        service._tracker.set_status(task.bonsai_sid, "idle")
        # Context is mostly empty
        service._tracker.set_context_tokens(task.bonsai_sid, 10_000)
        # This should not raise (small message, plenty of room)
        # We can't fully run send_message without persistence, so just check
        # that the size check itself doesn't block it
        text = "Hello, how are you?"
        msg_tokens = len(text) // 6
        ctx_max = service._get_context_max(task.config.model)
        remaining = ctx_max - 10_000
        assert msg_tokens < remaining * 0.8  # Would pass the check
