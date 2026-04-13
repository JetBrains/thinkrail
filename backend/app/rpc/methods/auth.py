"""RPC handlers for auth/* and connection/* methods — user and token management."""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

from jsonrpcserver import JsonRpcError, Result, Success

from app.rpc.bus import bus

if TYPE_CHECKING:
    from app.core.server_store import ServerStore

_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


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
async def create_token(server_store: "ServerStore", **params: Any) -> dict:
    """Create or update a user and return their token.

    Params: { userId: str, name?: str }
    Returns: { userId, name, token }
    """
    user_id = params["userId"]
    name = params.get("name", user_id)
    user = await server_store.ensure_user(user_id, name)
    token = await server_store.create_token(user_id)
    return {"userId": user.id, "name": user.display_name, "token": token}


@_handle_errors
async def list_users(server_store: "ServerStore", **params: Any) -> dict:
    """List all server-wide users (without tokens).

    Returns: { users: [{ id, name }] }
    """
    users = await server_store.list_users()
    return {
        "users": [{"id": u.id, "name": u.display_name} for u in users],
    }


@_handle_errors
async def list_connections(server_store: "ServerStore", **params: Any) -> list[dict]:
    """List all currently connected clients for this project.

    Returns: [{ connId, userId, displayName, connectedAt }]

    Note: uses the project from the calling connection's context,
    resolved via the EventBus.
    """
    from app.rpc.connections import current_conn_id as _ctx

    conn_id = _ctx.get(None)
    if conn_id is None:
        return []
    conn = bus._connections.get(conn_id)
    if conn is None:
        return []
    connections = bus.connections_for_project(conn.project_path)
    return [
        {
            "connId": c.conn_id,
            "userId": c.user_id,
            "displayName": c.display_name,
            "connectedAt": c.connected_at,
        }
        for c in connections
    ]
