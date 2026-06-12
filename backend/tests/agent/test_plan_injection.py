"""Tests for AgentService._build_context_for plan-section injection.

When a session is linked to a ticket that has a plan, the agent's
system prompt should be augmented with that plan — but the *framing*
depends on the session's role:

- ``ticket-implementation-plan`` skill → "Existing Plan" (refines it)
- ``ticket-implement`` skill → "As the orchestrator" (drives suggest_step)
- any other skill or none → "Plan (for reference)" — must NOT instruct
  the session to act as an orchestrator, otherwise step sessions (which
  are created by approving a suggest_step card and inherit the ticket
  link) re-emit suggest_step themselves instead of executing the step.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.agent.models import AgentConfig
from app.agent.service import AgentService
from app.board.plan import PlanStep
from app.board.service import BoardService
from app.core.config import AppConfig
from app.spec.service import SpecService


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


def _seed_skill(config: AppConfig, skill_id: str) -> None:
    """Plant a minimal SKILL.md so _load_skill doesn't FileNotFoundError."""
    skill_dir = config.plugin_dir / "skills" / skill_id
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(f"# {skill_id}\n")


async def _build_service_with_plan(tmp_path: Path) -> tuple[AgentService, str, AppConfig]:
    """Create an AgentService + a meta-ticket with a 1-step plan."""
    config = _make_config(tmp_path)
    spec_service = SpecService(config)
    agent = AgentService(config, spec_service)
    board = BoardService(config)
    agent.board_service = board
    ticket = board.create_ticket("Test", body="test", type="feature")
    board.plans.create_plan(
        ticket.id, "Test plan",
        steps=[
            PlanStep(
                number=1, title="Step 1", skill="default",
                agent_instructions="Do step 1.",
            ),
        ],
    )
    # The plan-injection guard reads ticket.implementation_plan_path; set it
    # explicitly here since the test bypasses ticket-implementation-plan
    # (which would set it normally).
    fresh = board.get_ticket(ticket.id)
    fresh.implementation_plan_path = f".tr/tickets/{ticket.id}/implementation-plan.md"
    from app.board.storage import ticket_path, write_ticket, tickets_root
    write_ticket(
        ticket_path(tickets_root(config.project_root), ticket.id),
        fresh,
    )
    return agent, ticket.id, config


def _make_task(agent: AgentService, ticket_id: str, skill_id: str | None):
    """Use the same code path the real run/draft flow uses."""
    task = agent._tracker.create_task([], AgentConfig(), skill_id=skill_id)
    task.ticket_id = ticket_id
    return task


class TestBuildContextPlanInjection:
    async def test_ticket_implement_skill_gets_orchestrator_framing(
        self, tmp_path: Path,
    ) -> None:
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        _seed_skill(config, "ticket-implement")
        task = _make_task(agent, ticket_id, skill_id="ticket-implement")
        prompt = await agent._build_context_for(task)
        assert "As the orchestrator" in prompt
        assert "suggest_step" in prompt
        assert "Step 1" in prompt  # plan content is present

    async def test_ticket_implementation_plan_skill_gets_existing_plan_framing(
        self, tmp_path: Path,
    ) -> None:
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        _seed_skill(config, "ticket-implementation-plan")
        task = _make_task(agent, ticket_id, skill_id="ticket-implementation-plan")
        prompt = await agent._build_context_for(task)
        assert "Existing Plan" in prompt
        assert "Review it and update" in prompt
        assert "As the orchestrator" not in prompt

    async def test_step_session_gets_reference_framing_not_orchestrator(
        self, tmp_path: Path,
    ) -> None:
        """Regression guard for the "step session re-orchestrates" bug.

        When a user clicks "Start Step" on a step proposal card, the new
        session inherits ``ticketId`` but should NOT inherit the
        orchestrator role.
        """
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        # None skill_id is what suggest_step → startSession produces after
        # the "default" sentinel is normalised away.
        task = _make_task(agent, ticket_id, skill_id=None)
        prompt = await agent._build_context_for(task)
        assert "Plan (for reference)" in prompt
        assert "do not act as the orchestrator" in prompt
        assert "do not call `suggest_step`" in prompt
        assert "Step 1" in prompt  # plan still attached as context
        # The orchestrator framing must NOT be injected.
        assert "As the orchestrator" not in prompt

    async def test_drafting_skill_gets_ticket_body_injected(
        self, tmp_path: Path,
    ) -> None:
        """ticket-product-design (and siblings) should see the ticket's
        title/body in their prompt — what ticket-describe used to get."""
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        _seed_skill(config, "ticket-product-design")
        task = _make_task(agent, ticket_id, skill_id="ticket-product-design")
        prompt = await agent._build_context_for(task)
        assert "## Current Ticket" in prompt
        assert "**Title:** Test" in prompt


class TestSubagentModeFraming:
    """Cover the orchestration-mode section injected for ticket-implement."""

    async def test_step_session_mode_has_no_subagent_section(
        self, tmp_path: Path,
    ) -> None:
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        _seed_skill(config, "ticket-implement")
        task = _make_task(agent, ticket_id, skill_id="ticket-implement")
        # Default is step-session
        prompt = await agent._build_context_for(task)
        assert "Subagent Mode" not in prompt
        assert "[thinkrail-step" not in prompt

    async def test_subagent_gated_mode_includes_marker_instructions(
        self, tmp_path: Path,
    ) -> None:
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        _seed_skill(config, "ticket-implement")
        task = _make_task(agent, ticket_id, skill_id="ticket-implement")
        task.subagent_mode = "subagent"
        task.step_gate = "approve"
        prompt = await agent._build_context_for(task)
        assert "Subagent Mode (approve each)" in prompt
        assert "[thinkrail-step ticket=" in prompt
        assert "Failure policy: **fail-fast**" in prompt

    async def test_subagent_autonomous_mode_omits_suggest_step(
        self, tmp_path: Path,
    ) -> None:
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        _seed_skill(config, "ticket-implement")
        task = _make_task(agent, ticket_id, skill_id="ticket-implement")
        task.subagent_mode = "subagent"
        task.step_gate = "autonomous"
        prompt = await agent._build_context_for(task)
        assert "Subagent Mode (autonomous)" in prompt
        assert "Do NOT emit `suggest_step`" in prompt

    async def test_wait_all_policy_reflected_in_prompt(
        self, tmp_path: Path,
    ) -> None:
        agent, ticket_id, config = await _build_service_with_plan(tmp_path)
        _seed_skill(config, "ticket-implement")
        # Drop a settings.json with wait-all under .tr/
        from app.core.settings import save_settings

        save_settings(tmp_path, {"tickets": {"subagentFailurePolicy": "wait-all"}})
        task = _make_task(agent, ticket_id, skill_id="ticket-implement")
        task.subagent_mode = "subagent"
        task.step_gate = "autonomous"
        prompt = await agent._build_context_for(task)
        assert "Failure policy: **wait-all**" in prompt
