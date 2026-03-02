from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Success, Result

from app.spec.service import SpecNotFoundError, SpecService

# Error codes per RPC spec
_SPEC_NOT_FOUND = -32001
_REGISTRY_ERROR = -32002
_VALIDATION_ERROR = -32003
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


def _handle_errors(func):  # type: ignore[type-arg]
    """Decorator that maps domain exceptions to JSON-RPC errors."""

    async def wrapper(service: SpecService, **params: Any) -> Result:
        try:
            return Success(await func(service, **params))
        except SpecNotFoundError as exc:
            raise JsonRpcError(_SPEC_NOT_FOUND, "Spec not found", str(exc))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except ValueError as exc:
            raise JsonRpcError(_VALIDATION_ERROR, "Validation error", str(exc))
        except JsonRpcError:
            raise
        except Exception as exc:
            raise JsonRpcError(_INTERNAL_ERROR, "Internal error", str(exc))

    wrapper.__name__ = func.__name__
    wrapper.__qualname__ = func.__qualname__
    return wrapper


@_handle_errors
async def list_specs(service: SpecService, **params: Any) -> list[dict]:
    return [s.model_dump() for s in service.list_specs()]


@_handle_errors
async def get_spec(service: SpecService, **params: Any) -> dict:
    return service.get_spec(params["id"]).model_dump()


@_handle_errors
async def create_spec(service: SpecService, **params: Any) -> dict:
    return service.create_spec(
        type=params["type"],
        path=params["path"],
        content=params.get("content"),
        id=params.get("id"),
    ).model_dump()


@_handle_errors
async def update_spec(service: SpecService, **params: Any) -> dict:
    return service.update_spec(
        id=params["id"],
        content=params["content"],
    ).model_dump()


@_handle_errors
async def delete_spec(service: SpecService, **params: Any) -> None:
    service.delete_spec(params["id"])


@_handle_errors
async def get_graph(service: SpecService, **params: Any) -> dict:
    return service.get_graph().model_dump()
