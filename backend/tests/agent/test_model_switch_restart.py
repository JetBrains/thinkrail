"""Reproduction for issue #62 follow-up: the model-switch confirm path

(`update_config(model, effort)` then `restart_session`) used by the frontend's
"Switch & restart" dialog. Verifies it relaunches with the new settings instead
of raising.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from app.agent.models import AgentConfig, AgentResult, TaskStatus
from app.agent.runtime import LabeledOption, RuntimeCapabilities, RuntimeRegistry
from app.agent.service import AgentService
from app.agent.tracker import END_SIGNAL

_OPUS = "claude-opus-4-8"
_HAIKU = "claude-haiku-4-5-20251001"


def _service(tmp_path: Path) -> AgentService:
    config = MagicMock()
    config.project_root = tmp_path
    spec_service = MagicMock()
    spec_service.get_spec = AsyncMock()
    service = AgentService(config, spec_service)

    runtime = MagicMock()
    runtime.runtime_type = "claude"
    runtime.display_name = "Claude (test)"
    runtime.interrupt = AsyncMock()
    runtime.capabilities = MagicMock(return_value=RuntimeCapabilities(
        permission_modes=[LabeledOption(value="default", label="default")],
        effort_levels=[
            LabeledOption(value=v, label=v)
            for v in ("auto", "low", "medium", "high", "xhigh", "max")
        ],
        models=[LabeledOption(value=v, label=v) for v in (_OPUS, _HAIKU)],
    ))
    reg = RuntimeRegistry()
    reg.register(runtime)
    service.runtime_registry = reg
    return service


async def test_switch_and_restart_relaunches_with_new_model(tmp_path: Path) -> None:
    service = _service(tmp_path)
    tracker = service._tracker
    runtime = service.runtime_registry.get("claude")

    live_client = MagicMock()
    live_client.set_model = AsyncMock()
    live_client.set_permission_mode = AsyncMock()

    async def fake_run_session(task, exec_config, handler):
        tracker.set_client(task.thinkrail_sid, live_client)
        tracker.set_session_id(task.thinkrail_sid, "cli-sid-1")
        tracker.set_status(task.thinkrail_sid, TaskStatus.IDLE)
        while True:
            msg = await tracker.get_next_message(task.thinkrail_sid)
            if msg is END_SIGNAL:
                break
        return AgentResult(
            thinkrail_sid=task.thinkrail_sid, session_id="cli-sid-1",
            result="", cost_usd=0.0, turns=0, duration_ms=0,
        )

    runtime.run_session = AsyncMock(side_effect=fake_run_session)

    task = await service.run_task(["s1"], AgentConfig(model=_OPUS, effort="xhigh"))
    sid = task.thinkrail_sid
    await asyncio.sleep(0.05)
    assert tracker.get_client(sid) is live_client

    # Frontend "Switch & restart": updateConfig(model + clamped effort) → restart.
    await service.update_config(sid, model=_HAIKU, effort="auto")
    new_task = await service.restart_session(sid)

    assert new_task.config.model == _HAIKU
    assert new_task.config.effort == "auto"

    # Tidy up the relaunched runner.
    await asyncio.sleep(0.05)
    tracker.enqueue_end_signal(sid)
    bg = service._running_tasks.get(sid)
    if bg:
        await asyncio.gather(bg)


async def test_switch_and_restart_with_no_session_id_yet(tmp_path: Path) -> None:
    """The crashy case from the bug report: switching model on a session that
    is idle but never sent a first message (so it has no CLI sessionId). The
    restart must relaunch fresh with the new settings, not raise."""
    service = _service(tmp_path)
    tracker = service._tracker
    runtime = service.runtime_registry.get("claude")

    live_client = MagicMock()
    live_client.set_model = AsyncMock()
    live_client.set_permission_mode = AsyncMock()

    async def fake_run_session(task, exec_config, handler):
        tracker.set_client(task.thinkrail_sid, live_client)
        # No set_session_id — mirrors an idle session with no completed turn.
        tracker.set_status(task.thinkrail_sid, TaskStatus.IDLE)
        while True:
            msg = await tracker.get_next_message(task.thinkrail_sid)
            if msg is END_SIGNAL:
                break
        return AgentResult(
            thinkrail_sid=task.thinkrail_sid, session_id="",
            result="", cost_usd=0.0, turns=0, duration_ms=0,
        )

    runtime.run_session = AsyncMock(side_effect=fake_run_session)

    task = await service.run_task(["s1"], AgentConfig(model=_OPUS, effort="xhigh"))
    sid = task.thinkrail_sid
    await asyncio.sleep(0.05)

    await service.update_config(sid, model=_HAIKU, effort="auto")
    new_task = await service.restart_session(sid)  # must not raise

    assert new_task.config.model == _HAIKU
    assert new_task.config.effort == "auto"

    await asyncio.sleep(0.05)
    tracker.enqueue_end_signal(sid)
    bg = service._running_tasks.get(sid)
    if bg:
        await asyncio.gather(bg)
