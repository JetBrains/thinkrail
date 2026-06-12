"""Tests for the ticket-step-executor subagent definition and step-marker
prompt parser. See app/agent/subagents.py and TICKET_LIFECYCLE_DESIGN.md
§ Implementation orchestration modes.
"""

from __future__ import annotations

from app.agent.subagents import (
    TICKET_STEP_EXECUTOR,
    parse_thinkrail_step_marker,
)


class TestTicketStepExecutorDefinition:
    def test_description_present(self) -> None:
        assert TICKET_STEP_EXECUTOR.description
        assert "plan step" in TICKET_STEP_EXECUTOR.description.lower()

    def test_excludes_orchestrator_only_tools(self) -> None:
        tools = set(TICKET_STEP_EXECUTOR.tools or [])
        # Only the orchestrator emits suggest_step or changes ticket status.
        assert "suggest_step" not in tools
        assert "ChangeTicketStatus" not in tools

    def test_includes_propose_change_and_editing_tools(self) -> None:
        tools = set(TICKET_STEP_EXECUTOR.tools or [])
        assert "ProposeChange" in tools
        # Step subagents need basic editing surface.
        assert {"Write", "Edit"}.issubset(tools)

    def test_prompt_disallows_orchestrator_responsibilities(self) -> None:
        prompt = TICKET_STEP_EXECUTOR.prompt
        assert "suggest_step" in prompt
        assert "ChangeTicketStatus" in prompt


class TestThinkRailStepMarker:
    def test_parse_marker_with_ticket_and_step(self) -> None:
        prompt = "[thinkrail-step ticket=mt_abc12 step=5]\nDo the thing\n"
        result = parse_thinkrail_step_marker(prompt)
        assert result == {"ticket_id": "mt_abc12", "step": 5}

    def test_parse_marker_tolerates_leading_whitespace(self) -> None:
        prompt = "\n  [thinkrail-step ticket=mt_abc12 step=42]\nRest\n"
        result = parse_thinkrail_step_marker(prompt)
        assert result == {"ticket_id": "mt_abc12", "step": 42}

    def test_parse_marker_missing_returns_none(self) -> None:
        assert parse_thinkrail_step_marker("just a prompt with no marker") is None

    def test_parse_marker_malformed_returns_none(self) -> None:
        assert parse_thinkrail_step_marker("[thinkrail-step ticket=mt_abc12]") is None
        assert parse_thinkrail_step_marker("[thinkrail-step step=5]") is None
        assert parse_thinkrail_step_marker("[thinkrail-step]") is None

    def test_parse_marker_empty_returns_none(self) -> None:
        assert parse_thinkrail_step_marker("") is None


class TestRuntimeAgentRegistration:
    """Verify the runtime registers ticket-step-executor only when the
    orchestrator is ticket-implement in subagent mode.
    """

    def _make_task(self, **overrides: object) -> object:
        from app.agent.models import AgentConfig, AgentTask
        defaults: dict[str, object] = {
            "skill_id": "ticket-implement",
            "subagent_mode": "subagent",
            "config": AgentConfig(),
        }
        defaults.update(overrides)
        return AgentTask(**defaults)  # type: ignore[arg-type]

    def test_subagent_mode_registers_step_executor(self) -> None:
        from app.agent.runtime.claude.runtime import _build_agents_for
        task = self._make_task()
        agents = _build_agents_for(task)
        assert "ticket-step-executor" in agents
        assert agents["ticket-step-executor"] is TICKET_STEP_EXECUTOR

    def test_step_session_mode_registers_nothing(self) -> None:
        from app.agent.runtime.claude.runtime import _build_agents_for
        task = self._make_task(subagent_mode="step-session")
        assert _build_agents_for(task) == {}

    def test_non_ticket_implement_skill_registers_nothing(self) -> None:
        from app.agent.runtime.claude.runtime import _build_agents_for
        task = self._make_task(skill_id="ticket-product-design")
        # subagent_mode is only meaningful for ticket-implement.
        assert _build_agents_for(task) == {}

    def test_no_skill_registers_nothing(self) -> None:
        from app.agent.runtime.claude.runtime import _build_agents_for
        task = self._make_task(skill_id=None)
        assert _build_agents_for(task) == {}
