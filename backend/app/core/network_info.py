"""Network information detection — hostname, LAN IPs, Tailscale status.

Used by the ``/api/server-info`` endpoint to help mobile clients discover
the server address.  All detection is best-effort; failures return safe
defaults rather than raising.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import shutil
import socket
import subprocess
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_CACHE_TTL = 60  # seconds


@dataclass
class TailscaleInfo:
    """Tailscale VPN status on this machine."""

    active: bool = False
    ip: str | None = None
    hostname: str | None = None


@dataclass
class ServerNetworkInfo:
    """Aggregated network information for the local server."""

    hostname: str = ""
    lan_ips: list[str] = field(default_factory=list)
    tailscale: TailscaleInfo = field(default_factory=TailscaleInfo)


# ── Detection helpers ────────────────────────────────────────────────────────


def get_hostname() -> str:
    """Return the machine hostname."""
    try:
        return socket.gethostname()
    except Exception:
        return "unknown"


def get_lan_ips() -> list[str]:
    """Return non-loopback IPv4 addresses for this machine (best-effort)."""
    ips: list[str] = []
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        for _family, _type, _proto, _canonname, sockaddr in infos:
            addr = sockaddr[0]
            if not addr.startswith("127."):
                if addr not in ips:
                    ips.append(addr)
    except Exception:
        logger.debug("Failed to enumerate LAN IPs via getaddrinfo", exc_info=True)

    # Fallback: connect to a public IP to discover the default route address
    if not ips:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                addr = s.getsockname()[0]
                if not addr.startswith("127."):
                    ips.append(addr)
        except Exception:
            pass

    return ips


def _is_tailscale_ip(addr: str) -> bool:
    """Check whether *addr* falls in the 100.64.0.0/10 CGNAT range used by Tailscale."""
    try:
        return ipaddress.ip_address(addr) in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return False


def get_tailscale_info(lan_ips: list[str] | None = None) -> TailscaleInfo:
    """Detect Tailscale status on this machine.

    1. Check if any LAN IP is in the ``100.64.0.0/10`` range.
    2. If so, try ``tailscale status --json`` to get the MagicDNS hostname.
    3. Fall back gracefully at every step.
    """
    if lan_ips is None:
        lan_ips = get_lan_ips()

    ts_ip: str | None = None
    for addr in lan_ips:
        if _is_tailscale_ip(addr):
            ts_ip = addr
            break

    if ts_ip is None:
        return TailscaleInfo(active=False)

    # Try to get MagicDNS hostname via CLI
    ts_hostname: str | None = None
    ts_bin = shutil.which("tailscale")
    if ts_bin:
        try:
            result = subprocess.run(
                [ts_bin, "status", "--json"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                dns_name = data.get("Self", {}).get("DNSName", "")
                if dns_name:
                    # Strip trailing dot (e.g. "my-machine.tailnet.ts.net." → "my-machine.tailnet.ts.net")
                    ts_hostname = dns_name.rstrip(".")
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
            logger.debug("Failed to query tailscale CLI: %s", exc)

    return TailscaleInfo(active=True, ip=ts_ip, hostname=ts_hostname)


# ── Cached aggregate ─────────────────────────────────────────────────────────

_cached_info: ServerNetworkInfo | None = None
_cached_at: float = 0


def get_server_network_info() -> ServerNetworkInfo:
    """Return cached network info (refreshed every 60 s)."""
    global _cached_info, _cached_at  # noqa: PLW0603

    now = time.monotonic()
    if _cached_info is not None and (now - _cached_at) < _CACHE_TTL:
        return _cached_info

    hostname = get_hostname()
    lan_ips = get_lan_ips()
    tailscale = get_tailscale_info(lan_ips)

    _cached_info = ServerNetworkInfo(
        hostname=hostname,
        lan_ips=lan_ips,
        tailscale=tailscale,
    )
    _cached_at = now
    return _cached_info
