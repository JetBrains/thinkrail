"""REST endpoint for server network information (no auth required).

Exposes hostname, LAN IPs, and Tailscale status so that mobile clients
can discover the correct address to connect to.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.schemas import ServerInfoResponse, TailscaleInfoResponse
from app.core.network_info import get_server_network_info
from app.version import VERSION

router = APIRouter(tags=["server"])


@router.get("/api/server-info", response_model=ServerInfoResponse)
async def server_info() -> ServerInfoResponse:
    info = get_server_network_info()
    return ServerInfoResponse(
        hostname=info.hostname,
        lanIps=info.lan_ips,
        tailscale=TailscaleInfoResponse(
            ip=info.tailscale.ip,
            hostname=info.tailscale.hostname,
            active=info.tailscale.active,
        ),
        version=VERSION,
    )
