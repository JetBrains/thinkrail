"""RPC handlers for trash/* methods."""

from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.trash.service import TrashService

_INTERNAL_ERROR = -32603
_INVALID_PARAMS = -32602


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(service: TrashService, **params: Any) -> Result:
        try:
            return Success(await func(service, **params))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except FileNotFoundError as exc:
            raise JsonRpcError(-32021, "Not found", str(exc))
        except JsonRpcError:
            raise
    return wrapper


@_handle_errors
async def list_trashed(service: TrashService, **params: Any) -> list[dict]:
    """List all trashed items."""
    item_type = params.get("type")
    return service.list_trashed(item_type=item_type)


@_handle_errors
async def purge_trashed(service: TrashService, **params: Any) -> None:
    """Permanently delete a specific trashed item."""
    service.purge(params["type"], params["id"])


@_handle_errors
async def empty_trash(service: TrashService, **params: Any) -> None:
    """Permanently delete all trashed items."""
    item_type = params.get("type")
    service.empty_trash(item_type=item_type)


@_handle_errors
async def restore_spec(service: TrashService, **params: Any) -> dict:
    """Restore a trashed spec (file + registry entry + links)."""
    spec_id = params["specId"]
    entry_dict, links_dicts = service.restore_spec(spec_id)
    return {"registryEntry": entry_dict, "links": links_dicts}


