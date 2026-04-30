"""Runtime-agnostic agent contract.

This package defines the abstraction layer that lets bonsai run different
agent backends (Claude SDK today, Codex / others later) behind a single
interface. Modules will be filled in by subsequent tasks of plan 01.
"""

from __future__ import annotations

from app.agent.runtime.events import (
    AgentEventHandler,
    RuntimeEvent,
    make_handler_from_notify,
)
from app.agent.runtime.permissions import (
    ToolCategory,
    ToolPermissionRequest,
    ToolPermissionResponse,
)
from app.agent.runtime.types import (
    IAgentRuntime,
    RuntimeExecutionConfig,
    RuntimeType,
)

__all__ = [
    "AgentEventHandler",
    "IAgentRuntime",
    "RuntimeEvent",
    "RuntimeExecutionConfig",
    "RuntimeType",
    "ToolCategory",
    "ToolPermissionRequest",
    "ToolPermissionResponse",
    "make_handler_from_notify",
]
