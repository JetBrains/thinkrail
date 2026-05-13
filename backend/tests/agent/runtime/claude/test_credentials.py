"""Tests for app.agent.runtime.claude.credentials — resolving an Anthropic API key."""

from __future__ import annotations

import subprocess
from unittest.mock import patch

from app.agent.runtime.claude import credentials


class TestEnvVar:
    def test_env_var_returned_as_is(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-from-env")
        assert credentials.resolve_anthropic_api_key() == "sk-ant-from-env"

    def test_env_var_preferred_over_keychain(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-from-env")
        with patch.object(credentials, "_read_claude_code_managed_key", return_value="sk-ant-from-kc"):
            assert credentials.resolve_anthropic_api_key() == "sk-ant-from-env"

    def test_blank_env_var_ignored(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "   ")
        with patch.object(credentials, "_read_claude_code_managed_key", return_value="sk-ant-from-kc"):
            assert credentials.resolve_anthropic_api_key() == "sk-ant-from-kc"

    def test_missing_env_falls_through_to_keychain(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with patch.object(credentials, "_read_claude_code_managed_key", return_value="sk-ant-from-kc"):
            assert credentials.resolve_anthropic_api_key() == "sk-ant-from-kc"

    def test_no_sources_returns_none(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with patch.object(credentials, "_read_claude_code_managed_key", return_value=None):
            assert credentials.resolve_anthropic_api_key() is None


class TestReadClaudeCodeManagedKey:
    def _fake_completed(self, stdout: str, returncode: int = 0):
        return subprocess.CompletedProcess(
            args=[], returncode=returncode, stdout=stdout, stderr=""
        )

    def test_non_darwin_returns_none(self):
        with patch.object(credentials, "sys") as mock_sys:
            mock_sys.platform = "linux"
            assert credentials._read_claude_code_managed_key() is None

    def test_darwin_success(self):
        fake = self._fake_completed("sk-ant-api03-abcdef\n")
        with (
            patch.object(credentials, "sys") as mock_sys,
            patch.object(credentials.subprocess, "run", return_value=fake),
        ):
            mock_sys.platform = "darwin"
            assert credentials._read_claude_code_managed_key() == "sk-ant-api03-abcdef"

    def test_darwin_non_zero_returncode_returns_none(self):
        fake = self._fake_completed("", returncode=44)
        with (
            patch.object(credentials, "sys") as mock_sys,
            patch.object(credentials.subprocess, "run", return_value=fake),
        ):
            mock_sys.platform = "darwin"
            assert credentials._read_claude_code_managed_key() is None

    def test_non_api_key_format_rejected(self):
        """OAuth session tokens (stored under other services) must not be used."""
        fake = self._fake_completed("sess-abcdef-not-an-api-key\n")
        with (
            patch.object(credentials, "sys") as mock_sys,
            patch.object(credentials.subprocess, "run", return_value=fake),
        ):
            mock_sys.platform = "darwin"
            assert credentials._read_claude_code_managed_key() is None

    def test_security_binary_missing(self):
        with (
            patch.object(credentials, "sys") as mock_sys,
            patch.object(credentials.subprocess, "run", side_effect=FileNotFoundError()),
        ):
            mock_sys.platform = "darwin"
            assert credentials._read_claude_code_managed_key() is None

    def test_timeout(self):
        with (
            patch.object(credentials, "sys") as mock_sys,
            patch.object(
                credentials.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired(cmd="security", timeout=2.0),
            ),
        ):
            mock_sys.platform = "darwin"
            assert credentials._read_claude_code_managed_key() is None
