from __future__ import annotations

from typing import Any

from app import analytics
from app.analytics import SpecGraphViewedEvent, SpecsViewedEvent
from app.rpc.errors import INDEX_NOT_READY, SPEC_NOT_FOUND, rpc_handler
from app.spec.service import IndexNotReadyError, SpecNotFoundError, SpecService

_handle_errors = rpc_handler(
    (SpecNotFoundError, SPEC_NOT_FOUND, "Spec not found"),
    (IndexNotReadyError, INDEX_NOT_READY, "Index is still initializing"),
)


@_handle_errors
async def list_specs(service: SpecService, **params: Any) -> list[dict]:
    analytics.track_event(SpecsViewedEvent())
    return [s.model_dump(by_alias=True) for s in await service.list_specs()]


@_handle_errors
async def get_spec(service: SpecService, **params: Any) -> dict:
    return (await service.get_spec(params["id"])).model_dump(by_alias=True)


@_handle_errors
async def create_spec(service: SpecService, **params: Any) -> dict:
    return (await service.create_spec(
        type=params["type"],
        path=params["path"],
        content=params.get("content"),
        id=params.get("id"),
    )).model_dump(by_alias=True)


@_handle_errors
async def update_spec(service: SpecService, **params: Any) -> dict:
    return (await service.update_spec(
        id=params["id"],
        content=params["content"],
    )).model_dump(by_alias=True)


@_handle_errors
async def delete_spec(service: SpecService, **params: Any) -> None:
    await service.delete_spec(params["id"])


@_handle_errors
async def get_graph(service: SpecService, **params: Any) -> dict:
    analytics.track_event(SpecGraphViewedEvent())
    return (await service.get_graph()).model_dump(by_alias=True)
