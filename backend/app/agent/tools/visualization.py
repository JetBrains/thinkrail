"""Bonsai visualization MCP tool.

In-process MCP tool that renders structured visualizations in the frontend.
The actual rendering happens client-side via the toolCallStart event's
toolInput payload; this handler returns a short confirmation.
"""

from __future__ import annotations

from typing import Any

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tracker import Tracker

VIZ_SCHEMA: dict = {
    "type": "object",
    "required": ["type", "data"],
    "properties": {
        "type": {
            "type": "string",
            "enum": [
                "progress-tracker", "summary-box", "comparison",
                "data-table", "status-list", "diagram",
            ],
            "description": "The visualization type to render",
        },
        "title": {
            "type": "string",
            "description": "Title displayed in the visualization card header",
        },
        "vizId": {
            "type": "string",
            "description": (
                "Optional stable ID for the visualization. When the same vizId "
                "is used across multiple calls, older cards auto-collapse and "
                "the latest one renders in full."
            ),
        },
        "data": {
            "type": "object",
            "description": "Type-specific structured data (see documentation for schemas)",
        },
    },
}

VIZ_INSTRUCTIONS = """\
## Visualization Tool

You have access to the `bonsai_visualize` MCP tool for rendering structured \
visual output in the UI. Use it instead of ASCII art, markdown tables, or \
plain-text diagrams whenever the output would benefit from visual structure.

**Available types:** progress-tracker, summary-box, comparison, data-table, \
status-list, diagram.

**When to use:** reporting status, showing progress, comparing options, \
presenting tabular data, or illustrating architecture. Call the tool with \
a JSON object containing `type`, `title`, `data`, and optionally `vizId` \
(reuse the same `vizId` to update a previous visualization in-place).

**Anti-patterns:** Do NOT use Bash to print ANSI-colored text, do NOT \
render ASCII-art tables, do NOT approximate visualizations with markdown \
when the tool can do it better."""


@tool(
    "bonsai_visualize",
    "Render a structured visualization in the Bonsai UI. "
    "Use this instead of ASCII art, ANSI escape codes, or Bash echo commands. "
    "The Bonsai frontend renders the data as an interactive card.",
    VIZ_SCHEMA,
)
async def _bonsai_visualize(args: dict) -> dict:
    viz_type = args.get("type", "")
    title = args.get("title", viz_type)
    return {"content": [{"type": "text", "text": f"\u2713 Rendered: {title} ({viz_type})"}]}


viz_mcp_server = create_sdk_mcp_server(name="bonsai-viz", tools=[_bonsai_visualize])


async def intercept_visualize(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
) -> PermissionResultAllow:
    """Auto-approve: display-only tool, no side effects."""
    return PermissionResultAllow(behavior="allow")
