"""Tests for runtime contract types."""

from __future__ import annotations

import inspect
from typing import get_args, get_type_hints

import pytest
from pydantic import ValidationError

from app.agent.models import AgentResult, AgentTask
from app.agent.runtime.types import (
    IAgentRuntime,
    RuntimeExecutionConfig,
    RuntimeSkillInfo,
    RuntimeType,
)


class TestRuntimeExecutionConfig:
    def test_requires_working_directory(self):
        with pytest.raises(ValidationError):
            RuntimeExecutionConfig(model="claude-opus-4-7")  # type: ignore[call-arg]

    def test_requires_model(self):
        # ``model`` is required: the neutral type doesn't carry a provider-
        # specific default — the caller (a runtime) picks the value.
        with pytest.raises(ValidationError):
            RuntimeExecutionConfig(working_directory="/tmp/proj")  # type: ignore[call-arg]

    def test_defaults_match_contract(self):
        cfg = RuntimeExecutionConfig(working_directory="/tmp/proj", model="claude-opus-4-7")
        assert cfg.permission_mode == "default"
        assert cfg.stream_text is True
        assert cfg.effort is None
        assert cfg.system_prompt is None
        assert cfg.resume_session_id is None

    def test_round_trip_with_camel_case_aliases(self):
        cfg = RuntimeExecutionConfig(
            working_directory="/tmp/proj",
            model="claude-opus-4-7",
            system_prompt="be concise",
            resume_session_id="sess-123",
            effort="high",
            permission_mode="acceptEdits",
            stream_text=False,
        )
        dumped = cfg.model_dump(by_alias=True)
        assert dumped == {
            "workingDirectory": "/tmp/proj",
            "model": "claude-opus-4-7",
            "systemPrompt": "be concise",
            "resumeSessionId": "sess-123",
            "effort": "high",
            "permissionMode": "acceptEdits",
            "streamText": False,
        }
        restored = RuntimeExecutionConfig.model_validate(dumped)
        assert restored == cfg

    def test_validate_from_camel_case_keys(self):
        cfg = RuntimeExecutionConfig.model_validate({
            "workingDirectory": "/tmp/proj",
            "model": "claude-opus-4-7",
            "permissionMode": "acceptEdits",
        })
        assert cfg.working_directory == "/tmp/proj"
        assert cfg.permission_mode == "acceptEdits"


class TestRuntimeSkillInfo:
    def test_requires_all_fields(self):
        with pytest.raises(ValidationError):
            RuntimeSkillInfo(id="review", name="Review", description="desc")  # type: ignore[call-arg]

    def test_round_trip_with_camel_case_aliases(self):
        info = RuntimeSkillInfo(
            id="specdriven:ticket-specify",
            name="Ticket Specify",
            description="Create or modify specifications for a meta-ticket.",
            source="plugin",
        )
        dumped = info.model_dump(by_alias=True)
        assert dumped == {
            "id": "specdriven:ticket-specify",
            "name": "Ticket Specify",
            "description": "Create or modify specifications for a meta-ticket.",
            "source": "plugin",
        }
        restored = RuntimeSkillInfo.model_validate(dumped)
        assert restored == info

    def test_is_frozen(self):
        info = RuntimeSkillInfo(
            id="review",
            name="Review",
            description="Review a pull request.",
            source="builtin",
        )
        with pytest.raises(ValidationError):
            info.id = "other"  # type: ignore[misc]


class TestIAgentRuntimeProtocol:
    def test_minimal_implementation_is_recognized(self):
        class Dummy:
            runtime_type: RuntimeType = "claude"
            display_name: str = "Claude (test)"

            def list_models(self):
                return []

            def list_skills(self):
                return []

            def get_context_window(self, model_id):
                return 200_000

            async def run_session(self, task, exec_config, handler):  # noqa: D401
                return AgentResult(
                    bonsai_sid=task.bonsai_sid,
                    session_id="s",
                    result="",
                    cost_usd=0.0,
                    turns=0,
                    duration_ms=0,
                )

            async def interrupt(self, task, tracker):
                return None

        d = Dummy()
        assert isinstance(d, IAgentRuntime)

    def test_missing_methods_fails_isinstance(self):
        class Partial:
            runtime_type: RuntimeType = "claude"
            display_name: str = "x"
            # no run_session / interrupt

        assert not isinstance(Partial(), IAgentRuntime)

    def test_runtime_type_literal_values(self):
        # Verify the literal type itself permits exactly the planned values.
        assert set(get_args(RuntimeType)) == {"claude", "codex"}

    def test_protocol_signatures_are_async(self):
        # Spot-check method annotations exist and are coroutine functions.
        hints = get_type_hints(IAgentRuntime, include_extras=True)
        assert "runtime_type" in hints
        assert "display_name" in hints
        assert inspect.iscoroutinefunction(IAgentRuntime.run_session)
        assert inspect.iscoroutinefunction(IAgentRuntime.interrupt)
