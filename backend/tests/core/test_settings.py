"""Tests for ProjectSettings model."""

from app.core.settings import ProjectSettings


def test_default_font_sizes():
    s = ProjectSettings()
    assert s.font_size == 13
    assert s.compact_font_size == 9


def test_custom_font_sizes():
    s = ProjectSettings(font_size=16, compact_font_size=11)
    assert s.font_size == 16
    assert s.compact_font_size == 11


def test_font_sizes_in_json_roundtrip():
    s = ProjectSettings(font_size=16, compact_font_size=11)
    data = s.model_dump()
    s2 = ProjectSettings.model_validate(data)
    assert s2.font_size == 16
    assert s2.compact_font_size == 11


def test_extra_fields_preserved():
    s = ProjectSettings.model_validate({"font_size": 14, "custom_key": "hello"})
    assert s.font_size == 14
    assert s.model_dump()["custom_key"] == "hello"


def test_voice_revise_mode_default():
    assert ProjectSettings().voice_revise_mode == "off"


def test_voice_revise_mode_roundtrip():
    for mode in ("auto", "subsession", "off"):
        s = ProjectSettings(voice_revise_mode=mode)
        assert ProjectSettings.model_validate(s.model_dump()).voice_revise_mode == mode


class TestTicketsSubagentFailurePolicy:
    def test_default_is_fail_fast(self) -> None:
        assert ProjectSettings().tickets.subagent_failure_policy == "fail-fast"

    def test_explicit_wait_all_via_camelcase_alias(self) -> None:
        s = ProjectSettings.model_validate(
            {"tickets": {"subagentFailurePolicy": "wait-all"}}
        )
        assert s.tickets.subagent_failure_policy == "wait-all"

    def test_explicit_wait_all_via_snake_case(self) -> None:
        s = ProjectSettings.model_validate(
            {"tickets": {"subagent_failure_policy": "wait-all"}}
        )
        assert s.tickets.subagent_failure_policy == "wait-all"

    def test_invalid_value_falls_back_to_default(self) -> None:
        s = ProjectSettings.model_validate(
            {"tickets": {"subagentFailurePolicy": "nonsense"}}
        )
        assert s.tickets.subagent_failure_policy == "fail-fast"

    def test_missing_tickets_namespace_uses_default(self) -> None:
        # A settings file that doesn't mention tickets at all still yields the default.
        s = ProjectSettings.model_validate({"font_size": 14})
        assert s.tickets.subagent_failure_policy == "fail-fast"
