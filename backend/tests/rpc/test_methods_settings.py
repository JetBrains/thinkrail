"""Contract tests for ``settings`` RPC handlers — grouped wire shape."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from jsonrpcserver import JsonRpcError

from app.agent.runtime import (
    LabeledOption,
    RuntimeCapabilities,
    RuntimeRegistry,
    RuntimeSkillInfo,
)
from app.rpc.errors import UNKNOWN_RUNTIME, VALIDATION_ERROR
from app.rpc.methods.settings import (
    list_runtime_skills,
    runtimes_capabilities,
    runtimes_list,
)


def _caps(models: list[str]) -> RuntimeCapabilities:
    return RuntimeCapabilities(
        permission_modes=[LabeledOption(value="default", label="default")],
        effort_levels=[LabeledOption(value="auto", label="auto")],
        models=[LabeledOption(value=m, label=m) for m in models],
    )


def _fake_runtime(
    rt: str, models: list[str], display: str | None = None,
) -> MagicMock:
    runtime = MagicMock()
    runtime.runtime_type = rt
    runtime.display_name = display or rt.title()
    runtime.capabilities = MagicMock(return_value=_caps(models))
    return runtime


def _success(result_or_response: Any) -> Any:
    """Extract the payload from a jsonrpcserver ``Success(value)``."""
    return result_or_response._value.result


@pytest.mark.asyncio
class TestRuntimesList:
    async def test_returns_registered_identity_with_display_name(self) -> None:
        # The RPC maps each registered runtime to its wire identity,
        # passing ``displayName`` through from the runtime. Sort order is
        # a registry guarantee, covered by ``test_registry`` directly.
        reg = RuntimeRegistry()
        reg.register(_fake_runtime("claude", ["claude-opus-4-8"], display="Claude Code"))

        result = _success(await runtimes_list(reg))

        assert [r["runtimeType"] for r in result["runtimes"]] == ["claude"]
        assert result["runtimes"][0]["displayName"] == "Claude Code"

    async def test_identity_has_no_models(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_fake_runtime("claude", ["claude-opus-4-8"]))
        result = _success(await runtimes_list(reg))
        assert set(result["runtimes"][0].keys()) == {"runtimeType", "displayName"}

    async def test_empty_registry_returns_empty_list(self) -> None:
        reg = RuntimeRegistry()
        result = _success(await runtimes_list(reg))
        assert result == {"runtimes": []}


@pytest.mark.asyncio
class TestRuntimesCapabilities:
    async def test_returns_camel_case_capability_lists(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_fake_runtime("claude", ["claude-opus-4-8", "claude-sonnet-4-6"]))

        result = _success(await runtimes_capabilities(reg, runtimeType="claude"))

        assert set(result.keys()) == {
            "permissionModes", "effortLevels", "models", "flags", "modelCapabilities",
        }
        assert result["permissionModes"][0]["value"] == "default"
        assert result["effortLevels"][0]["value"] == "auto"
        assert [m["value"] for m in result["models"]] == [
            "claude-opus-4-8", "claude-sonnet-4-6",
        ]

    async def test_invalid_runtime_type_raises_validation_error(self) -> None:
        # A value outside the RuntimeType literal is rejected by
        # ``RuntimesCapabilitiesRequest`` before the registry lookup.
        reg = RuntimeRegistry()
        reg.register(_fake_runtime("claude", ["claude-opus-4-8"]))

        with pytest.raises(JsonRpcError) as exc_info:
            await runtimes_capabilities(reg, runtimeType="bogus")
        assert exc_info.value.code == VALIDATION_ERROR


def _skill(skill_id: str, source: str = "user") -> RuntimeSkillInfo:
    return RuntimeSkillInfo(
        id=skill_id,
        name=skill_id.title(),
        description=f"{skill_id} description",
        source=source,
    )


def _fake_runtime_with_skills(
    rt: str, skills: list[RuntimeSkillInfo], display: str | None = None,
) -> MagicMock:
    runtime = MagicMock()
    runtime.runtime_type = rt
    runtime.display_name = display or rt.title()
    runtime.list_skills = MagicMock(return_value=skills)
    return runtime


@pytest.mark.asyncio
class TestListRuntimeSkills:
    """Wire-shape + dispatch + error-mapping for ``skills/listRuntime``."""

    async def test_dispatches_to_named_runtime(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_fake_runtime_with_skills(
            "claude",
            [_skill("review", source="user"), _skill("init", source="builtin")],
        ))

        result = _success(await list_runtime_skills(reg, runtime="claude"))
        ids = [s["id"] for s in result]
        assert ids == ["review", "init"]

    async def test_returns_camel_case_wire_shape(self) -> None:
        # Single-word keys → camelCase == snake_case; assert the contract
        # nonetheless so a future field rename can't silently break clients.
        reg = RuntimeRegistry()
        reg.register(_fake_runtime_with_skills(
            "claude",
            [_skill("spec-status", source="plugin")],
        ))

        result = _success(await list_runtime_skills(reg, runtime="claude"))
        entry = result[0]
        assert set(entry.keys()) == {"id", "name", "description", "source"}
        assert entry["id"] == "spec-status"
        assert entry["source"] == "plugin"

    async def test_returns_empty_when_runtime_has_no_skills(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_fake_runtime_with_skills("claude", []))

        result = _success(await list_runtime_skills(reg, runtime="claude"))
        assert result == []

    async def test_picks_correct_runtime_when_multiple_registered(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_fake_runtime_with_skills(
            "claude", [_skill("claude-only-skill")],
        ))
        reg.register(_fake_runtime_with_skills(
            "zeta", [_skill("zeta-only-skill")],
        ))

        claude_res = _success(await list_runtime_skills(reg, runtime="claude"))
        zeta_res = _success(await list_runtime_skills(reg, runtime="zeta"))
        assert [s["id"] for s in claude_res] == ["claude-only-skill"]
        assert [s["id"] for s in zeta_res] == ["zeta-only-skill"]

    async def test_unknown_runtime_raises_rpc_error_32031(self) -> None:
        # registry.get for a runtime with no registered instance raises
        # UnknownRuntimeError, which the decorator must map to -32031.
        reg = RuntimeRegistry()
        reg.register(_fake_runtime_with_skills("claude", []))

        with pytest.raises(JsonRpcError) as exc_info:
            await list_runtime_skills(reg, runtime="ghost")
        # JsonRpcError exposes the error code on ``.code`` (jsonrpcserver
        # 6.x).  Compare against the constant so a future code change is
        # caught here rather than only at the protocol layer.
        assert exc_info.value.code == UNKNOWN_RUNTIME
        assert UNKNOWN_RUNTIME == -32031

    async def test_missing_runtime_param_raises_invalid_params(self) -> None:
        # Omitting ``runtime`` makes Python raise TypeError, which the
        # decorator maps to INVALID_PARAMS (-32602) — not -32031, since
        # this is a wire-shape error, not a domain error.
        reg = RuntimeRegistry()
        reg.register(_fake_runtime_with_skills("claude", []))

        with pytest.raises(JsonRpcError) as exc_info:
            await list_runtime_skills(reg)  # type: ignore[call-arg]
        assert exc_info.value.code == -32602
