"""Tests for the context assembly pipeline (context.py)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.agent.context import (
    _build_general_instructions,
    _build_specs_section,
    _parse_frontmatter,
    _scan_skill_frontmatter,
    build_context,
)
from app.agent.models import AgentConfig
from app.spec.models import SpecDetail


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_spec_detail(id: str, title: str, content: str) -> SpecDetail:
    return SpecDetail(
        id=id,
        type="module-design",
        path=f"specs/{id}/README.md",
        status="active",
        title=title,
        content=content,
    )


def _write_skill_md(skill_dir: Path, name: str, description: str, body: str = "# Skill body") -> None:
    """Create a SKILL.md file with frontmatter in the given skill directory."""
    skill_dir.mkdir(parents=True, exist_ok=True)
    content = f"---\nname: {name}\ndescription: {description}\n---\n\n{body}\n"
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# _parse_frontmatter
# ---------------------------------------------------------------------------

class TestParseFrontmatter:
    def test_valid_frontmatter(self) -> None:
        text = "---\nname: my-skill\ndescription: Does things\n---\n\n# Body"
        result = _parse_frontmatter(text)
        assert result["name"] == "my-skill"
        assert result["description"] == "Does things"

    def test_no_frontmatter(self) -> None:
        assert _parse_frontmatter("# Just markdown") == {}

    def test_no_closing_delimiter(self) -> None:
        assert _parse_frontmatter("---\nname: x\n# no closing") == {}

    def test_quoted_values(self) -> None:
        text = '---\nname: "quoted-skill"\ndescription: \'single quoted\'\n---\n'
        result = _parse_frontmatter(text)
        assert result["name"] == "quoted-skill"
        assert result["description"] == "single quoted"

    def test_empty_value_skipped(self) -> None:
        text = "---\nname:\ndescription: valid\n---\n"
        result = _parse_frontmatter(text)
        assert "name" not in result
        assert result["description"] == "valid"

    def test_comment_lines_ignored(self) -> None:
        text = "---\n# comment\nname: x\n---\n"
        result = _parse_frontmatter(text)
        assert result == {"name": "x"}

    def test_argument_hint_field(self) -> None:
        text = '---\nname: test\ndescription: Test skill\nargument-hint: "[path]"\n---\n'
        result = _parse_frontmatter(text)
        assert result["argument-hint"] == "[path]"


# ---------------------------------------------------------------------------
# _scan_skill_frontmatter
# ---------------------------------------------------------------------------

class TestScanSkillFrontmatter:
    def test_scans_multiple_skills(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        _write_skill_md(skills_dir / "alpha", "alpha", "Alpha skill")
        _write_skill_md(skills_dir / "beta", "beta", "Beta skill")
        _write_skill_md(skills_dir / "gamma", "gamma", "Gamma skill")

        result = _scan_skill_frontmatter(tmp_path)
        assert len(result) == 3
        assert result[0] == ("alpha", "Alpha skill")
        assert result[1] == ("beta", "Beta skill")
        assert result[2] == ("gamma", "Gamma skill")

    def test_sorted_by_directory_name(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        _write_skill_md(skills_dir / "zulu", "zulu", "Last")
        _write_skill_md(skills_dir / "alpha", "alpha", "First")

        result = _scan_skill_frontmatter(tmp_path)
        assert result[0][0] == "alpha"
        assert result[1][0] == "zulu"

    def test_skips_malformed_frontmatter(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        _write_skill_md(skills_dir / "good", "good", "Good skill")

        # Create a skill with no description
        bad_dir = skills_dir / "bad"
        bad_dir.mkdir(parents=True)
        (bad_dir / "SKILL.md").write_text("---\nname: bad\n---\n# No desc", encoding="utf-8")

        result = _scan_skill_frontmatter(tmp_path)
        assert len(result) == 1
        assert result[0][0] == "good"

    def test_missing_skills_dir(self, tmp_path: Path) -> None:
        result = _scan_skill_frontmatter(tmp_path)
        assert result == []

    def test_empty_skills_dir(self, tmp_path: Path) -> None:
        (tmp_path / "skills").mkdir()
        result = _scan_skill_frontmatter(tmp_path)
        assert result == []


# ---------------------------------------------------------------------------
# _build_general_instructions
# ---------------------------------------------------------------------------

class TestBuildGeneralInstructions:
    def test_starts_with_general_instructions_header(self, tmp_path: Path) -> None:
        (tmp_path / "skills").mkdir()
        result = _build_general_instructions(tmp_path)
        assert result.startswith("## General Instructions")

    def test_contains_all_five_subsections(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        _write_skill_md(skills_dir / "test-skill", "test-skill", "A test skill")

        result = _build_general_instructions(tmp_path)
        assert "### Visualization" in result
        assert "### Interaction Style" in result
        assert "### Spec-Driven Workflow" in result
        assert "### Proactive Suggestions" in result
        assert "### Available Skills" in result

    def test_visualization_subsection_content(self, tmp_path: Path) -> None:
        (tmp_path / "skills").mkdir()
        result = _build_general_instructions(tmp_path)
        assert "bonsai_visualize" in result
        assert "progress-tracker" in result
        assert "Anti-patterns" in result

    def test_interaction_style_content(self, tmp_path: Path) -> None:
        (tmp_path / "skills").mkdir()
        result = _build_general_instructions(tmp_path)
        assert "AskUserQuestion" in result
        assert "2-4 concrete" in result

    def test_proactive_suggestions_content(self, tmp_path: Path) -> None:
        (tmp_path / "skills").mkdir()
        result = _build_general_instructions(tmp_path)
        assert "SuggestSession" in result
        assert "Respect dismissals" in result

    def test_skills_table_populated(self, tmp_path: Path) -> None:
        skills_dir = tmp_path / "skills"
        _write_skill_md(skills_dir / "module-design", "module-design", "Design a module")
        _write_skill_md(skills_dir / "task-spec", "task-spec", "Create a task spec")

        result = _build_general_instructions(tmp_path)
        assert "| module-design | Design a module |" in result
        assert "| task-spec | Create a task spec |" in result

    def test_no_skills_shows_fallback(self, tmp_path: Path) -> None:
        (tmp_path / "skills").mkdir()
        result = _build_general_instructions(tmp_path)
        assert "No skills available" in result


# ---------------------------------------------------------------------------
# _build_specs_section
# ---------------------------------------------------------------------------

class TestBuildSpecsSection:
    def test_single_spec(self) -> None:
        spec_service = MagicMock()
        spec_service.get_spec.return_value = _make_spec_detail(
            "mod-a", "Module A", "Content A"
        )

        result = _build_specs_section(["mod-a"], spec_service)
        assert "## Specifications" in result
        assert "### Module A" in result
        assert "Content A" in result

    def test_multiple_specs_separated_by_hr(self) -> None:
        spec_service = MagicMock()
        spec_service.get_spec.side_effect = [
            _make_spec_detail("a", "Spec A", "Body A"),
            _make_spec_detail("b", "Spec B", "Body B"),
        ]

        result = _build_specs_section(["a", "b"], spec_service)
        assert "### Spec A" in result
        assert "### Spec B" in result
        assert "---" in result


# ---------------------------------------------------------------------------
# build_context (integration)
# ---------------------------------------------------------------------------

class TestBuildContext:
    def _make_plugin_dir(self, tmp_path: Path) -> Path:
        """Create a plugin dir with one skill for testing."""
        plugin = tmp_path / "plugin"
        _write_skill_md(
            plugin / "skills" / "test-skill",
            "test-skill",
            "A test skill",
            body="# Test skill\n\nDo the thing.",
        )
        return plugin

    def test_requires_plugin_dir(self) -> None:
        with pytest.raises(ValueError, match="plugin_dir is required"):
            build_context(
                spec_ids=[],
                skill_id=None,
                project_root=Path("/project"),
                config=AgentConfig(),
                spec_service=MagicMock(),
                plugin_dir=None,
            )

    def test_general_instructions_always_first(self, tmp_path: Path) -> None:
        plugin = self._make_plugin_dir(tmp_path)
        result = build_context(
            spec_ids=[],
            skill_id=None,
            project_root=Path("/my/project"),
            config=AgentConfig(),
            spec_service=MagicMock(),
            plugin_dir=plugin,
        )
        assert result.startswith("## General Instructions")

    def test_freeform_session_has_general_and_project(self, tmp_path: Path) -> None:
        """Free-form session (no skill, no specs) includes General Instructions + Project."""
        plugin = self._make_plugin_dir(tmp_path)
        result = build_context(
            spec_ids=[],
            skill_id=None,
            project_root=Path("/my/project"),
            config=AgentConfig(),
            spec_service=MagicMock(),
            plugin_dir=plugin,
        )
        assert "## General Instructions" in result
        assert "## Project" in result
        assert "Working directory: /my/project" in result
        # No skill or specs sections
        assert "## Your Task" not in result
        assert "## Specifications" not in result

    def test_skill_session_includes_skill_section(self, tmp_path: Path) -> None:
        plugin = self._make_plugin_dir(tmp_path)
        result = build_context(
            spec_ids=[],
            skill_id="test-skill",
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=MagicMock(),
            plugin_dir=plugin,
        )
        assert '## Your Task' in result
        assert 'You are running the "test-skill" skill.' in result
        assert "# Test skill" in result

    def test_skill_not_found_raises(self, tmp_path: Path) -> None:
        plugin = self._make_plugin_dir(tmp_path)
        with pytest.raises(FileNotFoundError, match="nonexistent"):
            build_context(
                spec_ids=[],
                skill_id="nonexistent",
                project_root=Path("/project"),
                config=AgentConfig(),
                spec_service=MagicMock(),
                plugin_dir=plugin,
            )

    def test_specs_included_when_provided(self, tmp_path: Path) -> None:
        plugin = self._make_plugin_dir(tmp_path)
        spec_service = MagicMock()
        spec_service.get_spec.return_value = _make_spec_detail(
            "mod-a", "Module A", "Module A content"
        )

        result = build_context(
            spec_ids=["mod-a"],
            skill_id=None,
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=spec_service,
            plugin_dir=plugin,
        )
        assert "## Specifications" in result
        assert "### Module A" in result
        assert "Module A content" in result

    def test_section_ordering(self, tmp_path: Path) -> None:
        """Verify sections appear in the correct order: General → Skill → Project → Specs."""
        plugin = self._make_plugin_dir(tmp_path)
        spec_service = MagicMock()
        spec_service.get_spec.return_value = _make_spec_detail(
            "s1", "Spec One", "Body"
        )

        result = build_context(
            spec_ids=["s1"],
            skill_id="test-skill",
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=spec_service,
            plugin_dir=plugin,
        )

        gi_pos = result.index("## General Instructions")
        task_pos = result.index("## Your Task")
        proj_pos = result.index("## Project")
        spec_pos = result.index("## Specifications")

        assert gi_pos < task_pos < proj_pos < spec_pos

    def test_no_viz_instructions_standalone(self, tmp_path: Path) -> None:
        """The old standalone '## Visualization Tool' section should not appear."""
        plugin = self._make_plugin_dir(tmp_path)
        result = build_context(
            spec_ids=[],
            skill_id=None,
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=MagicMock(),
            plugin_dir=plugin,
        )
        assert "## Visualization Tool" not in result
        # But visualization content IS present inside General Instructions
        assert "bonsai_visualize" in result

    def test_full_session_all_sections(self, tmp_path: Path) -> None:
        """Full session with skill + specs has all four sections."""
        plugin = self._make_plugin_dir(tmp_path)
        spec_service = MagicMock()
        spec_service.get_spec.side_effect = [
            _make_spec_detail("a", "Spec A", "Content A"),
            _make_spec_detail("b", "Spec B", "Content B"),
        ]

        result = build_context(
            spec_ids=["a", "b"],
            skill_id="test-skill",
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=spec_service,
            plugin_dir=plugin,
        )

        assert "## General Instructions" in result
        assert "## Your Task" in result
        assert "## Project" in result
        assert "## Specifications" in result
        assert "### Spec A" in result
        assert "### Spec B" in result

    def test_session_prompt_only_creates_task_section(self, tmp_path: Path) -> None:
        """session_prompt without skill_id still creates a Your Task section."""
        plugin = self._make_plugin_dir(tmp_path)
        result = build_context(
            spec_ids=[],
            skill_id=None,
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=MagicMock(),
            plugin_dir=plugin,
            session_prompt="Fix the login bug",
        )
        assert "## Your Task" in result
        assert "Fix the login bug" in result

    def test_session_prompt_with_skill(self, tmp_path: Path) -> None:
        """session_prompt + skill_id places prompt between header and skill body."""
        plugin = self._make_plugin_dir(tmp_path)
        result = build_context(
            spec_ids=[],
            skill_id="test-skill",
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=MagicMock(),
            plugin_dir=plugin,
            session_prompt="Focus on the auth module",
        )
        assert "## Your Task" in result
        assert 'You are running the "test-skill" skill.' in result
        assert "Focus on the auth module" in result
        assert "# Test skill" in result
        # Prompt appears before skill body
        prompt_pos = result.index("Focus on the auth module")
        body_pos = result.index("# Test skill")
        assert prompt_pos < body_pos

    def test_session_prompt_none_no_task_section(self, tmp_path: Path) -> None:
        """No skill and no session_prompt means no Your Task section."""
        plugin = self._make_plugin_dir(tmp_path)
        result = build_context(
            spec_ids=[],
            skill_id=None,
            project_root=Path("/project"),
            config=AgentConfig(),
            spec_service=MagicMock(),
            plugin_dir=plugin,
            session_prompt=None,
        )
        assert "## Your Task" not in result
