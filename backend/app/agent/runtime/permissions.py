"""Runtime-neutral permission types — ToolPermissionRequest/Response, ToolCategory.

These types form the runtime-agnostic permission contract. Each
``IAgentRuntime`` implementation translates its native permission shape
(e.g. Claude SDK ``PermissionResultAllow|Deny``) to/from these neutral
models so the permission engine in
``app.agent.permissions.can_use_tool`` never has to import a backend SDK.

``ToolCategory`` is the coarse classification that drives mode-based
permission filtering inside ``can_use_tool`` (mirrors the reference's
``PermissionPolicyEngine.evaluatePermissionMode`` with the same five
buckets). The mapping from tool names to categories and the
``(mode, category) -> decision`` table live in
``app.agent.permissions``; this module exposes only the type alias so
runtimes and tests can refer to it without importing the engine.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ToolCategory = Literal["read", "net", "edit", "bash", "mcp"]


class ToolPermissionRequest(BaseModel):
    """A tool-permission decision request handed to ``can_use_tool``.

    Mirrors the input side of Claude SDK's ``canUseTool`` callback but
    contains no SDK types. ``context`` is an open escape hatch for fields
    that only make sense for some runtimes so the shape can grow without
    another refactor.
    """

    model_config = ConfigDict(extra="forbid")

    tool_name: str
    input: dict[str, Any] = Field(default_factory=dict)
    tool_use_id: str | None = None
    session_id: str | None = None
    permission_mode: str = "default"
    context: dict[str, Any] = Field(default_factory=dict)


class ToolPermissionResponse(BaseModel):
    """The neutral allow/deny decision returned by ``can_use_tool``.

    A single shape carries both outcomes — ``behavior`` discriminates.
    On allow, ``updated_input`` may rewrite arguments before execution;
    on deny, ``message`` explains the rejection and ``interrupt`` asks
    the runtime to abort the current turn (vs. just refusing this call).
    """

    model_config = ConfigDict(extra="forbid")

    behavior: Literal["allow", "deny"]
    updated_input: dict[str, Any] | None = None
    message: str | None = None
    interrupt: bool = False
