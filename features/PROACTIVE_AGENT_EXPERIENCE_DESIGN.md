# Proactive Agent Experience — Architecture Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Implements: [PROACTIVE_AGENT_EXPERIENCE.md](PROACTIVE_AGENT_EXPERIENCE.md) | Status: **Active** | Created: 2026-03-07 | Updated: 2026-03-11

## Table of Contents
1. [Overview](#overview)
2. [Current State](#current-state)
3. [High-Level Design](#high-level-design)
4. [Tool Interception Pattern](#tool-interception-pattern)
5. [Proactive Tool Categories](#proactive-tool-categories)
6. [Source Tree](#source-tree)
7. [Data Flow](#data-flow)
8. [Changes by Layer](#changes-by-layer)
9. [Key Design Decisions](#key-design-decisions)
10. [Resolved Questions](#resolved-questions)
11. [Feature & Backend Specs](#feature--backend-specs)

## Overview

This design introduces **proactive tools** — a class of agent tools that let the LLM drive the developer's UI and workflow, not just respond in a chat stream. Instead of the developer manually orchestrating sessions and checking context, the agent calls proactive tools to suggest actions, report progress, and push structured information to UI surfaces beyond the chat.

All proactive tools follow a single pattern already proven in the codebase: **`canUseTool` interception** in `runner.py`. The agent calls a tool, the SDK's permission hook fires, and the runner translates it into a frontend-facing notification or request — exactly how `AskUserQuestion` already works.

## Current State

Today, the agent communicates through three channels:

```
Agent (LLM)
  │
  ├── Text blocks ──────────→ agent/textDelta ──→ ChatStream
  ├── Tool calls ───────────→ agent/toolCallStart/End ──→ ToolCallCard
  └── AskUserQuestion tool ─→ agent/askUserQuestion ──→ QuestionCard
      (intercepted by canUseTool)
```

The developer manually creates sessions via `NewSessionModal`, manually checks the context panel, and manually decides what to do next. The agent has no way to suggest follow-up work or push structured information outside the chat stream.

## High-Level Design

Proactive tools add new branches to the existing `canUseTool` interception:

```
Agent (LLM)
  │
  ├── Text blocks ──────────→ agent/textDelta ──→ ChatStream
  ├── Tool calls ───────────→ agent/toolCallStart/End ──→ ToolCallCard
  ├── AskUserQuestion ──────→ agent/askUserQuestion ──→ QuestionCard
  │
  ├── [Proactive: Interactive tools] ──→ server-initiated request ──→ UI card
  │   (intercepted, suspends on Future)   (needs developer response)
  │
  └── [Proactive: Passive tools] ──────→ notification ──→ UI surface
      (intercepted, auto-approved)        (fire and forget)
```

**Key principle:** No new backend infrastructure. All proactive tools reuse the existing `canUseTool` hook, `asyncio.Future` suspension, and JSON-RPC notification/request channels.

## Tool Interception Pattern

All agent-to-UI communication goes through the SDK's `canUseTool` hook. When the agent calls a tool, the hook fires before the tool executes:

```python
# runner.py — can_use_tool
async def can_use_tool(tool_name, input_data, context):
    if tool_name == "AskUserQuestion":
        # existing: send request, await response
    elif tool_name in PROACTIVE_INTERACTIVE_TOOLS:
        # NEW: send request, await approval/dismiss
    elif tool_name in PROACTIVE_PASSIVE_TOOLS:
        # NEW: emit notification, auto-approve immediately
    else:
        # existing: send confirmAction, await approval
```

### Interactive proactive tools

For tools where the developer must approve or choose (e.g., session suggestions):

1. Runner creates an `asyncio.Future` via `tracker.register_future()`
2. Runner sends a **server-initiated request** (JSON-RPC with `id`) to the frontend
3. Runner awaits the Future — agent is suspended
4. Developer responds → `agent/respond` RPC → Future resolved → runner resumes
5. Runner returns `PermissionResultAllow` with `updated_input` carrying the response

**On dismiss:** Return `PermissionResultAllow` (not Deny) with a dismissal flag in `updated_input`. This prevents the SDK from treating it as an error.

### Passive proactive tools

For tools that push info without needing a response (e.g., progress updates):

1. Runner emits a **notification** (JSON-RPC without `id`) to the frontend
2. Runner immediately returns `PermissionResultAllow` — no suspension
3. Frontend updates its state and renders the info

## Proactive Tool Categories

| Category | Behavior | Example | Submodule Spec |
|----------|----------|---------|----------------|
| **Interactive** | Suspends agent, needs developer approval | SuggestSession | [SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md) |
| **Passive** | Auto-approved, notification only | UpdateProgress | [PROGRESS.md](../backend/app/agent/tools/PROGRESS.md) |

Future proactive tools (e.g., PushContext, SuggestAction) would follow one of these two categories. The pattern is extensible — adding a new proactive tool only requires:
1. A new branch in `can_use_tool` (runner.py)
2. A new notification/request method name
3. Frontend handler + UI component

## Source Tree

```
backend/app/agent/
  runner.py              # MODIFIED — new @tool definitions for SuggestSession + UpdateProgress,
                         #            new branches in can_use_tool for interception,
                         #            new MCP server registration (or extend existing bonsai-viz server)
  models.py              # MODIFIED — add SessionSuggestion + ProgressUpdate Pydantic models
  context.py             # MODIFIED — add shared proactive-tools preamble to system prompt

frontend/src/
  store/wireEvents.ts    # MODIFIED — wire agent/suggestSession + agent/progressUpdate
  store/sessionStore.ts  # MODIFIED — add onSuggestSession handler, progress state, pending suggestion
  components/ChatStream/
    ChatStream.tsx        # MODIFIED — new case for suggestSession event → SuggestionCard
    SuggestionCard.tsx    # NEW — interactive card: skill pill, name, reason, Start/Dismiss
  components/ContextPanel/
    sections/
      ProgressSection.tsx # NEW — phase, plan, status display in Agent Context mode
    modes/
      AgentContext.tsx     # MODIFIED — add ProgressSection as first section
  types/session.ts        # MODIFIED — add ProgressData type, suggestion to PendingRequest union
```

**Unchanged files:** `service.py`, `tracker.py`, `persistence.py`, `notifications.py` — all existing infrastructure is reused as-is.

## Data Flow

### Interactive tool flow (SuggestSession)

```
Agent LLM
  │ calls SuggestSession({skill, specIds, name, reason})
  ▼
SDK canUseTool fires
  │
  ▼
runner.py can_use_tool
  │ 1. Validate skill exists in plugin, specIds exist in registry
  │ 2. Create asyncio.Future via tracker.register_future()
  │ 3. Send agent/suggestSession (JSON-RPC request with id) → frontend
  │ 4. Await Future (agent suspended)
  ▼
Frontend wireEvents.ts → sessionStore.onSuggestSession()
  │ Store pending suggestion → ChatStream renders SuggestionCard
  ▼
Developer clicks Start or Dismiss
  │ sessionStore.resolveRequest() → agent/respond RPC → backend
  ▼
tracker resolves Future → runner.py resumes
  │ Return PermissionResultAllow with {approved: true} or {dismissed: true}
  ▼
Agent receives tool result, continues
```

### Passive tool flow (UpdateProgress)

```
Agent LLM
  │ calls UpdateProgress({phase, plan, status})
  ▼
SDK canUseTool fires
  │
  ▼
runner.py can_use_tool
  │ 1. Emit agent/progressUpdate notification (no id) → frontend
  │ 2. Immediately return PermissionResultAllow (no suspension)
  ▼
Frontend wireEvents.ts → sessionStore.onProgressUpdate()
  │ Update session.progress → ContextPanel re-renders ProgressSection
  ▼
Agent continues immediately (no waiting)
```

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `runner.py` | Register SuggestSession + UpdateProgress as MCP tools (same `@tool` + `create_sdk_mcp_server` pattern as `bonsai_visualize`). Add branches in `can_use_tool` for interception. Backend validates skill/specIds before forwarding SuggestSession. |
| `models.py` | Add `SessionSuggestion` and `ProgressUpdate` Pydantic models for validation |
| `context.py` | Add shared proactive-tools preamble to system prompt — all skills get awareness of SuggestSession and UpdateProgress |

No changes to: `service.py`, `tracker.py`, `persistence.py`, `notifications.py`.

### Frontend

| File | Change |
|------|--------|
| `wireEvents.ts` | Wire `agent/suggestSession` (request) and `agent/progressUpdate` (notification) |
| `sessionStore.ts` | Add handlers, `progress` state field, pending suggestion state |
| `ChatStream.tsx` | New case for `suggestSession` event → renders `<SuggestionCard>` |
| `SuggestionCard.tsx` | NEW: interactive card with skill pill, name, reason, Start/Dismiss buttons |
| `ProgressSection.tsx` | NEW: phase, plan steps, status display in ContextPanel Agent Context mode |
| `types/session.ts` | Add `ProgressData` type, `"suggestion"` to `PendingRequest.type` union |

### Plugin / Context

| Concern | Approach |
|---------|----------|
| Tool availability | **MCP tool registration** — same `@tool` + `create_sdk_mcp_server` pattern as `bonsai_visualize`. Tools registered in `runner.py`, agent sees real schemas. |
| Skill awareness | **Shared preamble** — `context.py` injects proactive tool instructions into every session's system prompt. All skills can suggest sessions and report progress. |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reuse canUseTool | All proactive tools go through the same hook as AskUserQuestion | Zero new infrastructure. Proven pattern. Single interception point. |
| Two categories | Interactive (suspend + await) vs. Passive (auto-approve) | Right semantics: meaningful actions need approval, informational updates shouldn't block. |
| Allow on dismiss | `PermissionResultAllow` with dismissal flag, never `PermissionResultDeny` | Deny triggers SDK error handling. We want graceful continuation. |
| No new backend files | Changes fit in existing `runner.py` + `models.py` + `context.py` | Small, focused additions. Each tool is a few lines in the hook. |
| Extensible pattern | Adding a new proactive tool = one hook branch + one notification + one component | Low cost to add future tools (PushContext, SuggestAction, etc.) |
| Tool registration | MCP tools via `@tool` + `create_sdk_mcp_server` (same as `bonsai_visualize`) | Proven pattern already in `runner.py`. Agent sees real tool schemas with names, descriptions, and parameter definitions. `canUseTool` fires before execution, so interception is guaranteed. |
| Skill awareness | Shared preamble in `context.py` for all skills | All skills benefit from UpdateProgress (progress reporting) and SuggestSession (follow-up suggestions). No opt-in overhead — every session gets proactive tool awareness. |
| Backend validation | Runner validates `skill` and `specIds` exist before forwarding SuggestSession to frontend | Catches bad suggestions early. Agent gets clear error feedback. Frontend never renders an invalid suggestion card. |

## Resolved Questions

1. ~~**Tool availability:**~~ **Resolved** — MCP tool registration using `@tool` + `create_sdk_mcp_server`, the same pattern as `bonsai_visualize`. Tools are registered in `runner.py` and the agent sees real schemas.

2. ~~**Skill awareness:**~~ **Resolved** — Shared preamble in `context.py`. All skills automatically know about proactive tools. No per-skill opt-in needed.

3. ~~**Progress persistence:**~~ **Resolved** — Passive tool events are persisted in `.events.jsonl` via `appendEvent` in the frontend handler. Restored sessions reconstruct last known progress from events.

4. ~~**SuggestSession validation:**~~ **Resolved** — Backend validates that `skill` exists in the plugin and `specIds` exist in the registry before forwarding to the frontend. Invalid suggestions are auto-dismissed with an error message back to the agent.

## Feature & Backend Specs

Each proactive tool has a **feature spec** (full end-to-end: protocol + backend + frontend + scenarios) and a **backend spec** (runner.py changes only):

| Tool | Feature Spec | Backend Spec | Category |
|------|-------------|-------------|----------|
| SuggestSession | [features/SUGGEST_SESSION.md](SUGGEST_SESSION.md) | [backend/app/agent/tools/SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md) | Interactive |
| UpdateProgress | [features/UPDATE_PROGRESS.md](UPDATE_PROGRESS.md) | [backend/app/agent/tools/PROGRESS.md](../backend/app/agent/tools/PROGRESS.md) | Passive |
