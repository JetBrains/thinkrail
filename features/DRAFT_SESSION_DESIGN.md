# Draft Session (Pre-Start Config) — Feature Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-28

## Table of Contents
1. [Overview](#overview)
2. [Current State](#current-state)
3. [Two-Phase Session Lifecycle](#two-phase-session-lifecycle)
4. [Data Flow](#data-flow)
5. [DraftConfigCard Component](#draftconfigcard-component)
6. [Changes by Layer](#changes-by-layer)
7. [Wire Format](#wire-format)
8. [Key Design Decisions](#key-design-decisions)
9. [Known Limitations](#known-limitations)

## Overview

When a session is created in Bonsai, the system prompt — assembled from specs, skill instructions, and general instructions — is only visible after the session starts (via the `SessionContextCard` in the `sessionStart` event). The user picks config in the modal, presses Start, and hopes it's right.

This feature introduces a **draft session** concept with a two-phase backend lifecycle: first **prepare** (creates the task, builds the system prompt, persists to disk — but does not start the runner), then **start** (launches the SDK session). Between those steps, the user sees an editable config card (`DraftConfigCard`) with a live system prompt preview and can adjust specs, skill, model, permissions, effort, and betas before committing.

## Current State

```
NewSessionModal (pick skill, specs, model, etc.)
  → "Start Session" → agent/run RPC
  → Backend: create task + build context + start runner (all in one step)
  → sessionStart event arrives
  → SessionContextCard renders (read-only) showing what was included
```

**Problems:**
- System prompt is invisible until after the session starts
- No way to review or adjust the assembled context before committing API cost
- Config set in the modal is locked — changing specs or skill requires creating a new session

## Two-Phase Session Lifecycle

```
draft  →  initializing  →  idle / running / waiting  →  done / error
 ↑          ↑
 prepare    startDraft (or agent/run for one-step)
```

The `"draft"` status is added to `TaskStatus`. Draft tasks are persisted to `.specs/sessions/` just like other tasks, so they survive page refreshes.

| Method | Transition | What Happens |
|--------|-----------|--------------|
| `agent/prepare` | → `draft` | Creates task, builds system prompt, saves to disk. No runner launched. |
| `agent/updateDraft` | `draft` → `draft` | Updates config fields, rebuilds system prompt, returns it. |
| `agent/startDraft` | `draft` → `initializing` | Launches the runner. Optionally accepts a first message. |
| `agent/run` | → `initializing` | Unchanged one-step shortcut. Used by suggested sessions and meta-ticket auto-starts. |

The `agent/run` method is unchanged — it remains the one-step shortcut for flows that don't need the draft phase (suggested sessions, meta-ticket auto-starts).

## Data Flow

### Creating a Draft

```
User clicks "Create Session" in NewSessionModal
  → sessionStore.createDraft()
  → RPC: agent/prepare { specIds, config, skillId, name, ... }
  → AgentService.prepare_task():
      1. tracker.create_task() with status = "draft"
      2. _build_context_for(task) → assembles system prompt
      3. task.system_prompt = assembled prompt
      4. _save_task(task) → persist to .specs/sessions/
  → Response: { bonsaiSid, systemPrompt }
  → Frontend: session added to store with status "draft" + systemPrompt
  → DraftConfigCard renders in ChatStream
```

### Adjusting Config

```
User changes a field in DraftConfigCard (e.g., removes a spec)
  → debouncedUpdate(300ms)
  → sessionStore.updateDraft()
  → RPC: agent/updateDraft { bonsaiSid, specIds }
  → AgentService.update_draft():
      1. Validate task is in "draft" status
      2. Apply field changes to task
      3. Rebuild system prompt via _build_context_for(task)
      4. _save_task(task)
  → Response: { systemPrompt }
  → Frontend: session.systemPrompt updated → prompt preview refreshes
```

### Starting the Session

```
User clicks "Start Session" (or types a message in InputArea)
  → sessionStore.startDraft(bonsaiSid, prompt?)
  → RPC: agent/startDraft { bonsaiSid, prompt? }
  → AgentService.start_draft():
      1. Validate task is in "draft" status
      2. Transition: draft → initializing
      3. Enqueue first message if prompt provided
      4. Launch _run_background(task, system_prompt, notify)
  → Response: { bonsaiSid }
  → Frontend: status → "initializing" → events flow normally
```

### Auto-Start on Message Send

When the user types a message in the InputArea while a draft session is active, `sessionStore.sendMessage()` detects `status === "draft"` and delegates to `startDraft(bonsaiSid, text)` — transparently starting the session with the user's message as the first prompt.

## DraftConfigCard Component

The `DraftConfigCard` is a stacked card rendered at the top of `ChatStream` when `session.status === "draft"`. It follows the visual pattern of the existing `SessionContextCard` but with interactive controls.

**Layout (top to bottom):**

| Section | Content | Interaction |
|---------|---------|-------------|
| **Header** | "Session Configuration" + `draft` badge | — |
| **Skill** | Current skill pill with description | `x` to clear, "change ▼" opens `SkillGrid` popover |
| **Specs** | Removable spec pills | `x` per pill, "+ add spec" opens `SpecSelector` popover |
| **Config** | Model dropdown, permissions dropdown, effort pills, 1M checkbox | Inline selectors |
| **System Prompt** | Expandable `<pre>` with estimated token count | Toggle expand/collapse |
| **Actions** | "Discard" (secondary) + "Start Session" (primary blue) | Discard ends + closes session |

**Key behaviors:**
- Each config change triggers `updateDraft()` with a 300ms debounce
- Subtle "updating..." indicator during prompt rebuild
- `SkillGrid` and `SpecSelector` reused from `NewSessionModal` as popovers
- CSS uses Bonsai design tokens (`--space-*`, `--radius-*`, `--border`, etc.)
- Gold left-border to distinguish from the purple `SessionContextCard`

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `agent/models.py` | Add `"draft"` to `TaskStatus`. Add `system_prompt: str \| None = None` field to `AgentTask`. |
| `agent/tracker.py` | Add `"draft"` to `_VALID_TRANSITIONS` — can transition to `initializing`, `done`, `error`. |
| `agent/service.py` | Add `prepare_task()`, `update_draft()`, `start_draft()` methods. Add `_attach_to_ticket()` helper. Update `_save_task()` to include `systemPrompt`. Update `list_all_sessions()` to include full config + prompt for drafts. Update `end_session()` to handle draft cleanup. |
| `agent/persistence.py` | Include `config`, `systemPrompt`, `sessionPrompt` in `list_sessions()` output for draft entries. |
| `rpc/methods/agents.py` | Add `prepare_agent`, `update_draft`, `start_draft` RPC handlers. |
| `rpc/server.py` | Register `agent/prepare`, `agent/updateDraft`, `agent/startDraft` in `METHODS` dict. |

### Frontend

| File | Change |
|------|--------|
| `types/session.ts` | Add `"draft"` to `SessionStatus` union. |
| `api/methods/agents.ts` | Add `prepare()`, `updateDraft()`, `startDraft()` API calls. Add `DraftUpdateParams` interface. |
| `api/methods/sessions.ts` | Add `config`, `systemPrompt`, `sessionPrompt` optional fields to `SessionSummary`. |
| `store/sessionStore.ts` | Add `createDraft()`, `updateDraft()`, `startDraft()` actions. Modify `sendMessage()` to auto-start drafts. Update `loadActiveSessions()` to restore `systemPrompt` for drafts. |
| `components/ChatStream/DraftConfigCard.tsx` | **New** — editable stacked config card with skill/spec/config editing. System prompt preview delegated to `PromptPreview` component. |
| `components/ChatStream/DraftConfigCard.css` | **New** — styles using Bonsai CSS variables. Gold left-border, `.draft-config-*` class prefix. |
| `components/ChatStream/PromptPreview.tsx` | **New** — structured prompt preview with stacked bar (token breakdown by section: general/task/project/specs), clickable legend, collapsible sections with rendered markdown (react-markdown), per-spec sub-entries. Replaces the old `<pre>` prompt dump. |
| `components/ChatStream/PromptPreview.css` | **New** — bar, legend, section, spec entry, rendered markdown styles. |
| `components/ChatStream/ChatStream.tsx` | Render `DraftConfigCard` when `session.status === "draft"`. |
| `components/ChatStream/SessionStatusLine.tsx` | Add `"draft"` case to `statusInfo()` switch. |
| `components/NewSessionModal/NewSessionModal.tsx` | Change button from "Start Session" to "Create Session". Call `createDraft()` instead of `startSession()`. |
| `components/SessionPanel/SessionPanel.tsx` | Add `"draft"` to `handleSend` status guard. Hide `SessionStatusLine` for drafts. Hide Start button for drafts. Draft-specific placeholder text. |
| `components/SessionPanel/SessionTabBar.tsx` | Gold `--gold` dot color for `"draft"` status in tab bar. |

## Wire Format

### `agent/prepare`

Request:
```json
{
  "specIds": ["goal-and-requirements", "module-agent"],
  "config": { "model": "claude-sonnet-4-6", "maxTurns": 50, "permissionMode": "default", "streamText": true, "betas": [], "effort": null },
  "skillId": "module-design",
  "name": "Module: session-manager",
  "prompt": null,
  "metaTicketId": null
}
```

Response:
```json
{
  "bonsaiSid": "abc-123-...",
  "systemPrompt": "## General Instructions\n\nYou have access to..."
}
```

### `agent/updateDraft`

Request:
```json
{
  "bonsaiSid": "abc-123-...",
  "specIds": ["goal-and-requirements"]
}
```

Response:
```json
{
  "systemPrompt": "## General Instructions\n\n..."
}
```

### `agent/startDraft`

Request:
```json
{
  "bonsaiSid": "abc-123-...",
  "prompt": "start"
}
```

Response:
```json
{
  "bonsaiSid": "abc-123-..."
}
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Two-phase backend | Draft persisted on backend, not frontend-only | Survives page refresh. Consistent with backend-first architecture. |
| `agent/run` unchanged | One-step shortcut preserved for suggested sessions and meta-tickets | Backward compatible. Not all session creation flows need the draft step. |
| Sentinel defaults in `update_draft` | Use `...` (Ellipsis) to distinguish "not provided" from explicit `None` | `skill_id=None` means "clear the skill"; omitting means "keep current". Standard Python sentinel pattern. |
| 300ms debounce on config changes | Prevents excessive RPC calls during rapid editing | Each updateDraft rebuilds the system prompt — debounce reduces backend load. |
| Stacked card layout | Config card in the chat stream area, not a split pane or modal | Matches existing `SessionContextCard` visual pattern. Feels integrated, not modal-heavy. |
| Gold border + badge | Draft card uses `--gold` left-border (vs purple for `SessionContextCard`) | Visually distinguishes "configuring" from "already started" states. |
| Auto-start on sendMessage | Typing a message in a draft session starts it with that message | Natural UX — user doesn't have to think about whether to click Start or type. |
| Discard = end + close | Discard transitions draft → done and removes from tab bar | Clean cleanup. No zombie drafts. |
| Reuse SkillGrid/SpecSelector | Popover-rendered versions of the modal's existing selectors | DRY. Same components, different container (popover vs modal section). |

## Known Limitations

- **Server restart orphans drafts:** If the backend server restarts, draft sessions exist on disk but the in-memory `Tracker` is empty. Calling `updateDraft` or `startDraft` will fail with `TaskNotFoundError`. The draft appears in the UI but cannot be updated or started — it can only be discarded. A future improvement could re-register drafts from disk on server startup.
- **No draft cleanup:** Drafts older than 24h are not auto-cleaned. Stale drafts accumulate on disk until manually discarded.
- **`run_task()` not refactored:** The plan called for `run_task()` to internally use `prepare_task()` + `start_draft()`. This was deferred — `run_task()` remains standalone with some duplicated logic. Both paths work correctly.
