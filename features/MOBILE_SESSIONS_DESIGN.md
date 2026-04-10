# Mobile Sessions — Full Functionality Design Spec

**Status:** Draft
**Date:** 2026-04-10
**Depends on:** `features/MOBILE_FRONTEND_DESIGN.md` (base mobile app design)

## Overview

Make sessions in the Bonsai mobile app fully functional — matching the web frontend's capabilities for real-time streaming, all event renderers, session creation, session continuation, and interactive approval/question flows.

### Goals

- **Real-time event streaming** via WebSocket notifications (no polling)
- **16 event type renderers** covering all agent event types
- **Session creation flow** with full configuration + draft preview
- **Interactive cards** for approvals, questions, and suggestions with compact resolved states
- **Session lifecycle** — continue, restart, change model/effort mid-session
- **Live metrics** — cost and context usage in session header
- **Subagent nesting** — visually indented subagent blocks

---

## 1. Real-Time Event Streaming Architecture

### Current Problem

Mobile polls the entire session on any notification:
```
notification arrives → sessionGet(bonsaiSid) → replace all events → re-render
```

### New Architecture

Subscribe to individual notifications and append events incrementally:
```
notification arrives → parse event type + payload → append to local events list → UI re-renders new item
```

### Implementation

**SessionDetailComponentImpl changes:**

1. On init: call `sessionGet(bonsaiSid)` once to load existing events (historical session data)
2. Subscribe to `rpcClient.notifications` filtered by `bonsaiSid`
3. On each notification:
   - Extract `eventType` from method name: `"agent/textDelta"` → `"textDelta"`
   - Create `AgentEvent(eventType, payload)` and append to `_state.events`
   - For specific events, update derived state:
     - `turnComplete` → update metrics (cost, turns, context tokens)
     - `done`/`error` → update session status
     - `askUserQuestion`/`confirmAction` → set `pendingRequest`
     - `requestResolved`/`requestExpired` → clear `pendingRequest`
4. Subscribe to `rpcClient.serverRequests` for approval/question requests (these have `id` and expect a response)

**SessionListComponentImpl changes:**

1. Subscribe to `rpcClient.notifications` for ALL sessions
2. On `agent/done`, `agent/error`, status changes → update specific session in list
3. On `agent/askUserQuestion`, `agent/confirmAction` → mark session as attention-needed
4. Avoid reloading entire session list — update in-place

### Text Delta Accumulation

Backend sends many small `textDelta` events. Accumulate them into a single assistant message bubble:
- Track current assistant message text as a `StringBuilder`
- Each `textDelta` appends to the builder
- A new `userMessage`, `toolCallStart`, or `turnComplete` event flushes the builder into a completed message

---

## 2. Session Header — Live Metrics

### Layout

```
← Mobile frontend impl              ⋮
  ● running · opus-4-6 ▼ · $0.42 · 22% ctx
  [■■■■■■                              ]
```

**Line 1:** Session name (bold) + overflow menu (⋮)
**Line 2:** Status dot + status text + model name (tappable ▼) + live cost + context percentage
**Line 3:** Thin context usage progress bar (green when <60%, orange 60-85%, red >85%)

### Model Tap → Context Menu

Tapping the model name opens a bottom sheet or popup menu:
- **Change Model** — dropdown of available models from `models/list`
- **Change Effort** — chips: `low | medium | high | max | auto`
- Calls `agent/updateConfig` RPC on change

### Metrics Source

- `turnComplete` event payload contains: `costUsd`, `contextTokens`, `contextMax`, `outputTokens`
- Accumulate `costUsd` across turns
- `contextTokens / contextMax` for the percentage bar
- Update on every `turnComplete` notification

---

## 3. Event Renderers — 16 Types

### Render Pipeline

Events stored as `List<AgentEvent>` where each has `eventType: EventType` and `payload: JsonObject`.

Pre-processing before render:
1. **Text accumulation:** Group consecutive `textDelta` events into single message blocks
2. **Tool state tracking:** Map tool calls by index → `{status, output, error}`; `toolCallEnd` updates the matching `toolCallStart`
3. **Subagent grouping:** Events between `subagentStart` and `subagentEnd` rendered as indented block
4. **Request linking:** `confirmAction` links to its corresponding `toolCallStart` via `toolUseId`

