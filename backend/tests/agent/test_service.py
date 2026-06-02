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


def _install_mock_runtime(service: AgentService) -> MagicMock:
    """Install a mock IAgentRuntime under runtime_type='claude' on ``service``.

    The mock's ``interrupt`` mirrors ``ClaudeRuntime.interrupt`` — it pulls
    the SDK client off the tracker and calls ``client.interrupt()`` — so
    integration tests asserting on the stored client still hold.
    """
    from app.agent.runtime import LabeledOption, RuntimeCapabilities, RuntimeRegistry

    async def _interrupt(task, tracker):
        client = tracker.get_client(task.bonsai_sid)
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
            bonsai_sid="t1",
            session_id="s1",
            result="done",
            cost_usd=0.0,
            turns=1,
            duration_ms=100,
        ))
        spec_service.get_spec.return_value = _make_spec_detail(
            "spec-1", "Test Spec", "# Content"
        )

        task = await service.run_task(["spec-1"], AgentConfig())

        assert task.status == "initializing"
        assert task.spec_ids == ["spec-1"]

        # Wait for background task to complete
        await asyncio.sleep(0.05)

        runtime.run_session.assert_called_once()

    async def test_run_task_returns_immediately(self) -> None:
        async def slow_run(*args, **kwargs):
            await asyncio.sleep(0.5)
            return AgentResult(
                bonsai_sid="t1", session_id="s1", result="done",
                cost_usd=0.0, turns=1, duration_ms=500,
            )

        service, _, spec_service = _make_service()
        runtime = service.runtime_registry.get("claude")
        runtime.run_session = AsyncMock(side_effect=slow_run)
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

    async def test_error_sets_status(self) -> None:
        service, _, spec_service = _make_service()
        runtime = service.runtime_registry.get("claude")
        runtime.run_session = AsyncMock(side_effect=RuntimeError("boom"))
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

    async def test_end_session_resolves_pending_futures(self) -> None:
        """A waiting session must have its futures resolved so the runner
        can pick up the end signal — otherwise it stays blocked in the
        tool callback forever."""
        service, _, _ = _make_service()
        task = service._tracker.create_task(["s1"], AgentConfig())
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")
        service._tracker.set_status(task.bonsai_sid, "waiting")
        future = service._tracker.register_future(task.bonsai_sid, "req-1")

        await service.end_session(task.bonsai_sid)

        assert future.done()
        result = future.result()
        assert result["behavior"] == "deny"
        assert result["interrupt"] is True


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
        # contextMax is unknown until the first turn streams it from the runtime.
        assert m["contextMax"] == 0
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
            "bonsaiSid": "draft-restore",
            "name": "n",
            "skillId": "ticket-implement",
            "specIds": [],
            "config": AgentConfig().model_dump(by_alias=True),
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

        task = service._tracker.get_task("draft-restore")
        assert task is not None
        assert task.subagent_mode == "subagent"
        assert task.step_gate == "autonomous"

    def test_get_session_data_overlays_live_tracker_subagent_mode(
        self, tmp_path: Path,
    ) -> None:
        """Regression: live tracker subagent_mode/step_gate must beat disk —
        otherwise stale disk values bleed through to /session/get after a
        mode change has been applied in-memory but not yet flushed.
        """
        from app.agent.persistence import save_session

        save_session(tmp_path, {
            "bonsaiSid": "live-1",
            "name": "n",
            "skillId": "ticket-implement",
            "specIds": [],
            "config": AgentConfig().model_dump(by_alias=True),
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
        # the in-memory task is the live truth.
        task = service._tracker.get_task("live-1")
        task.subagent_mode = "subagent"
        task.step_gate = "autonomous"

        data = service.get_session_data("live-1")
        assert data is not None
        assert data["subagentMode"] == "subagent"
        assert data["stepGate"] == "autonomous"

    def test_defaults_are_step_session_and_approve(self, tmp_path: Path) -> None:
        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)

        task = service._tracker.create_task(["s1"], AgentConfig())
        assert task.subagent_mode == "step-session"
        assert task.step_gate == "approve"

    def test_save_task_serializes_subagent_mode_and_step_gate(
        self, tmp_path: Path,
    ) -> None:
        from app.agent.persistence import load_session

        config = MagicMock()
        config.project_root = tmp_path
        service = AgentService(config, MagicMock())
        _install_mock_runtime(service)

        task = service._tracker.create_task(["s1"], AgentConfig())
        task.subagent_mode = "subagent"
        task.step_gate = "autonomous"
        service._save_task(task)

        loaded = load_session(tmp_path, task.bonsai_sid)
        assert loaded is not None
        assert loaded["subagentMode"] == "subagent"
        assert loaded["stepGate"] == "autonomous"

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

    async def test_includes_vis_instructions_in_freeform_session(self) -> None:
        from pathlib import Path
        from app.agent.context import build_context

        spec_service = AsyncMock()

        context = await build_context(
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
                config=AgentConfig(),
                spec_service=spec_service,
                plugin_dir=Path("/tmp/plugins"),
            )
        assert "## Your Task" in context
        assert "bonsai_visualize" in context
        assert "## General Instructions" in context


class TestValidateConfigAgainstCaps:
    """Out-of-caps config values are rejected at launch, not coerced."""

    def test_valid_config_passes(self) -> None:
        service, _, _ = _make_service()
        task = service._tracker.create_task([], AgentConfig())  # all defaults are in caps
        service._validate_config_against_caps(task)  # no raise

    def test_out_of_caps_model_raises(self) -> None:
        from app.agent.exceptions import InvalidCapabilityValueError

        service, _, _ = _make_service()
        task = service._tracker.create_task([], AgentConfig(model="ghost-model"))
        with pytest.raises(InvalidCapabilityValueError) as exc_info:
            service._validate_config_against_caps(task)
        exc = exc_info.value
        assert exc.field == "model"
        assert exc.value == "ghost-model"
        # rpc_data is the wire payload (camelCase) forwarded as error data.
        assert exc.rpc_data["runtimeType"] == "claude"
        assert "claude-opus-4-8" in exc.rpc_data["allowed"]

    def test_out_of_caps_effort_raises(self) -> None:
        from app.agent.exceptions import InvalidCapabilityValueError

        service, _, _ = _make_service()
        task = service._tracker.create_task([], AgentConfig(effort="bogus"))
        with pytest.raises(InvalidCapabilityValueError) as exc_info:
            service._validate_config_against_caps(task)
        assert exc_info.value.field == "effort"

    def test_no_registry_skips_validation(self) -> None:
        service, _, _ = _make_service()
        service.runtime_registry = None
        task = service._tracker.create_task([], AgentConfig(model="ghost-model"))
        service._validate_config_against_caps(task)  # no raise — caps unavailable

    def test_unknown_runtime_skips_validation(self) -> None:
        from app.agent.runtime import RuntimeRegistry

        service, _, _ = _make_service()
        service.runtime_registry = RuntimeRegistry()  # claude not registered
        task = service._tracker.create_task([], AgentConfig(model="ghost-model"))
        service._validate_config_against_caps(task)  # no raise — runtime unknown


class TestInterruptTaskRollback:
    async def test_clears_interrupt_flag_when_runtime_missing(self) -> None:
        """If the runtime can't be resolved, the SDK will never produce a
        ResultMessage to clear the interrupted flag — service must roll back
        so the session isn't wedged."""
        from app.agent.runtime import RuntimeRegistry

        service, _, _ = _make_service()
        # Empty registry → UnknownRuntimeError on lookup
        service.runtime_registry = RuntimeRegistry()

        task = service._tracker.create_task(
            [], AgentConfig(runtime="claude"),  # Literal-valid but not registered
        )
        service._tracker.set_status(task.bonsai_sid, "idle")
        service._tracker.set_status(task.bonsai_sid, "running")

        await service.interrupt_task(task.bonsai_sid)

        # Flag must be cleared so the next ResultMessage doesn't trigger
        # a spurious agent/interrupted event.
        assert service._tracker.is_interrupted(task.bonsai_sid) is False


