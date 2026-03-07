# SuggestSession — Backend Spec

> Parent: [Agent Module](../README.md) | Feature: [features/SUGGEST_SESSION.md](../../../../features/SUGGEST_SESSION.md) | Status: **Draft** | Created: 2026-03-07

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

New branch in `can_use_tool`:

```python
elif tool_name == "SuggestSession":
    request_id = str(uuid4())
    future = tracker.register_future(task.bonsai_sid, request_id)
    await notify(
        "agent/suggestSession",
        {
            "bonsaiSid": task.bonsai_sid,
            "skill": input_data.get("skill", ""),
            "specIds": input_data.get("specIds", []),
            "name": input_data.get("name", ""),
            "reason": input_data.get("reason", ""),
        },
        request_id=request_id,
    )
    response = await future
    if response.get("behavior") == "deny":
        return PermissionResultAllow(
            behavior="allow",
            updated_input={**input_data, "dismissed": True},
        )
    return PermissionResultAllow(
        behavior="allow",
        updated_input={**input_data, "approved": True},
    )
```

**Key:** Both approve and dismiss return `PermissionResultAllow`. We use `updated_input` to signal the outcome — never `PermissionResultDeny` (which would trigger SDK error handling).

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
