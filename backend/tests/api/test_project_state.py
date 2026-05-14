"""Tests for project-state detection used by ``/api/project/validate``."""

from __future__ import annotations

from pathlib import Path

from app.api.routers.project import _detect_project_state


class TestDetectProjectState:
    def test_empty_folder_is_new(self, tmp_path: Path) -> None:
        assert _detect_project_state(tmp_path) == "new"

    def test_folder_with_only_dotfiles_is_new(self, tmp_path: Path) -> None:
        # Background tasks (model-registry cache, etc.) may materialize
        # .bonsai/ before the user starts work — still a "new" workspace.
        (tmp_path / ".bonsai" / "cache").mkdir(parents=True)
        (tmp_path / ".bonsai" / "cache" / "models.json").write_text("[]")
        (tmp_path / ".DS_Store").write_text("")
        assert _detect_project_state(tmp_path) == "new"

    def test_half_baked_new_project_session_is_still_new(self, tmp_path: Path) -> None:
        # Session started but no deliverable yet — user should still see
        # the welcome screen on reopen (per product decision).
        sessions = tmp_path / ".bonsai" / "sessions"
        sessions.mkdir(parents=True)
        (sessions / "abc.json").write_text("{}")
        assert _detect_project_state(tmp_path) == "new"

    def test_non_empty_folder_without_specs_is_existing(self, tmp_path: Path) -> None:
        (tmp_path / "README.md").write_text("hi")
        assert _detect_project_state(tmp_path) == "existing"

    def test_goal_requirements_with_content_marks_initialized(self, tmp_path: Path) -> None:
        (tmp_path / "GOAL&REQUIREMENTS.md").write_text("# Project\n\nOverview...")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_underscore_variant_marks_initialized(self, tmp_path: Path) -> None:
        (tmp_path / "GOAL_AND_REQUIREMENTS.md").write_text("# Project\n")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_design_doc_marks_initialized(self, tmp_path: Path) -> None:
        (tmp_path / "DESIGN_DOC.md").write_text("# Architecture\n")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_empty_goal_file_is_not_initialized(self, tmp_path: Path) -> None:
        # spec_save creates the file with at least a title — a zero-byte
        # file means nothing was actually persisted yet.
        (tmp_path / "GOAL&REQUIREMENTS.md").write_text("")
        assert _detect_project_state(tmp_path) == "existing"

    def test_initialized_overrides_user_files(self, tmp_path: Path) -> None:
        (tmp_path / "src.py").write_text("print('hi')")
        (tmp_path / "GOAL&REQUIREMENTS.md").write_text("# Project\n")
        assert _detect_project_state(tmp_path) == "initialized"

    # Agents typically write the spec INSIDE `.bonsai/` rather than at
    # project root.  Both locations must register as "initialized" —
    # otherwise the user gets dragged back into the new-project flow
    # after a real session has finished.
    def test_spec_inside_bonsai_dir_marks_initialized(self, tmp_path: Path) -> None:
        bonsai = tmp_path / ".bonsai"
        bonsai.mkdir()
        (bonsai / "GOAL&REQUIREMENTS.md").write_text("# Project\n")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_board_tickets_mark_initialized(self, tmp_path: Path) -> None:
        # Once the user has board state, the project has clearly moved
        # past "new" — even if the spec is missing.
        mt = tmp_path / ".bonsai" / "meta-tickets"
        mt.mkdir(parents=True)
        (mt / "mt_abc.json").write_text("{}")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_saved_plan_marks_initialized(self, tmp_path: Path) -> None:
        plans = tmp_path / ".bonsai" / "plans"
        plans.mkdir(parents=True)
        (plans / "plan.json").write_text("{}")
        assert _detect_project_state(tmp_path) == "initialized"

    def test_empty_meta_tickets_dir_does_not_mark_initialized(self, tmp_path: Path) -> None:
        # Watcher might create the empty dir before any ticket lands.
        (tmp_path / ".bonsai" / "meta-tickets").mkdir(parents=True)
        assert _detect_project_state(tmp_path) == "new"
