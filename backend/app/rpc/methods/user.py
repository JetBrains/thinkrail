"""RPC handlers for user/* methods — profile, preferences, recent projects."""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

from jsonrpcserver import JsonRpcError, Result, Success

from app.rpc.connections import current_conn_id
from app.rpc.bus import bus

if TYPE_CHECKING:
    from app.core.server_store import ServerStore

_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


def _get_caller_user_id() -> str | None:
    """Return the user_id of the calling WebSocket connection."""
    conn_id = current_conn_id.get(None)
    if conn_id is None:
        return None
    conn = bus.get_connection(conn_id)
    return conn.user_id if conn else None


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(server_store: "ServerStore", **params: Any) -> Result:
        try:
            return Success(await func(server_store, **params))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except JsonRpcError:
            raise
        except Exception as exc:
            raise JsonRpcError(_INTERNAL_ERROR, "Internal error", str(exc))

    wrapper.__name__ = func.__name__
    wrapper.__qualname__ = func.__qualname__
    return wrapper


@_handle_errors
async def get_profile(server_store: "ServerStore", **params: Any) -> dict:
    """Return the calling user's profile.

    Returns: { userId, displayName, createdAt }
    """
    user_id = _get_caller_user_id()
    if not user_id:
        raise JsonRpcError(_INVALID_PARAMS, "Not authenticated")
    user = await server_store.get_user(user_id)
    if not user:
        raise JsonRpcError(_INTERNAL_ERROR, f"User {user_id!r} not found")
    return {
        "userId": user.id,
        "displayName": user.display_name,
        "createdAt": user.created_at,
    }


@_handle_errors
async def get_preferences(server_store: "ServerStore", **params: Any) -> dict:
    """Return the calling user's preferences.

    Returns: { theme, soundEnabled, ... }
    """
    user_id = _get_caller_user_id()
    if not user_id:
        raise JsonRpcError(_INVALID_PARAMS, "Not authenticated")
    return await server_store.get_preferences(user_id)


@_handle_errors
async def update_preferences(server_store: "ServerStore", **params: Any) -> dict:
    """Merge a patch into the calling user's preferences.

    Params: { patch: { ... } }
    Returns: updated preferences object
    """
    user_id = _get_caller_user_id()
    if not user_id:
        raise JsonRpcError(_INVALID_PARAMS, "Not authenticated")
    patch = params.get("patch", {})
    if not isinstance(patch, dict):
        raise JsonRpcError(_INVALID_PARAMS, "patch must be a dict")
    return await server_store.update_preferences(user_id, patch)


@_handle_errors
async def get_recent_projects(server_store: "ServerStore", **params: Any) -> list:
    """Return the calling user's recent projects.

    Params: { limit?: number }
    Returns: [{ path, name, lastOpened }]
    """
    user_id = _get_caller_user_id()
    if not user_id:
        raise JsonRpcError(_INVALID_PARAMS, "Not authenticated")
    limit = params.get("limit", 10)
    recents = await server_store.get_recent_projects(user_id, limit=limit)
    return [
        {"path": r.project_path, "name": r.name, "lastOpened": r.last_opened}
        for r in recents
    ]
