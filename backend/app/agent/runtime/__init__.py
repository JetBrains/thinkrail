"""Runtime-agnostic agent contract.

This package defines the abstraction layer that lets thinkrail run different
agent backends behind a single interface. The Claude SDK is the only
backend today; the contract is shaped so others can be added.
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
    IAgentRuntime,
    LabeledOption,
    ModelCapability,
    RuntimeCapabilities,
    RuntimeExecutionConfig,
    RuntimeFlag,
    RuntimeIdentity,
    RuntimeSkillInfo,
    RuntimeType,
)

__all__ = [
    "AgentEventHandler",
    "DuplicateRuntimeError",
    "IAgentRuntime",
    "LabeledOption",
    "ModelCapability",
    "RuntimeCapabilities",
    "RuntimeEvent",
    "RuntimeExecutionConfig",
    "RuntimeFlag",
    "RuntimeIdentity",
    "RuntimeRegistry",
    "RuntimeRegistryError",
    "RuntimeSkillInfo",
    "RuntimeType",
    "ToolCategory",
    "ToolPermissionRequest",
    "ToolPermissionResponse",
    "UnknownRuntimeError",
    "make_handler_from_notify",
]
