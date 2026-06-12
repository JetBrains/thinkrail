"""SetPreviewFile / ClearPreviewFile — agent-driven Preview tab control.

SetPreviewFile updates task.preview_path AND adds the file to the
artifact list (kind='preview') if not already tracked. ClearPreviewFile
is a deprecated alias for SetPreviewFile({ path: null }) — same effect:
clears the pointer, leaves the list intact.
"""

from __future__ import annotations

from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from app.agent.artifacts import persist_artifact_state, set_preview
from app.agent.models import AgentTask
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig, MCP_PREFIX


SET_PREVIEW_FILE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "path": {
            "type": ["string", "null"],
            "description": (
                "Project-relative path of the file to show in the right "
                "Context Panel's Preview tab. Pass null to clear. The "
                "path is added to the session's artifact list "
                "(kind='preview') if not already tracked."
            ),
        },
        "section": {
            "type": "string",
            "description": (
                "Optional Markdown heading text to scroll the preview to "
                "after content loads. Not persisted on the task — applied "
                "once per call."
            ),
        },
    },
}

CLEAR_PREVIEW_FILE_SCHEMA: dict = {"type": "object", "properties": {}}


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


@tool(
    "SetPreviewFile",
    "Show a file in the right Context Panel's Preview tab beside the chat. "
    "Pass null to clear. The path is added to the session's artifact list.",
    SET_PREVIEW_FILE_SCHEMA,
)
async def _set_preview_file(args: dict) -> dict:
    ctx = get_tool_context()
    path = args.get("path")
    section = args.get("section")
    project_root = ctx.config.get_project_root()
    set_preview(ctx.task, path, project_root)
    persist_artifact_state(project_root, ctx.task)
    # Normalize the notification payload to project-relative form so the UI
    # sees the same path that set_preview stored on disk.
    from app.agent.artifacts import _to_relative
    notif_path = None if path is None else _to_relative(project_root, path)
    payload: dict = {"thinkrailSid": ctx.task.thinkrail_sid, "path": notif_path}
    if section and notif_path is not None:
        payload["section"] = section
    await ctx.notify("ui/setPreviewFile", payload)
    return _ok(
        "Preview cleared." if notif_path is None else f"Preview set to {notif_path}."
    )


@tool(
    "ClearPreviewFile",
    "DEPRECATED: alias for SetPreviewFile({ path: null }). Hides the "
    "Preview tab without clearing the artifact list.",
    CLEAR_PREVIEW_FILE_SCHEMA,
)
async def _clear_preview_file(args: dict) -> dict:
    ctx = get_tool_context()
    project_root = ctx.config.get_project_root()
    set_preview(ctx.task, None, project_root)
    persist_artifact_state(project_root, ctx.task)
    await ctx.notify(
        "ui/setPreviewFile",
        {"thinkrailSid": ctx.task.thinkrail_sid, "path": None},
    )
    return _ok("Preview cleared.")


preview_mcp_server = create_sdk_mcp_server(
    name=f"{MCP_PREFIX}preview",
    tools=[_set_preview_file, _clear_preview_file],
)


async def intercept_preview(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Auto-approve — these tools are display-only side effects."""
    return ToolPermissionResponse(behavior="allow")