### Event Type → Visual Component

| Event Type | Component | Collapsed | Expanded |
|-----------|-----------|-----------|----------|
| `sessionStart` | `SessionConfigCard` | Model + specs count | Full config grid + system prompt token bar |
| `userMessage` | `UserMessageBubble` | — | Green bubble, full text |
| `textDelta` | `AssistantMessageBubble` | — | Gray bubble, accumulated text |
| `toolCallStart` | `ToolCallCard` | `▶ ToolName · path · ✓` (1 line) | Input JSON + output + diff (if Edit/Write) |
| `toolCallEnd` | (updates ToolCallCard) | — | — |
| `turnComplete` | `TurnMarker` | — | Centered pill: `$X.XX · Nk tokens` |
| `subagentStart` | `SubagentBlock` | `↳ Subagent: name` + collapsed children | Full nested event list |
| `subagentEnd` | (closes SubagentBlock) | — | — |
| `confirmAction` | `ApprovalCard` (pending) / inline ✓✕ (resolved) | See below | Tool name + diff + approve/deny |
| `askUserQuestion` | `QuestionCard` (pending) / inline answer (resolved) | See below | Question + option chips + submit |
| `suggestSession` | `SuggestionCard` (pending) / inline result (resolved) | See below | Skill + reason + create/dismiss |
| `suggestDescription` | `DescriptionCard` (pending) / inline (resolved) | See below | Description text + accept/edit |
| `notification` | `SystemPill` | — | Centered pill with message |
| `progress` | `SystemPill` | — | Centered pill with progress text |
| `interrupted` | `InterruptedPill` | — | Orange pill `⏸ Turn interrupted` |
| `done` | `CompletionBanner` | — | Green banner + metrics + Resume button |
| `error` | `ErrorBanner` | — | Red banner + error message + Resume button |
| `permissionDenied` | `WarningText` | — | `⚠ Permission denied: {toolName}` |

### Tool Call Card Details

**Collapsed (default):** Single line
```
▶ Read · backend/app/rpc/server.py · ✓
```

**Expanded (on tap):** Shows full input and output
- For `Read`: file path + line range
- For `Write`/`Edit`: mini diff view (green +lines, red -lines), line count (+N -M)
- For `Bash`: command text + output (scrollable, max 10 lines)
- For `Glob`/`Grep`: pattern + matched file count
- Running tools show spinner instead of ✓

### Interactive Card States

**Approval Card:**
- **Pending:** Full card above input bar — tool name, file path, collapsible diff preview, Approve/Deny buttons
- **Resolved:** Card disappears. Tool call line updates to show `✓ approved` (green) or `✕ denied` (red). Tap tool call to see full details.

**Question Card:**
- **Pending:** Full card above input bar — question text, selectable option chips, Submit button
- **Resolved:** Collapses to single line: `❓ Question text → Selected Answer`. Tap to see all options.

**Suggestion Card:**
- **Pending:** Full card in event stream — skill name, reason, Create Session / Dismiss buttons
- **Resolved:** Collapses to single line: `✓ Session created: test-driven-development` or faded `Dismissed: suggestion`. Tap to expand.

**Expired:** Single faded line: `⏱ Expired: Tool approval for Write`

---

## 4. Session Creation Flow

### Two-Step Flow

**Step 1: Configure (full-screen form)**

Header: `✕ New Session` + `Preview` button

Fields:
- **Name** — optional text input
- **Prompt** — multi-line text (the initial message)
- **Model** — dropdown from `models/list`
- **Effort** — chips: `low | medium | high | max | auto`
- **Permission Mode** — chips: `default | auto | accept edits | yolo`
- **Skill** — dropdown (fetched from available skills)
- **Specs** — multi-select chips with `+ Add` button → searchable spec picker (from `spec/list`)
- **Files** — multi-select with `+ Add` button → file browser picker
- **Linked Ticket** — optional dropdown from `board/list`

**Step 2: Draft Preview**

Header: `← Draft Preview` + `Start` button

Calls `agent/prepare` RPC → returns:
- `bonsaiSid` — draft session ID
- `systemPrompt` — full system prompt text
- `sections` — array of `{key, label, content, tokens, specDetails?, fileDetails?}`
- `totalTokens` — total system prompt token count

