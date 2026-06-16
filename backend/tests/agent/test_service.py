from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pathlib import Path

from app.agent.models import AgentTask, SessionConfig, AgentResult
from app.agent.service import AgentService
from app.agent.tracker import TaskNotFoundError
from app.board.service import BoardService
from app.core.config import load_config
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


def _install_mock_runtime(service: AgentService) -> MagicMock:
    """Install a mock IAgentRuntime under runtime_type='claude' on ``service``.

    The mock's ``interrupt`` mirrors ``ClaudeRuntime.interrupt`` — it pulls
    the SDK client off the tracker and calls ``client.interrupt()`` — so
    integration tests asserting on the stored client still hold.
    """
    from app.agent.runtime import LabeledOption, RuntimeCapabilities, RuntimeRegistry

    async def _interrupt(thinkrail_session, tracker):
        client = tracker.get_client(thinkrail_session.thinkrail_sid)
        if client is not None:
            await client.interrupt()

    caps = RuntimeCapabilities(
        permission_modes=[
            LabeledOption(value=v, label=v)
            for v in ("default", "acceptEdits", "bypassPermissions", "plan")
        ],
        effort_levels=[
            LabeledOption(value=v, label=v)
            for v in ("auto", "low", "medium", "high", "max")
        ],
        models=[
            LabeledOption(value=v, label=v)
            for v in ("claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001")
        ],
    )

    runtime = MagicMock()
    runtime.runtime_type = "claude"
    runtime.display_name = "Claude (test)"
    runtime.run_session = AsyncMock()
    runtime.interrupt = AsyncMock(side_effect=_interrupt)
    runtime.capabilities = MagicMock(return_value=caps)
    reg = RuntimeRegistry()
    reg.register(runtime)
    service.runtime_registry = reg
    return runtime


def _make_service() -> tuple[AgentService, MagicMock, MagicMock]:
    config = MagicMock()
    spec_service = MagicMock()
    spec_service.get_spec = AsyncMock()
    service = AgentService(config, spec_service)
    _install_mock_runtime(service)
    return service, config, spec_service


class TestRunTask:
    async def test_creates_task_and_launches_background(self) -> None:
        service, _, spec_service = _make_service()
        runtime = service.runtime_registry.get("claude")
        runtime.run_session = AsyncMock(return_value=AgentResult(
            thinkrail_sid="t1",
            session_id="s1",
            result="done",
            cost_usd=0.0,
            turns=1,
            duration_ms=100,
        ))
        spec_service.get_spec.return_value = _make_spec_detail(
            "spec-1", "Test Spec", "# Content"
        )

        thinkrail_session = await service.run_task(["spec-1"], SessionConfig())

        assert thinkrail_session.status == "initializing"
        assert thinkrail_session.spec_ids == ["spec-1"]

        # Wait for background thinkrail_session to complete
        await asyncio.sleep(0.05)

        runtime.run_session.assert_called_once()

    async def test_run_task_returns_immediately(self) -> None:
        async def slow_run(*args, **kwargs):
            await asyncio.sleep(0.5)
            return AgentResult(
                thinkrail_sid="t1", session_id="s1", result="done",
                cost_usd=0.0, turns=1, duration_ms=500,
            )

        service, _, spec_service = _make_service()
        runtime = service.runtime_registry.get("claude")
        runtime.run_session = AsyncMock(side_effect=slow_run)
        spec_service.get_spec.return_value = _make_spec_detail("s1", "T", "C")

        thinkrail_session = await service.run_task(["s1"], SessionConfig())
        # Task starts as initializing — runner transitions to idle/running
        assert thinkrail_session.status == "initializing"

        # Clean up
        bg = service._running_tasks.get(thinkrail_session.thinkrail_sid)
        if bg:
            bg.cancel()
            try:
                await bg
            except (asyncio.CancelledError, Exception):
                pass

    async def test_error_sets_status(self) -> None:
        service, _, spec_service = _make_service()
        runtime = service.runtime_registry.get("claude")
        runtime.run_session = AsyncMock(side_effect=RuntimeError("boom"))
        spec_service.get_spec.return_value = _make_spec_detail("s1", "T", "C")

        thinkrail_session = await service.run_task(["s1"], SessionConfig())
        await asyncio.sleep(0.05)

        assert thinkrail_session.status == "error"


