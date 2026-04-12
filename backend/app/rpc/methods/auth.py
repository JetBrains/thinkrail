"""RPC handlers for auth/* methods — user and token management."""

from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.core.config import AppConfig
from app.rpc.auth import generate_token, load_users, save_user
from app.rpc.bus import bus
from app.rpc.connections import current_conn_id

_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(config: AppConfig, **params: Any) -> Result:
        try:
            return Success(await func(config, **params))
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
async def create_token(config: AppConfig, **params: Any) -> dict:
    """Create or update a user and return their token.

    Params: { userId: str, name?: str }
    Returns: { userId, name, token }
    """
    user_id = params["userId"]
    name = params.get("name", user_id)
    token = save_user(config.project_root, user_id, name)
    return {"userId": user_id, "name": name, "token": token}


@_handle_errors
async def list_users(config: AppConfig, **params: Any) -> dict:
    """List all users (without tokens) and the anonymous access setting.

    Returns: { users: [{ id, name }], allowAnonymous: bool }
    """
    token_map, allow_anonymous = load_users(config.project_root)
    users = [
        {"id": identity.user_id, "name": identity.display_name}
        for identity in token_map.values()
    ]
    return {"users": users, "allowAnonymous": allow_anonymous}


@_handle_errors
async def list_connections(config: AppConfig, **params: Any) -> list[dict]:
    """List all currently connected clients for this project.

    Returns: [{ connId, userId, displayName, connectedAt }]
    """
    connections = bus.connections_for_project(str(config.project_root))
    return [
        {
            "connId": c.conn_id,
            "userId": c.user_id,
            "displayName": c.display_name,
            "connectedAt": c.connected_at,
        }
        for c in connections
    ]
