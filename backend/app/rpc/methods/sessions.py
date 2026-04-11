"""RPC handlers for session/* methods — session persistence and management."""

from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.rpc.bus import bus
from app.rpc.connections import current_conn_id
from app.agent.service import AgentService

_INTERNAL_ERROR = -32603
_INVALID_PARAMS = -32602


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(service: AgentService, **params: Any) -> Result:
        try:
            return Success(await func(service, **params))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except ValueError as exc:
            raise JsonRpcError(_INTERNAL_ERROR, str(exc))
        except JsonRpcError:
            raise
        except Exception as exc:
            raise JsonRpcError(_INTERNAL_ERROR, "Internal error", str(exc))

    wrapper.__name__ = func.__name__
    wrapper.__qualname__ = func.__qualname__
    return wrapper


def _auto_subscribe_all(bonsai_sid: str) -> None:
    """Subscribe ALL connections on the same project to a session topic.

    Phase 1: every client sees every session's events.
    """
    try:
        conn_id = current_conn_id.get()
        conn = bus.get_connection(conn_id)
        if conn:
            topic = f"session:{bonsai_sid}"
            for c in bus.connections_for_project(conn.project_path):
                bus.subscribe(c.conn_id, topic)
    except LookupError:
        pass


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
    _auto_subscribe_all(bonsai_sid)
    task = await service.continue_session(bonsai_sid)
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def restart_session(service: AgentService, **params: Any) -> dict:
    """End current session and resume with updated config."""
    bonsai_sid = params["bonsaiSid"]
    _auto_subscribe_all(bonsai_sid)
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
        raise JsonRpcError(_INTERNAL_ERROR, "Trash service not available")
    service.trash_service.restore_session(params["bonsaiSid"])


# -- Subscription management --------------------------------------------------

@_handle_errors
async def subscribe_session(service: AgentService, **params: Any) -> None:
    """Subscribe the calling connection to a session's event topic."""
    bonsai_sid = params["bonsaiSid"]
    _auto_subscribe_all(bonsai_sid)


@_handle_errors
async def unsubscribe_session(service: AgentService, **params: Any) -> None:
    """Unsubscribe the calling connection from a session's event topic."""
    bonsai_sid = params["bonsaiSid"]
    try:
        conn_id = current_conn_id.get()
        bus.unsubscribe(conn_id, f"session:{bonsai_sid}")
    except LookupError:
        pass
