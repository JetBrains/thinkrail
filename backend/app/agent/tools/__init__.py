"""Agent tools package — registry of MCP servers and tool interceptors."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

from app.agent.models import AgentTask
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.agent.tools.specs import intercept_specs, specs_mcp_server
from app.agent.tools.suggest_session import intercept_suggest_session, suggest_session_mcp_server
from app.agent.tools.visualization import intercept_visualize, vis_mcp_server

InterceptFn = Callable[
    [dict[str, Any], Tracker, Any, AgentTask, AppConfig],
    Awaitable[PermissionResultAllow | PermissionResultDeny],
]

MCP_SERVERS: dict[str, Any] = {
    "bonsai-vis": vis_mcp_server,
    "bonsai-proactive": suggest_session_mcp_server,
    "bonsai-specs": specs_mcp_server,
}

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
}
