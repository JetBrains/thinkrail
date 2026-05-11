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
