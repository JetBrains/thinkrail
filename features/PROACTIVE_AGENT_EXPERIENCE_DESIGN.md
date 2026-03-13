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

All proactive tools follow a single pattern already proven in the codebase: **`canUseTool` interception**. The agent calls a tool, the SDK's permission hook fires, and the intercept function translates it into a frontend-facing notification or request — exactly how `AskUserQuestion` already works.

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
# permissions.py — can_use_tool (routes via INTERCEPTORS registry)
async def can_use_tool(tool_name, input_data, context, *, tracker, notify, task, ctx):
    # Dispatch to registered tool interceptors (suffix match)
    for suffix, intercept_fn in INTERCEPTORS.items():
        if tool_name.endswith(suffix):
            return await intercept_fn(input_data, tracker, notify, task, ctx)
    # Built-in: AskUserQuestion
    if tool_name == "AskUserQuestion":
        ...  # existing: send request, await response
    # Default: generic tool approval
    else:
        ...  # existing: send confirmAction, await approval
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
1. A new tool file in `tools/` (schema + handler + MCP server + intercept)
2. Registration in `tools/__init__.py` (`MCP_SERVERS` + `INTERCEPTORS`)
3. A new notification/request method name
4. Frontend handler + UI component

## Affected Areas

**Backend:** Each proactive tool is self-contained in the `backend/app/agent/tools/` package (schema, handler, MCP server, and intercept logic in one file). Permission routing dispatches `canUseTool` callbacks via the `INTERCEPTORS` registry. No changes to runner, service, tracker, or persistence — all existing infrastructure is reused as-is. See [Tools Package spec](../backend/app/agent/tools/README.md) for the implementation pattern.

**Frontend:** Event wiring, store handlers, chat stream rendering, and context panel sections. Each tool needs a wire subscription, store handler, and UI component. See individual feature specs for file-level details.

## Data Flow

### Interactive tool flow (SuggestSession)

```
Agent LLM
  │ calls SuggestSession({skill, specIds, name, reason})
  ▼
SDK canUseTool fires
  │
  ▼
permissions.py → intercept function
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
tracker resolves Future → intercept function resumes
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
permissions.py → intercept function
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

Each proactive tool lives in the `backend/app/agent/tools/` package as a self-contained file. The tools package exposes `MCP_SERVERS` (wired into the SDK) and `INTERCEPTORS` (used by `permissions.py` for `canUseTool` routing). See [Tools Package spec](../backend/app/agent/tools/README.md) for the pattern and file-level details.

No changes to: `runner.py`, `service.py`, `tracker.py`, `persistence.py`, `notifications.py`.

### Frontend

Each proactive tool needs: event subscription in the store wiring layer, a store handler, and a UI component in the chat stream. See individual feature specs ([SuggestSession](SUGGEST_SESSION.md), [UpdateProgress](UPDATE_PROGRESS.md)) for file-level details.

### Tool Availability & Skill Awareness

| Concern | Approach |
|---------|----------|
| Tool availability | **MCP tool registration** — same `@tool` + `create_sdk_mcp_server` pattern as `bonsai_visualize`. Tools registered in `tools/__init__.py`, agent sees real schemas. |
| Skill awareness | **Shared preamble** — `context.py` injects proactive tool instructions into every session's system prompt. All skills can suggest sessions and report progress. |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reuse canUseTool | All proactive tools go through the same hook as AskUserQuestion | Zero new infrastructure. Proven pattern. Single interception point. |
| Two categories | Interactive (suspend + await) vs. Passive (auto-approve) | Right semantics: meaningful actions need approval, informational updates shouldn't block. |
| Allow on dismiss | `PermissionResultAllow` with dismissal flag, never `PermissionResultDeny` | Deny triggers SDK error handling. We want graceful continuation. |
| Self-contained tool files | Each proactive tool is one file in `tools/` with schema + handler + server + intercept | Follows the tools package pattern. Easy to find everything about a tool in one place. |
| Extensible pattern | Adding a new proactive tool = one hook branch + one notification + one component | Low cost to add future tools (PushContext, SuggestAction, etc.) |
| Tool registration | MCP tools via `@tool` + `create_sdk_mcp_server` (same as `bonsai_visualize`) | Proven pattern in the tools package. Agent sees real tool schemas with names, descriptions, and parameter definitions. `canUseTool` fires before execution, so interception is guaranteed. |
| Skill awareness | Shared preamble in `context.py` for all skills | All skills benefit from UpdateProgress (progress reporting) and SuggestSession (follow-up suggestions). No opt-in overhead — every session gets proactive tool awareness. |
| Backend validation | Runner validates `skill` and `specIds` exist before forwarding SuggestSession to frontend | Catches bad suggestions early. Agent gets clear error feedback. Frontend never renders an invalid suggestion card. |

## Resolved Questions

1. ~~**Tool availability:**~~ **Resolved** — MCP tool registration using `@tool` + `create_sdk_mcp_server`, the same pattern as `bonsai_visualize`. Tools are registered in the `tools/` package and the agent sees real schemas.

2. ~~**Skill awareness:**~~ **Resolved** — Shared preamble in `context.py`. All skills automatically know about proactive tools. No per-skill opt-in needed.

3. ~~**Progress persistence:**~~ **Resolved** — Passive tool events are persisted in `.events.jsonl` via `appendEvent` in the frontend handler. Restored sessions reconstruct last known progress from events.

4. ~~**SuggestSession validation:**~~ **Resolved** — Backend validates that `skill` exists in the plugin and `specIds` exist in the registry before forwarding to the frontend. Invalid suggestions are auto-dismissed with an error message back to the agent.

## Feature & Backend Specs

Each proactive tool has a **feature spec** (full end-to-end: protocol + backend + frontend + scenarios) and a **backend spec** (tool file implementation):

| Tool | Feature Spec | Backend Spec | Category |
|------|-------------|-------------|----------|
| SuggestSession | [features/SUGGEST_SESSION.md](SUGGEST_SESSION.md) | [backend/app/agent/tools/SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md) | Interactive |
| UpdateProgress | [features/UPDATE_PROGRESS.md](UPDATE_PROGRESS.md) | [backend/app/agent/tools/PROGRESS.md](../backend/app/agent/tools/PROGRESS.md) | Passive |
