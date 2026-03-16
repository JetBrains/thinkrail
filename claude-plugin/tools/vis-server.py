#!/usr/bin/env python3
"""Minimal MCP server exposing the bonsai_visualize tool.

Implements the MCP protocol over stdio (JSON-RPC 2.0).
Zero external dependencies — stdlib only.

The tool accepts structured visualization data and returns a compact
text confirmation. The actual rendering happens in the Bonsai frontend
via the agent/toolCallStart WebSocket event.

In CLI fallback mode (when not connected to Bonsai web UI), the tool
returns a Markdown-formatted version of the visualization.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
from app.agent.tools._vis_validation import (
    VALID_STATUSES,
    VIS_EXAMPLES,
    _validate_status,
    _validate_vis_data,
)

TOOL_DEFINITION = {
    "name": "bonsai_visualize",
    "description": (
        "Render a structured visualization in the Bonsai UI. "
        "Use this instead of ASCII art, ANSI escape codes, or Bash echo commands. "
        "The Bonsai frontend renders the data as an interactive card."
    ),
    "inputSchema": {
        "type": "object",
        "required": ["type", "data"],
        "properties": {
            "type": {
                "type": "string",
                "enum": [
                    "progress-tracker",
                    "summary-box",
                    "comparison",
                    "data-table",
                    "status-list",
                    "diagram",
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
    },
}

STATUS_ICONS = {
    "done": "\u2713",
    "current": "\u25b6",
    "pending": "\u25cb",
    "error": "\u2715",
    "skipped": "\u2298",
    "stale": "~",
    "fresh": "\u2713",
    "in_progress": "\u25d0",
}


def _md_progress_tracker(title: str, data: dict) -> str:
    lines = [f"### {title}", "", "| Step | Status | File |", "|------|--------|------|"]
    for step in data.get("steps", []):
        icon = STATUS_ICONS.get(step.get("status", "pending"), "\u25cb")
        label = step.get("label", "")
        f = step.get("file", "")
        bold = step.get("status") in ("done", "current")
        name = f"**{label}**" if bold else label
        lines.append(f"| {name} | {icon} {step.get('status', '')} | `{f}` |" if f else f"| {name} | {icon} {step.get('status', '')} | |")
        for sub in step.get("substeps", []):
            si = STATUS_ICONS.get(sub.get("status", "pending"), "\u25cb")
            lines.append(f"|  \u2514 {sub.get('label', '')} | {si} {sub.get('status', '')} | |")
    return "\n".join(lines)


def _md_summary_box(title: str, data: dict) -> str:
    lines = [f"### {title}"]
    for section in data.get("sections", []):
        icon = STATUS_ICONS.get(section.get("status", ""), "")
        lines.append(f"\n**{section.get('heading', '')}** {icon}")
        items = section.get("items", [])
        if items:
            lines.append("| Key | Value |")
            lines.append("|-----|-------|")
            for item in items:
                lines.append(f"| {item.get('label', '')} | {item.get('value', '')} |")
        else:
            lines.append("*No items yet*")
    return "\n".join(lines)


def _md_comparison(title: str, data: dict) -> str:
    lines = [f"### {title}"]
    for opt in data.get("options", []):
        lines.append(f"\n**{opt.get('name', '')}**")
        if opt.get("description"):
            lines.append(opt["description"])
        if opt.get("visualization"):
            lines.append(f"\n```mermaid\n{opt['visualization']}\n```")
        for p in opt.get("pros", []):
            lines.append(f"- \u2713 {p}")
        for c in opt.get("cons", []):
            lines.append(f"- \u2715 {c}")
    return "\n".join(lines)


def _md_data_table(title: str, data: dict) -> str:
    cols = data.get("columns", [])
    rows = data.get("rows", [])
    if not cols:
        return f"### {title}\n\n*Empty table*"
    lines = [f"### {title}", "", "| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for row in rows:
        lines.append("| " + " | ".join(str(c) for c in row) + " |")
    return "\n".join(lines)


def _md_status_list(title: str, data: dict) -> str:
    lines = [f"### {title}"]
    for item in data.get("items", []):
        icon = STATUS_ICONS.get(item.get("status", "pending"), "\u25cb")
        meta = f" *({item['meta']})*" if item.get("meta") else ""
        lines.append(f"- {icon} {item.get('label', '')}{meta}")
    return "\n".join(lines)


def _md_diagram(title: str, data: dict) -> str:
    # Text-based diagram
    if isinstance(data.get("diagram"), str):
        lang = "mermaid" if data.get("notation") == "mermaid" else ""
        return f"### {title}\n\n```{lang}\n{data['diagram']}\n```"
    # Structured nodes/edges diagram
    lines = [f"### {title}", "", "```"]
    for node in data.get("nodes", []):
        t = f" ({node['type']})" if node.get("type") else ""
        lines.append(f"[{node.get('label', node.get('id', ''))}]{t}")
    lines.append("")
    for edge in data.get("edges", []):
        lbl = f" ({edge['label']})" if edge.get("label") else ""
        lines.append(f"{edge.get('from', '')} --> {edge.get('to', '')}{lbl}")
    lines.append("```")
    return "\n".join(lines)


MD_RENDERERS = {
    "progress-tracker": _md_progress_tracker,
    "summary-box": _md_summary_box,
    "comparison": _md_comparison,
    "data-table": _md_data_table,
    "status-list": _md_status_list,
    "diagram": _md_diagram,
}


def handle_tool_call(arguments: dict) -> dict:
    """Process a bonsai_visualize tool call."""
    vis_type = arguments.get("type", "")
    title = arguments.get("title", vis_type)
    data = arguments.get("data", {})
    # LLMs sometimes pass `data` as a JSON string instead of an object — auto-parse it
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, ValueError):
            example = VIS_EXAMPLES.get(vis_type, "{}")
            return {
                "content": [{"type": "text", "text": f"\u274c Validation error for '{vis_type}': data is a string but not valid JSON\n\nExpected format: {example}"}],
                "isError": True,
            }

    if isinstance(data, dict):
        error = _validate_vis_data(vis_type, data)
        if error:
            example = VIS_EXAMPLES.get(vis_type, "{}")
            return {
                "content": [{"type": "text", "text": f"\u274c Validation error for '{vis_type}': {error}\n\nExpected format: {example}"}],
                "isError": True,
            }

    renderer = MD_RENDERERS.get(vis_type)
    if renderer:
        md = renderer(title, data)
        return {
            "content": [
                {"type": "text", "text": f"\u2713 Rendered: {title} ({vis_type})"},
                {"type": "text", "text": md},
            ]
        }
    return {
        "content": [{"type": "text", "text": f"\u2713 Rendered: {title} ({vis_type})"}]
    }


def send(msg: dict) -> None:
    """Write a JSON-RPC message to stdout."""
    raw = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(raw)}\r\n\r\n".encode("utf-8"))
    sys.stdout.buffer.write(raw)
    sys.stdout.buffer.flush()


def read_message() -> dict | None:
    """Read a JSON-RPC message from stdin (Content-Length framing)."""
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            break
        if b":" in line:
            key, val = line.split(b":", 1)
            headers[key.strip().decode("utf-8")] = val.strip().decode("utf-8")
    length = int(headers.get("Content-Length", 0))
    if length == 0:
        return None
    body = sys.stdin.buffer.read(length)
    return json.loads(body)


def main() -> None:
    while True:
        msg = read_message()
        if msg is None:
            break

        method = msg.get("method", "")
        msg_id = msg.get("id")

        if method == "initialize":
            send({
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "bonsai-vis", "version": "1.0.0"},
                },
            })
        elif method == "notifications/initialized":
            pass  # Client acknowledgment, no response needed
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": msg_id, "result": {}})
        elif method == "tools/list":
            send({
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"tools": [TOOL_DEFINITION]},
            })
        elif method == "tools/call":
            params = msg.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})
            if tool_name == "bonsai_visualize":
                result = handle_tool_call(arguments)
            else:
                result = {
                    "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
                    "isError": True,
                }
            send({"jsonrpc": "2.0", "id": msg_id, "result": result})
        elif msg_id is not None:
            # Unknown method with id — return error
            send({
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            })


if __name__ == "__main__":
    main()
