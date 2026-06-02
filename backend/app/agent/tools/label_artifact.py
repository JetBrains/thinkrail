"""LabelArtifact — annotate a tracked artifact with role + label."""
from __future__ import annotations

from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from app.agent.artifacts import label_artifact, persist_artifact_state
from app.agent.models import AgentTask
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig


LABEL_ARTIFACT_SCHEMA: dict = {
    "type": "object",
    "required": ["path"],
    "properties": {
        "path": {
            "type": "string",
            "description": (
                "Project-relative path of the artifact to label. Must "
                "already be tracked in the session's artifact list — "
                "call AFTER Write / ProposeChange, not before."
            ),
        },
        "role": {
            "type": "string",
            "description": (
                "Machine-readable role tag, e.g. 'product_design', "
                "'technical_design', 'spec'."
            ),
        },
        "label": {
            "type": "string",
            "description": (
                "Human-readable label shown on the artifact chip, e.g. "
                "'Product design'."
            ),
        },
    },
}


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


@tool(
    "LabelArtifact",
    "Annotate a tracked artifact with a role + label for the chip strip "
    "in the right Context Panel.",
    LABEL_ARTIFACT_SCHEMA,
)
async def _label_artifact(args: dict) -> dict:
    ctx = get_tool_context()
    path = args.get("path", "")
    role = args.get("role")
    label = args.get("label")
    if not path:
        return _ok("path is required.")

    artifact = label_artifact(
        ctx.task,
        path,
        role=role,
        label=label,
        project_root=ctx.config.get_project_root(),
    )
    if artifact is None:
        return _ok(
            f"Warning: artifact '{path}' is not tracked yet; "
            "call LabelArtifact AFTER Write/Edit/ProposeChange.",
        )
    persist_artifact_state(ctx.config.get_project_root(), ctx.task)

    payload: dict = {"bonsaiSid": ctx.task.bonsai_sid, "path": artifact.path}
    if role is not None:
        payload["role"] = role
    if label is not None:
        payload["label"] = label
    await ctx.notify("ui/artifactLabeled", payload)
    return _ok(f"Labeled {artifact.path}.")


label_artifact_mcp_server = create_sdk_mcp_server(
    name="bonsai-label-artifact",
    tools=[_label_artifact],
)


async def intercept_label_artifact(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Auto-approve — display-only annotation."""
    return ToolPermissionResponse(behavior="allow")
