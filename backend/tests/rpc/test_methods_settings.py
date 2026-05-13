"""Contract tests for ``settings`` RPC handlers — grouped wire shape."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.agent.runtime import (
    ModelInfo,
    RuntimeRegistry,
)
from app.rpc.methods.settings import list_models


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
