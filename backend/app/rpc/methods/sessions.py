"""RPC handlers for session/* methods — session persistence and management."""

from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError

from app.rpc.bus import bus
from app.rpc.context import auto_subscribe_all, get_current_conn
from app.rpc.errors import INTERNAL_ERROR, rpc_handler
from app.agent.service import AgentService

_handle_errors = rpc_handler()


@_handle_errors
async def list_all_sessions(service: AgentService, **params: Any) -> list[dict]:
    """List all sessions (in-memory + on-disk)."""
    return service.list_all_sessions()


@_handle_errors
async def get_session(service: AgentService, **params: Any) -> dict | None:
    """Get full session data including events."""
    return service.get_session_data(params["bonsaiSid"])


@_handle_errors
async def continue_session(service: AgentService, **params: Any) -> dict:
    """Continue a dead session — reuse same bonsai_sid with old conversation as context."""
    bonsai_sid = params["bonsaiSid"]
    auto_subscribe_all(bonsai_sid)
    task = await service.continue_session(bonsai_sid)
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def restart_session(service: AgentService, **params: Any) -> dict:
    """End current session and resume with updated config."""
    bonsai_sid = params["bonsaiSid"]
    auto_subscribe_all(bonsai_sid)
    task = await service.restart_session(bonsai_sid)
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def delete_session_data(service: AgentService, **params: Any) -> None:
    """Trash a session (soft-delete) and detach from all tickets."""
    service.trash_session(params["bonsaiSid"])


@_handle_errors
async def restore_session(service: AgentService, **params: Any) -> None:
    """Restore a trashed session."""
    if not service.trash_service:
        raise JsonRpcError(INTERNAL_ERROR, "Trash service not available")
    service.trash_service.restore_session(params["bonsaiSid"])


@_handle_errors
async def subscribe_session(service: AgentService, **params: Any) -> None:
    """Subscribe the calling connection to a session's event topic."""
    auto_subscribe_all(params["bonsaiSid"])


@_handle_errors
async def unsubscribe_session(service: AgentService, **params: Any) -> None:
    """Unsubscribe the calling connection from a session's event topic."""
    conn = get_current_conn()
    if conn:
        bus.unsubscribe(conn.conn_id, f"session:{params['bonsaiSid']}")