class TestSendMessage:
    async def test_send_message_enqueues(self) -> None:
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        # thinkrail_session starts draft — ready for messages

        await service.send_message(thinkrail_session.thinkrail_sid, "hello")

        msg = service._tracker._queues[thinkrail_session.thinkrail_sid].get_nowait()
        assert msg == "hello"

    async def test_send_message_while_running_raises(self) -> None:
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")
        with pytest.raises(ValueError, match="expected 'initializing' or 'idle'"):
            await service.send_message(thinkrail_session.thinkrail_sid, "hello")

    async def test_send_message_when_finished_raises(self) -> None:
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "done")
        with pytest.raises(ValueError, match="expected 'initializing' or 'idle'"):
            await service.send_message(thinkrail_session.thinkrail_sid, "hello")


class TestEndSession:
    async def test_end_session_enqueues_signal(self) -> None:
        from app.agent.tracker import END_SIGNAL

        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")

        await service.end_session(thinkrail_session.thinkrail_sid)

        msg = service._tracker._queues[thinkrail_session.thinkrail_sid].get_nowait()
        assert msg is END_SIGNAL

    async def test_end_already_finished_is_noop(self) -> None:
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "done")

        # Should not raise
        await service.end_session(thinkrail_session.thinkrail_sid)

    async def test_end_session_resolves_pending_futures(self) -> None:
        """A waiting session must have its futures resolved so the runner
        can pick up the end signal — otherwise it stays blocked in the
        tool callback forever."""
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "waiting")
        future = service._tracker.register_future(thinkrail_session.thinkrail_sid, "req-1")

        await service.end_session(thinkrail_session.thinkrail_sid)

        assert future.done()
        result = future.result()
        assert result["behavior"] == "deny"
        assert result["interrupt"] is True


class TestTrashSession:
    async def test_trash_session_cancels_live_runner(self, tmp_path: Path) -> None:
        service, config, _ = _make_service()
        config.project_root = tmp_path
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")

        async def _run_forever() -> None:
            await asyncio.Event().wait()

        runner = asyncio.create_task(_run_forever())
        service._running_tasks[thinkrail_session.thinkrail_sid] = runner

        service.trash_session(thinkrail_session.thinkrail_sid)

        assert not service._tracker.has_task(thinkrail_session.thinkrail_sid)
        assert thinkrail_session.thinkrail_sid not in service._running_tasks
        with pytest.raises(asyncio.CancelledError):
            await runner

    async def test_trash_after_end_cancels_runner_before_final_status(
        self,
        tmp_path: Path,
    ) -> None:
        from app.agent.tracker import END_SIGNAL

        service, config, _ = _make_service()
        config.project_root = tmp_path
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        runtime = service.runtime_registry.get("claude")
        started = asyncio.Event()

        async def _wait_for_end_then_linger(*_args, **_kwargs) -> AgentResult:
            started.set()
            msg = await service._tracker.get_next_message(thinkrail_session.thinkrail_sid)
            assert msg is END_SIGNAL
            await asyncio.sleep(60)
            return AgentResult(
                thinkrail_sid=thinkrail_session.thinkrail_sid,
                session_id="sdk-session",
                result="done",
                cost_usd=0,
                turns=0,
                duration_ms=0,
            )

        runtime.run_session = AsyncMock(side_effect=_wait_for_end_then_linger)
        runner = asyncio.create_task(service._run_background(thinkrail_session, "context"))
        service._running_tasks[thinkrail_session.thinkrail_sid] = runner
        await started.wait()

        await service.end_session(thinkrail_session.thinkrail_sid)
        service.trash_session(thinkrail_session.thinkrail_sid)
        await runner

        assert not service._tracker.has_task(thinkrail_session.thinkrail_sid)
        assert thinkrail_session.thinkrail_sid not in service._running_tasks

    async def test_trash_does_not_resume_orchestrator(self, tmp_path: Path) -> None:
        service, board = _make_service_with_board(tmp_path)

        orchestrator = service._tracker.create_task([], SessionConfig(), name="orch")
        orch_sid = orchestrator.thinkrail_sid
        ticket = board.create_ticket("t", spawn_orchestrator=False)
        board.set_orchestrator(ticket.id, orch_sid)

        worker = service._tracker.create_task(["s1"], SessionConfig(), name="worker")
        worker.ticket_id = ticket.id
        board.attach_session(ticket.id, worker.thinkrail_sid)
        runtime = service.runtime_registry.get("claude")
        started = asyncio.Event()

        async def _linger(*_args, **_kwargs) -> AgentResult:
            started.set()
            await asyncio.Event().wait()
            raise AssertionError("runner should have been cancelled")

        runtime.run_session = AsyncMock(side_effect=_linger)
        runner = asyncio.create_task(service._run_background(worker, "context"))
        service._running_tasks[worker.thinkrail_sid] = runner
        await started.wait()

        service.trash_session(worker.thinkrail_sid)
        await runner

        assert not service._tracker.has_task(worker.thinkrail_sid)
        assert service._tracker._queues[orch_sid].empty()


