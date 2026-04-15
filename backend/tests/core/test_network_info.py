"""Tests for the network_info module."""

from __future__ import annotations

from unittest.mock import patch

from app.core.network_info import (
    ServerNetworkInfo,
    TailscaleInfo,
    _is_tailscale_ip,
    get_hostname,
    get_lan_ips,
    get_server_network_info,
    get_tailscale_info,
)


class TestGetHostname:
    def test_returns_string(self) -> None:
        result = get_hostname()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_fallback_on_error(self) -> None:
        with patch("app.core.network_info.socket.gethostname", side_effect=OSError):
            assert get_hostname() == "unknown"


class TestGetLanIps:
    def test_returns_list(self) -> None:
        result = get_lan_ips()
        assert isinstance(result, list)

    def test_excludes_loopback(self) -> None:
        for ip in get_lan_ips():
            assert not ip.startswith("127.")


class TestIsTailscaleIp:
    def test_tailscale_range(self) -> None:
        assert _is_tailscale_ip("100.64.0.1") is True
        assert _is_tailscale_ip("100.100.100.100") is True
        assert _is_tailscale_ip("100.127.255.255") is True

    def test_non_tailscale(self) -> None:
        assert _is_tailscale_ip("192.168.1.1") is False
        assert _is_tailscale_ip("10.0.0.1") is False
        assert _is_tailscale_ip("127.0.0.1") is False

    def test_invalid_address(self) -> None:
        assert _is_tailscale_ip("not-an-ip") is False


class TestGetTailscaleInfo:
    def test_no_tailscale_ip(self) -> None:
        result = get_tailscale_info(lan_ips=["192.168.1.5", "10.0.0.1"])
        assert result.active is False
        assert result.ip is None
        assert result.hostname is None

    def test_tailscale_ip_no_cli(self) -> None:
        with patch("app.core.network_info.shutil.which", return_value=None):
            result = get_tailscale_info(lan_ips=["192.168.1.5", "100.100.1.2"])
        assert result.active is True
        assert result.ip == "100.100.1.2"
        assert result.hostname is None

    def test_tailscale_ip_with_cli(self) -> None:
        mock_status = '{"Self": {"DNSName": "my-machine.tailnet.ts.net."}}'
        with (
            patch("app.core.network_info.shutil.which", return_value="/usr/bin/tailscale"),
            patch("app.core.network_info.subprocess.run") as mock_run,
        ):
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = mock_status
            result = get_tailscale_info(lan_ips=["100.64.0.5"])

        assert result.active is True
        assert result.ip == "100.64.0.5"
        assert result.hostname == "my-machine.tailnet.ts.net"  # trailing dot stripped


class TestGetServerNetworkInfo:
    def test_returns_info(self) -> None:
        # Reset cache
        import app.core.network_info as mod
        mod._cached_info = None

        result = get_server_network_info()
        assert isinstance(result, ServerNetworkInfo)
        assert isinstance(result.hostname, str)
        assert isinstance(result.lan_ips, list)
        assert isinstance(result.tailscale, TailscaleInfo)

    def test_caching(self) -> None:
        import app.core.network_info as mod
        mod._cached_info = None

        first = get_server_network_info()
        second = get_server_network_info()
        assert first is second  # same object from cache
