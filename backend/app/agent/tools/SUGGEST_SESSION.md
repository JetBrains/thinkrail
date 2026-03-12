# SuggestSession — Backend Spec

> Parent: [Tools Package](README.md) | Feature: [features/SUGGEST_SESSION.md](../../../../features/SUGGEST_SESSION.md) | Status: **Draft** | Created: 2026-03-07 | Updated: 2026-03-11

## Purpose

Backend implementation of the SuggestSession proactive tool. Self-contained in `suggest_session.py` following the [tools package pattern](README.md): schema + handler + MCP server + `intercept()` in one file.

See the [full feature spec](../../../../features/SUGGEST_SESSION.md) for protocol, frontend, and scenarios.

## Wire Format

**Method:** `agent/suggestSession` (server-initiated request, JSON-RPC with `id`)

**Params sent to frontend:**

```json
{
  "bonsaiSid": "...",
  "skill": "module-design",
  "specIds": ["module-agent"],
  "name": "Design: Agent Context Module",
  "reason": "The context assembly pipeline needs its own module spec.",
  "requestId": "..."
}
```

**Response from frontend** (via `agent/respond`):
- Approve: `{ "behavior": "allow" }`
- Dismiss: `{ "behavior": "deny", "message": "Dismissed" }`

## suggest_session.py

Single file exports:

| Export | Type | Description |
|--------|------|-------------|
| `SUGGEST_SESSION_SCHEMA` | `dict` | JSON Schema for tool input parameters |
| `suggest_session_mcp_server` | MCP server | Created via `create_sdk_mcp_server()`, registered in `tools.MCP_SERVERS` |
| `intercept_suggest_session()` | `InterceptFn` | Handles `can_use_tool()` callback: validate inputs, create Future, notify frontend, await response |

**Interception logic:**

- Validate `skill` exists in the plugin and `specIds` exist in the registry
- If validation fails: return `PermissionResultAllow` with `updated_input` containing `{error: "..."}` — agent sees the error gracefully
- If valid: create `asyncio.Future`, send `agent/suggestSession` request, await response
- Both approve and dismiss return `PermissionResultAllow` — never `PermissionResultDeny` (which triggers SDK error handling)
- Approve: `updated_input` contains `{approved: true}`
- Dismiss: `updated_input` contains `{dismissed: true}`

## No Other Backend Changes

- `runner.py` — no changes (imports `MCP_SERVERS` from `tools/`, delegates to `permissions.py`)
- `permissions.py` — no changes (routes via `INTERCEPTORS` registry)
- `service.py` — no changes (existing `respond()` method handles the Future resolution)
- `tracker.py` — no changes (existing `register_future()` / `resolve_future()` reused)
- `persistence.py` — no changes (event persisted by frontend via `appendEvent`)
