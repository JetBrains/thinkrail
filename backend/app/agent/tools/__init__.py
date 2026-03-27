"""Agent tools package — registry of MCP servers, interceptors, and tool context."""

from __future__ import annotations

from typing import Any, Callable, Coroutine

from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

from app.agent.tools._context import ToolContext, get_tool_context, set_tool_context
from app.agent.tools.specs import intercept_specs, specs_mcp_server
from app.agent.tools.suggest_session import (
    intercept_suggest_session,
    suggest_session_mcp_server,
)
from app.agent.tools.orchestrator import intercept_orchestrator, orchestrator_mcp_server
from app.agent.tools.visualization import intercept_visualize, vis_mcp_server

# Type for intercept functions: (input_data, tracker, notify, task, config) -> result
InterceptFn = Callable[..., Coroutine[Any, Any, PermissionResultAllow | PermissionResultDeny]]

MCP_SERVERS: dict[str, Any] = {
    "bonsai-vis": vis_mcp_server,
    "bonsai-proactive": suggest_session_mcp_server,
    "bonsai-specs": specs_mcp_server,
    "bonsai-orchestrator": orchestrator_mcp_server,
}

# canUseTool interceptors — keyed by tool name suffix.
# permissions.py iterates this dict and dispatches to the matching function.
# All current interceptors auto-approve; real logic lives in handlers via
# get_tool_context().  Interactive tools (SuggestSession) handle their own
# Future-based suspension inside the handler.
INTERCEPTORS: dict[str, InterceptFn] = {
    "bonsai_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
    "spec_list": intercept_specs,
    "spec_get": intercept_specs,
    "spec_save": intercept_specs,
    "spec_delete": intercept_specs,
    "spec_links": intercept_specs,
    "registry_query": intercept_specs,
    "registry_mutate": intercept_specs,
    "suggest_step": intercept_orchestrator,
}

__all__ = [
    "INTERCEPTORS",
    "InterceptFn",
    "MCP_SERVERS",
    "ToolContext",
    "get_tool_context",
    "set_tool_context",
]
