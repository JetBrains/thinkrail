from __future__ import annotations

from app.agent.models import SessionConfig


class TestSessionConfig:
    def test_legacy_null_effort_coerced(self) -> None:
        cfg = SessionConfig.model_validate({"effort": None})
        assert cfg.effort == "auto"

    def test_unknown_fields_ignored(self) -> None:
        cfg = SessionConfig.model_validate({"model": "claude-opus-4-8", "gone": 1})
        assert cfg.model == "claude-opus-4-8"
