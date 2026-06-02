from __future__ import annotations

import pytest

from app.board.state_machine import (
    InvalidTransitionError,
    can_transition,
    is_backward_transition,
    validate_transition,
)


class TestForwardTransitions:
    @pytest.mark.parametrize(
        "src,dst",
        [
            ("idea", "product-design"),
            ("product-design", "technical-design"),
            ("technical-design", "amend-specs"),
            ("amend-specs", "implementation-plan"),
            ("implementation-plan", "implementing"),
            ("implementing", "done"),
        ],
    )
    def test_allowed(self, src: str, dst: str) -> None:
        assert can_transition(src, dst)


class TestBackwardTransitions:
    @pytest.mark.parametrize(
        "src,dst",
        [
            ("product-design", "idea"),
            ("technical-design", "product-design"),
            ("amend-specs", "technical-design"),
            ("implementation-plan", "amend-specs"),
            ("implementing", "implementation-plan"),
            ("done", "implementing"),
        ],
    )
    def test_allowed(self, src: str, dst: str) -> None:
        assert can_transition(src, dst)

    def test_classifier(self) -> None:
        assert is_backward_transition("implementation-plan", "amend-specs")
        assert not is_backward_transition("amend-specs", "implementation-plan")
        assert is_backward_transition("done", "implementing")
        assert is_backward_transition("technical-design", "product-design")


class TestRejectedTransitions:
    @pytest.mark.parametrize(
        "src,dst",
        [
            ("idea", "done"),
            ("product-design", "done"),
            ("technical-design", "done"),
            ("amend-specs", "done"),
            ("implementation-plan", "done"),
            ("done", "idea"),
            ("done", "implementation-plan"),
            ("idea", "technical-design"),
            ("product-design", "amend-specs"),
            ("technical-design", "implementation-plan"),
            ("amend-specs", "implementing"),
        ],
    )
    def test_rejected(self, src: str, dst: str) -> None:
        assert not can_transition(src, dst)
        with pytest.raises(InvalidTransitionError):
            validate_transition(src, dst)


class TestSameStatus:
    def test_same_status_is_allowed(self) -> None:
        assert can_transition("idea", "idea") is True
        assert can_transition("done", "done") is True


class TestNextUnskippedStatus:
    def test_no_skip(self) -> None:
        from app.board.state_machine import next_unskipped_status
        assert next_unskipped_status("product-design", []) == "technical-design"

    def test_skips_one(self) -> None:
        from app.board.state_machine import next_unskipped_status
        assert next_unskipped_status("product-design", ["technical-design"]) == "amend-specs"

    def test_skips_many(self) -> None:
        from app.board.state_machine import next_unskipped_status
        skipped = ["technical-design", "amend-specs", "implementation-plan"]
        assert next_unskipped_status("product-design", skipped) == "implementing"

    def test_returns_done_when_all_skipped(self) -> None:
        from app.board.state_machine import next_unskipped_status
        skipped = ["technical-design", "amend-specs", "implementation-plan", "implementing"]
        assert next_unskipped_status("product-design", skipped) == "done"

    def test_at_done_stays_done(self) -> None:
        from app.board.state_machine import next_unskipped_status
        assert next_unskipped_status("done", []) == "done"


class TestIsSkippable:
    def test_excludes_idea_and_done(self) -> None:
        from app.board.state_machine import is_skippable
        assert is_skippable("idea") is False
        assert is_skippable("done") is False

    def test_all_middle_phases(self) -> None:
        from app.board.state_machine import is_skippable
        for s in (
            "product-design",
            "technical-design",
            "amend-specs",
            "implementation-plan",
            "implementing",
        ):
            assert is_skippable(s) is True