class TestRunBackground:
    async def test_run_background_tolerates_session_deleted_before_final_status(
        self,
        tmp_path: Path,
    ) -> None:
        service, config, _ = _make_service()
        config.project_root = tmp_path
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        runtime = service.runtime_registry.get("claude")

        async def _delete_then_return(*_args, **_kwargs) -> AgentResult:
            service._tracker.remove_task(thinkrail_session.thinkrail_sid)
            return AgentResult(
                thinkrail_sid=thinkrail_session.thinkrail_sid,
                session_id="sdk-session",
                result="done",
                cost_usd=0,
                turns=0,
                duration_ms=0,
            )

        runtime.run_session = AsyncMock(side_effect=_delete_then_return)

        await service._run_background(thinkrail_session, "context")

        assert not service._tracker.has_task(thinkrail_session.thinkrail_sid)


class TestGetAndListTasks:
    def test_get_task(self) -> None:
        service, _, _ = _make_service()
        service._tracker.create_task(["s1"], SessionConfig())
        tasks = service.list_tasks()
        assert len(tasks) == 1

        retrieved = service.get_task(tasks[0].thinkrail_sid)
        assert retrieved.thinkrail_sid == tasks[0].thinkrail_sid

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
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        future = service._tracker.register_future(thinkrail_session.thinkrail_sid, "req-1")

        await service.respond(thinkrail_session.thinkrail_sid, "req-1", {"answer": "yes"})
        result = await future
        assert result == {"answer": "yes"}


class TestRespondPersistsEvent:
    async def test_respond_saves_request_resolved_event(self) -> None:
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        future = service._tracker.register_future(thinkrail_session.thinkrail_sid, "req-1")

        service._save_event = MagicMock()
        await service.respond(thinkrail_session.thinkrail_sid, "req-1", {"behavior": "allow"})

        service._save_event.assert_called_once_with(
            thinkrail_session.thinkrail_sid,
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
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")

        mock_client = AsyncMock()
        service._tracker.set_client(thinkrail_session.thinkrail_sid, mock_client)

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        mock_client.interrupt.assert_called_once()

    async def test_interrupt_sets_flag_before_client_interrupt(self) -> None:
        """set_interrupted is called before client.interrupt()."""
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")

        call_order: list[str] = []

        mock_client = AsyncMock()

        async def track_interrupt():
            call_order.append("client.interrupt")

        mock_client.interrupt = track_interrupt

        original_set = service._tracker.set_interrupted

        def track_set_interrupted(thinkrail_sid: str) -> None:
            call_order.append("set_interrupted")
            original_set(thinkrail_sid)

        service._tracker.set_interrupted = track_set_interrupted
        service._tracker.set_client(thinkrail_session.thinkrail_sid, mock_client)

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        assert call_order == ["set_interrupted", "client.interrupt"]

    async def test_interrupt_resolves_futures_with_deny(self) -> None:
        """interrupt_task calls interrupt_futures, not cancel_futures."""
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")
        service._tracker.set_client(thinkrail_session.thinkrail_sid, AsyncMock())

        future = service._tracker.register_future(thinkrail_session.thinkrail_sid, "req-1")

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        # Future should be resolved (not cancelled)
        assert not future.cancelled()
        assert future.done()
        result = future.result()
        assert result["behavior"] == "deny"
        assert result["interrupt"] is True

    async def test_interrupt_no_relaunch(self) -> None:
        """After interrupt, no new background thinkrail_session is created."""
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")
        service._tracker.set_client(thinkrail_session.thinkrail_sid, AsyncMock())

        # Record existing background tasks
        service._running_tasks[thinkrail_session.thinkrail_sid] = AsyncMock()
        original_bg = service._running_tasks[thinkrail_session.thinkrail_sid]

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        # The background thinkrail_session reference should be unchanged (not replaced)
        assert service._running_tasks.get(thinkrail_session.thinkrail_sid) is original_bg

    async def test_interrupt_idle_is_noop(self) -> None:
        """Interrupting an idle session does nothing."""
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())

        mock_client = AsyncMock()
        service._tracker.set_client(thinkrail_session.thinkrail_sid, mock_client)

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        mock_client.interrupt.assert_not_called()
        assert service._tracker.is_interrupted(thinkrail_session.thinkrail_sid) is False

    async def test_interrupt_waiting_state(self) -> None:
        """Interrupting a waiting session resolves futures and calls client.interrupt."""
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "waiting")

        mock_client = AsyncMock()
        service._tracker.set_client(thinkrail_session.thinkrail_sid, mock_client)

        future = service._tracker.register_future(thinkrail_session.thinkrail_sid, "req-1")

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        mock_client.interrupt.assert_called_once()
        assert future.done()
        assert future.result()["interrupt"] is True

    async def test_interrupt_no_client_does_not_raise(self) -> None:
        """If no client is stored (edge case), interrupt still sets flag."""
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")
        # No client set

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        # Should have set the flag even without a client
        assert service._tracker.is_interrupted(thinkrail_session.thinkrail_sid) is True


