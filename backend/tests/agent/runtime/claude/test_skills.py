"""Tests for ``app.agent.runtime.claude.skills.ClaudeSkillRegistry``.

Moved from ``test_runtime.py`` by the Step 8 refactor: skill discovery
now lives in its own ``ClaudeSkillRegistry`` (mirroring ``ClaudeModelRegistry``)
so we exercise it directly instead of via ``ClaudeRuntime``.

The contract (scan order, dedup, mtime cache, silent failure) is unchanged
— the RPC-level test in ``tests/rpc/test_methods_settings.py`` is the
end-to-end check that ``skills/listRuntime`` still produces the same
wire shape as before.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from app.agent.runtime.claude.skills import ClaudeSkillRegistry


def _write_skill_md(path: Path, name: str, description: str) -> None:
    """Helper: create the parent dir and write a minimal SKILL.md."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\nname: {name}\ndescription: {description}\n---\nbody\n",
        encoding="utf-8",
    )


def _make_skill_registry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> tuple[ClaudeSkillRegistry, Path, Path]:
    """Build a registry whose ``~`` and project root point inside ``tmp_path``.

    Returns ``(registry, fake_home, project_root)`` so individual tests can
    seed fixture trees under either.
    """
    home = tmp_path / "home"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    # ``Path.home()`` reads HOME on POSIX, USERPROFILE on Windows; tests run
    # on Linux/macOS CI so HOME is sufficient.
    monkeypatch.setenv("HOME", str(home))
    registry = ClaudeSkillRegistry(project_root=project)
    return registry, home, project


