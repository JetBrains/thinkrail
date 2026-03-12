# UpdateProgress — Backend Spec

> Parent: [Tools Package](README.md) | Feature: [features/UPDATE_PROGRESS.md](../../../../features/UPDATE_PROGRESS.md) | Status: **Draft** | Created: 2026-03-07 | Updated: 2026-03-11

## Purpose

Backend implementation of the UpdateProgress proactive tool. Self-contained in `progress.py` following the [tools package pattern](README.md): schema + handler + MCP server + `intercept()` in one file.

See the [full feature spec](../../../../features/UPDATE_PROGRESS.md) for protocol, frontend, and scenarios.

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
| `intercept_progress()` | `InterceptFn` | Handles `can_use_tool()` callback: emit notification, auto-approve |

**Interception logic:**

```python
async def intercept_progress(input_data, tracker, notify, task):
    await notify("agent/progressUpdate", {
        "bonsaiSid": task.bonsai_sid,
        "phase": input_data.get("phase", ""),
        "plan": input_data.get("plan", []),
        "status": input_data.get("status", ""),
    })
    return PermissionResultAllow(behavior="allow")
```

No suspension, no Future. The intercept emits the notification and auto-approves immediately.

## No Other Backend Changes

- `runner.py` — no changes (imports `MCP_SERVERS` from `tools/`, delegates to `permissions.py`)
- `permissions.py` — no changes (routes via `INTERCEPTORS` registry)
- `service.py` — no changes
- `tracker.py` — no changes (no Future needed for passive tools)
- `persistence.py` — no changes
