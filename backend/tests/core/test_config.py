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

    def test_server_settings_reads_env(self) -> None:
        srv = ServerSettings()
        assert isinstance(srv.backend_port, int)
        assert isinstance(srv.backend_host, str)

    def test_discovers_root_when_not_given(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        (tmp_path / ".bonsai").mkdir()
        monkeypatch.chdir(tmp_path)
        cfg = load_config()
        assert cfg.project_root == tmp_path
