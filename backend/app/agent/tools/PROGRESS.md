# UpdateProgress — Backend Spec

> Parent: [Agent Module](../README.md) | Feature: [features/UPDATE_PROGRESS.md](../../../../features/UPDATE_PROGRESS.md) | Status: **Draft** | Created: 2026-03-07

## Purpose

Backend implementation of the UpdateProgress proactive tool. Intercepts the tool call via `canUseTool` in `runner.py`, emits a notification to the frontend, and immediately auto-approves.

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

## runner.py

New branch in `can_use_tool`:

```python
elif tool_name == "UpdateProgress":
    await notify("agent/progressUpdate", {
        "bonsaiSid": task.bonsai_sid,
        "phase": input_data.get("phase", ""),
        "plan": input_data.get("plan", []),
        "status": input_data.get("status", ""),
    })
    return PermissionResultAllow(behavior="allow")
```

No suspension, no Future. The runner emits the notification and continues immediately.

## models.py (optional)

```python
class ProgressUpdate(BaseModel):
    phase: str
    plan: list[str] = []
    status: str = ""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
```

## No Other Backend Changes

- `service.py` — no changes
- `tracker.py` — no changes (no Future needed for passive tools)
- `notifications.py` — no changes (existing `make_notify()` supports notifications)
- `persistence.py` — no changes
