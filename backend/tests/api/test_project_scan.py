"""Tests for ``/api/project/scan`` — onboarding "what we'll read" probe."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.routers.project import init_engine, scan_project
from app.api.schemas import InitEngineRequest


@pytest.mark.asyncio
class TestScanProjectImportantFiles:
    async def test_picks_up_readme_and_pyproject(self, tmp_path: Path) -> None:
        (tmp_path / "README.md").write_text("# Hello")
        (tmp_path / "pyproject.toml").write_text("[project]\nname='x'\n")

        result = await scan_project(path=str(tmp_path))

        names = {f.name for f in result.important_files}
        assert "README.md" in names
        assert "pyproject.toml" in names

    async def test_returns_file_size_and_description(self, tmp_path: Path) -> None:
        body = "# README\nhello"
        (tmp_path / "README.md").write_text(body)

        result = await scan_project(path=str(tmp_path))

        readme = next(f for f in result.important_files if f.name == "README.md")
        assert readme.size == len(body.encode())
        assert "overview" in readme.description.lower()

    async def test_ignores_unrelated_files(self, tmp_path: Path) -> None:
        (tmp_path / "main.py").write_text("print('x')")
        (tmp_path / "data.json").write_text("{}")

        result = await scan_project(path=str(tmp_path))

        assert result.important_files == []

    async def test_changelog_and_license_variants(self, tmp_path: Path) -> None:
        (tmp_path / "CHANGELOG.md").write_text("v1")
        (tmp_path / "LICENSE").write_text("MIT")

        result = await scan_project(path=str(tmp_path))

        names = {f.name for f in result.important_files}
        assert names == {"CHANGELOG.md", "LICENSE"}


@pytest.mark.asyncio
class TestScanProjectTopFolders:
    async def test_lists_top_level_dirs(self, tmp_path: Path) -> None:
        (tmp_path / "app").mkdir()
        (tmp_path / "tests").mkdir()
        (tmp_path / "app" / "main.py").write_text("")

        result = await scan_project(path=str(tmp_path))

        names = {f.name for f in result.top_folders}
        assert names == {"app", "tests"}

    async def test_ignores_build_and_vcs_dirs(self, tmp_path: Path) -> None:
        for ignored in (".git", "node_modules", "__pycache__", ".venv", "dist"):
            (tmp_path / ignored).mkdir()
        (tmp_path / "src").mkdir()

        result = await scan_project(path=str(tmp_path))

        names = {f.name for f in result.top_folders}
        assert names == {"src"}

    async def test_ignores_dotfolders(self, tmp_path: Path) -> None:
        (tmp_path / ".bonsai").mkdir()
        (tmp_path / ".github").mkdir()
        (tmp_path / "app").mkdir()

        result = await scan_project(path=str(tmp_path))

        names = {f.name for f in result.top_folders}
        assert names == {"app"}

    async def test_reports_entry_count(self, tmp_path: Path) -> None:
        app_dir = tmp_path / "app"
        app_dir.mkdir()
        (app_dir / "a.py").write_text("")
        (app_dir / "b.py").write_text("")
        (app_dir / "sub").mkdir()

        result = await scan_project(path=str(tmp_path))

        app = next(f for f in result.top_folders if f.name == "app")
        assert app.entry_count == 3

    async def test_entry_count_caps_at_500(self, tmp_path: Path) -> None:
        # Guards against a generated dir blowing up the scan.
        from app.api.routers.project import _ENTRY_COUNT_CAP

        big = tmp_path / "big"
        big.mkdir()
        for i in range(_ENTRY_COUNT_CAP + 50):
            (big / f"f{i}").write_text("")

        result = await scan_project(path=str(tmp_path))

        target = next(f for f in result.top_folders if f.name == "big")
        assert target.entry_count == _ENTRY_COUNT_CAP


@pytest.mark.asyncio
class TestScanProjectEngineGuidance:
    async def test_reports_claude_guidance_present(self, tmp_path: Path) -> None:
        (tmp_path / "CLAUDE.md").write_text("# Project guidance")

        result = await scan_project(path=str(tmp_path))

        claude = next(g for g in result.engine_guidance if g.engine == "claude")
        assert claude.file == "CLAUDE.md"
        assert claude.found is True
        assert claude.display_name == "Claude Code"
        assert claude.init_command == "claude init"

    async def test_reports_claude_guidance_missing(self, tmp_path: Path) -> None:
        result = await scan_project(path=str(tmp_path))

        claude = next(g for g in result.engine_guidance if g.engine == "claude")
        assert claude.found is False
        assert claude.init_command == "claude init"


@pytest.mark.asyncio
class TestScanProjectMissingDir:
    async def test_returns_empty_response_for_missing_path(self, tmp_path: Path) -> None:
        missing = tmp_path / "does-not-exist"

        result = await scan_project(path=str(missing))

        assert result.important_files == []
        assert result.top_folders == []
        assert result.engine_guidance == []


@pytest.mark.asyncio
class TestInitEngine:
    async def test_creates_claude_md_from_template(self, tmp_path: Path) -> None:
        result = await init_engine(
            InitEngineRequest(engine="claude", path=str(tmp_path)),
        )

        assert result.created is True
        assert result.file == "CLAUDE.md"
        assert result.init_command == "claude init"
        body = (tmp_path / "CLAUDE.md").read_text()
        assert "Claude Code" in body
        assert "claude init" in body  # template points user at the real command

    async def test_idempotent_when_file_exists(self, tmp_path: Path) -> None:
        existing = tmp_path / "CLAUDE.md"
        existing.write_text("# my own notes")

        result = await init_engine(
            InitEngineRequest(engine="claude", path=str(tmp_path)),
        )

        assert result.created is False
        # Existing content must not be clobbered.
        assert existing.read_text() == "# my own notes"

    async def test_unknown_engine_returns_404(self, tmp_path: Path) -> None:
        with pytest.raises(HTTPException) as info:
            await init_engine(
                InitEngineRequest(engine="nope", path=str(tmp_path)),
            )
        assert info.value.status_code == 404

    async def test_missing_directory_returns_404(self, tmp_path: Path) -> None:
        missing = tmp_path / "does-not-exist"
        with pytest.raises(HTTPException) as info:
            await init_engine(
                InitEngineRequest(engine="claude", path=str(missing)),
            )
        assert info.value.status_code == 404
