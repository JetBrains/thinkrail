"""Tests for runtime contract types."""

from __future__ import annotations

import inspect
from typing import get_args, get_type_hints

import pytest
from pydantic import ValidationError

from app.agent.models import AgentResult, AgentTask
from app.agent.runtime.types import (
    IAgentRuntime,
    LabeledOption,
    RuntimeCapabilities,
    RuntimeExecutionConfig,
    RuntimeFlag,
    RuntimeIdentity,
    RuntimeSkillInfo,
    RuntimeType,
)


class TestRuntimeFlag:
    def test_camelcase_round_trip(self) -> None:
        flag = RuntimeFlag(
            key="context1m", label="1M context window", type="boolean",
            default=True, description="…",
        )
        dumped = flag.model_dump(by_alias=True)
        assert dumped["type"] == "boolean"
        assert dumped["default"] is True
        assert RuntimeFlag.model_validate(dumped) == flag

    def test_rejects_unknown_type(self) -> None:
        with pytest.raises(ValidationError):
            RuntimeFlag(key="x", label="X", type="slider", default=True)  # type: ignore[arg-type]


class TestLabeledOption:
    def test_required_fields(self):
        opt = LabeledOption(value="auto", label="auto")
        assert opt.value == "auto"
        assert opt.label == "auto"

    def test_rejects_extra_fields(self):
        # ``extra="forbid"`` — typos in payloads are surfaced at parse time.
        with pytest.raises(ValidationError):
            LabeledOption.model_validate({"value": "x", "label": "X", "group": "current"})

    def test_camelcase_round_trip(self):
        opt = LabeledOption(value="claude-opus-4-8", label="Opus 4.8")
        dumped = opt.model_dump(by_alias=True)
        assert dumped == {"value": "claude-opus-4-8", "label": "Opus 4.8"}
        assert LabeledOption.model_validate(dumped) == opt

    def test_frozen(self):
        opt = LabeledOption(value="auto", label="auto")
        with pytest.raises(ValidationError):
            opt.value = "low"  # type: ignore[misc]


class TestRuntimeCapabilities:
    @staticmethod
    def _opt(v: str, label: str | None = None) -> LabeledOption:
        return LabeledOption(value=v, label=label or v)

    def test_constructs_with_three_lists(self):
        caps = RuntimeCapabilities(
            permission_modes=[self._opt("default")],
            effort_levels=[self._opt("auto")],
            models=[self._opt("claude-opus-4-8", "Opus 4.8")],
        )
        assert caps.permission_modes[0].value == "default"
        assert caps.effort_levels[0].value == "auto"
        assert caps.models[0].label == "Opus 4.8"
        assert caps.flags == []  # flags are optional; absent → empty

    def test_rejects_empty_list(self):
        with pytest.raises(ValidationError, match="at least one option"):
            RuntimeCapabilities(
                permission_modes=[self._opt("default")],
                effort_levels=[],
                models=[self._opt("claude-opus-4-8")],
            )

    def test_camelcase_round_trip(self):
        caps = RuntimeCapabilities(
            permission_modes=[self._opt("default"), self._opt("plan")],
            effort_levels=[self._opt("auto"), self._opt("high")],
            models=[self._opt("claude-opus-4-8", "Opus 4.8")],
        )
        dumped = caps.model_dump(by_alias=True)
        assert "permissionModes" in dumped
        assert "effortLevels" in dumped
        assert "models" in dumped
        assert RuntimeCapabilities.model_validate(dumped) == caps


class TestRuntimeIdentity:
    def test_camelcase_round_trip(self):
        ident = RuntimeIdentity(runtime_type="claude", display_name="Claude Code")
        dumped = ident.model_dump(by_alias=True)
        assert dumped == {"runtimeType": "claude", "displayName": "Claude Code"}
        assert RuntimeIdentity.model_validate(dumped) == ident


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
            guidance_file: str | None = "CLAUDE.md"
            init_command: str | None = "claude init"
            guidance_template: str | None = "# stub"

            def capabilities(self):
                return RuntimeCapabilities(
                    permission_modes=[LabeledOption(value="default", label="default")],
                    effort_levels=[LabeledOption(value="auto", label="auto")],
                    models=[LabeledOption(value="claude-opus-4-8", label="Opus 4.8")],
                )

            def list_skills(self):
                return []

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
        assert set(get_args(RuntimeType)) == {"claude"}

    def test_protocol_signatures_are_async(self):
        # Spot-check method annotations exist and are coroutine functions.
        hints = get_type_hints(IAgentRuntime, include_extras=True)
        assert "runtime_type" in hints
        assert "display_name" in hints
        assert "guidance_file" in hints
        assert "init_command" in hints
        assert "guidance_template" in hints
        assert inspect.iscoroutinefunction(IAgentRuntime.run_session)
        assert inspect.iscoroutinefunction(IAgentRuntime.interrupt)

    def test_claude_runtime_declares_guidance_metadata(self):
        # Claude declares its repo-root convention so the onboarding scanner
        # doesn't have to hardcode it.
        from app.agent.runtime.claude.runtime import ClaudeRuntime

        assert ClaudeRuntime.guidance_file == "CLAUDE.md"
        assert ClaudeRuntime.init_command == "claude init"
        assert ClaudeRuntime.guidance_template is not None
        assert "Claude Code" in ClaudeRuntime.guidance_template
