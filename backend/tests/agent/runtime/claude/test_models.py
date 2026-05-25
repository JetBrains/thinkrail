"""Tests for app.agent.runtime.claude.models — static catalog registry."""

from __future__ import annotations

from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.types import DEFAULT_CONTEXT_WINDOW, ModelInfo


class TestClaudeModelRegistry:
    def test_list_models_returns_three_entries_in_declared_order(self) -> None:
        reg = ClaudeModelRegistry()
        ids = [m.id for m in reg.list_models()]
        assert ids == [
            "claude-opus-4-7",
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001",
        ]

    def test_list_models_returns_modelinfo_with_only_three_fields(self) -> None:
        reg = ClaudeModelRegistry()
        for m in reg.list_models():
            assert isinstance(m, ModelInfo)
            assert set(ModelInfo.model_fields) == {"id", "label", "context_window"}

    def test_get_context_window_opus_is_one_million(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.get_context_window("claude-opus-4-7") == 1_000_000

    def test_get_context_window_sonnet_is_one_million(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.get_context_window("claude-sonnet-4-6") == 1_000_000

    def test_get_context_window_haiku_is_two_hundred_thousand(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.get_context_window("claude-haiku-4-5-20251001") == 200_000

    def test_get_context_window_returns_default_for_unknown_id(self) -> None:
        reg = ClaudeModelRegistry()
        assert reg.get_context_window("nonexistent-model") == DEFAULT_CONTEXT_WINDOW
