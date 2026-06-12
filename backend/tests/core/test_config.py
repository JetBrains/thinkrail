import socket
from pathlib import Path

import pytest

from app.core.config import (
    AppConfig,
    ServerSettings,
    find_free_port,
    load_config,
)

class TestAppConfigMethods:
    def test_get_project_root(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_project_root() == tmp_path

    def test_get_thinkrail_dir(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_thinkrail_dir() == tmp_path / ".tr"

    def test_get_thinkrail_dir_returns_path(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert cfg.get_thinkrail_dir().name == ".tr"


class TestLoadConfig:
    def test_returns_app_config(self, tmp_path: Path) -> None:
        cfg = load_config(tmp_path)
        assert isinstance(cfg, AppConfig)
        assert cfg.project_root == tmp_path
        assert cfg.thinkrail_dir == tmp_path / ".tr"

    def test_server_settings_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("BACKEND_PORT", raising=False)
        monkeypatch.delenv("BACKEND_HOST", raising=False)
        srv = ServerSettings(_env_file=None)
        assert srv.backend_port == 8000
        assert srv.backend_host == "127.0.0.1"

    def test_discovers_root_when_not_given(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        (tmp_path / ".tr").mkdir()
        monkeypatch.chdir(tmp_path)
        cfg = load_config()
        assert cfg.project_root == tmp_path


class TestFindFreePort:
    def test_returns_start_when_start_is_free(self) -> None:
        # Use find_free_port itself to pick a known-bindable port from a high
        # range, then re-query with probe_range=0 — the function must return
        # that exact port without advancing. Avoids the bind/close/rebind race
        # of trying to recycle a just-released ephemeral port.
        port = find_free_port(40000, probe_range=10000)
        assert find_free_port(port, probe_range=0) == port

    def test_skips_busy_port_and_returns_next_free(self) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as busy:
            busy.bind(("127.0.0.1", 0))
            busy_port = busy.getsockname()[1]
            chosen = find_free_port(busy_port)
            assert chosen > busy_port
            assert chosen <= busy_port + 10

    def test_raises_when_range_exhausted(self) -> None:
        held: list[socket.socket] = []
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", 0))
                start = probe.getsockname()[1]
            # Hold every port in [start, start+2] so probe_range=2 is exhausted.
            for offset in range(3):
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.bind(("127.0.0.1", start + offset))
                held.append(s)
            with pytest.raises(OSError):
                find_free_port(start, probe_range=2)
        finally:
            for s in held:
                s.close()
