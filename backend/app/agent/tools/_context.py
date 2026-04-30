"""Tool context — session-scoped state for MCP tool handlers via contextvars.

The runtime sets context once before SDK client creation.  Tool handlers
read it via ``get_tool_context()`` during execution.  This ensures tools
work in all permission modes — including ``bypassPermissions`` (yolo
mode) where the CLI skips the ``canUseTool`` hook entirely.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.agent.models import AgentTask
from app.agent.tracker import Tracker
from app.core.config import AppConfig

if TYPE_CHECKING:
    from app.spec.coordinator import IndexCoordinator
    from app.spec.service import SpecService


@dataclass(frozen=True)
class ToolContext:
    """Immutable session context available to all MCP tool handlers."""

    tracker: Tracker
    notify: Any  # async callable: (method, params, *, request_id?) → None
    task: AgentTask
    config: AppConfig
    spec_service: SpecService | None = None  # cached service from server (reuses index connection)
    coordinator: IndexCoordinator | None = None  # serialized index mutations


_tool_context: contextvars.ContextVar[ToolContext] = contextvars.ContextVar(
    "tool_context"
)


def set_tool_context(
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
    spec_service: SpecService | None = None,
    coordinator: "IndexCoordinator | None" = None,
) -> contextvars.Token:
    """Set session context.  Called by the runtime before SDK operations."""
    return _tool_context.set(
        ToolContext(
            tracker=tracker, notify=notify, task=task, config=config,
            spec_service=spec_service, coordinator=coordinator,
        )
    )


def get_tool_context() -> ToolContext:
    """Read session context.  Called by tool handlers during execution."""
    return _tool_context.get()
