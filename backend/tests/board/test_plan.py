from __future__ import annotations

from pathlib import Path

from app.board.plan import (
    Milestone,
    Plan,
    PlanService,
    PlanStep,
    SuccessCriterion,
    _parse_plan,
    _render_plan,
)
from app.core.config import load_config


def _setup(tmp_path: Path) -> PlanService:
    bonsai_dir = tmp_path / ".bonsai"
    bonsai_dir.mkdir()
    return PlanService(load_config(tmp_path))


def _sample_plan() -> Plan:
    return Plan(
        ticket_id="mt_abc12345",
        title="Add auth system",
        status="draft",
        milestones=[
            Milestone(
                number=1,
                title="Auth Setup",
                steps=[
                    PlanStep(
                        number=1,
                        title="Create auth spec",
                        status="pending",
                        skill="module-design",
                        milestone_number=1,
                        input_spec_ids=["design-doc"],
                        success_criteria=[
                            SuccessCriterion(text="Spec file exists", checked=False),
                        ],
                    ),
                    PlanStep(
                        number=2,
                        title="Implement models",
                        status="pending",
                        skill="default",
                        milestone_number=1,
                        depends_on=[1],
                        input_spec_ids=["auth-module"],
                        success_criteria=[
                            SuccessCriterion(text="Tests pass", checked=False),
                            SuccessCriterion(text="Models defined", checked=False),
                        ],
                    ),
                ],
            ),
        ],
        verification=[
            SuccessCriterion(text="E2E auth flow works", checked=False),
        ],
    )


class TestRenderAndParse:
    def test_roundtrip(self) -> None:
        plan = _sample_plan()
        md = _render_plan(plan)
        parsed = _parse_plan(md, "mt_abc12345")
        assert parsed.title == "Add auth system"
        assert parsed.status == "draft"
        assert len(parsed.all_steps()) == 2
        assert parsed.all_steps()[0].title == "Create auth spec"
        assert parsed.all_steps()[0].skill == "module-design"
        assert parsed.all_steps()[1].depends_on == [1]
        assert len(parsed.all_steps()[1].success_criteria) == 2
        assert len(parsed.verification) == 1

    def test_render_checked_criteria(self) -> None:
        plan = _sample_plan()
        plan.milestones[0].steps[0].success_criteria[0].checked = True
        md = _render_plan(plan)
        assert "[x] Spec file exists" in md

    def test_parse_checked_criteria(self) -> None:
        plan = _sample_plan()
        plan.milestones[0].steps[0].success_criteria[0].checked = True
        md = _render_plan(plan)
        parsed = _parse_plan(md, "mt_abc12345")
        assert parsed.all_steps()[0].success_criteria[0].checked is True

    def test_render_with_session(self) -> None:
        plan = _sample_plan()
        plan.milestones[0].steps[0].session_id = "bonsai_sid_xyz"
        md = _render_plan(plan)
        assert "bonsai_sid_xyz" in md


class TestPlanService:
    def test_create_and_read(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        steps = _sample_plan().all_steps()
        plan = svc.create_plan("mt_test", "Test Plan", steps)
        assert plan.title == "Test Plan"
        assert svc.plan_exists("mt_test")

        loaded = svc.read_plan("mt_test")
        assert loaded.title == "Test Plan"
        assert len(loaded.all_steps()) == 2

    def test_read_missing_raises(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        import pytest
        with pytest.raises(FileNotFoundError):
            svc.read_plan("mt_nonexistent")

    def test_update_step_status(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        svc.create_plan("mt_test", "Test", _sample_plan().all_steps())
        updated = svc.update_step_status("mt_test", 1, "done", session_id="sid1")
        assert updated.all_steps()[0].status == "done"
        assert updated.all_steps()[0].session_id == "sid1"

    def test_plan_auto_status_executing(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        svc.create_plan("mt_test", "Test", _sample_plan().all_steps())
        updated = svc.update_step_status("mt_test", 1, "executing")
        assert updated.status == "executing"

    def test_plan_auto_status_done(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        svc.create_plan("mt_test", "Test", _sample_plan().all_steps())
        svc.update_step_status("mt_test", 1, "done")
        updated = svc.update_step_status("mt_test", 2, "done")
        assert updated.status == "done"

    def test_check_criterion(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        svc.create_plan("mt_test", "Test", _sample_plan().all_steps())
        updated = svc.check_criterion("mt_test", 1, 0, True)
        assert updated.all_steps()[0].success_criteria[0].checked is True

    def test_get_next_step(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        svc.create_plan("mt_test", "Test", _sample_plan().all_steps())
        # Step 1 has no deps, so it's next
        next_step = svc.get_next_step("mt_test")
        assert next_step is not None
        assert next_step.number == 1

    def test_get_next_step_respects_deps(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        svc.create_plan("mt_test", "Test", _sample_plan().all_steps())
        svc.update_step_status("mt_test", 1, "done")
        next_step = svc.get_next_step("mt_test")
        assert next_step is not None
        assert next_step.number == 2

    def test_get_next_step_blocked(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        # Only step 2 with dep on step 1
        steps = [PlanStep(number=2, title="Blocked", depends_on=[1])]
        svc.create_plan("mt_test", "Test", steps)
        next_step = svc.get_next_step("mt_test")
        assert next_step is None

    def test_get_next_step_all_done(self, tmp_path: Path) -> None:
        svc = _setup(tmp_path)
        svc.create_plan("mt_test", "Test", _sample_plan().all_steps())
        svc.update_step_status("mt_test", 1, "done")
        svc.update_step_status("mt_test", 2, "done")
        next_step = svc.get_next_step("mt_test")
        assert next_step is None
