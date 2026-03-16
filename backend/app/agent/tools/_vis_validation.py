"""Shared visualization validation — single source of truth.

Both the in-process SDK handler (visualization.py) and the standalone
CLI MCP server (vis-server.py) import from here.  Pure-stdlib only so
vis-server.py stays zero-dependency.
"""

from __future__ import annotations

from typing import Any

VALID_STATUSES = {"done", "current", "pending", "error", "skipped", "stale", "fresh", "in_progress"}

VIS_EXAMPLES: dict[str, str] = {
    "progress-tracker": '{"steps": [{"label": "Step 1", "status": "done"}]}',
    "summary-box": '{"sections": [{"heading": "Title", "items": [{"label": "Key", "value": "Val"}]}]}',
    "comparison": '{"options": [{"name": "Option A"}]}',
    "data-table": '{"columns": ["Col1", "Col2"], "rows": [["a", "b"]]}',
    "status-list": '{"items": [{"label": "Item", "status": "done"}]}',
    "diagram": '{"nodes": [{"id": "a", "label": "A"}], "edges": [{"from": "a", "to": "b"}]}',
}


def _validate_status(status: Any, context: str) -> str | None:
    """Return error string if status is not a valid enum value."""
    if not isinstance(status, str) or status not in VALID_STATUSES:
        valid = ", ".join(sorted(VALID_STATUSES))
        return f"{context}: invalid status '{status}'. Valid values: {valid}"
    return None


def _validate_vis_data(vis_type: str, data: dict) -> str | None:
    """Validate data payload for a given visualization type. Returns error hint or None."""
    if vis_type == "progress-tracker":
        steps = data.get("steps")
        if not isinstance(steps, list):
            return "data.steps must be a list"
        for i, step in enumerate(steps):
            if not isinstance(step, dict) or not isinstance(step.get("label"), str):
                return f"data.steps[{i}] must have a string 'label'"
            if err := _validate_status(step.get("status"), f"data.steps[{i}].status"):
                return err

    elif vis_type == "summary-box":
        sections = data.get("sections")
        if not isinstance(sections, list):
            return "data.sections must be a list"
        for i, section in enumerate(sections):
            if not isinstance(section, dict) or not isinstance(section.get("heading"), str):
                return f"data.sections[{i}] must have a string 'heading'"
            items = section.get("items")
            if not isinstance(items, list):
                return f"data.sections[{i}].items must be a list"
            for j, item in enumerate(items):
                if not isinstance(item, dict):
                    return f"data.sections[{i}].items[{j}] must be an object"
                if not isinstance(item.get("label"), str) or not isinstance(item.get("value"), str):
                    return f"data.sections[{i}].items[{j}] must have string 'label' and 'value'"

    elif vis_type == "comparison":
        options = data.get("options")
        if not isinstance(options, list):
            return "data.options must be a list"
        for i, opt in enumerate(options):
            if not isinstance(opt, dict) or not isinstance(opt.get("name"), str):
                return f"data.options[{i}] must have a string 'name'"
            vis = opt.get("visualization")
            if vis is not None and not isinstance(vis, str):
                return f"data.options[{i}].visualization must be a string (Mermaid syntax)"

    elif vis_type == "data-table":
        columns = data.get("columns")
        if not isinstance(columns, list) or not all(isinstance(c, str) for c in columns):
            return "data.columns must be a list of strings"
        rows = data.get("rows")
        if not isinstance(rows, list):
            return "data.rows must be a list"
        for i, row in enumerate(rows):
            if not isinstance(row, list):
                return f"data.rows[{i}] must be a list"
            if len(row) != len(columns):
                return f"data.rows[{i}] has {len(row)} cells but expected {len(columns)} (matching columns)"

    elif vis_type == "status-list":
        items = data.get("items")
        if not isinstance(items, list):
            return "data.items must be a list"
        for i, item in enumerate(items):
            if not isinstance(item, dict) or not isinstance(item.get("label"), str):
                return f"data.items[{i}] must have a string 'label'"
            if err := _validate_status(item.get("status"), f"data.items[{i}].status"):
                return err

    elif vis_type == "diagram":
        # Accept either structured {nodes, edges} or text-based {diagram: "..."}
        if isinstance(data.get("diagram"), str):
            return None  # text-based diagram, always valid
        nodes = data.get("nodes")
        edges = data.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            return "data must have 'nodes' and 'edges' lists, or a 'diagram' string"
        for i, node in enumerate(nodes):
            if not isinstance(node, dict):
                return f"data.nodes[{i}] must be an object"
            if not isinstance(node.get("id"), str) or not isinstance(node.get("label"), str):
                return f"data.nodes[{i}] must have string 'id' and 'label'"
        for i, edge in enumerate(edges):
            if not isinstance(edge, dict):
                return f"data.edges[{i}] must be an object"
            if not isinstance(edge.get("from"), str) or not isinstance(edge.get("to"), str):
                return f"data.edges[{i}] must have string 'from' and 'to'"

    else:
        valid_types = ", ".join(VIS_EXAMPLES)
        return f"Unknown visualization type '{vis_type}'. Valid types: {valid_types}"

    return None
