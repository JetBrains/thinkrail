"""Shared JSON-RPC error handling for all RPC method modules.

Usage::

    from app.rpc.errors import rpc_handler

    # No domain-specific errors
    @rpc_handler()
    async def my_method(service, **params): ...

    # With domain-specific error mapping
    from app.agent.tracker import TaskNotFoundError, FutureNotFoundError

    _handle_errors = rpc_handler(
        (TaskNotFoundError, -32011, "Agent task not found"),
        (FutureNotFoundError, -32012, "No pending request"),
    )

    @_handle_errors
    async def my_other_method(service, **params): ...
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success
from pydantic import BaseModel

# ── Standard JSON-RPC error codes ──────────────────────────────────────────
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# ── Domain-specific error codes ────────────────────────────────────────────
TASK_NOT_FOUND = -32011
FUTURE_NOT_FOUND = -32012
ALREADY_RESOLVED = -32013
SPEC_NOT_FOUND = -32001
VALIDATION_ERROR = -32003
INDEX_NOT_READY = -32015
TICKET_NOT_FOUND = -32021
INVALID_TRANSITION = -32022
UNKNOWN_RUNTIME = -32031
INVALID_CAPABILITY_VALUE = -32032


def serialize_result(value: Any) -> Any:
    """Convert Pydantic models in a handler's return value to wire dicts.

    Handlers may return ``BaseModel`` (or ``list[BaseModel]``) directly so
    the return annotation is the contract; this dumps with ``by_alias=True``
    so camelCase aliases match the on-wire schema. Pass-through for
    everything else (``None``, primitives, plain dicts).
    """
    if isinstance(value, BaseModel):
        return value.model_dump(by_alias=True)
    if isinstance(value, list):
        return [serialize_result(item) for item in value]
    return value


def rpc_handler(
    *domain_errors: tuple[type[Exception], int, str],
) -> Callable:
    """Return a decorator that converts exceptions into JSON-RPC errors.

    Common mappings (``KeyError``/``TypeError`` → ``INVALID_PARAMS``,
    generic ``Exception`` → ``INTERNAL_ERROR``) are always applied.
    Pass additional ``(ExcType, code, message)`` tuples for domain errors.

    Pydantic ``BaseModel`` returns are auto-serialized via ``serialize_result``
    so handlers can declare their return type as the actual response model.
    A domain error may attach an ``rpc_data`` attribute, forwarded as the
    JSON-RPC error ``data`` (else ``str(exc)``).
    """

    def decorator(func: Callable) -> Callable:
        async def wrapper(service: Any, **params: Any) -> Result:
            try:
                return Success(serialize_result(await func(service, **params)))
            except JsonRpcError:
                raise
            except Exception as exc:
                for exc_type, code, message in domain_errors:
                    if isinstance(exc, exc_type):
                        data = getattr(exc, "rpc_data", None)
                        raise JsonRpcError(code, message, data if data is not None else str(exc)) from exc
                if isinstance(exc, (KeyError, TypeError)):
                    raise JsonRpcError(INVALID_PARAMS, "Invalid params", str(exc)) from exc
                if isinstance(exc, ValueError):
                    raise JsonRpcError(VALIDATION_ERROR, "Validation error", str(exc)) from exc
                raise JsonRpcError(INTERNAL_ERROR, "Internal error", str(exc)) from exc

        wrapper.__name__ = func.__name__
        wrapper.__qualname__ = func.__qualname__
        return wrapper

    return decorator
