"""Tests for ``RuntimeRegistry``."""

from __future__ import annotations

import pytest

from app.agent.runtime import (
    DuplicateRuntimeError,
    LabeledOption,
    RuntimeCapabilities,
    RuntimeRegistry,
    UnknownRuntimeError,
)


class _FakeRuntime:
    def __init__(
        self, runtime_type: str, models: list[LabeledOption] | None = None
    ) -> None:
        self.runtime_type = runtime_type
        self.display_name = runtime_type.title()
        self._models = models or [LabeledOption(value="default-model", label="Default")]

    def capabilities(self) -> RuntimeCapabilities:
        return RuntimeCapabilities(
            permission_modes=[LabeledOption(value="default", label="default")],
            effort_levels=[LabeledOption(value="auto", label="auto")],
            models=self._models,
        )

    async def run_session(self, *args, **kwargs):  # pragma: no cover - not exercised here
        raise NotImplementedError

    async def interrupt(self, *args, **kwargs):  # pragma: no cover
        raise NotImplementedError


class TestRegister:
    def test_register_and_get(self) -> None:
        reg = RuntimeRegistry()
        rt = _FakeRuntime("claude")
        reg.register(rt)
        assert reg.get("claude") is rt

    def test_double_register_raises(self) -> None:
        reg = RuntimeRegistry()
        reg.register(_FakeRuntime("claude"))
        with pytest.raises(DuplicateRuntimeError, match="already registered"):
            reg.register(_FakeRuntime("claude"))

    def test_missing_get_raises(self) -> None:
        reg = RuntimeRegistry()
        with pytest.raises(UnknownRuntimeError, match="not registered"):
            reg.get("codex")

    def test_has(self) -> None:
        reg = RuntimeRegistry()
        assert not reg.has("claude")
        reg.register(_FakeRuntime("claude"))
        assert reg.has("claude")


class TestAllOrdering:
    def test_returns_runtimes_sorted_by_runtime_type(self) -> None:
        reg = RuntimeRegistry()
        # Register out of alphabetical order; ``all()`` must still return sorted.
        reg.register(_FakeRuntime("codex"))
        reg.register(_FakeRuntime("claude"))
        types = [rt.runtime_type for rt in reg.all()]
        assert types == ["claude", "codex"]