class TestSaveTask:
    def test_new_session_gets_zeroed_metrics(self, tmp_path: Path) -> None:
        """_save_task produces zeroed metrics for a brand-new session (no disk data)."""
        config = MagicMock()
        config.project_root = tmp_path
        spec_service = MagicMock()
        service = AgentService(config, spec_service)

        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        service._save_task(thinkrail_session)

        from app.agent.persistence import load_session
        loaded = load_session(tmp_path, thinkrail_session.thinkrail_sid)
        assert loaded is not None
        m = loaded["metrics"]
        assert m["costUsd"] == 0
        assert m["turns"] == 0
        assert m["toolCalls"] == 0
        assert m["durationMs"] == 0
        assert m["contextTokens"] == 0
        # contextMax is unknown until the first turn streams it from the runtime.
        assert m["contextMax"] == 0
        assert m["outputTokens"] == 0

    def test_model_metrics_persist(self, tmp_path: Path) -> None:
        """_save_task preserves metrics that were written to disk separately."""
        from app.agent.persistence import load_session, save_session

        config = MagicMock()
        config.project_root = tmp_path
        spec_service = MagicMock()
        service = AgentService(config, spec_service)

        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        save_session(tmp_path, {
            "thinkrailSid": thinkrail_session.thinkrail_sid,
            "name": "test",
            "specIds": [],
            "config": {},
            "status": "idle",
            "metrics": {"costUsd": 1.5, "toolCalls": 10, "turns": 3},
        })
        service._save_task(thinkrail_session)

        loaded = load_session(tmp_path, thinkrail_session.thinkrail_sid)
        assert loaded is not None
        assert loaded["metrics"]["costUsd"] == 1.5
        assert loaded["metrics"]["toolCalls"] == 10


class TestSubagentModePersistence:
    """Cover AgentTask.subagent_mode / step_gate save + restore."""

    def test_restore_draft_sessions_hydrates_subagent_mode_and_step_gate(
        self, tmp_path: Path,
    ) -> None:
        """Regression: backend startup must re-attach the on-disk mode/gate
        to the rehydrated draft Task.  Caught during Phase G UX testing —
        without this fix, the live tracker overlay clobbered disk values
        with defaults after every restart.
        """
        from app.agent.persistence import save_session

        save_session(tmp_path, {
            "thinkrailSid": "draft-restore",
            "name": "n",
            "skillId": "ticket-implement",
            "specIds": [],
            "config": SessionConfig().model_dump(by_alias=True),
            "status": "draft",
            "ticketId": "mt_test",
            "subagentMode": "subagent",
            "stepGate": "autonomous",
            "createdAt": "2026-05-30T00:00:00Z",
            "updatedAt": "2026-05-30T00:00:00Z",
            "metrics": {},
        })

        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)
        service._restore_draft_sessions()

        thinkrail_session = service._tracker.get_task("draft-restore")
        assert thinkrail_session is not None
        assert thinkrail_session.subagent_mode == "subagent"
        assert thinkrail_session.step_gate == "autonomous"

    def test_get_session_data_overlays_live_tracker_subagent_mode(
        self, tmp_path: Path,
    ) -> None:
        """Regression: live tracker subagent_mode/step_gate must beat disk —
        otherwise stale disk values bleed through to /session/get after a
        mode change has been applied in-memory but not yet flushed.
        """
        from app.agent.persistence import save_session

        save_session(tmp_path, {
            "thinkrailSid": "live-1",
            "name": "n",
            "skillId": "ticket-implement",
            "specIds": [],
            "config": SessionConfig().model_dump(by_alias=True),
            "status": "draft",
            "subagentMode": "step-session",  # stale on disk
            "stepGate": "approve",
            "createdAt": "2026-05-30T00:00:00Z",
            "updatedAt": "2026-05-30T00:00:00Z",
            "metrics": {},
        })

        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)
        service._restore_draft_sessions()
        # Simulate the user picking a different mode after hydration —
        # the in-memory thinkrail_session is the live truth.
        thinkrail_session = service._tracker.get_task("live-1")
        thinkrail_session.subagent_mode = "subagent"
        thinkrail_session.step_gate = "autonomous"

        data = service.get_session_data("live-1")
        assert data is not None
        assert data["subagentMode"] == "subagent"
        assert data["stepGate"] == "autonomous"

    def test_defaults_are_step_session_and_approve(self, tmp_path: Path) -> None:
        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)

        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        assert thinkrail_session.subagent_mode == "step-session"
        assert thinkrail_session.step_gate == "approve"

    def test_save_task_serializes_subagent_mode_and_step_gate(
        self, tmp_path: Path,
    ) -> None:
        from app.agent.persistence import load_session

        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)

        thinkrail_session = service._tracker.create_task(["s1"], SessionConfig())
        thinkrail_session.subagent_mode = "subagent"
        thinkrail_session.step_gate = "autonomous"
        service._save_task(thinkrail_session)

        loaded = load_session(tmp_path, thinkrail_session.thinkrail_sid)
        assert loaded is not None
        assert loaded["subagentMode"] == "subagent"
        assert loaded["stepGate"] == "autonomous"

