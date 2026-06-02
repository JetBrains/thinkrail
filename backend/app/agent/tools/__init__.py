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
from app.agent.tools.change_ticket_status import (
    change_ticket_status_mcp_server,
    intercept_change_ticket_status,
)
from app.agent.tools.create_ticket import (
    create_ticket_mcp_server,
    intercept_create_board_ticket,
)
from app.agent.tools.label_artifact import (
    intercept_label_artifact,
    label_artifact_mcp_server,
)
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

MCP_SERVERS: dict[str, Any] = {
    "bonsai-vis": vis_mcp_server,
    "bonsai-proactive": suggest_session_mcp_server,
    "bonsai-describe": suggest_description_mcp_server,
    "bonsai-preview": preview_mcp_server,
    "bonsai-amend": propose_change_mcp_server,
    "bonsai-specs": specs_mcp_server,
    "bonsai-orchestrator": orchestrator_mcp_server,
    "bonsai-ticket-status": change_ticket_status_mcp_server,
    "bonsai-create-ticket": create_ticket_mcp_server,
    "bonsai-label-artifact": label_artifact_mcp_server,
    "bonsai-session-outcome": session_outcome_mcp_server,
}

# canUseTool interceptors — keyed by tool name suffix.
# permissions.py iterates this dict and dispatches to the matching function.
# All current interceptors auto-approve; real logic lives in handlers via
# get_tool_context().  Interactive tools (SuggestSession) handle their own
# Future-based suspension inside the handler.
INTERCEPTORS: dict[str, InterceptFn] = {
    "bonsai_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
    "SuggestDescription": intercept_suggest_description,
    "SetPreviewFile": intercept_preview,
    "ClearPreviewFile": intercept_preview,
    "ProposeChange": intercept_propose_change,
    "spec_search": intercept_specs,
    "spec_links": intercept_specs,
    "spec_delete": intercept_specs,
    "suggest_step": intercept_orchestrator,
    "ChangeTicketStatus": intercept_change_ticket_status,
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
