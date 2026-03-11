# SuggestSession — Backend Spec

> Parent: [Agent Module](../README.md) | Feature: [features/SUGGEST_SESSION.md](../../../../features/SUGGEST_SESSION.md) | Status: **Draft** | Created: 2026-03-07 | Updated: 2026-03-11

## Purpose

Backend implementation of the SuggestSession proactive tool. Intercepts the tool call via `canUseTool` in `runner.py`, sends a server-initiated request to the frontend, and awaits the developer's response.

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

## runner.py

Two changes in `runner.py`:

**1. MCP tool registration** — register SuggestSession as an MCP tool (same `@tool` + `create_sdk_mcp_server` pattern as `bonsai_visualize`). This makes the tool callable by the agent with a real schema.

**2. canUseTool interception** — new branch that validates inputs, sends a request to the frontend, and awaits the developer's response:

- Validate `skill` exists in the plugin and `specIds` exist in the registry
- If validation fails: return `PermissionResultAllow` with `updated_input` containing `{error: "..."}` — agent sees the error gracefully
- If valid: create `asyncio.Future`, send `agent/suggestSession` request, await response
- Both approve and dismiss return `PermissionResultAllow` — never `PermissionResultDeny` (which triggers SDK error handling)
- Approve: `updated_input` contains `{approved: true}`
- Dismiss: `updated_input` contains `{dismissed: true}`

## models.py (optional)

```python
class SessionSuggestion(BaseModel):
    skill: str
    spec_ids: list[str] = []
    name: str
    reason: str

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
```

## No Other Backend Changes

- `service.py` — no changes (existing `respond()` method handles the Future resolution)
- `tracker.py` — no changes (existing `register_future()` / `resolve_future()` reused)
- `notifications.py` — no changes (existing `make_notify()` supports requests with `id`)
- `persistence.py` — no changes (event persisted by frontend via `appendEvent`)