class TestPrepareDraftOnType:
    """Draft-on-type additive params on prepare_task / update_draft."""

    def _service(self, tmp_path: Path) -> AgentService:
        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)
        service._build_context_for = AsyncMock(return_value="prompt")
        service._build_context_structured_for = AsyncMock(
            return_value={"full": "prompt", "sections": [], "totalTokens": 0}
        )
        return service

    async def test_prepare_reuses_supplied_thinkrail_sid(self, tmp_path: Path) -> None:
        from app.agent.persistence import load_session

        service = self._service(tmp_path)
        thinkrail_session = await service.prepare_task(
            ["s1"], SessionConfig(),
            thinkrail_sid="client-minted", draft_input="fix login flow",
        )
        assert thinkrail_session.thinkrail_sid == "client-minted"
        assert thinkrail_session.draft_input == "fix login flow"
        # The supplied id is reused verbatim — no re-mint — so the persisted
        # thinkrail_session is keyed by it and echoes it back as thinkrailSid.
        loaded = load_session(tmp_path, "client-minted")
        assert loaded is not None
        assert loaded["thinkrailSid"] == "client-minted"

    async def test_prepare_without_args_server_mints_and_no_draft_input(
        self, tmp_path: Path,
    ) -> None:
        service = self._service(tmp_path)
        thinkrail_session = await service.prepare_task(["s1"], SessionConfig())
        assert thinkrail_session.thinkrail_sid  # server-minted uuid
        assert thinkrail_session.draft_input is None

    async def test_prepare_persists_draft_input(self, tmp_path: Path) -> None:
        from app.agent.persistence import load_session

        service = self._service(tmp_path)
        thinkrail_session = await service.prepare_task(
            ["s1"], SessionConfig(),
            thinkrail_sid="d1", draft_input="fix login flow",
        )
        loaded = load_session(tmp_path, thinkrail_session.thinkrail_sid)
        assert loaded is not None
        assert loaded["draftInput"] == "fix login flow"

    async def test_update_draft_sets_draft_input(self, tmp_path: Path) -> None:
        service = self._service(tmp_path)
        thinkrail_session = await service.prepare_task(["s1"], SessionConfig(), thinkrail_sid="d1")
        await service.update_draft("d1", draft_input="typed text")
        assert thinkrail_session.draft_input == "typed text"

    async def test_update_draft_omitting_draft_input_keeps_current(
        self, tmp_path: Path,
    ) -> None:
        service = self._service(tmp_path)
        thinkrail_session = await service.prepare_task(
            ["s1"], SessionConfig(), thinkrail_sid="d1", draft_input="original",
        )
        # Omit draft_input → Ellipsis-sentinel leaves it untouched.
        await service.update_draft("d1", name="renamed")
        assert thinkrail_session.draft_input == "original"

    async def test_text_only_update_skips_system_prompt_rebuild(
        self, tmp_path: Path,
    ) -> None:
        service = self._service(tmp_path)
        await service.prepare_task(["s1"], SessionConfig(), thinkrail_sid="d1")
        service._build_context_for.reset_mock()
        service._build_context_structured_for.reset_mock()
        await service.update_draft("d1", draft_input="typed text", name="typed text")
        service._build_context_for.assert_not_called()
        service._build_context_structured_for.assert_not_called()

    async def test_config_change_rebuilds_system_prompt(
        self, tmp_path: Path,
    ) -> None:
        service = self._service(tmp_path)
        await service.prepare_task(["s1"], SessionConfig(), thinkrail_sid="d1")
        service._build_context_for.reset_mock()
        await service.update_draft("d1", spec_ids=["s1", "s2"])
        service._build_context_for.assert_called_once()

    async def test_list_all_sessions_includes_draft_input(
        self, tmp_path: Path,
    ) -> None:
        service = self._service(tmp_path)
        await service.prepare_task(
            ["s1"], SessionConfig(), thinkrail_sid="d1", draft_input="fix login flow",
        )
        entry = next(s for s in service.list_all_sessions() if s["thinkrailSid"] == "d1")
        assert entry["draftInput"] == "fix login flow"

    async def test_draft_input_round_trips_through_both_list_paths(
        self, tmp_path: Path,
    ) -> None:
        """prepare_task then update_draft persists draftInput, and BOTH the
        in-memory (list_all_sessions) and on-disk (persistence.list_sessions)
        listings surface the latest text for the draft entry."""
        from app.agent.persistence import list_sessions

        service = self._service(tmp_path)
        await service.prepare_task(
            ["s1"], SessionConfig(), thinkrail_sid="d1", draft_input="first draft",
        )
        await service.update_draft("d1", draft_input="second draft")

        in_memory = next(
            s for s in service.list_all_sessions() if s["thinkrailSid"] == "d1"
        )
        assert in_memory["draftInput"] == "second draft"

        on_disk = next(
            s for s in list_sessions(tmp_path) if s["thinkrailSid"] == "d1"
        )
        assert on_disk["draftInput"] == "second draft"

    async def test_draft_input_is_not_assembled_into_system_prompt(
        self, tmp_path: Path,
    ) -> None:
        """draft_input is non-context: it must never reach build_context.

        Builds the real system prompt for a draft carrying BOTH a session_prompt
        and a draft_input. The session_prompt lands under "Your Task"; the
        draft_input must be absent entirely.
        """
        config = MagicMock()
        config.project_root = tmp_path
        config.plugin_dir = tmp_path / "plugins"
        spec_service = MagicMock()
        spec_service.get_spec = AsyncMock()
        service = AgentService(config, spec_service)
        _install_mock_runtime(service)

        thinkrail_session = await service.prepare_task(
            [], SessionConfig(),
            thinkrail_sid="d1",
            session_prompt="SENTINEL_SESSION_PROMPT_VISIBLE",
            draft_input="SENTINEL_DRAFT_INPUT_HIDDEN",
        )
        prompt = await service._build_context_for(thinkrail_session)

        assert "SENTINEL_SESSION_PROMPT_VISIBLE" in prompt
        assert "SENTINEL_DRAFT_INPUT_HIDDEN" not in prompt

    def test_restore_draft_sessions_carries_draft_input(
        self, tmp_path: Path,
    ) -> None:
        from app.agent.persistence import save_session

        save_session(tmp_path, {
            "thinkrailSid": "draft-restore",
            "name": "n",
            "specIds": [],
            "config": SessionConfig().model_dump(by_alias=True),
            "status": "draft",
            "draftInput": "fix login flow",
            "createdAt": "2026-05-30T00:00:00Z",
            "updatedAt": "2026-05-30T00:00:00Z",
            "metrics": {},
        })
        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)
        service._restore_draft_sessions()

        thinkrail_session = service._tracker.get_task("draft-restore")
        assert thinkrail_session.draft_input == "fix login flow"


