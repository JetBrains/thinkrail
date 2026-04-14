# Visualization — Backend Spec

> Parent: [Tools Package](README.md) | Feature: [.bonsai/design_docs/VISUALIZATION.md](../../../../.bonsai/design_docs/VISUALIZATION.md) | Status: **Active** | Created: 2026-03-16

## Purpose

Backend implementation of the `bonsai_visualize` MCP tool. Unlike most tools in the `tools/` package, visualization spans **three files** across two deployment contexts:

| File | Location | Context |
|------|----------|---------|
| `_vis_validation.py` | `backend/app/agent/tools/` | Shared validation — imported by both servers |
| `visualization.py` | `backend/app/agent/tools/` | In-process SDK handler (Bonsai web UI sessions) |
| `vis-server.py` | `claude-plugin/tools/` | Standalone CLI MCP server (Claude Code sessions) |

See the [full feature spec](../../../../.bonsai/design_docs/VISUALIZATION.md) for protocol, frontend, and scenarios.

## _vis_validation.py

Shared validation module — pure stdlib, zero external dependencies. Both `visualization.py` and `vis-server.py` import from here to ensure consistent validation behavior.

| Export | Type | Description |
|--------|------|-------------|
| `VALID_STATUSES` | `set[str]` | 8 allowed status values: `done`, `current`, `pending`, `error`, `skipped`, `stale`, `fresh`, `in_progress` |
| `VIS_EXAMPLES` | `dict[str, str]` | Example JSON for each visualization type — used in error messages to help the LLM self-correct |
| `_validate_status()` | `(Any, str) → str \| None` | Returns error string if status is not in `VALID_STATUSES` |
| `_validate_vis_data()` | `(str, dict) → str \| None` | Type-specific structural validation; returns error hint or `None` |

### Validation per type

| Type | Required fields | Status validated? |
|------|----------------|-------------------|
| `progress-tracker` | `data.steps[]` with `label` (str) + `status` | Yes — each step and substep |
| `summary-box` | `data.sections[]` with `heading` (str) + `items[]` with `label`/`value` (str) | No — `status` is optional on sections |
| `comparison` | `data.options[]` with `name` (str), optional `visualization` (str, Mermaid syntax) | No |
| `data-table` | `data.columns[]` (str[]) + `data.rows[][]` (matching column count) | No |
| `status-list` | `data.items[]` with `label` (str) + `status` | Yes — each item |
| `diagram` | Either `data.diagram` (str, optional `notation: "mermaid"`) OR `data.nodes[]` + `data.edges[]` with `id`/`label`/`from`/`to` | No |

## visualization.py

