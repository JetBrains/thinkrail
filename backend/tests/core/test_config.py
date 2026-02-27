from pathlib import Path

import pytest

from app.core.config import AppConfig, load_config

class TestAppConfigMethods:
    def test_get_project_root(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_project_root() == tmp_path

    def test_get_spec_dir(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_spec_dir() == tmp_path / ".specs"

    def test_get_registry_path(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_registry_path() == tmp_path / ".specs" / "registry.json"


class TestLoadConfig:
    def test_returns_app_config(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert isinstance(cfg, AppConfig)
        assert cfg.project_root == tmp_path
        assert cfg.spec_dir == tmp_path / ".specs"
        assert cfg.host == "127.0.0.1"
        assert cfg.port == 8000

    def test_discovers_root_when_not_given(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        (tmp_path / ".specs").mkdir()
        monkeypatch.chdir(tmp_path)
        cfg = load_config()
        assert cfg.project_root == tmp_path
