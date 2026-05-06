"""Tests for lazy auto-creation of .bonsai/ meta-files."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.project import (
    BONSAI_SUBDIRS,
    ensure_meta_dir,
    ensure_meta_file,
    ensure_project,
)


class TestEnsureMetaFile:
    def test_creates_settings_when_missing(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        content = ensure_meta_file(bonsai_dir, "settings.json")
        data = json.loads(content)
        assert "default_model" in data
        assert (bonsai_dir / "settings.json").is_file()

    def test_returns_existing_content(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        bonsai_dir.mkdir()
        existing = '{"custom": true}'
        (bonsai_dir / "settings.json").write_text(existing, encoding="utf-8")
        content = ensure_meta_file(bonsai_dir, "settings.json")
        assert content == existing

    def test_never_overwrites_existing(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        bonsai_dir.mkdir()
        custom = '{"custom": true}'
        (bonsai_dir / "settings.json").write_text(custom, encoding="utf-8")
        content = ensure_meta_file(bonsai_dir, "settings.json")
        assert content == custom

    def test_unknown_file_raises(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        with pytest.raises(ValueError, match="Unknown meta-file"):
            ensure_meta_file(bonsai_dir, "unknown.json")

    def test_registry_is_unknown(self, tmp_path: Path) -> None:
        """registry.json is no longer a known meta-file."""
        bonsai_dir = tmp_path / ".bonsai"
        with pytest.raises(ValueError, match="Unknown meta-file"):
            ensure_meta_file(bonsai_dir, "registry.json")

    def test_creates_parent_dirs(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / "deep" / "nested" / ".bonsai"
        content = ensure_meta_file(bonsai_dir, "settings.json")
        assert (bonsai_dir / "settings.json").is_file()
        assert json.loads(content)["default_model"]

    def test_deleted_file_gets_regenerated(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        ensure_meta_file(bonsai_dir, "settings.json")
        assert (bonsai_dir / "settings.json").is_file()
        (bonsai_dir / "settings.json").unlink()
        assert not (bonsai_dir / "settings.json").is_file()
        content = ensure_meta_file(bonsai_dir, "settings.json")
        assert (bonsai_dir / "settings.json").is_file()
        assert "default_model" in json.loads(content)


class TestEnsureMetaDir:
    def test_creates_directory(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        result = ensure_meta_dir(bonsai_dir, "sessions")
        assert result.is_dir()
        assert result == bonsai_dir / "sessions"

    def test_idempotent(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        ensure_meta_dir(bonsai_dir, "sessions")
        ensure_meta_dir(bonsai_dir, "sessions")
        assert (bonsai_dir / "sessions").is_dir()

    def test_returns_path(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        p = ensure_meta_dir(bonsai_dir, "trash")
        assert p == bonsai_dir / "trash"


class TestEnsureProject:
    def test_creates_all_meta_files(self, tmp_path: Path) -> None:
        ensure_project(tmp_path)
        bonsai_dir = tmp_path / ".bonsai"
        assert (bonsai_dir / "settings.json").is_file()
        # Legacy meta-files are no longer created (single-user model)
        assert not (bonsai_dir / "registry.json").exists()

    def test_creates_all_subdirs(self, tmp_path: Path) -> None:
        ensure_project(tmp_path)
        bonsai_dir = tmp_path / ".bonsai"
        for name in BONSAI_SUBDIRS:
            assert (bonsai_dir / name).is_dir(), f"{name} dir not created"

    def test_idempotent_on_existing_project(self, tmp_path: Path) -> None:
        bonsai_dir = tmp_path / ".bonsai"
        bonsai_dir.mkdir()
        custom_settings = '{"custom": true}'
        (bonsai_dir / "settings.json").write_text(custom_settings, encoding="utf-8")
        ensure_project(tmp_path)
        assert (bonsai_dir / "settings.json").read_text(encoding="utf-8") == custom_settings
