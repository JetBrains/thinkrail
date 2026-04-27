---
id: subsession-design
type: architecture-design
title: Subsessions — Architecture Design
parent: design-doc
tags:
- subsessions
- branching
- agent
---
# Subsessions — Architecture Design

> Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md) | Status: **Draft** | Created: 2026-04-14

## Table of Contents

1. [Overview](#overview)
2. [Goals & Non-Goals](#goals--non-goals)
3. [Architecture](#architecture)
4. [Data Model](#data-model)
5. [Subsession Types](#subsession-types)
6. [Context Injection](#context-injection)
7. [Return Flow](#return-flow)
8. [Entry Points](#entry-points)
9. [Parent State Management](#parent-state-management)
10. [Tab Bar UI](#tab-bar-ui)
11. [RPC Surface](#rpc-surface)
12. [Changes by Layer](#changes-by-layer)
13. [Key Design Decisions](#key-design-decisions)
14. [Open Questions](#open-questions)

## Overview

A subsession is a branched conversation that inherits context from a parent session. It lets users discuss, clarify, or refine something without polluting the main conversation. When done, the subsession's conclusion (summary or refined content) optionally flows back to the parent.

**Core principle:** A subsession is a regular `AgentTask` with extra metadata — not a new entity type. This reuses 100% of the existing session lifecycle (create, run, persist, resume, interrupt).

## Goals & Non-Goals

**Goals:**
- Branch off discussions from an active session without polluting the main conversation
- Inherit full parent conversation context so the subsession agent can reference prior discussion
- Structured return flow: agent proposes summary, user reviews in a loop, approved result flows back
- Two distinct patterns: discussion (summary returns as context) and refinement (content returns as message/input)
- Multiple entry points tailored to specific use cases (text selection, question cards, slash command, voice input)
- Unlimited nesting depth

**Non-Goals:**
- Real-time sync between parent and subsession conversations
- Shared tool execution state between parent and child
- Merging subsession conversation history into parent's conversation turns
- Collaborative multi-user subsessions

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ AgentTask (existing)                                    │
│  + parent_bonsai_sid: str | None                        │
│  + subsession_type: "discussion" | "refinement" | None  │
│  + subsession_context: str | None                       │
│  + return_status: str | None                            │
│  + return_summary: str | None                           │
└─────────────────────────────────────────────────────────┘
         │
         │ parent_bonsai_sid links to
         ▼
┌──────────────────┐     ┌──────────────────┐
│ Parent Session   │────▶│ Subsession A     │
│ (regular task)   │     │ (task + metadata) │
└──────────────────┘     └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ Subsession A.1   │
                         │ (nested child)   │
                         └──────────────────┘
```

A subsession is fully independent after creation — same lifecycle, same persistence, same resume mechanism as standalone sessions. The only extras are:

1. **Parent link** — knows which session spawned it
2. **Context injection** — parent's conversation injected into system prompt
3. **Return flow** — summary/result flows back when done

## Data Model

### Backend (`AgentTask` additions)

```python
class SubsessionType(str, Enum):
    discussion = "discussion"    # Discuss topic, summary returns as context
    refinement = "refinement"    # Refine content, result returns as message/input

class AgentTask(BaseModel):
    # ... existing fields ...
    parent_bonsai_sid: str | None = None
    subsession_type: SubsessionType | None = None  # None = regular session
    subsession_context: str | None = None           # Selected text / voice transcript
    return_status: str | None = None                # "pending" | "approved" | "dismissed"
    return_summary: str | None = None               # Approved text to inject back
```

### Frontend (`Session` type additions)

```typescript
interface Session {
  // ... existing fields ...
  parentBonsaiSid: string | null;
  subsessionType: "discussion" | "refinement" | null;
  subsessionContext: string | null;
  returnStatus: "pending" | "approved" | "dismissed" | null;
  returnSummary: string | null;
}
```

### Persistence

Same format as regular sessions — new fields serialized into the `.json` metadata file:

```json
{
  "bonsaiSid": "sub-uuid",
  "parentBonsaiSid": "parent-uuid",
  "subsessionType": "discussion",
  "subsessionContext": "JWT tokens for stateless auth...",
  "returnStatus": null,
  "returnSummary": null
}
```

## Subsession Types

### Discussion

**Purpose:** Discuss a topic without polluting the parent. Summary returns as context.

**Flow:** User triggers subsession → discuss topic → agent proposes summary → user approves → summary appears as a `SubsessionResultCard` in parent's chat stream → parent's agent sees it on next turn.

**Use cases:**
- Exploring a question before answering it
- Debating approach trade-offs
- Clarifying requirements

### Refinement

**Purpose:** Refine content (voice transcript, draft message). Result returns as actual content.

**Flow:** User triggers subsession → agent refines content → user approves final version → user chooses: "Put in input box" (parent's textarea) or "Send as message" (auto-send in parent).

**Use cases:**
- Cleaning up voice transcription
- Drafting a complex message with agent help
- Reformatting or restructuring content

## Context Injection

When a subsession starts, the parent's conversation is summarized and injected into the subsession's system prompt.

### Implementation

New function in `context.py`:

```python
def build_parent_context(
    parent_sid: str,
    subsession_type: SubsessionType,
    subsession_context: str | None,
    project_root: Path,
) -> str:
```

**Steps:**
1. Load parent's events via `load_events(project_root, parent_sid)`
2. Extract user messages (`userMessage` events) and assistant text (`textDelta` events aggregated per turn)
3. Format as condensed transcript: `**User:** ... / **Assistant:** ...`
4. If transcript exceeds 4000 chars, keep the most recent messages plus the focus context
5. Wrap in a system prompt section with subsession-type-specific instructions

### System Prompt Section

```markdown
## Parent Session Context

You are in a subsession branched from a parent conversation.
The user wants to {discuss a topic | refine content} without polluting the main session.

### Parent Conversation:
{condensed transcript}

### Focus:
{subsession_context — the selected text or voice transcript that triggered this}

### Your Role:
- For discussion: Discuss the topic thoroughly. When the user is satisfied,
  propose a concise summary to bring back to the parent session.
- For refinement: Help refine the provided content. When the user is satisfied,
  propose the final version to bring back.
```

### Future Strategy Swap

The summarization logic is isolated in `build_parent_context()`. To switch to SDK resume later, this function would return a different kind of context (e.g., a session-id for `--resume`) and the runner would fork the conversation directly. No changes needed outside this function and the runner.

## Return Flow

When a subsession ends, the agent proposes a summary and the user reviews it in a loop.

### Flow Diagram

```
User ends subsession (or sends "done")
         │
         ▼
Agent receives: "Please summarize this discussion for the parent session"
         │
         ▼
Agent writes summary → ReturnFlowCard shown to user
         │
         ├─ Approve → return_summary stored, subsession closes
         │            parent receives SubsessionResultCard
         │
         ├─ Edit → user modifies text inline, then approves
         │
         ├─ Revise → user sends feedback, agent rewrites
         │           loop back to ReturnFlowCard
         │
         └─ Dismiss → return_status = "dismissed", subsession closes
                      nothing flows back to parent
```

### Discussion Return

Approved summary appears in parent's chat stream as a `SubsessionResultCard` — a visually distinct card (blue left border) showing the subsession name and summary text. The parent's agent sees this as context on its next turn.

### Refinement Return

After approval, user chooses:
- **"Put in input box"** — refined text placed in parent's input textarea for review before sending
- **"Send as message"** — refined text auto-sent as a user message in the parent session

## Entry Points

### 1. Text Selection → Context Menu

User selects text in the chat stream, right-clicks → context menu shows:
- **"Discuss in subsession"** → opens discussion subsession with selected text as `subsessionContext`
- **"Refine in subsession"** → opens refinement subsession

**Component:** `SubsessionContextMenu.tsx` — attaches to ChatStream's selection events.

### 2. AskUserQuestion "Discuss First" Button

Every `AskUserQuestionCard` gains a "Discuss first" button at the bottom. Clicking it:
- Opens a discussion subsession
- The question text becomes the `subsessionContext`
- When the subsession returns, the user can answer the original question with informed context

**Component:** Modify existing `AskUserQuestionCard.tsx`.

### 3. Slash Command `/discuss`

User types `/discuss <topic>` in the input area. This:
- Creates a discussion subsession
- The text after `/discuss` becomes the `subsessionContext` and the first user message

**Component:** Modify existing `InputArea.tsx` slash command handling.

### 4. Voice Input "Revise with Agent"

After voice transcription completes, a "Revise with agent" button appears next to the transcript. Clicking it:
- Opens a refinement subsession
- The raw transcript becomes the `subsessionContext`
- Agent cleans up the transcript, user approves, result flows back

**Component:** Modify existing `InputArea.tsx` voice input section.

## Parent State Management

When a subsession is created:
1. Parent session's tab shows `⏸` indicator and dims (reduced opacity)
2. Parent is **not ended** — it stays in memory with its SDK client intact
3. User can explicitly "unpark" the parent by clicking its tab and sending a message
4. When subsession closes (with or without return), parent tab automatically un-dims

This is purely a UI convention — the backend doesn't enforce parent pausing. Both sessions can technically run in parallel.

## Tab Bar UI

Subsession tabs appear in the tab bar with visual hierarchy indicators:

| Indicator | Meaning |
|-----------|---------|
| `↳` prefix | This tab is a subsession (depth shown by `↳` count) |
| `💬` icon | Discussion subsession |
| `✏️` icon | Refinement subsession |
| `⏸` + dimmed | Parent is paused (subsession active) |

**Tab ordering:** Subsession tabs appear immediately after their parent tab, maintaining the tree structure visually.

**Nested example:**
```
[⏸ Main session] [↳ ⏸ Discuss: DB design] [↳↳ 💬 Discuss: Postgres vs SQLite]
```

## RPC Surface

### New RPC Methods

| Method | Params | Response | Description |
|--------|--------|----------|-------------|
| `subsession/create` | `{ parentBonsaiSid, type, context?, name? }` | `{ bonsaiSid, ... }` | Create and optionally start a subsession |
| `subsession/requestSummary` | `{ bonsaiSid }` | `{ ok: true }` | Ask subsession agent to propose return summary |
| `subsession/approveSummary` | `{ bonsaiSid, text }` | `{ ok: true }` | Approve (possibly edited) summary |
| `subsession/dismissSummary` | `{ bonsaiSid }` | `{ ok: true }` | Close without returning anything |
| `subsession/reviseSummary` | `{ bonsaiSid, feedback }` | `{ ok: true }` | Ask agent to rewrite with feedback |
| `subsession/listChildren` | `{ parentBonsaiSid }` | `{ children: [...] }` | List subsessions of a parent |

### New Notifications

| Notification | Payload | Description |
|-------------|---------|-------------|
| `subsession/summaryProposed` | `{ bonsaiSid, summary }` | Agent proposed a return summary |
| `subsession/returned` | `{ parentBonsaiSid, childBonsaiSid, type, summary }` | Summary approved and ready for parent |

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `backend/app/agent/models.py` | Add `SubsessionType` enum, 5 new fields on `AgentTask` |
| `backend/app/agent/context.py` | `build_parent_context()` function, new system prompt section |
| `backend/app/agent/service.py` | `create_subsession()`, `request_summary()`, `approve_summary()`, `dismiss_summary()`, `revise_summary()` |
| `backend/app/agent/persistence.py` | Serialize/deserialize new fields, `list_children()` helper |
| `backend/app/rpc/methods/sessions.py` | 6 new RPC handlers for `subsession/*` namespace |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/types/session.ts` | 5 new fields on `Session` interface |
| `frontend/src/store/sessionStore.ts` | `createSubsession()`, `approveReturn()`, `dismissReturn()`, `reviseReturn()` actions; parent pause/unpause logic |
| `frontend/src/components/SessionPanel/SessionTabBar.tsx` | `↳` prefix, type icons, dim paused parents, tree ordering |
| `frontend/src/components/ChatStream/ReturnFlowCard.tsx` | **New** — summary review card |
| `frontend/src/components/ChatStream/SubsessionResultCard.tsx` | **New** — shows returned summary in parent |
| `frontend/src/components/ChatStream/SubsessionContextMenu.tsx` | **New** — right-click menu for text selection |
| `frontend/src/components/ChatStream/AskUserQuestionCard.tsx` | Add "Discuss first" button |
| `frontend/src/components/SessionPanel/InputArea.tsx` | `/discuss` command, "Revise with agent" voice button |
| `frontend/src/api/methods/sessions.ts` | RPC wrappers for `subsession/*` methods |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Subsession = decorated AgentTask | Thin wrapper, not new entity | Reuses 100% of session lifecycle; avoids code duplication |
| System prompt injection | Not SDK resume | Cleaner separation; swappable later via `build_parent_context()` |
| Unlimited nesting | No depth limit | Tree structure is natural; UI handles via `↳` count; no added backend complexity |
| Parent pauses by default | UI convention, not enforced | Common case is focused flow; user can unpark if needed |
| Agent writes summary | User reviews in loop | More helpful than user writing from scratch; loop ensures quality |
| Two subsession types | Discussion vs refinement | Different return semantics (context vs content) need different UI flows |
| Separate tabs | Not overlay/drawer | Consistent with existing multi-tab session model; simpler state management |

## Open Questions

- Should subsession summaries be persisted as events in the parent's `.events.jsonl`? (Currently planned as a special event type)
- Should there be a limit on total subsession depth to prevent accidental infinite nesting?
- Could the agent proactively suggest opening a subsession when it detects a tangential discussion? (Future enhancement, similar to SuggestSession)
- Should completed subsessions be auto-collapsed in the tab bar to reduce clutter?