class TestBuildContext:
    async def test_builds_context_from_specs(self) -> None:
        from pathlib import Path
        from app.agent.context import build_context

        spec_service = AsyncMock()
        spec_service.get_spec.side_effect = [
            _make_spec_detail("s1", "First Spec", "Content one"),
            _make_spec_detail("s2", "Second Spec", "Content two"),
        ]

        context = await build_context(
            spec_ids=["s1", "s2"],
            skill_id=None,
            project_root=Path("/tmp/test-project"),
            config=SessionConfig(),
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

    async def test_includes_vis_instructions_in_freeform_session(self) -> None:
        from pathlib import Path
        from app.agent.context import build_context

        spec_service = AsyncMock()

        context = await build_context(
            spec_ids=[],
            skill_id=None,
            project_root=Path("/tmp/test-project"),
            config=SessionConfig(),
            spec_service=spec_service,
            plugin_dir=Path("/tmp/plugins"),
        )
        assert "thinkrail_visualize" in context
        # Visualization is now a subsection inside General Instructions
        assert "## General Instructions" in context
        assert "### Visualization" in context

    async def test_includes_vis_instructions_in_skill_session(self) -> None:
        from pathlib import Path
        from unittest.mock import patch as mock_patch
        from app.agent.context import build_context

        spec_service = AsyncMock()

        with mock_patch(
            "app.agent.context._load_skill", return_value="Do the thing."
        ):
            context = await build_context(
                spec_ids=[],
                skill_id="test-skill",
                project_root=Path("/tmp/test-project"),
                config=SessionConfig(),
                spec_service=spec_service,
                plugin_dir=Path("/tmp/plugins"),
            )
        assert "## Your Task" in context
        assert "thinkrail_visualize" in context
        assert "## General Instructions" in context


class TestValidateConfigAgainstCaps:
    """Out-of-caps config values are rejected at launch, not coerced."""

    def test_valid_config_passes(self) -> None:
        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task([], SessionConfig())  # all defaults are in caps
        service._validate_config_against_caps(thinkrail_session)  # no raise

    def test_out_of_caps_model_raises(self) -> None:
        from app.agent.exceptions import InvalidCapabilityValueError

        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task([], SessionConfig(model="ghost-model"))
        with pytest.raises(InvalidCapabilityValueError) as exc_info:
            service._validate_config_against_caps(thinkrail_session)
        exc = exc_info.value
        assert exc.field == "model"
        assert exc.value == "ghost-model"
        # rpc_data is the wire payload (camelCase) forwarded as error data.
        assert exc.rpc_data["runtimeType"] == "claude"
        assert "claude-opus-4-8" in exc.rpc_data["allowed"]

    def test_out_of_caps_effort_raises(self) -> None:
        from app.agent.exceptions import InvalidCapabilityValueError

        service, _, _ = _make_service()
        thinkrail_session = service._tracker.create_task([], SessionConfig(effort="bogus"))
        with pytest.raises(InvalidCapabilityValueError) as exc_info:
            service._validate_config_against_caps(thinkrail_session)
        assert exc_info.value.field == "effort"

    def test_no_registry_skips_validation(self) -> None:
        service, _, _ = _make_service()
        service.runtime_registry = None
        thinkrail_session = service._tracker.create_task([], SessionConfig(model="ghost-model"))
        service._validate_config_against_caps(thinkrail_session)  # no raise — caps unavailable

    def test_unknown_runtime_skips_validation(self) -> None:
        from app.agent.runtime import RuntimeRegistry

        service, _, _ = _make_service()
        service.runtime_registry = RuntimeRegistry()  # claude not registered
        thinkrail_session = service._tracker.create_task([], SessionConfig(model="ghost-model"))
        service._validate_config_against_caps(thinkrail_session)  # no raise — runtime unknown


class TestInterruptTaskRollback:
    async def test_clears_interrupt_flag_when_runtime_missing(self) -> None:
        """If the runtime can't be resolved, the SDK will never produce a
        ResultMessage to clear the interrupted flag — service must roll back
        so the session isn't wedged."""
        from app.agent.runtime import RuntimeRegistry

        service, _, _ = _make_service()
        # Empty registry → UnknownRuntimeError on lookup
        service.runtime_registry = RuntimeRegistry()

        thinkrail_session = service._tracker.create_task(
            [], SessionConfig(runtime="claude"),  # Literal-valid but not registered
        )
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "idle")
        service._tracker.set_status(thinkrail_session.thinkrail_sid, "running")

        await service.interrupt_task(thinkrail_session.thinkrail_sid)

        # Flag must be cleared so the next ResultMessage doesn't trigger
        # a spurious agent/interrupted event.
        assert service._tracker.is_interrupted(thinkrail_session.thinkrail_sid) is False


