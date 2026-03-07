# UpdateProgress — Feature Spec

> Parent: [Proactive Agent Experience Design](PROACTIVE_AGENT_EXPERIENCE_DESIGN.md) | Status: **Draft** | Created: 2026-03-07

## Table of Contents
1. [Summary](#summary)
2. [Tool Schema](#tool-schema)
3. [Protocol](#protocol)
4. [Backend](#backend)
5. [Frontend](#frontend)
6. [Scenarios](#scenarios)
7. [Related Specs](#related-specs)

## Summary

UpdateProgress is a **passive proactive tool** that lets the agent broadcast its current phase, plan, and status to the context panel. The developer sees what the agent is doing and where it is in its plan — without interrupting the agent's work.

Auto-approved: the runner emits a notification and immediately continues. No developer response needed.

## Tool Schema

The agent calls `UpdateProgress` with:

```json
{
  "phase": "analyzing",
  "plan": [
    "1. Read existing module specs",
    "2. Identify gaps in coverage",
    "3. Draft new module spec"
  ],
  "status": "Reading backend/app/agent/README.md..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phase` | string | yes | Current phase name (e.g., "analyzing", "implementing", "reviewing") |
| `plan` | string[] | no | Ordered list of plan steps (agent's current plan) |
| `status` | string | no | Free-form status text (what the agent is doing right now) |

## Protocol

**Type:** Notification (JSON-RPC without `id`) — no developer response needed.

**Method:** `agent/progressUpdate`

### Flow

```
  Runner (canUseTool)                    Frontend
       │                                    │
       │  agent/progressUpdate (notification)
       │  { bonsaiSid, phase, plan, status }│
       │──────────────────────────────────→ │
       │                                    │  updates sessionStore
       │  (no waiting — auto-approve)       │  renders in ContextPanel
       │  → PermissionResultAllow           │
       │                                    │
```

No suspension, no Future, no response needed.

### Full Lifecycle

```
1. Agent (LLM) generates tool call: UpdateProgress({phase, plan, status})
2. SDK fires canUseTool("UpdateProgress", input_data, context)
3. runner.py intercepts → emits agent/progressUpdate notification → returns Allow
4. notifications.py sends JSON-RPC notification over WebSocket (no id)
5. wireEvents.ts receives → dispatches to sessionStore.onProgressUpdate()
6. sessionStore updates session.progress → ContextPanel re-renders
```

### Persistence

Progress events are persisted in `.events.jsonl` via `appendEvent` in the frontend handler. Restored sessions can reconstruct the last known progress from the event stream.

## Backend

Backend implementation is scoped to `runner.py` and `models.py` in the agent module. See [backend/app/agent/tools/PROGRESS.md](../backend/app/agent/tools/PROGRESS.md) for the backend-only spec.

**Summary:** New branch in `can_use_tool` that emits `agent/progressUpdate` notification and immediately returns `PermissionResultAllow`.

## Frontend

> **TBD** — Frontend implementation details to be specified separately.

**Expected changes:**
- `wireEvents.ts` — wire `agent/progressUpdate` notification
- `sessionStore.ts` — add `progress` field to `Session`, add `onProgressUpdate` handler
- `ProgressSection.tsx` — new component in `ContextPanel/sections/` showing phase, plan, status
- `AgentContext.tsx` — add `ProgressSection` as first section
- `types/session.ts` — add `ProgressData` type

**UX behavior:**
- Progress renders in the context panel (Agent Context mode), always visible
- Updates replace previous progress state (latest wins)
- Plan steps shown as an ordered list with current step highlighted

## Scenarios

### Agent reports progress during a long task

```
Developer: "Review all module specs against the current code"
Agent: [calls UpdateProgress]
  → phase: "scanning"
  → plan: ["1. Read all module specs", "2. Compare with code", "3. Report gaps"]
  → status: "Reading backend/app/spec/README.md..."
  → Context panel shows progress

Agent: [reads files, calls UpdateProgress again]
  → phase: "comparing"
  → status: "Comparing spec module with actual code..."
  → Context panel updates in real-time

Agent: [calls UpdateProgress with findings]
  → phase: "reporting"
  → status: "Found 3 gaps, drafting report..."
```

## Related Specs

- **Parent:** [Proactive Agent Experience Design](PROACTIVE_AGENT_EXPERIENCE_DESIGN.md)
- **Backend:** [backend/app/agent/tools/PROGRESS.md](../backend/app/agent/tools/PROGRESS.md)
- **Frontend:** ContextPanel AgentContext mode
