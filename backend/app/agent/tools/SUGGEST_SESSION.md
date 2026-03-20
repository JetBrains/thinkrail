# SuggestSession — Backend Spec

> Parent: [Tools Package](README.md) | Feature: [features/SUGGEST_SESSION.md](../../../../features/SUGGEST_SESSION.md) | Status: **Draft** | Created: 2026-03-07 | Updated: 2026-03-20

## Purpose

Backend implementation of the SuggestSession proactive tool. Self-contained in `suggest_session.py` following the [tools package pattern](README.md): schema + handler + MCP server in one file.

The handler performs **in-handler interaction** — validation, card notification, and Future-based suspension happen inside the tool handler via `get_tool_context()`, not through a `canUseTool` interceptor. This ensures the suggestion card is always shown regardless of permission mode, including `bypassPermissions` (yolo mode).

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
  "prompt": "Focus on the build_context() helpers.",
  "requestId": "..."
}
```

Note: `prompt` is only included when the agent provides it. `skill` may be empty for free-form sessions.

**Response from frontend** (via `agent/respond`):
- Approve: `{ "behavior": "allow" }`
- Dismiss: `{ "behavior": "deny", "dismissReason": "Already covered in another session" }`

The `dismissReason` field is optional. The backend reads `dismissReason` first, falling back to `message` for backwards compatibility.

## suggest_session.py

Single file exports:

| Export | Type | Description |
|--------|------|-------------|
| `SUGGEST_SESSION_SCHEMA` | `dict` | JSON Schema for tool input parameters |
| `suggest_session_mcp_server` | MCP server | Created via `create_sdk_mcp_server()`, registered in `tools.MCP_SERVERS` |
| `intercept_suggest_session()` | `InterceptFn` | Auto-approve — interactive flow is handled inside the tool handler via `get_tool_context()`. Registered in `INTERCEPTORS`. |

**Handler logic (`_suggest_session`):**

1. Read session context via `get_tool_context()` → `ctx`
2. Validate `skill` exists in `ctx.config.plugin_dir` and `specIds` exist in registry
3. If validation fails: return `isError` MCP response with error message
4. Create `asyncio.Future` via `ctx.tracker.register_future()`
5. Send `agent/suggestSession` request via `ctx.notify()` with `request_id`
6. `await future` — agent suspended until developer responds
7. On approve: return `"✓ Session '{name}' approved and created."`
8. On dismiss: return `"✗ Suggestion dismissed by developer: {reason}"`

```python
@tool("SuggestSession", "...", SUGGEST_SESSION_SCHEMA)
async def _suggest_session(args: dict) -> dict:
    ctx = get_tool_context()

    # 1. Validate
    skill = args.get("skill", "")
    if skill:
        skill_error = _validate_skill(skill, ctx.config.plugin_dir)
        if skill_error:
            return {"content": [{"type": "text", "text": f"Error: {skill_error}"}], "isError": True}

    spec_ids = args.get("specIds", [])
    if spec_ids:
        spec_error = _validate_spec_ids(spec_ids, ctx.config.get_registry_path())
        if spec_error:
            return {"content": [{"type": "text", "text": f"Error: {spec_error}"}], "isError": True}

    # 2. Interactive flow
    request_id = str(uuid4())
    future = ctx.tracker.register_future(ctx.task.bonsai_sid, request_id)
    payload = {
        "bonsaiSid": ctx.task.bonsai_sid,
        "skill": skill,
        "specIds": spec_ids,
        "name": args.get("name", ""),
        "reason": args.get("reason", ""),
    }
    if args.get("prompt"):
        payload["prompt"] = args["prompt"]

    await ctx.notify("agent/suggestSession", payload, request_id=request_id)
    response = await future

    # 3. Handle response
    if response.get("behavior") == "deny":
        dismiss_reason = response.get("dismissReason") or response.get("message") or ""
        msg = f"✗ Suggestion dismissed by developer: {dismiss_reason}" if dismiss_reason else "✗ Suggestion dismissed by developer."
        return {"content": [{"type": "text", "text": msg}]}

    return {"content": [{"type": "text", "text": f"✓ Session '{args.get('name', '')}' approved and created."}]}
```

### Why this works in yolo mode

In `bypassPermissions` mode, the CLI sends `mcp_message` directly to the SDK without calling `canUseTool`. The SDK routes the message to the in-process MCP server, which runs the handler in the same asyncio event loop as the runner. The handler:

1. Reads `ctx` from `contextvars` (set by runner before SDK client creation)
2. Sends the card notification to the frontend via `ctx.notify()`
3. `await future` yields control to the event loop
4. The event loop processes the frontend's `agent/respond` RPC → `tracker.resolve_future()`
5. Handler resumes with the response

No `canUseTool` hook involvement at any point.

## Related Backend Changes

- `runner.py` — **updated**: calls `set_tool_context(tracker, notify, task, config)` before creating SDK client
- `permissions.py` — routes `SuggestSession` via `INTERCEPTORS` → `intercept_suggest_session()` (auto-approve). Also handles `AskUserQuestion` interactively and default `agent/confirmAction` for unknown tools.
- `tools/__init__.py` — **updated**: exports `intercept_suggest_session` in `INTERCEPTORS` and `set_tool_context` / `get_tool_context` from `_context.py`.
- `tools/_context.py` — **new**: `ToolContext` dataclass + `contextvars` accessors
- `service.py` — no changes (session_prompt threading already done)
- `tracker.py` — no changes (Future management already done)
- `models.py` — no changes (AgentTask already has session_prompt)
