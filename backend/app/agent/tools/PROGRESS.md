---
id: agent-progress
type: submodule-design
title: UpdateProgress — Backend Spec
parent: module-agent
implements:
- feature-update-progress
covers:
- backend/app/agent/tools/progress.py
tags:
- backend
- proactive
- passive
---
# UpdateProgress — Backend Spec

> Parent: [Tools Package](README.md) | Feature: [.bonsai/design_docs/UPDATE_PROGRESS.md](../../../../.bonsai/design_docs/UPDATE_PROGRESS.md) | Status: **Draft** | Created: 2026-03-07 | Updated: 2026-03-11

## Purpose

Backend implementation of the UpdateProgress proactive tool. Self-contained in `progress.py` following the [tools package pattern](README.md): schema + handler + MCP server + `intercept()` in one file.

See the [full feature spec](../../../../.bonsai/design_docs/UPDATE_PROGRESS.md) for protocol, frontend, and scenarios.

## Wire Format

**Method:** `agent/progressUpdate` (notification, JSON-RPC without `id`)

**Params sent to frontend:**

```json
{
  "bonsaiSid": "...",
  "phase": "analyzing",
  "plan": ["1. Read module specs", "2. Compare with code", "3. Report gaps"],
  "status": "Reading backend/app/spec/README.md..."
}
```

No response expected.

## progress.py

Single file exports:

| Export | Type | Description |
|--------|------|-------------|
| `PROGRESS_SCHEMA` | `dict` | JSON Schema for tool input parameters |
| `progress_mcp_server` | MCP server | Created via `create_sdk_mcp_server()`, registered in `tools.MCP_SERVERS` |
| `intercept_progress()` | `InterceptFn` | Auto-approve in `canUseTool`. Registered in `INTERCEPTORS`. |

**Handler logic** (uses `get_tool_context()` for yolo-mode compatibility):

```python
@tool("UpdateProgress", "...", PROGRESS_SCHEMA)
async def _update_progress(args: dict) -> dict:
    ctx = get_tool_context()
    await ctx.notify("agent/progressUpdate", {
        "bonsaiSid": ctx.task.bonsai_sid,
        "phase": args.get("phase", ""),
        "plan": args.get("plan", []),
        "status": args.get("status", ""),
    })
    return {"content": [{"type": "text", "text": "✓ Progress updated."}]}
```

No suspension, no Future. The handler emits the notification and returns immediately. The interceptor just auto-approves (for non-yolo modes where `canUseTool` fires).

## No Other Backend Changes

- `runtime/claude/runtime.py` — no changes (already calls `set_tool_context()` before SDK client creation)
- `permissions.py` — no changes (routes via `INTERCEPTORS` registry)
- `service.py` — no changes
- `tracker.py` — no changes (no Future needed for passive tools)
- `persistence.py` — no changes
