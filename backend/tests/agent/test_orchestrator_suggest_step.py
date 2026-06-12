"""Tests for the orchestrator ``suggest_step`` tool handler.

The prerequisite each test sets up is a meta-ticket with a plan on disk —
created via ``PlanService.create_plan()`` rooted in ``tmp_path``. The
handler is then invoked directly so we can capture the ``notify`` payload
that would have driven the frontend's step-proposal card, without
spinning up the LLM, the WebSocket bus, or the React UI.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.agent.models import AgentConfig, AgentTask
from app.agent.tools._context import set_tool_context
from app.agent.tools.orchestrator import _suggest_step
from app.agent.tracker import Tracker
from app.board.plan import PlanService, PlanStep, SuccessCriterion
from app.core.config import AppConfig


# ── Fixtures ───────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = tmp_path / ".thinkrail_server"
    data_dir.mkdir()
    monkeypatch.setattr("app.core.config.get_data_dir", lambda: data_dir)


def _make_config(tmp_path: Path) -> AppConfig:
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir(exist_ok=True)
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir(exist_ok=True)
    return AppConfig(
        project_root=tmp_path, thinkrail_dir=thinkrail_dir, plugin_dir=plugin_dir,
    )


def _make_tracker_and_task() -> tuple[Tracker, AgentTask]:
    tracker = Tracker()
    task = tracker.create_task(["spec-1"], AgentConfig())
    tracker.set_status(task.thinkrail_sid, "idle")
    tracker.set_status(task.thinkrail_sid, "running")
    return tracker, task


def _seed_plan(config: AppConfig, ticket_id: str) -> PlanService:
    """Prerequisite: write a meta-ticket plan with one fully-populated step."""
    svc = PlanService(config)
    step = PlanStep(
        number=1,
        title="Create backend/app/core/last_used.py",
        skill="default",
        input_spec_ids=["module-core", "module-app-store"],
        agent_instructions=(
            "Read the design doc. Create backend/app/core/last_used.py with "
            "LastUsedSessionConfig + cold-start constants."
        ),
        success_criteria=[
            SuccessCriterion(text="Builds without errors", checked=False),
        ],
    )
    svc.create_plan(ticket_id, "Test plan", [step])
    return svc


async def _resolve_future_with(tracker: Tracker, task: AgentTask, response: dict) -> None:
    """Wait a beat, then resolve whatever future the handler is awaiting."""
    await asyncio.sleep(0.01)
    for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
        tracker.resolve_future(task.thinkrail_sid, req_id, response)
        break


# ── Tests ───────────────────────────────────────────────────────────────


class TestSuggestStepNotifyPayload:
    """The frontend card and the approved step session both depend on the
    notify payload carrying the right fields.  These tests guard the wire
    contract."""

    async def test_payload_includes_agent_instructions_and_specs(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _seed_plan(config, "mt_test")

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        # Schedule an approval so the handler unblocks; we only care about
        # the payload that fires *before* the future resolves.
        asyncio.get_event_loop().create_task(
            _resolve_future_with(tracker, task, {"behavior": "allow"})
        )

        result = await _suggest_step.handler({
            "ticketId": "mt_test", "stepNumber": 1, "reason": "deps met",
        })
        assert "approved" in result["content"][0]["text"]

        notify.assert_called_once()
        method, params = notify.call_args.args[0], notify.call_args.args[1]
        assert method == "agent/suggestStep"

        # Regression guard: every field the frontend / new step session uses.
        assert params["ticketId"] == "mt_test"
        assert params["stepNumber"] == 1
        assert params["stepTitle"] == "Create backend/app/core/last_used.py"
        assert params["skill"] == "default"
        assert params["inputSpecIds"] == ["module-core", "module-app-store"]
        assert params["agentInstructions"].startswith("Read the design doc")
        assert params["reason"] == "deps met"

    async def test_dismiss_flow_returns_dismissed_text(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _seed_plan(config, "mt_test")

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        asyncio.get_event_loop().create_task(
            _resolve_future_with(tracker, task, {"behavior": "deny", "message": "later"})
        )

        result = await _suggest_step.handler({
            "ticketId": "mt_test", "stepNumber": 1,
        })
        text = result["content"][0]["text"]
        assert "dismissed" in text.lower()
        assert "later" in text

    async def test_missing_plan_returns_error(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        result = await _suggest_step.handler({
            "ticketId": "mt_missing", "stepNumber": 1,
        })
        assert result.get("isError") is True
        assert "No plan found" in result["content"][0]["text"]
        notify.assert_not_called()

    async def test_unknown_step_returns_error(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _seed_plan(config, "mt_test")

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        result = await _suggest_step.handler({
            "ticketId": "mt_test", "stepNumber": 99,
        })
        assert result.get("isError") is True
        assert "Step 99 not found" in result["content"][0]["text"]
        notify.assert_not_called()
