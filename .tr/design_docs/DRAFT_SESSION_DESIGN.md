---
id: draft-session-design
type: submodule-design
status: active
title: Draft Session (Pre-Start Config) — Feature Design
parent: design-doc
depends-on:
- module-agent
- module-rpc
references:
- skill-session-start-design
covers:
- backend/app/agent/service.py
- backend/app/agent/models.py
- backend/app/rpc/methods/agents.py
- frontend/src/components/ChatStream/DraftConfigCard.tsx
- frontend/src/components/ChatStream/InputArea.tsx
- frontend/src/components/SessionPanel/SessionPanel.tsx
- frontend/src/components/SessionPanel/SessionTabBar.tsx
- frontend/src/store/sessionStore.ts
- frontend/src/store/inputDraftStore.ts
- frontend/src/store/draftAutosave.ts
- frontend/src/utils/sessionName.ts
tags:
- feature
- session
- config
- draft
---
# Draft Session (Pre-Start Config) — Feature Design

> Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-28

## Table of Contents
1. [Overview](#overview)
2. [Two-Phase Session Lifecycle](#two-phase-session-lifecycle)
3. [Draft-on-Type (Lazy Persistence)](#draft-on-type-lazy-persistence)
4. [Data Flow](#data-flow)
5. [DraftConfigCard Component](#draftconfigcard-component)
6. [Changes by Layer](#changes-by-layer)
7. [Wire Format](#wire-format)
8. [Key Design Decisions](#key-design-decisions)
9. [Known Limitations](#known-limitations)

## Overview

When a session is created in ThinkRail, the system prompt — assembled from specs, skill instructions, and general instructions — is only visible after the session starts (via the `SessionContextCard` in the `sessionStart` event). The user picks config in the modal, presses Start, and hopes it's right.

This feature introduces a **draft session** concept with a two-phase backend lifecycle: first **prepare** (creates the task, builds the system prompt, persists to disk — but does not start the runner), then **start** (launches the SDK session). Between those steps, the user sees an editable config card (`DraftConfigCard`) with a live system prompt preview and can adjust specs, skill, model, permissions, effort, and betas before committing.

## Background (motivation for the draft phase)

Before draft sessions, picking config and starting a session was a single step
via the legacy `NewSessionModal` → `agent/run` RPC. Problems with that flow:

- System prompt was invisible until after the session started
- No way to review or adjust the assembled context before committing API cost
- Config set in the modal was locked — changing specs or skill required a new session

The draft phase below addresses all three.

## Two-Phase Session Lifecycle

```
draft  →  initializing  →  idle / running / waiting  →  done / error
 ↑          ↑
 prepare    startDraft (or agent/run for one-step)
```

The `"draft"` status is added to `TaskStatus`. Draft tasks are persisted to `.tr/sessions/` just like other tasks, so they survive page refreshes.

| Method | Transition | What Happens |
|--------|-----------|--------------|
| `agent/prepare` | → `draft` | Creates task, builds system prompt, saves to disk. No runner launched. |
| `agent/updateDraft` | `draft` → `draft` | Updates config fields, rebuilds system prompt, returns it. |
| `agent/startDraft` | `draft` → `initializing` | Launches the runner. Optionally accepts a first message. |
| `agent/run` | → `initializing` | Unchanged one-step shortcut. Used by suggested sessions and meta-ticket auto-starts. |

The `agent/run` method is unchanged — it remains the one-step shortcut for flows that don't need the draft phase (suggested sessions, meta-ticket auto-starts).

## Draft-on-Type (Lazy Persistence)

The two-phase lifecycle above persists a draft the instant it is created. For **blank** new sessions that is wasteful: clicking **+ New** (or `Cmd/Ctrl+T`, or the Command Palette's "New session") used to write `.tr/sessions/{id}.json` and broadcast `session/didCreate` to every client immediately, so abandoned empty "Session N" drafts piled up on disk, in the sidebar, and on other clients.

**Draft-on-type** defers that persistence until the session carries intent. A blank session is born **entirely in the frontend** and touches the backend only once the user actually types a prompt (or starts it).

### Unsaved sub-phase

The feature adds a frontend-only **`unsaved`** flag that layers on the existing `"draft"` status — it is never sent to or stored by the backend. **+ New** mints the `thinkrailSid` client-side (`crypto.randomUUID()`) and inserts an ordinary `"draft"` session with `unsaved: true` and **no RPC**. Because it is a normal draft, `DraftConfigCard`, the `InputArea`, the gold tab dot, and the auto-start path all render and behave unchanged.

```
 unsaved draft        saved draft            initializing → idle/running → done
 (frontend only)      (.tr/sessions)
      │                     │                        │
  + New / Cmd+T        ≥5 chars (debounced)      Start / Send
  / palette  ─────────▶  OR Start / flush ─────▶  agent/startDraft
  (no RPC,             agent/prepare(thinkrailSid)
   no broadcast)       → persist + broadcast
```

### Save triggers

The session is **saved** (persisted on the backend) on the first of:

- the prompt reaching **≥ 5 non-whitespace characters** — a trailing **~750 ms** debounce with a **~5 s** max-wait so sustained typing still flushes about once per window;
- the user pressing **Start/Send** — works **regardless** of the threshold, so a 2-char prompt still starts; or
- a **flush** — input blur, session switch, or page hide (`visibilitychange`/`pagehide`).

Saving calls `agent/prepare` **passing the already-minted `thinkrailSid`** (`tracker.create_task` reuses it rather than reconciling), then flips `unsaved → false` (single-flight, so concurrent triggers create exactly one draft). From that point the session is an ordinary backend draft: the `session/didCreate` broadcast fires — correctly, now that intent exists — further edits autosave via `agent/updateDraft`, and the draft is restorable on reload.

### Persisted typed text (`draftInput`)

The in-progress prompt is **not** `session_prompt` — that field is injected into the system prompt under "Your Task" and would both pollute the context and duplicate as the first message on Start. Instead the draft carries a dedicated, **non-context `draftInput`** field (`AgentTask.draft_input`), persisted on autosave and restored into the input box on reload/reconnect. It is never fed to `build_context`.

### Derived name

Before any text is typed the tab shows a neutral **"New session"**. Once text exists the name is derived live from the prompt (`utils/sessionName.ts`): trim, collapse internal whitespace/newline runs to single spaces, then show as-is if ≤ 15 chars or the first 14 + `…` (label length ≤ 15 **including** the ellipsis). A **manual rename freezes** derivation permanently (`nameManuallySet`). Deleting all text **after** a save reverts the label to "New session" but **keeps** the draft on disk; derivation resumes on the next keystroke unless the name was manually set.

### No duplicate blanks

Triggering a new blank session while an untouched blank `unsaved` tab is already open **focuses that tab** instead of opening another. The guard is intentionally **per-client** — other clients never see an `unsaved` draft, so they cannot and should not dedupe against it.

### Scope guard

Only the bare `createNewSession()` (blank) path defers. Sessions that already carry intent at creation — meta-ticket / stage-default sessions (which call `createDraft` directly) and approved **Suggested** sessions (which use `agent/run`) — **persist immediately, unchanged**. `createDraft` itself remains the immediate-persist primitive, so the scope guard holds by construction.

## Data Flow

### Creating a Draft

**Blank** entry points (`+ New`, `Cmd/Ctrl+T`, palette) are **deferred** — no RPC, no broadcast, no file until the user types intent. See [Draft-on-Type (Lazy Persistence)](#draft-on-type-lazy-persistence).

**Pre-configured** drafts that already carry intent (meta-ticket / stage-default sessions) call `createDraft()` directly and persist immediately:

```
createDraft({ specIds, config, skillId, name, ... })
  → RPC: agent/prepare { specIds, config, skillId, name, ... }
  → AgentService.prepare_task():
      1. tracker.create_task() with status = "draft"
         (reuses a caller-supplied thinkrailSid when present; else server-mints)
      2. _build_context_for(task) → assembles system prompt
      3. task.system_prompt = assembled prompt
      4. _save_task(task) → persist to .tr/sessions/ + broadcast session/didCreate
  → Response: { thinkrailSid, systemPrompt }
  → Frontend: session added to store with status "draft" + systemPrompt
  → DraftConfigCard renders in ChatStream
```

On its first save the **blank** path runs this same `agent/prepare`, additionally passing the client-minted `thinkrailSid` and the typed `draftInput`.

### Adjusting Config

```
User changes a field in DraftConfigCard (e.g., removes a spec)
  → debouncedUpdate(300ms)
  → sessionStore.updateDraft()
  → RPC: agent/updateDraft { thinkrailSid, specIds }
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
  → sessionStore.startDraft(thinkrailSid, prompt?)
  → RPC: agent/startDraft { thinkrailSid, prompt? }
  → AgentService.start_draft():
      1. Validate task is in "draft" status
      2. Transition: draft → initializing
      3. Enqueue first message if prompt provided
      4. Launch _run_background(task, system_prompt, notify)
  → Response: { thinkrailSid }
  → Frontend: status → "initializing" → events flow normally
```

### Auto-Start on Message Send

When the user types a message in the InputArea while a draft session is active, `sessionStore.sendMessage()` detects `status === "draft"` and delegates to `startDraft(thinkrailSid, text)` — transparently starting the session with the user's message as the first prompt.

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
- `SkillGrid` and `SpecSelector` (`components/shared/`) used as popovers
- CSS uses ThinkRail design tokens (`--space-*`, `--radius-*`, `--border`, etc.)
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
| `components/ChatStream/DraftConfigCard.css` | **New** — styles using ThinkRail CSS variables. Gold left-border, `.draft-config-*` class prefix. |
| `components/ChatStream/PromptPreview.tsx` | **New** — structured prompt preview with stacked bar (token breakdown by section: general/task/project/specs), clickable legend, collapsible sections with rendered markdown (react-markdown), per-spec sub-entries. Replaces the old `<pre>` prompt dump. |
| `components/ChatStream/PromptPreview.css` | **New** — bar, legend, section, spec entry, rendered markdown styles. |
| `components/ChatStream/ChatStream.tsx` | Render `DraftConfigCard` when `session.status === "draft"`. |
| `components/ChatStream/SessionStatusLine.tsx` | Add `"draft"` case to `statusInfo()` switch. |
| `components/SessionPanel/SessionPanel.tsx` | `+ New` button calls `sessionStore.createNewSession()`, which now **defers** persistence for blank sessions (see [Draft-on-Type deltas](#draft-on-type-deltas)). Add `"draft"` to `handleSend` status guard. Hide `SessionStatusLine` for drafts. Hide Start button for drafts. Draft-specific placeholder text. |
| `components/SessionPanel/SessionTabBar.tsx` | Gold `--gold` dot color for `"draft"` status in tab bar. |

### Draft-on-Type deltas

Incremental changes layered on the two-phase feature above (see [Draft-on-Type (Lazy Persistence)](#draft-on-type-lazy-persistence)).

**Backend**

| File | Draft-on-type change |
|------|----------------------|
| `agent/models.py` | Add `draft_input` (alias `draftInput`) to `AgentTask` — non-context, never fed to `build_context`. |
| `agent/tracker.py` | `create_task` threads `draft_input` (alongside the already-supported caller `thinkrail_sid`). |
| `agent/service.py` | `prepare_task` accepts `thinkrail_sid` + `draft_input`; `update_draft` accepts `draft_input`; `_save_task` writes `draftInput`; `list_all_sessions` includes `draftInput` for drafts. |
| `agent/persistence.py` | `save_session` persists `draftInput`; `list_sessions` returns it for `status == "draft"` entries. |
| `rpc/methods/agents.py` | `prepare_agent` reads optional `thinkrailSid` + `draftInput`; `update_draft` reads `draftInput`. |

**Frontend**

| File | Draft-on-type change |
|------|----------------------|
| `utils/sessionName.ts` *(new)* | Pure `deriveSessionName(text)` + `DEFAULT_SESSION_NAME`. No React/store deps. |
| `store/draftAutosave.ts` *(new)* | Module-scoped autosave controller: `noteInput` (750 ms trailing + 5 s max-wait), `flush`, `cancel`. |
| `types/session.ts` | Add `unsaved?` + `nameManuallySet?` to `Session`. |
| `store/sessionStore.ts` | `createNewSession` defers (no RPC) + no-duplicate-blanks; new `ensureSaved` / `noteDraftInput` / `commitDraft` / `renameDraft`; `updateDraft` is local-only while `unsaved`; restore seeds `inputDraftStore` from `draftInput`. |
| `components/ChatStream/InputArea.tsx` | `handleChange` → `noteDraftInput`; textarea `onBlur` → `draftAutosave.flush`. |
| `components/ChatStream/DraftConfigCard.tsx` | Name input → `renameDraft` (sets the freeze flag); prompt preview shows a placeholder hint while `unsaved`. |
| app shell (`AppShell` / `useDraftFlushOnHide`) | One `visibilitychange` / `pagehide` listener flushes the active draft. |

`keyboard.ts` (`Cmd/Ctrl+T`) and `CommandPalette.tsx` need **no change** — both already funnel through `createNewSession`, so the deferral is inherited at that single chokepoint.

## Wire Format

### `agent/prepare`

Request:
```json
{
  "thinkrailSid": "client-minted-uuid",
  "specIds": ["goal-and-requirements", "module-agent"],
  "config": { "model": "claude-sonnet-4-6", "permissionMode": "default", "streamText": true, "effort": null },
  "skillId": "module-design",
  "name": "fix login flow",
  "draftInput": "fix login flow",
  "prompt": null,
  "metaTicketId": null
}
```

Response:
```json
{
  "thinkrailSid": "abc-123-...",
  "systemPrompt": "## General Instructions\n\nYou have access to..."
}
```

`thinkrailSid` and `draftInput` are **optional, additive** fields used by the draft-on-type path. When `thinkrailSid` is supplied the backend **reuses** it (no server-mint) and the response echoes it; `draftInput` persists the typed text as the non-context `draft_input`. Omitting both preserves the original immediate-persist behavior.

### `agent/updateDraft`

Request:
```json
{
  "thinkrailSid": "abc-123-...",
  "specIds": ["goal-and-requirements"],
  "draftInput": "fix login flow",
  "name": "fix login flo…"
}
```

Response:
```json
{
  "systemPrompt": "## General Instructions\n\n..."
}
```

`draftInput` and `name` are **optional, additive** — the draft-on-type autosave sends them to persist the typed text and its derived label without otherwise changing config. Any subset of fields may be sent; omitted fields are left unchanged (Ellipsis-sentinel on the backend).

### `agent/startDraft`

Request:
```json
{
  "thinkrailSid": "abc-123-...",
  "prompt": "start"
}
```

Response:
```json
{
  "thinkrailSid": "abc-123-..."
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
| **Defer save for blank sessions** | Client-minted `thinkrailSid` + frontend-only `unsaved` flag; `agent/prepare` deferred until intent (≥5 non-ws / Start / flush) | Blank `+ New` no longer writes a file or broadcasts until the user types, killing empty "Session N" clutter — without losing autosave protection once text exists. |
| **`draftInput` separate from `session_prompt`** | A dedicated **non-context** field persists the typed text | `session_prompt` is injected into the system prompt ("Your Task") and would both pollute context and duplicate as the first message on Start. `draftInput` is never fed to `build_context`. |
| **Live-derived name + manual-rename freeze** | Name tracks the prompt via `deriveSessionName`; a hand rename sets `nameManuallySet` and stops derivation | Glanceable tabs instead of interchangeable "Session N"; respects an explicit user name. |
| **Single-flight `ensureSaved`** | Per-`thinkrailSid` in-flight promise; reuses the minted id | Concurrent triggers (threshold timer + Start) create exactly one draft; the id is reused, never reconciled. |
| **No-duplicate-blanks is per-client** | Guard focuses an existing untouched `unsaved` tab on the same client only | Other clients never see an `unsaved` draft, so cross-client dedupe is neither possible nor desired. |

## Known Limitations

- **Server restart orphans drafts:** If the backend server restarts, draft sessions exist on disk but the in-memory `Tracker` is empty. Calling `updateDraft` or `startDraft` will fail with `TaskNotFoundError`. The draft appears in the UI but cannot be updated or started — it can only be discarded. A future improvement could re-register drafts from disk on server startup.
- **No draft cleanup:** Drafts older than 24h are not auto-cleaned. Stale drafts accumulate on disk until manually discarded.
- **Unsaved drafts vanish on reload (by design):** A blank `unsaved` draft has no backend task and no file, so a reload/restart simply doesn't restore it — abandoning a blank leaves no trace. The server-restart-orphan limitation above applies only **after** a draft is saved.
- **Page-hide tail:** `flush` issues the save over the WebSocket but cannot block unload; `visibilitychange→hidden` fires earlier and more reliably than `beforeunload`. The last **< 750 ms** of uninterrupted typing before a hard kill may not flush in time — an accepted limitation (a backend `draftInput` field was chosen over a synchronous `localStorage` backstop, and the debounce/max-wait window keeps the at-risk tail small).
- **No migration:** Pre-existing empty "Session N" drafts on disk are left as-is; draft-on-type applies only to sessions created from now on.
- **`run_task()` not refactored:** The plan called for `run_task()` to internally use `prepare_task()` + `start_draft()`. This was deferred — `run_task()` remains standalone with some duplicated logic. Both paths work correctly. Note: `run_task()` no longer takes a `notify` parameter; all streaming events are routed through the EventBus (`bus.publish_to_session()`).
