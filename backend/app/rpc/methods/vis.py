from __future__ import annotations

from typing import Any

from jsonrpcserver import Success, Result

from app.vis.service import VisualizationService


async def get_vis_state(service: VisualizationService, **_: Any) -> Result:
    """Return the current dashboard state without recomputing."""
    return Success(service.get_state().to_dict())


async def recompute_vis(service: VisualizationService, **_: Any) -> Result:
    """Force a dashboard recompute and return the new state."""
    state = await service.recompute()
    return Success(state.to_dict())