Display:
- **Token breakdown bar** — colored segments (CLAUDE.md, Specs, Files, Skill) with percentages
- **Expandable sections** — tap to see content. Spec section shows individual spec items with token counts. File section shows individual files.
- **`+ Add Specs`** / **`+ Add Files`** / **`+ Change Skill`** buttons → calls `agent/updateDraft` to modify draft
- `← Edit Configuration` link → back to form (re-populates with draft config)

**Step 3: Start**

Tap `Start` → calls `agent/startDraft(bonsaiSid, prompt)` → navigates to session chat view.

---

## 5. Session Lifecycle Actions

### Continuation (Done/Error sessions)

**Done banner** includes:
- Metrics: cost, turns, tool calls, duration, files changed
- `Resume Session` button → calls `session/continue` RPC → same bonsaiSid, new run

**Error banner** includes:
- Error message text
- `Resume Session` button → same as above

### Session List Actions (overflow menu ⋮ on each card)

- **Open** — navigate to chat view
- **Continue** — resume a done/error session
- **Stop** — interrupt a running session
- **End** — terminate the session
- **Delete** — trash the session

### Mid-Session Model/Effort Change

- Tap model name in session header → context menu
- Select new model or effort
- Calls `agent/updateConfig(bonsaiSid, {model?, effort?})` RPC
- Header updates immediately

---

## 6. Subagent Nesting

Events between `subagentStart` and `subagentEnd` are rendered inside an indented block:

```
↳ Subagent: Explore codebase
│  ▶ Glob **/*.kt · ✓
│  ▶ Read 3 files · ✓
│  Subagent complete · $0.03
```

Visual:
- 2dp left border (blue/purple)
- 8dp left padding
- Header: `↳ Subagent: {description}` (bold, blue)
- Children: same renderers as parent, recursively
- Footer: `Subagent complete · $cost` (muted)
- Collapsible: tap header to collapse/expand

---

## 7. New Session from Ticket

When viewing a ticket in the board, the overflow menu includes "Start Session for Ticket". This pre-populates the session creation form with:
- Linked Ticket = this ticket
- Specs = ticket's linkedSpecIds
- Name = ticket title

---

## 8. Data Model Changes

### AgentEvent (updated)

Add default for `eventType` to handle unknown future types gracefully:
```kotlin
@Serializable
data class AgentEvent(
    val bonsaiSid: String = "",
    val sessionId: String = "",
    val eventType: EventType = EventType.TEXT_DELTA,
    val payload: JsonObject = JsonObject(emptyMap()),
)
```

### New: ToolCallState (local tracking)

```kotlin
data class ToolCallState(
    val toolName: String,
    val input: JsonObject,
    val output: String? = null,
    val error: String? = null,
    val isComplete: Boolean = false,
    val approvalStatus: ApprovalStatus = ApprovalStatus.NONE,
)

enum class ApprovalStatus { NONE, PENDING, APPROVED, DENIED, EXPIRED }
```

### New: AccumulatedMessage (text delta grouping)

```kotlin
data class AccumulatedMessage(
    val role: String, // "user" | "assistant"
    val text: StringBuilder = StringBuilder(),
    val isStreaming: Boolean = false,
)
```

### SessionDetailState (updated)

```kotlin
data class SessionDetailState(
    val bonsaiSid: String,
    val session: Session? = null,
    val events: List<AgentEvent> = emptyList(),
    val pendingRequest: PendingRequest? = null,
    val toolStates: Map<Int, ToolCallState> = emptyMap(),
    val accumulatedMessages: List<AccumulatedMessage> = emptyList(),
    val activeSubagents: Set<String> = emptySet(),
    val costUsd: Double = 0.0,
    val contextTokens: Long = 0,
    val contextMax: Long = 0,
    val turns: Int = 0,
    val isLoading: Boolean = false,
    val error: String? = null,
) {
    val contextPercent: Int get() = if (contextMax > 0) ((contextTokens * 100) / contextMax).toInt() else 0
}
```

---

## 9. RPC Methods (additions needed)

Existing methods are sufficient. Key methods used:

| Action | RPC Method |
|--------|-----------|
| Load session | `session/get` |
| List sessions | `session/list` |
| Create draft | `agent/prepare` |
| Update draft | `agent/updateDraft` |
| Start draft | `agent/startDraft` |
| Quick start | `agent/run` |
| Send message | `agent/send` |
| Respond to request | `agent/respond` |
| Interrupt | `agent/interrupt` |
| End session | `agent/end` |
| Continue session | `session/continue` |
| Change config | `agent/updateConfig` |
| Delete session | `session/delete` |
| List models | `models/list` |
| List specs | `spec/list` |

---

## 10. Files to Create/Modify

### New Files

```
shared/src/commonMain/kotlin/dev/aiir/bonsai/component/session/
  NewSessionComponent.kt          # Interface for session creation
  NewSessionComponentImpl.kt      # Implementation with prepare/startDraft flow

androidApp/src/androidMain/kotlin/dev/aiir/bonsai/android/ui/
  screen/
    NewSessionScreen.kt           # Configure + Preview full-screen form
  component/
    ToolCallCard.kt               # Expandable tool call with diff/output
    ApprovalCard.kt               # Pending approval with approve/deny
    QuestionCard.kt               # Question with option chips + submit
    SuggestionCard.kt             # Skill suggestion with create/dismiss
    AssistantMessage.kt           # Gray bubble for accumulated text
    UserMessageBubble.kt          # Green bubble for user messages
    SessionConfigCard.kt          # Expandable config + token breakdown
    CompletionBanner.kt           # Done/Error banners with metrics + resume
    SubagentBlock.kt              # Indented subagent event group
    SystemPill.kt                 # Centered pill for turn/interrupt/notification
    TokenBreakdownBar.kt          # Colored bar showing prompt section sizes
    ContextUsageBar.kt            # Thin progress bar for header
```

### Modified Files

```
shared/src/commonMain/kotlin/dev/aiir/bonsai/
  component/session/
    SessionDetailComponent.kt     # Add cost/context state fields
    SessionDetailComponentImpl.kt # Rewrite: incremental events, text accumulation, tool tracking
    SessionListComponent.kt       # Add continue/restart actions
    SessionListComponentImpl.kt   # Rewrite: per-session notification updates
  component/main/
    MainComponentImpl.kt          # Wire up NewSession navigation
  data/model/
    Session.kt                    # No changes needed (already flexible)
    Agent.kt                      # Already fixed (defaults on AgentEvent)

androidApp/src/androidMain/kotlin/dev/aiir/bonsai/android/ui/
  screen/
    SessionDetailScreen.kt        # Full rewrite: new header, event pipeline, all renderers
    SessionListScreen.kt          # Add continue/restart in overflow, wire FAB
    MainScreen.kt                 # Add NewSession to detail slot
```

---

## 11. Verification

### Manual Testing Checklist

1. **Event streaming:**
   - [ ] Text appears in real-time as agent generates (not after full reload)
   - [ ] Tool calls appear and update status (running → complete)
   - [ ] Turn markers show with correct cost

2. **Interactive cards:**
   - [ ] Approval card appears when session waits for tool permission
   - [ ] Approve/Deny works and card collapses to inline indicator
   - [ ] Question card shows options, selection works, Submit sends answer
   - [ ] Suggestion card shows skill + reason, Create/Dismiss works

3. **Session creation:**
   - [ ] Form accepts all fields (name, prompt, model, effort, permission, skill, specs, files, ticket)
   - [ ] Preview shows token breakdown bar
   - [ ] Expandable sections show individual items
   - [ ] Start launches session and navigates to chat

4. **Session lifecycle:**
   - [ ] Done banner shows full metrics
   - [ ] Resume button on done/error works (continues session)
   - [ ] Model change via header tap works mid-session
   - [ ] Effort change works mid-session

5. **Tool calls:**
   - [ ] Collapsed view shows tool name + path + status
   - [ ] Tap expands to show input/output
   - [ ] Edit/Write tools show diff (green/red lines)
   - [ ] Running tools show spinner

6. **Subagents:**
   - [ ] Subagent events render in indented block
   - [ ] Block is collapsible
   - [ ] Nested tool calls visible inside block
