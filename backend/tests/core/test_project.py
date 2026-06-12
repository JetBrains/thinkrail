"""Tests for lazy auto-creation of .tr/ meta-files."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.project import (
    ensure_meta_dir,
    ensure_meta_file,
)


class TestEnsureMetaFile:
    def test_creates_settings_when_missing(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        content = ensure_meta_file(thinkrail_dir, "settings.json")
        data = json.loads(content)
        # ProjectSettings should hydrate with at least one known key. The
        # specific keys are project-scoped settings (font sizing, voice
        # revise mode, etc.) — session-creation defaults moved to the
        # user-scoped ``session_defaults`` AppStore record.
        assert "font_size" in data
        assert (thinkrail_dir / "settings.json").is_file()

    def test_returns_existing_content(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        thinkrail_dir.mkdir()
        existing = '{"custom": true}'
        (thinkrail_dir / "settings.json").write_text(existing, encoding="utf-8")
        content = ensure_meta_file(thinkrail_dir, "settings.json")
        assert content == existing

    def test_never_overwrites_existing(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        thinkrail_dir.mkdir()
        custom = '{"custom": true}'
        (thinkrail_dir / "settings.json").write_text(custom, encoding="utf-8")
        content = ensure_meta_file(thinkrail_dir, "settings.json")
        assert content == custom

    def test_unknown_file_raises(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        with pytest.raises(ValueError, match="Unknown meta-file"):
            ensure_meta_file(thinkrail_dir, "unknown.json")

    def test_registry_is_unknown(self, tmp_path: Path) -> None:
        """registry.json is no longer a known meta-file."""
        thinkrail_dir = tmp_path / ".tr"
        with pytest.raises(ValueError, match="Unknown meta-file"):
            ensure_meta_file(thinkrail_dir, "registry.json")

    def test_creates_parent_dirs(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / "deep" / "nested" / ".tr"
        content = ensure_meta_file(thinkrail_dir, "settings.json")
        assert (thinkrail_dir / "settings.json").is_file()
        assert json.loads(content)["font_size"]

    def test_deleted_file_gets_regenerated(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        ensure_meta_file(thinkrail_dir, "settings.json")
        assert (thinkrail_dir / "settings.json").is_file()
        (thinkrail_dir / "settings.json").unlink()
        assert not (thinkrail_dir / "settings.json").is_file()
        content = ensure_meta_file(thinkrail_dir, "settings.json")
        assert (thinkrail_dir / "settings.json").is_file()
        assert "font_size" in json.loads(content)


class TestEnsureMetaDir:
    def test_creates_directory(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        result = ensure_meta_dir(thinkrail_dir, "sessions")
        assert result.is_dir()
        assert result == thinkrail_dir / "sessions"

    def test_idempotent(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        ensure_meta_dir(thinkrail_dir, "sessions")
        ensure_meta_dir(thinkrail_dir, "sessions")
        assert (thinkrail_dir / "sessions").is_dir()

    def test_returns_path(self, tmp_path: Path) -> None:
        thinkrail_dir = tmp_path / ".tr"
        p = ensure_meta_dir(thinkrail_dir, "trash")
        assert p == thinkrail_dir / "trash"
