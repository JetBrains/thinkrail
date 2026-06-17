"""Tests for project-state detection used by ``/api/project/validate``."""

from __future__ import annotations

from pathlib import Path

from app.api.routers.project import _detect_project_state


class TestDetectProjectState:
    def test_empty_folder_is_new(self, tmp_path: Path) -> None:
        assert _detect_project_state(tmp_path) == "new"

    def test_folder_with_only_dotfiles_is_new(self, tmp_path: Path) -> None:
        # Stray dotfiles (.tr/, .DS_Store, etc.) don't change the
        # workspace's "new" verdict.
        (tmp_path / ".tr" / "cache").mkdir(parents=True)
        (tmp_path / ".tr" / "cache" / "models.json").write_text("[]")
        (tmp_path / ".DS_Store").write_text("")
        assert _detect_project_state(tmp_path) == "new"

    def test_half_baked_new_project_session_is_still_new(self, tmp_path: Path) -> None:
        # Session started but no deliverable yet — user should still see
        # the welcome screen on reopen (per product decision).
        sessions = tmp_path / ".tr" / "sessions"
        sessions.mkdir(parents=True)
        (sessions / "abc.json").write_text("{}")
        assert _detect_project_state(tmp_path) == "new"

    def test_non_empty_folder_without_specs_is_existing(self, tmp_path: Path) -> None:
        (tmp_path / "README.md").write_text("hi")
        assert _detect_project_state(tmp_path) == "existing"

    def test_goal_requirements_alone_is_existing(self, tmp_path: Path) -> None:
        # Goal&requirements is the first onboarding artifact — on its own
        # the user is still mid-onboarding, so the investigate flow should
        # pick the project up rather than skipping straight to a session.
        (tmp_path / "GOAL&REQUIREMENTS.md").write_text("# Project\n\nOverview...")
        assert _detect_project_state(tmp_path) == "existing"

    def test_underscore_goal_variant_alone_is_existing(self, tmp_path: Path) -> None:
        (tmp_path / "GOAL_AND_REQUIREMENTS.md").write_text("# Project\n")
        assert _detect_project_state(tmp_path) == "existing"

    def test_design_doc_marks_initialized(self, tmp_path: Path) -> None:
        (tmp_path / "DESIGN_DOC.md").write_text("# Architecture\n")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_empty_goal_file_is_not_initialized(self, tmp_path: Path) -> None:
        # spec_save creates the file with at least a title — a zero-byte
        # file means nothing was actually persisted yet.
        (tmp_path / "GOAL&REQUIREMENTS.md").write_text("")
        assert _detect_project_state(tmp_path) == "existing"

    def test_design_doc_overrides_user_files(self, tmp_path: Path) -> None:
        (tmp_path / "src.py").write_text("print('hi')")
        (tmp_path / "DESIGN_DOC.md").write_text("# Architecture\n")
        assert _detect_project_state(tmp_path) == "initialized"

    # Agents typically write the spec INSIDE `.tr/` rather than at project
    # root. A goal spec there (with no later deliverable) keeps the project
    # "existing" so the investigate flow re-reads it instead of either
    # skipping onboarding or restarting it from scratch.
    def test_goal_inside_thinkrail_dir_is_existing(self, tmp_path: Path) -> None:
        thinkrail = tmp_path / ".tr"
        thinkrail.mkdir()
        (thinkrail / "GOAL&REQUIREMENTS.md").write_text("# Project\n")
        assert _detect_project_state(tmp_path) == "existing"

    def test_design_doc_inside_thinkrail_dir_marks_initialized(self, tmp_path: Path) -> None:
        thinkrail = tmp_path / ".tr"
        thinkrail.mkdir()
        (thinkrail / "DESIGN_DOC.md").write_text("# Architecture\n")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_board_tickets_mark_initialized(self, tmp_path: Path) -> None:
        # Once the user has board state, the project has clearly moved
        # past "new" — even if the spec is missing.
        mt = tmp_path / ".tr" / "meta-tickets"
        mt.mkdir(parents=True)
        (mt / "mt_abc.json").write_text("{}")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_saved_plan_marks_initialized(self, tmp_path: Path) -> None:
        plans = tmp_path / ".tr" / "plans"
        plans.mkdir(parents=True)
        (plans / "plan.json").write_text("{}")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_empty_meta_tickets_dir_does_not_mark_initialized(self, tmp_path: Path) -> None:
        # Watcher might create the empty dir before any ticket lands.
        (tmp_path / ".tr" / "meta-tickets").mkdir(parents=True)
        assert _detect_project_state(tmp_path) == "new"