def _make_service_with_board(tmp_path: Path) -> tuple[AgentService, BoardService]:
    """Build an AgentService wired to a real BoardService for integration tests."""
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir()
    config = load_config(tmp_path)
    board = BoardService(config)
    service = AgentService(config, MagicMock())
    _install_mock_runtime(service)
    service.board_service = board
    board.agent_service = service
    return service, board


class TestAttachToTicket:
    def _session(self, skill_id: str | None):
        return AgentTask(ticket_id="t1", skill_id=skill_id, config=SessionConfig())

    def test_orchestrator_skill_becomes_ticket_orchestrator(self) -> None:
        service, _, _ = _make_service()
        service.board_service = MagicMock()
        s = self._session("ticket-orchestrator")
        service._attach_to_ticket(s)
        service.board_service.attach_session.assert_called_once_with("t1", s.thinkrail_sid)
        service.board_service.set_orchestrator.assert_called_once_with("t1", s.thinkrail_sid)

    def test_non_orchestrator_skill_attaches_without_setting_orchestrator(self) -> None:
        service, _, _ = _make_service()
        service.board_service = MagicMock()
        s = self._session("ticket-implement")
        service._attach_to_ticket(s)
        service.board_service.attach_session.assert_called_once()
        service.board_service.set_orchestrator.assert_not_called()


