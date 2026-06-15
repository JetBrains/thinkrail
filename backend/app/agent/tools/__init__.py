"""Agent tools package — registry of MCP servers, interceptors, and tool context."""

from __future__ import annotations

from typing import Any, Callable, Coroutine

from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import ToolContext, get_tool_context, set_tool_context
from app.agent.tools.specs import intercept_specs, specs_mcp_server
from app.agent.tools.suggest_description import (
    intercept_suggest_description,
    suggest_description_mcp_server,
)
from app.agent.tools.suggest_session import (
    intercept_suggest_session,
    suggest_session_mcp_server,
)
from app.agent.tools.create_ticket import (
    create_ticket_mcp_server,
    intercept_create_board_ticket,
)
from app.agent.tools.label_artifact import (
    intercept_label_artifact,
    label_artifact_mcp_server,
)
from app.agent.tools.orchestration import intercept_orchestration, orchestration_mcp_server
from app.agent.tools.orchestrator import intercept_orchestrator, orchestrator_mcp_server
from app.agent.tools.preview import intercept_preview, preview_mcp_server
from app.agent.tools.propose_change import (
    intercept_propose_change,
    propose_change_mcp_server,
)
from app.agent.tools.session_outcome import (
    intercept_session_finalize,
    session_outcome_mcp_server,
)
from app.agent.tools.visualization import intercept_visualize, vis_mcp_server

# Type for intercept functions: (input_data, tracker, notify, task, config) -> result
InterceptFn = Callable[..., Coroutine[Any, Any, ToolPermissionResponse]]

# Registry keyed by each server's own ``name`` (set via ``MCP_PREFIX`` in the
# tool module), so the prefix is defined in exactly one place.
_MCP_SERVER_LIST = [
    vis_mcp_server,
    orchestration_mcp_server,
    suggest_session_mcp_server,
    suggest_description_mcp_server,
    preview_mcp_server,
    propose_change_mcp_server,
    specs_mcp_server,
    orchestrator_mcp_server,
    create_ticket_mcp_server,
    label_artifact_mcp_server,
    session_outcome_mcp_server,
]
MCP_SERVERS: dict[str, Any] = {s["name"]: s for s in _MCP_SERVER_LIST}

# canUseTool interceptors — keyed by tool name suffix.
# permissions.py iterates this dict and dispatches to the matching function.
# All current interceptors auto-approve; real logic lives in handlers via
# get_tool_context().  Interactive tools (SuggestSession) handle their own
# Future-based suspension inside the handler.
INTERCEPTORS: dict[str, InterceptFn] = {
    "thinkrail_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
    "SuggestDescription": intercept_suggest_description,
    "SetPreviewFile": intercept_preview,
    "ClearPreviewFile": intercept_preview,
    "ProposeChange": intercept_propose_change,
    "spec_search": intercept_specs,
    "spec_links": intercept_specs,
    "spec_delete": intercept_specs,
    "propose_pipeline": intercept_orchestration,
    "add_node": intercept_orchestration,
    "remove_node": intercept_orchestration,
    "set_depends_on": intercept_orchestration,
    "propose_children": intercept_orchestration,
    "start_node": intercept_orchestration,
    "suggest_step": intercept_orchestrator,
    "CreateBoardTicket": intercept_create_board_ticket,
    "LabelArtifact": intercept_label_artifact,
    "SessionFinalize": intercept_session_finalize,
}

__all__ = [
    "INTERCEPTORS",
    "InterceptFn",
    "MCP_SERVERS",
    "ToolContext",
    "get_tool_context",
    "set_tool_context",
]
