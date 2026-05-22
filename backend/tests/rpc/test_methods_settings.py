"""Contract tests for ``settings`` RPC handlers — grouped wire shape."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from jsonrpcserver import JsonRpcError

from app.agent.runtime import (
    ModelInfo,
    RuntimeRegistry,
    RuntimeSkillInfo,
)
from app.rpc.errors import UNKNOWN_RUNTIME
from app.rpc.methods.settings import list_models, list_runtime_skills


def _fake_runtime(rt: str, models: list[ModelInfo], display: str | None = None) -> MagicMock:
    runtime = MagicMock()
    runtime.runtime_type = rt
    runtime.display_name = display or rt.title()
    runtime.list_models = MagicMock(return_value=models)
    return runtime


def _model(model_id: str, *, ctx: int = 1_000_000) -> ModelInfo:
    return ModelInfo(
        id=model_id,
        label=model_id,
        group="current",
        context_window=ctx,
        max_output=64_000,
        pricing_tier="opus",
    )


def _success(result_or_response: Any) -> Any:
    """Extract the payload from a jsonrpcserver ``Success(value)``."""
    return result_or_response._value.result


@pytest.mark.asyncio
class TestListModels:
    async def test_returns_runtimes_object_with_grouped_models(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_fake_runtime("claude", [_model("claude-opus-4-7")], display="Claude Code"))
        reg.register(_fake_runtime("codex", [_model("gpt-5", ctx=400_000)], display="Codex"))

        result = _success(await list_models(reg))

        assert "runtimes" in result
        runtimes = result["runtimes"]
        # ``RuntimeRegistry.all()`` is sorted by ``runtime_type``.
        assert [r["runtimeType"] for r in runtimes] == ["claude", "codex"]
        assert runtimes[0]["displayName"] == "Claude Code"
        assert runtimes[1]["displayName"] == "Codex"

    async def test_each_group_carries_its_own_models(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_fake_runtime("claude", [_model("claude-opus-4-7")]))
        reg.register(_fake_runtime("codex", [_model("gpt-5", ctx=400_000)]))

        result = _success(await list_models(reg))
        runtimes = {r["runtimeType"]: r for r in result["runtimes"]}

        claude_ids = [m["id"] for m in runtimes["claude"]["models"]]
        codex_ids = [m["id"] for m in runtimes["codex"]["models"]]
        assert claude_ids == ["claude-opus-4-7"]
        assert codex_ids == ["gpt-5"]

    async def test_model_entries_do_not_duplicate_runtime_field(self) -> None:
        # Runtime is on the group, not on every model entry.
        reg = RuntimeRegistry()
        reg.register(_fake_runtime("claude", [_model("claude-opus-4-7")]))

        result = _success(await list_models(reg))
        model = result["runtimes"][0]["models"][0]
        assert "runtime" not in model

    async def test_empty_registry_returns_empty_runtimes_list(self) -> None:
        reg = RuntimeRegistry()
        result = _success(await list_models(reg))
        assert result == {"runtimes": []}


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
            "codex", [_skill("codex-only-skill")],
        ))

        claude_res = _success(await list_runtime_skills(reg, runtime="claude"))
        codex_res = _success(await list_runtime_skills(reg, runtime="codex"))
        assert [s["id"] for s in claude_res] == ["claude-only-skill"]
        assert [s["id"] for s in codex_res] == ["codex-only-skill"]

    async def test_unknown_runtime_raises_rpc_error_32031(self) -> None:
        # No Codex runtime registered — registry.get("codex") raises
        # UnknownRuntimeError, which the decorator must map to -32031.
        reg = RuntimeRegistry()
        reg.register(_fake_runtime_with_skills("claude", []))

        with pytest.raises(JsonRpcError) as exc_info:
            await list_runtime_skills(reg, runtime="codex")
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