class TestIsTicketOrchestrator:
    def test_true_for_role(self, tmp_path: Path) -> None:
        svc, board = _make_service_with_board(tmp_path)
        ticket = board.create_ticket("t", spawn_orchestrator=False)
        session = AgentTask(name="s", ticket_id=ticket.id, skill_id="thinkrail-brainstorm")
        board.set_orchestrator(ticket.id, session.thinkrail_sid)
        assert svc._is_ticket_orchestrator(session) is True

    def test_false_when_not_ref(self, tmp_path: Path) -> None:
        svc, board = _make_service_with_board(tmp_path)
        ticket = board.create_ticket("t", spawn_orchestrator=False)
        session = AgentTask(name="s", ticket_id=ticket.id)
        assert svc._is_ticket_orchestrator(session) is False

    def test_false_when_no_ticket_id(self, tmp_path: Path) -> None:
        svc, board = _make_service_with_board(tmp_path)
        session = AgentTask(name="s")
        assert svc._is_ticket_orchestrator(session) is False

    def test_false_when_no_board_service(self) -> None:
        service, _, _ = _make_service()
        service.board_service = None
        session = AgentTask(name="s", ticket_id="t1")
        assert service._is_ticket_orchestrator(session) is False


class TestPromoteToTicket:
    async def test_adopts_session_as_orchestrator(self, tmp_path: Path) -> None:
        svc, board = _make_service_with_board(tmp_path)
        session = svc._tracker.create_task([], SessionConfig(), name="chat")
        svc._save_task(session)

        ticket = await svc.promote_to_ticket(session.thinkrail_sid, title="My feature")

        assert ticket.orchestrator is not None
        assert ticket.orchestrator.kind == "session"
        assert ticket.orchestrator.session_id == session.thinkrail_sid
        refreshed = svc._tracker.get_task(session.thinkrail_sid)
        assert refreshed.ticket_id == ticket.id

    async def test_rejects_session_already_in_ticket(self, tmp_path: Path) -> None:
        svc, board = _make_service_with_board(tmp_path)
        t = board.create_ticket("t", spawn_orchestrator=False)
        session = svc._tracker.create_task([], SessionConfig(), name="x")
        session.ticket_id = t.id
        svc._save_task(session)

        with pytest.raises(ValueError, match="already belongs to a ticket"):
            await svc.promote_to_ticket(session.thinkrail_sid, title="y")

    async def test_rejects_subsession(self, tmp_path: Path) -> None:
        svc, board = _make_service_with_board(tmp_path)
        session = svc._tracker.create_task([], SessionConfig(), name="sub")
        session.parent_thinkrail_sid = "some-parent-sid"
        svc._save_task(session)

        with pytest.raises(ValueError, match="subsession"):
            await svc.promote_to_ticket(session.thinkrail_sid, title="z")

    async def test_no_fresh_orchestrator_spawned(self, tmp_path: Path) -> None:
        svc, board = _make_service_with_board(tmp_path)
        spawned = []
        board.on_ticket_created = lambda tid, title: spawned.append(tid) or None
        session = svc._tracker.create_task([], SessionConfig(), name="chat")
        svc._save_task(session)

        await svc.promote_to_ticket(session.thinkrail_sid, title="Feature X")

        assert spawned == []

    async def test_promote_persists_ticket_id_to_disk(self, tmp_path: Path) -> None:
        from app.agent.persistence import load_session

        svc, board = _make_service_with_board(tmp_path)
        session = svc._tracker.create_task([], SessionConfig(), name="chat")
        svc._save_task(session)

        ticket = await svc.promote_to_ticket(session.thinkrail_sid, title="Persisted ticket")

        loaded = load_session(tmp_path, session.thinkrail_sid)
        assert loaded is not None
        assert (loaded.get("ticketId") or loaded.get("ticket_id")) == ticket.id

    async def test_promote_tolerates_legacy_disk_status(self, tmp_path: Path) -> None:
        # A disk-only session written before the status set was trimmed still
        # carries the removed "initializing" value; promotion must not 500 on it.
        from app.agent.persistence import save_session

        svc, board = _make_service_with_board(tmp_path)
        sid = "legacy-init-1"
        save_session(tmp_path, {"thinkrailSid": sid, "name": "old", "status": "initializing",
                                "created": "t", "updated": "t"})

        ticket = await svc.promote_to_ticket(sid, title="Legacy promote")

        assert ticket.orchestrator is not None
        assert ticket.orchestrator.session_id == sid
