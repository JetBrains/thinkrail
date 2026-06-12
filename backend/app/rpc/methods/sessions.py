"""RPC handlers for session/* methods — session persistence and management."""

from __future__ import annotations

from typing import Any

from app.rpc.bus import bus
from app.rpc.context import auto_subscribe_all, get_current_conn
from app.rpc.errors import rpc_handler
from app.agent.service import AgentService

_handle_errors = rpc_handler()


@_handle_errors
async def list_all_sessions(service: AgentService, **params: Any) -> list[dict]:
    """List all sessions (in-memory + on-disk)."""
    return service.list_all_sessions()


@_handle_errors
async def get_session(service: AgentService, **params: Any) -> dict | None:
    """Get full session data including events."""
    return service.get_session_data(params["thinkrailSid"])


@_handle_errors
async def continue_session(service: AgentService, **params: Any) -> dict:
    """Continue a dead session — reuse same thinkrail_sid with old conversation as context."""
    thinkrail_sid = params["thinkrailSid"]
    auto_subscribe_all(thinkrail_sid)
    task = await service.continue_session(thinkrail_sid)
    return {"thinkrailSid": task.thinkrail_sid}


@_handle_errors
async def restart_session(service: AgentService, **params: Any) -> dict:
    """End current session and resume with updated config."""
    thinkrail_sid = params["thinkrailSid"]
    auto_subscribe_all(thinkrail_sid)
    task = await service.restart_session(thinkrail_sid)
    return {"thinkrailSid": task.thinkrail_sid}


@_handle_errors
async def delete_session_data(service: AgentService, **params: Any) -> None:
    """Delete a session and detach from all tickets."""
    service.trash_session(params["thinkrailSid"])


@_handle_errors
async def subscribe_session(service: AgentService, **params: Any) -> None:
    """Subscribe the calling connection to a session's event topic."""
    auto_subscribe_all(params["thinkrailSid"])


@_handle_errors
async def unsubscribe_session(service: AgentService, **params: Any) -> None:
    """Unsubscribe the calling connection from a session's event topic."""
    conn = get_current_conn()
    if conn:
        bus.unsubscribe(conn.conn_id, f"session:{params['thinkrailSid']}")


@_handle_errors
async def patch_outcome_action(service: AgentService, **params: Any) -> dict | None:
    """Mark a queued outcome action as applied (or update other fields).

    Used by the frontend after the user executes a queued action — e.g.
    when 'Add to board' completes, the action's state moves to 'applied'
    so the button stays in the 'added' state across reloads.
    """
    thinkrail_sid = params["thinkrailSid"]
    action_id = params["actionId"]
    patch = params.get("patch", {})
    return service.patch_outcome_action(thinkrail_sid, action_id, patch)
