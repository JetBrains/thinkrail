"""RPC handlers for admin/* methods — user and server management."""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

from jsonrpcserver import JsonRpcError, Result, Success

from app.rpc.connections import current_conn_id
from app.rpc.bus import bus

if TYPE_CHECKING:
    from app.core.server_store import ServerStore

_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603
_FORBIDDEN = -32000


def _get_caller_user_id() -> str | None:
    """Return the user_id of the calling WebSocket connection."""
    conn_id = current_conn_id.get(None)
    if conn_id is None:
        return None
    conn = bus.get_connection(conn_id)
    return conn.user_id if conn else None


async def _require_admin(server_store: "ServerStore") -> str:
    """Return caller user_id or raise if not authenticated / not admin."""
    user_id = _get_caller_user_id()
    if not user_id:
        raise JsonRpcError(_INVALID_PARAMS, "Not authenticated")
    user = await server_store.get_user(user_id)
    if not user or not user.is_admin:
        raise JsonRpcError(_FORBIDDEN, "Admin access required")
    return user_id


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
async def admin_list_users(server_store: "ServerStore", **params: Any) -> dict:
    """List all users with admin status and token counts.

    Returns: { users: [{ id, name, isAdmin, createdAt, tokenCount }] }
    """
    await _require_admin(server_store)
    users = await server_store.list_users()
    result = []
    for u in users:
        tokens = await server_store.list_tokens(u.id)
        result.append({
            "id": u.id,
            "name": u.display_name,
            "isAdmin": u.is_admin,
            "createdAt": u.created_at,
            "tokenCount": len(tokens),
        })
    return {"users": result}


@_handle_errors
async def admin_create_user(server_store: "ServerStore", **params: Any) -> dict:
    """Create a new user and return their token.

    Params: { userId: str, name?: str, isAdmin?: bool }
    Returns: { userId, name, token, isAdmin }
    """
    await _require_admin(server_store)
    user_id = params["userId"]
    name = params.get("name", user_id)
    is_admin = params.get("isAdmin", False)
    user = await server_store.create_user(user_id, name, is_admin=is_admin)
    token = await server_store.create_token(user_id)
    return {
        "userId": user.id,
        "name": user.display_name,
        "token": token,
        "isAdmin": user.is_admin,
    }


@_handle_errors
async def admin_delete_user(server_store: "ServerStore", **params: Any) -> dict:
    """Delete a user and all their data.

    Params: { userId: str }
    Cannot delete the last admin.
    """
    await _require_admin(server_store)
    target_id = params["userId"]
    target = await server_store.get_user(target_id)
    if not target:
        raise JsonRpcError(_INVALID_PARAMS, f"User {target_id!r} not found")
    if target.is_admin:
        count = await server_store.admin_count()
        if count <= 1:
            raise JsonRpcError(_FORBIDDEN, "Cannot delete the last admin")
    await server_store.delete_user(target_id)
    return {"ok": True}


@_handle_errors
async def admin_set_admin(server_store: "ServerStore", **params: Any) -> dict:
    """Grant admin rights to a user.

    Params: { userId: str }
    """
    await _require_admin(server_store)
    target_id = params["userId"]
    target = await server_store.get_user(target_id)
    if not target:
        raise JsonRpcError(_INVALID_PARAMS, f"User {target_id!r} not found")
    await server_store.set_admin(target_id, True)
    return {"ok": True}


@_handle_errors
async def admin_remove_admin(server_store: "ServerStore", **params: Any) -> dict:
    """Revoke admin rights from a user.

    Params: { userId: str }
    Cannot revoke from the last admin.
    """
    await _require_admin(server_store)
    target_id = params["userId"]
    target = await server_store.get_user(target_id)
    if not target:
        raise JsonRpcError(_INVALID_PARAMS, f"User {target_id!r} not found")
    if not target.is_admin:
        return {"ok": True}  # Already not admin
    count = await server_store.admin_count()
    if count <= 1:
        raise JsonRpcError(_FORBIDDEN, "Cannot remove the last admin")
    await server_store.set_admin(target_id, False)
    return {"ok": True}


@_handle_errors
async def admin_revoke_token(server_store: "ServerStore", **params: Any) -> dict:
    """Revoke a specific token.

    Params: { token: str }
    """
    await _require_admin(server_store)
    token = params["token"]
    user_id = await server_store.resolve_token(token)
    if user_id is None:
        raise JsonRpcError(_INVALID_PARAMS, "Token not found")
    await server_store.revoke_token(token)
    return {"ok": True}
