# Proactive Agent Experience — Architecture Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Implements: [PROACTIVE_AGENT_EXPERIENCE.md](PROACTIVE_AGENT_EXPERIENCE.md) | Status: **Draft** | Created: 2026-03-07

## Table of Contents
1. [Overview](#overview)
2. [Current State](#current-state)
3. [High-Level Design](#high-level-design)
4. [Tool Interception Pattern](#tool-interception-pattern)
5. [Proactive Tool Categories](#proactive-tool-categories)
6. [Changes by Layer](#changes-by-layer)
7. [Key Design Decisions](#key-design-decisions)
8. [Open Questions](#open-questions)
9. [Feature & Backend Specs](#feature--backend-specs)

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

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `runner.py` | Add branches in `can_use_tool` for each proactive tool |
| `models.py` | Add Pydantic models for tool schemas (optional, for validation) |

No changes to: `service.py`, `tracker.py`, `context.py`, `persistence.py`, `notifications.py`.

### Frontend

| File | Change |
|------|--------|
| `wireEvents.ts` | Wire new notification/request methods |
| `sessionStore.ts` | Add handlers and state fields for each proactive tool |
| `ChatStream.tsx` | Render cards for interactive tool events |
| New components | One UI component per proactive tool |
| `types/session.ts` | Add TypeScript types for tool data |

### Plugin / Context

| Concern | Change |
|---------|--------|
| Tool availability | Proactive tools must be callable by the agent — may require plugin tool registration or system prompt injection (see [Open Questions](#open-questions)) |
| Skill instructions | Skills that should leverage proactive tools need instructions on when/how to call them |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reuse canUseTool | All proactive tools go through the same hook as AskUserQuestion | Zero new infrastructure. Proven pattern. Single interception point. |
| Two categories | Interactive (suspend + await) vs. Passive (auto-approve) | Right semantics: meaningful actions need approval, informational updates shouldn't block. |
| Allow on dismiss | `PermissionResultAllow` with dismissal flag, never `PermissionResultDeny` | Deny triggers SDK error handling. We want graceful continuation. |
| No new backend files | Changes fit in existing `runner.py` + `models.py` | Small, focused additions. Each tool is a few lines in the hook. |
| Extensible pattern | Adding a new proactive tool = one hook branch + one notification + one component | Low cost to add future tools (PushContext, SuggestAction, etc.) |

## Open Questions

1. **Tool availability:** Are custom tool names (SuggestSession, UpdateProgress) callable by the agent, or must we register them? Options:
   - Register as plugin tools via `claude-plugin/tools/`
   - Add as MCP tools
   - Use the SDK's custom tool registration API
   - Embed tool definitions in the system prompt

2. **Skill awareness:** Should all skills know about proactive tools automatically (via a shared preamble in `context.py`), or opt-in per skill (via SKILL.md instructions)?

3. ~~**Progress persistence:**~~ **Resolved** — passive tool events are persisted in `.events.jsonl` via `appendEvent` in the frontend handler. Restored sessions reconstruct last known progress from events.

## Feature & Backend Specs

Each proactive tool has a **feature spec** (full end-to-end: protocol + backend + frontend + scenarios) and a **backend spec** (runner.py changes only):

| Tool | Feature Spec | Backend Spec | Category |
|------|-------------|-------------|----------|
| SuggestSession | [features/SUGGEST_SESSION.md](SUGGEST_SESSION.md) | [backend/app/agent/tools/SUGGEST_SESSION.md](../backend/app/agent/tools/SUGGEST_SESSION.md) | Interactive |
| UpdateProgress | [features/UPDATE_PROGRESS.md](UPDATE_PROGRESS.md) | [backend/app/agent/tools/PROGRESS.md](../backend/app/agent/tools/PROGRESS.md) | Passive |
