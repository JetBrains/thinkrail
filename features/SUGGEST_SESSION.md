# SuggestSession — Feature Spec

> Parent: [Proactive Agent Experience Design](PROACTIVE_AGENT_EXPERIENCE_DESIGN.md) | Status: **Draft** | Created: 2026-03-07

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
  "reason": "The context assembly pipeline needs its own module spec before we refactor it."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill` | string | yes | Skill ID from the plugin (e.g., "module-design", "task-spec") |
| `specIds` | string[] | no | Spec IDs to attach as context (defaults to []) |
| `name` | string | yes | Suggested session name |
| `reason` | string | yes | Why the agent suggests this session |

## Protocol

**Type:** Server-initiated request (JSON-RPC with `id`) — developer must respond.

**Method:** `agent/suggestSession`

### Flow

```
  Runner (canUseTool)                    Frontend
       │                                    │
       │  agent/suggestSession (request)    │
       │  { bonsaiSid, skill, specIds,      │
       │    name, reason, requestId }       │
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
       │      message: "Dismissed" } }      │
       │←─────────────────────────────────  │
       │                                    │
       │  Future resolved                   │
       │  → PermissionResultAllow           │
       │    (updated_input: {dismissed: true})
       │  Agent sees dismissal, continues   │
```

**On dismiss:** Returns `PermissionResultAllow` (not Deny) with `dismissed: true` in `updated_input`. The agent sees the dismissal and continues working.

### Full Lifecycle

```
1. Agent (LLM) generates tool call: SuggestSession({skill, specIds, name, reason})
2. SDK fires canUseTool("SuggestSession", input_data, context)
3. runner.py intercepts → creates Future → sends agent/suggestSession request
4. notifications.py sends JSON-RPC request over WebSocket (with id)
5. wireEvents.ts receives → dispatches to sessionStore.onSuggestSession()
6. sessionStore stores pending suggestion → ChatStream renders SuggestionCard
7. User clicks "Start Session"
8. sessionStore.resolveRequest() → sends agent/respond RPC to backend
9. rpc/methods/agents.py → service.respond() → tracker resolves Future
10. runner.py resumes → returns PermissionResultAllow to SDK
11. Frontend: startSession() with suggested params → new session created
12. Frontend: switchSession() → auto-switches to new session tab
```

## Backend

Backend implementation is scoped to `runner.py` and `models.py` in the agent module. See [backend/app/agent/tools/SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md) for the backend-only spec.

**Summary:** New branch in `can_use_tool` that creates a Future, sends `agent/suggestSession` request, awaits response, and returns `PermissionResultAllow` with either `approved: true` or `dismissed: true` in `updated_input`.

## Frontend

> **TBD** — Frontend implementation details to be specified separately.

**Expected changes:**
- `wireEvents.ts` — wire `agent/suggestSession` event
- `sessionStore.ts` — add `onSuggestSession` handler, store as `pendingRequest`
- `SuggestionCard.tsx` — new component rendering suggestion with approve/dismiss buttons
- `ChatStream.tsx` — new case for `suggestSession` event type
- `types/session.ts` — add `"suggestion"` to `PendingRequest.type` union

**UX behavior:**
- On "Start Session": resolve request, call `startSession()` with suggested params, auto-switch to new session
- On "Dismiss": resolve request with deny, agent continues

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
Agent: [calls SuggestSession] → "Update: Core Module Spec"
Developer: [approves] → session created
Agent: [calls SuggestSession] → "Update: RPC Module Spec"
Developer: [dismisses] → agent continues
Agent: [calls SuggestSession] → "New: File Watcher Submodule Spec"
Developer: [approves] → session created
```

## Open Questions

1. **Validation:** Should the backend validate that `skill` and `specIds` exist before forwarding to the frontend? If yes, invalid suggestions are auto-dismissed with an error. If no, the frontend fails when creating the session.

## Related Specs

- **Parent:** [Proactive Agent Experience Design](PROACTIVE_AGENT_EXPERIENCE_DESIGN.md)
- **Backend:** [backend/app/agent/tools/SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md)
- **Pattern reference:** `AskUserQuestion` interception in `runner.py`
