"""Tests for app.agent.runtime.claude.models — static catalog registry."""

from __future__ import annotations

from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.types import LabeledOption


class TestClaudeModelRegistry:
    def test_list_options_returns_three_entries_in_declared_order(self) -> None:
        reg = ClaudeModelRegistry()
        values = [o.value for o in reg.list_options()]
        assert values == [
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001",
        ]

    def test_list_options_returns_labeled_options(self) -> None:
        reg = ClaudeModelRegistry()
        for o in reg.list_options():
            assert isinstance(o, LabeledOption)
            assert set(LabeledOption.model_fields) == {"value", "label"}

    def test_first_option_is_opus(self) -> None:
        reg = ClaudeModelRegistry()
        first = reg.list_options()[0]
        assert first.value == "claude-opus-4-8"
        assert first.label == "Opus 4.8"
