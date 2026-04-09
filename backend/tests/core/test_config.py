from pathlib import Path

import pytest

from app.core.config import AppConfig, ServerSettings, load_config

class TestAppConfigMethods:
    def test_get_project_root(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_project_root() == tmp_path

    def test_get_bonsai_dir(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_bonsai_dir() == tmp_path / ".bonsai"

    def test_get_registry_path(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_registry_path() == tmp_path / ".bonsai" / "registry.json"


class TestLoadConfig:
    def test_returns_app_config(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert isinstance(cfg, AppConfig)
        assert cfg.project_root == tmp_path
        assert cfg.bonsai_dir == tmp_path / ".bonsai"

    def test_server_settings_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("BACKEND_PORT", raising=False)
        monkeypatch.delenv("BACKEND_HOST", raising=False)
        srv = ServerSettings(_env_file=None)
        assert srv.backend_port == 8080
        assert srv.backend_host == "0.0.0.0"

    def test_discovers_root_when_not_given(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        (tmp_path / ".bonsai").mkdir()
        monkeypatch.chdir(tmp_path)
        cfg = load_config()
        assert cfg.project_root == tmp_path
