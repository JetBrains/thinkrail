"""RPC handlers for session/* methods — session persistence and management."""

from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

import app.rpc.notifications as notifications
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
    notify = notifications.current_notify
    if notify is None:
        raise JsonRpcError(_INTERNAL_ERROR, "Internal error", "No active connection")
    task = await service.continue_session(params["bonsaiSid"], notify)
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def restart_session(service: AgentService, **params: Any) -> dict:
    """End current session and resume with updated config."""
    notify = notifications.current_notify
    if notify is None:
        raise JsonRpcError(_INTERNAL_ERROR, "Internal error", "No active connection")
    task = await service.restart_session(params["bonsaiSid"], notify)
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def delete_session_data(service: AgentService, **params: Any) -> bool:
    """Delete a session from disk."""
    return service.delete_session_data(params["bonsaiSid"])
