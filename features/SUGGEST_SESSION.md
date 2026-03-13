# SuggestSession — Feature Spec

> Parent: [Proactive Agent Experience Design](PROACTIVE_AGENT_EXPERIENCE_DESIGN.md) | Status: **Draft** | Created: 2026-03-07 | Updated: 2026-03-11

## Table of Contents
1. [Summary](#summary)
2. [Tool Schema](#tool-schema)
3. [Protocol](#protocol)
4. [Backend](#backend)
5. [Frontend](#frontend)
6. [Scenarios](#scenarios)
7. [Open Questions](#open-questions)
8. [Related Specs](#related-specs)

## Summary

SuggestSession is an **interactive proactive tool** that lets the agent suggest follow-up sessions to the developer. Instead of the developer manually deciding "what next?", the agent proposes a session with a pre-filled skill, specs, name, and reason — and the developer approves or dismisses with one click.

When approved, the session is auto-created and the frontend switches to it. The original session continues in the background.

## Tool Schema

The agent calls `SuggestSession` with:

```json
{
  "skill": "module-design",
  "specIds": ["module-agent"],
  "name": "Design: Agent Context Module",
  "reason": "The context assembly pipeline needs its own module spec before we refactor it.",
  "prompt": "Focus on the build_context() helpers. The user wants compact output."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill` | string | no | Skill ID from the plugin (e.g., "module-design", "task-spec"). Omit for free-form sessions. |
| `specIds` | string[] | no | Spec IDs to attach as context (defaults to []) |
| `name` | string | yes | Suggested session name |
| `reason` | string | yes | Why the agent suggests this session |
| `prompt` | string | no | Custom instructions or task description for the new session. Placed before the skill instructions in the system prompt. |

## Protocol

**Type:** Server-initiated request (JSON-RPC with `id`) — developer must respond.

**Method:** `agent/suggestSession`

### Flow

```
  Runner (canUseTool)                    Frontend
       │                                    │
       │  agent/suggestSession (request)    │
       │  { bonsaiSid, skill, specIds,      │
       │    name, reason, prompt?,          │
       │    requestId }                     │
       │──────────────────────────────────→ │
       │                                    │  renders SuggestionCard
       │         (runner awaits Future)     │  in ChatStream
       │                                    │
       │              ┌─── APPROVE ─────────│  user clicks "Start"
       │              │                     │
       │  agent/respond                     │
       │  { requestId, response:            │
       │    { behavior: "allow" } }         │
       │←─────────────────────────────────  │
       │                                    │  → calls startSession()
       │  Future resolved                   │  → auto-switches to new session
       │  → PermissionResultAllow           │
       │                                    │
       │              ┌─── DISMISS ─────────│  user clicks "Dismiss"
       │              │                     │
       │  agent/respond                     │
       │  { requestId, response:            │
       │    { behavior: "deny",             │
       │      dismissReason: "..." } }      │
       │←─────────────────────────────────  │
       │                                    │
       │  Future resolved                   │
       │  → PermissionResultAllow           │
       │    (updated_input: {dismissed: true,│
       │     dismissReason: "..."})         │
       │  Agent sees dismissal + reason     │
```

**On dismiss:** Returns `PermissionResultAllow` (not Deny) with `dismissed: true` and optional `dismissReason` in `updated_input`. The agent sees the dismissal reason and can adjust its behavior accordingly.

### Full Lifecycle

```
1. Agent (LLM) generates tool call: SuggestSession({skill?, specIds, name, reason, prompt?})
2. SDK fires canUseTool("SuggestSession", input_data, context)
3. permissions.py routes via INTERCEPTORS → suggest_session.py intercept_suggest_session()
4. Intercept validates skill + specIds, creates Future, sends agent/suggestSession request (incl. prompt) over WebSocket (with id)
5. wireEvents.ts receives → dispatches to sessionStore.onSuggestSession()
6. sessionStore stores pending suggestion → ChatStream renders SuggestionCard (shows prompt if present)
7. User clicks "Start Session" (or "Dismiss" → dismiss form → optional reason)
8. sessionStore.resolveRequest() → sends agent/respond RPC to backend
9. rpc/methods/agents.py → service.respond() → tracker resolves Future
10. runner.py resumes → returns PermissionResultAllow to SDK (approved or dismissed+reason)
11. Frontend: startSession() with suggested params (incl. prompt) → new session created with session_prompt
12. Frontend: switchSession() → auto-switches to new session tab
```

## Backend

Backend implementation is self-contained in `backend/app/agent/tools/suggest_session.py`, following the [tools package pattern](../backend/app/agent/tools/README.md). See [backend/app/agent/tools/SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md) for the backend-only spec.

**Summary:** `suggest_session.py` defines the MCP tool schema, handler, and `intercept_suggest_session()` function. The `permissions.py` module routes `can_use_tool` callbacks to the intercept function via the `INTERCEPTORS` registry (suffix match). The intercept function validates inputs (skill exists, specIds valid), creates a Future, sends `agent/suggestSession` request (including optional `prompt`), awaits response, and returns `PermissionResultAllow` with either `approved: true` or `{dismissed: true, dismissReason: "..."}` in `updated_input`. When approved, the frontend calls `startSession()` with the suggested params including `prompt`, which is threaded through `service.run_task()` → `tracker.create_task()` → `AgentTask.session_prompt` → `build_context()` as the session prompt in the system prompt.

## Frontend

Frontend implementation is specified in [Chat UI — SuggestionCard](../frontend/ui-specs/CHAT_UI.md#suggestioncard) (component spec) and [State Management — onSuggestSession](../frontend/src/store/README.md#2-sessionstore) (store handler + wireEvents).

**Expected changes:**
- `wireEvents.ts` — wire `agent/suggestSession` event
- `sessionStore.ts` — add `onSuggestSession` handler, store as `pendingRequest`
- `SuggestionCard.tsx` — new component with skill pill, name, reason, Start/Dismiss buttons
- `ChatStream.tsx` — new case for `suggestSession` event type → renders `<SuggestionCard>`
- `types/session.ts` — add `"suggestion"` to `PendingRequest.type` union with `skill`, `specIds`, `name`, `reason` fields

**UX behavior:**
- On "Start Session": resolve request with approve, call `startSession()` with suggested params, auto-switch to new session
- On "Dismiss": resolve request with deny, agent continues
- Visual: blue border (vs. purple for questions), skill pill, session name, reason text

## Scenarios

### Agent completes a task and suggests follow-up

```
Developer: "Create a task spec for adding session persistence"
Agent: [writes task spec, calls tools to create file]
Agent: [calls SuggestSession]
  → skill: "module-design"
  → specIds: ["module-agent", "agent-persistence"]
  → name: "Update: Agent Persistence Module Spec"
  → reason: "The persistence module spec is stale after adding session persistence."
Developer: [sees SuggestionCard, clicks "Start Session"]
  → New session opens with module-design skill and relevant specs
  → Original session continues in background
```

### Agent suggests multiple sessions

```
Agent: [finishes architecture review]
Agent: [tells that it's going to suggest several sessions]
Agent: [calls SuggestSession] → "Update: Core Module Spec"
Developer: [approves] → session created
Agent: [calls SuggestSession] → "Update: RPC Module Spec"
Developer: [dismisses] → agent continues
Agent: [calls SuggestSession] → "New: File Watcher Submodule Spec"
Developer: [approves] → session created
```

## Resolved Questions

1. ~~**Validation:**~~ **Resolved** — Backend validates that `skill` exists in the plugin and `specIds` exist in the registry before forwarding to the frontend. Invalid suggestions are auto-dismissed with an error message back to the agent. This catches bad suggestions early and ensures the frontend never renders an invalid suggestion card.

## Related Specs

- **Parent:** [Proactive Agent Experience Design](PROACTIVE_AGENT_EXPERIENCE_DESIGN.md)
- **Backend:** [backend/app/agent/tools/SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md)
- **Pattern reference:** `AskUserQuestion` interception in `permissions.py`, tool package pattern in `tools/README.md`
