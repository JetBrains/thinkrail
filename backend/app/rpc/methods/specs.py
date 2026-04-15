from __future__ import annotations

from typing import Any

from app.rpc.errors import SPEC_NOT_FOUND, rpc_handler
from app.spec.service import SpecNotFoundError, SpecService

_handle_errors = rpc_handler(
    (SpecNotFoundError, SPEC_NOT_FOUND, "Spec not found"),
)


@_handle_errors
async def list_specs(service: SpecService, **params: Any) -> list[dict]:
    return [s.model_dump(by_alias=True) for s in service.list_specs()]


@_handle_errors
async def get_spec(service: SpecService, **params: Any) -> dict:
    return service.get_spec(params["id"]).model_dump(by_alias=True)


@_handle_errors
async def create_spec(service: SpecService, **params: Any) -> dict:
    return service.create_spec(
        type=params["type"],
        path=params["path"],
        content=params.get("content"),
        id=params.get("id"),
    ).model_dump(by_alias=True)


@_handle_errors
async def update_spec(service: SpecService, **params: Any) -> dict:
    return service.update_spec(
        id=params["id"],
        content=params["content"],
    ).model_dump(by_alias=True)


@_handle_errors
async def delete_spec(service: SpecService, **params: Any) -> None:
    service.delete_spec(params["id"])


@_handle_errors
async def get_graph(service: SpecService, **params: Any) -> dict:
    return service.get_graph().model_dump(by_alias=True)
