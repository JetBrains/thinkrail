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
from app.agent.runtime.registry import (
    DuplicateRuntimeError,
    RuntimeRegistry,
    RuntimeRegistryError,
    UnknownRuntimeError,
)
from app.agent.runtime.types import (
    DEFAULT_CONTEXT_WINDOW,
    IAgentRuntime,
    ModelInfo,
    RuntimeExecutionConfig,
    RuntimeType,
)

__all__ = [
    "DEFAULT_CONTEXT_WINDOW",
    "AgentEventHandler",
    "DuplicateRuntimeError",
    "IAgentRuntime",
    "ModelInfo",
    "RuntimeEvent",
    "RuntimeExecutionConfig",
    "RuntimeRegistry",
    "RuntimeRegistryError",
    "RuntimeType",
    "ToolCategory",
    "ToolPermissionRequest",
    "ToolPermissionResponse",
    "UnknownRuntimeError",
    "make_handler_from_notify",
]
