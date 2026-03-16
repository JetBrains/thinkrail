"""Bonsai visualization MCP tool.

In-process MCP tool that renders structured visualizations in the frontend.
The actual rendering happens client-side via the toolCallStart event's
toolInput payload; this handler returns a short confirmation.
"""

from __future__ import annotations

import json
from typing import Any

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tracker import Tracker
from app.core.config import AppConfig

from app.agent.tools._vis_validation import (
    VALID_STATUSES,
    VIS_EXAMPLES,
    _validate_status,
    _validate_vis_data,
)

VIS_SCHEMA: dict = {
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
        "visId": {
            "type": "string",
            "description": (
                "Optional stable ID for the visualization. When the same visId "
                "is used across multiple calls, older cards auto-collapse and "
                "the latest one renders in full."
            ),
        },
        "data": {
            "type": "object",
            "description": (
                "IMPORTANT: must be a JSON object, not a string. "
                "Type-specific structured data. "
                "For diagram: {nodes: [{id, label, type?}], edges: [{from, to, label?}], layout?} "
                "OR {diagram: '...', notation?: 'mermaid'}. "
                "For progress-tracker: {steps: [{label, status, file?, substeps?}]}. "
                "For summary-box: {sections: [{heading, status?, items: [{label, value}]}]}. "
                "For comparison: {options: [{name, description?, pros?, cons?, visualization?}]}. "
                "For data-table: {columns: string[], rows: string[][], statusColumn?}. "
                "For status-list: {items: [{label, status, meta?}]}."
            ),
        },
        "layout": {
            "type": "object",
            "description": "Optional layout hints: {width?: 'compact'|'normal'|'wide', maxHeight?: number}",
            "properties": {
                "width": {"type": "string", "enum": ["compact", "normal", "wide"]},
                "maxHeight": {"type": "number", "description": "Max card body height in px (scrolls if exceeded)"},
            },
        },
    },
}


def _error_response(vis_type: str, hint: str) -> dict:
    """Build an isError response with a helpful hint and expected format."""
    example = VIS_EXAMPLES.get(vis_type, "{}")
    return {
        "content": [{"type": "text", "text": f"❌ Validation error for '{vis_type}': {hint}\n\nExpected format: {example}"}],
        "isError": True,
    }


@tool(
    "bonsai_visualize",
    "Render a structured visualization in the Bonsai UI. "
    "Use this instead of ASCII art, ANSI escape codes, or Bash echo commands. "
    "The Bonsai frontend renders the data as an interactive card.",
    VIS_SCHEMA,
)
async def _bonsai_visualize(args: dict) -> dict:
    vis_type = args.get("type", "")
    title = args.get("title", vis_type)
    data = args.get("data", {})

    # Auto-parse JSON string data (LLMs sometimes stringify the object)
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, ValueError):
            return _error_response(
                vis_type,
                "`data` must be a JSON object, not a string. "
                'Pass data directly as {...}, not as "{...}"',
            )

    if not isinstance(data, dict):
        return _error_response(
            vis_type,
            f"`data` must be a JSON object, not {type(data).__name__}. "
            'Pass data directly as {...}, not as "{...}"',
        )

    error = _validate_vis_data(vis_type, data)
    if error:
        return _error_response(vis_type, error)

    return {"content": [{"type": "text", "text": f"✓ Rendered: {title} ({vis_type})"}]}


vis_mcp_server = create_sdk_mcp_server(name="bonsai-vis", tools=[_bonsai_visualize])


async def intercept_visualize(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve: display-only tool, no side effects."""
    return PermissionResultAllow(behavior="allow")
