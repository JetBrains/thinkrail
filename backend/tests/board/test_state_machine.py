from __future__ import annotations

import pytest

from app.board.state_machine import InvalidTransitionError, can_transition, validate_transition


class TestCanTransition:
    def test_same_status(self) -> None:
        assert can_transition("idea", "idea") is True

    def test_valid_forward(self) -> None:
        assert can_transition("idea", "specified") is True
        assert can_transition("specified", "planned") is True
        assert can_transition("planned", "executing") is True
        assert can_transition("executing", "done") is True

    def test_valid_backward(self) -> None:
        assert can_transition("done", "executing") is True
        assert can_transition("specified", "idea") is True
        assert can_transition("planned", "specified") is True

    def test_invalid_skip(self) -> None:
        assert can_transition("idea", "planned") is False
        assert can_transition("idea", "executing") is False

    def test_shortcut_to_done(self) -> None:
        assert can_transition("idea", "done") is True
        assert can_transition("specified", "done") is True
        assert can_transition("planned", "done") is True


class TestValidateTransition:
    def test_valid(self) -> None:
        validate_transition("idea", "specified")

    def test_invalid_raises(self) -> None:
        with pytest.raises(InvalidTransitionError) as exc_info:
            validate_transition("idea", "executing")
        assert exc_info.value.from_status == "idea"
        assert exc_info.value.to_status == "executing"