class TestListSkills:
    """Coverage for ``ClaudeSkillRegistry.list_skills`` (design doc §5.2)."""

    def test_scans_user_skills(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        _write_skill_md(
            home / ".claude" / "skills" / "user-skill" / "SKILL.md",
            "User Skill", "A skill installed by the user",
        )

        skills = registry.list_skills()
        user_skill = next(s for s in skills if s.id == "user-skill")
        assert user_skill.source == "user"
        assert user_skill.name == "User Skill"
        assert user_skill.description == "A skill installed by the user"

    def test_scans_project_skills(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, _, project = _make_skill_registry(tmp_path, monkeypatch)
        _write_skill_md(
            project / ".claude" / "skills" / "proj-skill" / "SKILL.md",
            "Project Skill", "A project-local skill",
        )

        skills = registry.list_skills()
        proj_skill = next(s for s in skills if s.id == "proj-skill")
        assert proj_skill.source == "project"
        assert proj_skill.name == "Project Skill"

    def test_scans_plugin_skills_with_namespaced_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        _write_skill_md(
            home / ".claude" / "plugins" / "marketplaces" / "official"
            / "plugins" / "specdriven" / "skills" / "ticket-specify" / "SKILL.md",
            "Ticket Specify", "Create or modify specifications for a meta-ticket",
        )

        skills = registry.list_skills()
        plugin_skill = next(s for s in skills if s.id == "specdriven:ticket-specify")
        assert plugin_skill.source == "plugin"
        assert plugin_skill.name == "Ticket Specify"

    def test_scans_command_files(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        cmd_path = home / ".claude" / "commands" / "deploy.md"
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text(
            "---\nname: Deploy\ndescription: Deploy to staging\n---\nbody\n",
            encoding="utf-8",
        )

        skills = registry.list_skills()
        cmd = next(s for s in skills if s.id == "deploy")
        assert cmd.source == "command"
        assert cmd.description == "Deploy to staging"

    def test_builtins_always_included(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, _, _ = _make_skill_registry(tmp_path, monkeypatch)
        skills = registry.list_skills()
        builtin_ids = {s.id for s in skills if s.source == "builtin"}
        # Matches the static list in skills.py (_BUILTIN_SKILLS)
        assert builtin_ids == {"init", "review", "security-review"}

    def test_dedup_user_wins_over_project(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, home, project = _make_skill_registry(tmp_path, monkeypatch)
        _write_skill_md(
            home / ".claude" / "skills" / "shared" / "SKILL.md",
            "From User", "user-version",
        )
        _write_skill_md(
            project / ".claude" / "skills" / "shared" / "SKILL.md",
            "From Project", "project-version",
        )

        skills = registry.list_skills()
        matches = [s for s in skills if s.id == "shared"]
        assert len(matches) == 1
        assert matches[0].source == "user"
        assert matches[0].description == "user-version"

    def test_dedup_user_wins_over_builtin(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        # User overrides the bundled ``review`` built-in
        _write_skill_md(
            home / ".claude" / "skills" / "review" / "SKILL.md",
            "Custom Review", "user override",
        )

        skills = registry.list_skills()
        matches = [s for s in skills if s.id == "review"]
        assert len(matches) == 1
        assert matches[0].source == "user"

    def test_missing_roots_skipped_silently(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Don't create ~/.claude or <project>/.claude at all
        registry, _, _ = _make_skill_registry(tmp_path, monkeypatch)

        skills = registry.list_skills()  # must not raise
        # Only the static built-ins should appear
        assert {s.id for s in skills} == {"init", "review", "security-review"}

    def test_malformed_skill_md_is_logged_and_skipped(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        # Malformed: missing description (frontmatter parses, but the skill
        # is unusable for autocomplete — it must be skipped with a warning).
        bad_path = home / ".claude" / "skills" / "broken" / "SKILL.md"
        bad_path.parent.mkdir(parents=True, exist_ok=True)
        bad_path.write_text("---\nname: Broken\n---\nbody\n", encoding="utf-8")

        with caplog.at_level("WARNING"):
            skills = registry.list_skills()
        assert all(s.id != "broken" for s in skills)
        assert any("broken" in rec.getMessage() or "Skipping" in rec.getMessage()
                   for rec in caplog.records)

    def test_unparseable_md_does_not_raise(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A SKILL.md that raises during frontmatter parsing is dropped.

        Patches ``_parse_frontmatter`` at the skills-module seam so we can
        prove the scan survives a parser failure on an individual file.
        """
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        bad = home / ".claude" / "skills" / "wonky" / "SKILL.md"
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_text("---\nname: Wonky\ndescription: ok\n---\n", encoding="utf-8")

        with patch(
            "app.agent.runtime.claude.skills._parse_frontmatter",
            side_effect=ValueError("boom"),
        ):
            skills = registry.list_skills()
        assert all(s.id != "wonky" for s in skills)

    def test_mtime_cache_hit_avoids_reparse(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        _write_skill_md(
            home / ".claude" / "skills" / "cached" / "SKILL.md",
            "Cached", "A cached skill",
        )

        from app.agent.runtime.claude import skills as skills_mod
        real_parse = skills_mod._parse_frontmatter
        with patch.object(
            skills_mod, "_parse_frontmatter",
            side_effect=real_parse,
        ) as mock_parse:
            first = registry.list_skills()
            call_count_after_first = mock_parse.call_count
            assert call_count_after_first >= 1

            second = registry.list_skills()
            # Cache hit: no further frontmatter parses
            assert mock_parse.call_count == call_count_after_first

        assert [s.id for s in first] == [s.id for s in second]

    def test_mtime_cache_invalidates_when_root_changes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        registry, home, _ = _make_skill_registry(tmp_path, monkeypatch)
        skills_root = home / ".claude" / "skills"
        _write_skill_md(skills_root / "first" / "SKILL.md", "First", "first skill")

        ids_before = {s.id for s in registry.list_skills() if s.source == "user"}
        assert ids_before == {"first"}

        # Add a new skill directory.  Creating it changes the mtime of
        # ``skills_root``, which the cache key uses.
        _write_skill_md(skills_root / "second" / "SKILL.md", "Second", "second skill")
        # Bump mtime explicitly in case the test FS clock granularity is too
        # coarse to register the directory write as a distinct mtime tick.
        import os as _os
        new_mtime = skills_root.stat().st_mtime + 5
        _os.utime(skills_root, (new_mtime, new_mtime))

        ids_after = {s.id for s in registry.list_skills() if s.source == "user"}
        assert ids_after == {"first", "second"}

    def test_unexpected_error_returns_empty_list(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The whole call is wrapped so a runtime fault never bubbles up."""
        registry, _, _ = _make_skill_registry(tmp_path, monkeypatch)
        with patch.object(
            ClaudeSkillRegistry, "_list_skills_uncached",
            side_effect=RuntimeError("fs went away"),
        ):
            assert registry.list_skills() == []
