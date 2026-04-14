from __future__ import annotations

from typing import Any

from app.rpc.errors import rpc_handler
from app.vis.service import VisualizationService

_handle_errors = rpc_handler()


@_handle_errors
async def get_vis_state(service: VisualizationService, **_: Any) -> dict:
    """Return the current dashboard state without recomputing."""
    return service.get_state().to_dict()


@_handle_errors
async def recompute_vis(service: VisualizationService, **_: Any) -> dict:
    """Force a dashboard recompute and return the new state."""
    state = await service.recompute()
    return state.to_dict()