In-process MCP tool handler for Bonsai web UI sessions. Follows the [tool file contract](README.md#tool-file-contract).

| Export | Type | Description |
|--------|------|-------------|
| `VIS_SCHEMA` | `dict` | JSON Schema for `bonsai_visualize` input — includes `type`, `title`, `visId`, `data`, `layout` |
| `vis_mcp_server` | MCP server | Created via `create_sdk_mcp_server(name="bonsai-vis")`, registered in `tools.MCP_SERVERS` |
| `intercept_visualize()` | `InterceptFn` | Auto-approve — display-only tool with no side effects |

### Handler flow

```
_bonsai_visualize(args) →
  1. Extract type, title, data from args
  2. Auto-parse JSON string data (LLMs sometimes stringify the object)
  3. Validate with _validate_vis_data()
  4. On error: return isError response with hint + expected format example
  5. On success: return "✓ Rendered: {title} ({type})"
```

The handler is lightweight — actual rendering happens on the frontend via the `toolCallStart` event. The backend only validates and confirms.

### Error response format

```python
{
    "content": [{"type": "text", "text": "❌ Validation error for '{type}': {hint}\n\nExpected format: {example}"}],
    "isError": True,
}
```

The `isError: True` flag tells the SDK to relay the error to the LLM, which can self-correct using the included example format.

## vis-server.py

Standalone stdio MCP server for use with Claude Code CLI (outside Bonsai web UI). Located at `claude-plugin/tools/vis-server.py`.

### Key exports and constants

| Name | Type | Description |
|------|------|-------------|
| `TOOL_DEFINITION` | `dict` | MCP tool definition with `inputSchema` matching `VIS_SCHEMA` |
| `STATUS_ICONS` | `dict[str, str]` | Unicode status icons for Markdown rendering |
| `MD_RENDERERS` | `dict[str, Callable]` | Per-type Markdown renderers (`_md_progress_tracker`, etc.) |
| `handle_tool_call()` | `(dict) → dict` | Process a tool call: validate → render Markdown |
| `main()` | `() → None` | stdio MCP event loop |

### Markdown renderers

When running in CLI fallback mode, the server renders visualizations as Markdown tables/lists instead of relying on a frontend:

| Renderer | Output format |
|----------|--------------|
| `_md_progress_tracker` | Markdown table with status icons, file column, substep indentation |
| `_md_summary_box` | Headings with key-value tables per section |
| `_md_comparison` | Bold names with ✓/✗ pro/con lists |
| `_md_data_table` | Standard Markdown table |
| `_md_status_list` | Bulleted list with status icons and optional meta |
| `_md_diagram` | Code block with node labels and edge arrows |

### stdio MCP protocol

Implements JSON-RPC 2.0 over stdio with Content-Length framing. Handles:

| Method | Response |
|--------|----------|
| `initialize` | Server info + capabilities |
| `notifications/initialized` | No response (acknowledgment) |
| `ping` | Empty result |
| `tools/list` | Returns `[TOOL_DEFINITION]` |
| `tools/call` | Routes to `handle_tool_call()` |
| Unknown with `id` | `-32601 Method not found` error |

### Shared validation import

```python
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
from app.agent.tools._vis_validation import (
    VALID_STATUSES, VIS_EXAMPLES, _validate_status, _validate_vis_data,
)
```

The path manipulation allows the CLI server to import from the backend package without installing it.

## VIS_SCHEMA

Full JSON Schema for the `bonsai_visualize` tool input:

```json
{
  "type": "object",
  "required": ["type", "data"],
  "properties": {
    "type": { "enum": ["progress-tracker", "summary-box", "comparison", "data-table", "status-list", "diagram"] },
    "title": { "type": "string" },
    "visId": { "type": "string" },
    "data": { "type": "object" },
    "layout": {
      "type": "object",
      "properties": {
        "width": { "enum": ["compact", "normal", "wide"] },
        "maxHeight": { "type": "number" }
      }
    }
  }
}
```

## Status Values

8 recognized values in `VALID_STATUSES`:

| Status | Primary? | Purpose |
|--------|----------|---------|
| `done` | Yes | Completed step/item |
| `current` | Yes | Currently active |
| `pending` | Yes | Not yet started |
| `error` | Yes | Failed |
| `skipped` | Yes | Intentionally bypassed |
| `stale` | Yes | Outdated |
| `fresh` | Compat | Equivalent to `done` — kept for backward compatibility |
| `in_progress` | Compat | Equivalent to `current` — kept for backward compatibility |

## Layout Field

The `layout` field is a pass-through — the backend does not interpret it. It is forwarded to the frontend via the `toolCallStart` event and rendered as CSS classes/inline styles on the card.

| Field | Type | Frontend interpretation |
|-------|------|----------------------|
| `width` | `"compact" \| "normal" \| "wide"` | CSS class on `.vis-card` |
| `maxHeight` | `number` | Inline `max-height` in px on `.vis-card-body` with overflow scroll |

## Related Changes

- **`context.py`** — General Instructions section includes visualization tool reference, available types, when-to-use guidance, and anti-patterns. See [CONTEXT.md](../CONTEXT.md).
- **`tools/__init__.py`** — Registers `vis_mcp_server` in `MCP_SERVERS` and `intercept_visualize` in `INTERCEPTORS`.
