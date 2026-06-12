---
ticket_id: mt_bcd2f1da
kind: technical_design
created: 2026-06-02T17:04:12Z
updated: 2026-06-02T17:04:12Z
---

# Technical design: Draft-on-type — defer blank-session save until the user types a prompt

## Architecture overview

Today, **+ New** (and `Cmd/Ctrl+T`, and the Command Palette) call
`sessionStore.createNewSession()` → `createDraft()` → the `agent/prepare` RPC,
which **persists a draft to `.tr/sessions/{id}.json` and broadcasts
`session/didCreate` to every client on the project topic** (`agents.py:158`)
the instant the button is pressed. That is the source of the empty-"Session N"
clutter.

This feature introduces a **frontend-local "unsaved" sub-phase of the existing
`draft` status**. A blank session is born entirely in the browser and touches
the backend only once it carries intent.

### Chosen approach: client-minted id + `unsaved` flag (deferred `prepare`)

**+ New** mints the `thinkrailSid` client-side (UUID) and inserts a normal
`Session` into the store with `status: "draft"` **and a new `unsaved: true`
flag** — with **no RPC call**. Because the session is a regular `draft`, the
existing `DraftConfigCard`, `InputArea` (`isDraft`), gold tab dot, and
`sendMessage`→`startDraft` auto-start path all render and behave unchanged.

The session is **saved** (persisted on the backend) on the first of:

- the prompt reaching **≥ 5 non-whitespace characters** (debounced autosave), or
- the user pressing **Start/Send**, or
- a **flush** (input blur, session switch, or page hide).

Saving calls `agent/prepare` **passing the already-minted `thinkrailSid`** —
`Tracker.create_task` already accepts an optional `thinkrail_sid`
(`tracker.py:59`), so the id is reused rather than reconciled. On success the
store flips `unsaved → false`. From that point the session is an ordinary
backend draft: visible to other clients (the `session/didCreate` broadcast now
fires, correctly), autosaved on further edits via `agent/updateDraft`, and
restorable on reload.

### Extended lifecycle

```
 unsaved draft        saved draft            initializing → idle/running → done
 (frontend only)      (.tr/sessions)
      │                     │                        │
  + New / Cmd+T        ≥5 chars (debounced)      Start / Send
  /palette  ──────────▶  OR Start/flush ──────▶  agent/startDraft
  (no RPC,             agent/prepare(thinkrailSid)   (enqueues typed
   no broadcast)       → persist + broadcast       text as 1st msg)
```

The backend `TaskStatus` is **unchanged** — `unsaved` is a frontend-only
dimension layered on the `draft` status, never sent to or stored by the
backend. An unsaved session never has a backend task, so any RPC that targets a
task by id (`updateDraft`, `startDraft`) is gated behind "ensure saved first".

### What gets deferred vs. what stays immediate

- **Deferred (blank entry points):** `+ New`, `Cmd/Ctrl+T`, Command Palette
  "New session" → local-only until intent.
- **Immediate (unchanged):** meta-ticket / stage-default sessions call
  `createDraft` **directly** (`TicketInfo.tsx`, `TicketDetail.tsx`) → `agent/prepare`,
  and approved Suggested sessions use `agent/run`. Only the **bare
  `createNewSession()`** path is changed to defer; `createDraft` itself remains
  the immediate-persist primitive, so the scope guard holds by construction.

### Persistence of the typed text

The in-progress prompt is **not** `session_prompt` — that field is injected
into the system prompt under "Your Task" (`context.py:509`) and would both
pollute the context and duplicate as the first message on Start. Instead the
feature adds a dedicated, non-context **`draft_input`** field on the draft task,
persisted on autosave and restored into the input box on reload/reconnect.

### Load-bearing invariants

1. **No backend trace while unsaved-and-untouched:** clicking + New and typing
   nothing (or < 5 chars) and configuring skill/specs/model writes **no file**
   and emits **no broadcast**.
2. **Stable identity:** the `thinkrailSid` is fixed from creation, so
   `inputDraftStore`, `openTabs`, `activeSessionId`, and `previewPath` never need
   rekeying.
3. **Start always wins:** Start/Send saves-then-starts regardless of the
   5-char threshold.
4. **Never lose typing:** explicit flush points (blur, switch, page hide) plus
   the debounce/maxWait window guarantee in-progress text is captured before the
   user leaves.

## Components

### New

| Component | Responsibility |
|-----------|----------------|
| `frontend/src/utils/sessionName.ts` | Pure name derivation. `deriveSessionName(text)`: trim, collapse internal whitespace/newline runs to single spaces, return as-is if ≤ 15 chars else **first 14 + `…`** (label length ≤ 15 *including* the ellipsis — matches validation scenario 4's `"Refactor the s…"`). Exports `DEFAULT_SESSION_NAME = "New session"`. No React, no store deps — trivially unit-testable. |
| `frontend/src/store/draftAutosave.ts` | Store-level autosave controller (module-scoped, not a React hook). Holds `Map<thinkrailSid, { trailingTimer, maxWaitTimer }>`. `noteInput(thinkrailSid)` (re)arms a **750 ms trailing** timer and a **5 s max-wait** timer; `flush(thinkrailSid)` cancels timers and commits immediately; `cancel(thinkrailSid)` drops timers (on discard/end). Commit logic delegates to session-store actions. Survives component unmount; imported by `sessionStore` and `InputArea`. |

### Changed — Frontend

| File | Change |
|------|--------|
| `types/session.ts` | Add `unsaved?: boolean` and `nameManuallySet?: boolean` to `Session`. (No change to the `SessionStatus` union — `unsaved` layers on `"draft"`.) |
| `store/sessionStore.ts` | **`createNewSession`**: no longer calls `createDraft`/`agent/prepare`. First runs the **no-duplicate-blanks** guard (focus an existing `unsaved` + empty-input draft if one exists); else mints a `thinkrailSid` (`crypto.randomUUID()`) and inserts a `Session` with `status:"draft"`, `unsaved:true`, default name `"New session"`, locally-built default config. **New `ensureSaved(thinkrailSid)`**: if `unsaved`, calls `agent/prepare` **with the minted id** + held config + `draftInput` + derived name, then flips `unsaved:false` (idempotent / single-flight). **`noteDraftInput(thinkrailSid, text)`**: live-derives `session.name` when `!nameManuallySet`, then routes to `draftAutosave.noteInput` (only arms a save when text ≥ 5 non-ws **or** already saved). **`commitDraft(thinkrailSid)`** (called by the controller): `ensureSaved` on first save, else `agent/updateDraft({ draftInput, name })`. **`updateDraft`**: when `unsaved`, apply changes to the in-memory session **without** the RPC (config held locally). **`startDraft`/`sendMessage`**: `await ensureSaved` before the existing `agent/startDraft`. **`renameDraft(thinkrailSid, name)`**: sets `nameManuallySet:true`, updates name (local if unsaved, debounced `updateDraft` if saved). **`restoreSession`/`loadActiveSessions`**: seed `inputDraftStore` from the entry's `draftInput` and set `session.name` from persisted name. **`discard`/`endSession`**: `draftAutosave.cancel`; unsaved discard is purely local (no RPC). |
| `components/ChatStream/InputArea.tsx` | `handleChange` additionally calls `noteDraftInput(sessionId, value)`. Add textarea `onBlur` → `draftAutosave.flush(sessionId)`. The existing draft Start button path already routes through `onSend → sendMessage`, which now ensures-saved first. |
| `components/ChatStream/DraftConfigCard.tsx` | Name input `onChange` calls `renameDraft` (sets the freeze flag) instead of `debouncedUpdate({ name })`. Config-field edits keep calling `updateDraft`, which is now local-only while `unsaved`. `PromptPreview` shows a **placeholder hint** while `unsaved` (no `systemPrompt`/`sections` yet); the live preview appears after the first save. |
| `components/SessionPanel/SessionPanel.tsx` | Draft placeholder copy unchanged. No structural change — `+ New` still calls `createNewSession`, which now defers. |
| `app shell page-hide flush` (e.g. `AppShell.tsx` or a small `useDraftFlushOnHide` hook) | One `visibilitychange`/`pagehide` listener that flushes the active session's draft (`draftAutosave.flush`) so a reload/background captures the unsaved tail. |

`keyboard.ts` (`Cmd/Ctrl+T`) and `CommandPalette.tsx` ("New session") need **no change** — both already funnel through `createNewSession`, so the deferral is inherited at the single chokepoint.

### Changed — Backend

| File | Change |
|------|--------|
| `agent/models.py` | Add `draft_input: str \| None = None` (alias `draftInput`) to `AgentTask`. Non-context field — never fed to `build_context`. |
| `agent/tracker.py` | `create_task` already accepts `thinkrail_sid`; add a `draft_input` param (or set `task.draft_input` after construction) so `prepare_task` can thread both. |
| `agent/service.py` | `prepare_task(...)`: accept `thinkrail_sid: str \| None = None` and `draft_input: str \| None = None`, pass both to `create_task`. `update_draft(...)`: add `draft_input` (Ellipsis-sentinel) and persist it. `_save_task`: write `draftInput`. `list_all_sessions`: include `draftInput` in the draft-only fields (alongside `config`/`systemPrompt`/`sessionPrompt`). Disk-rehydration on startup reads `draftInput`. |
| `agent/persistence.py` | `save_session`: persist `draftInput`. `list_sessions`: include `draftInput` in the `status == "draft"` branch. |
| `rpc/methods/agents.py` | `prepare_agent`: read `thinkrailSid` (optional) and `draftInput` from params, forward to `prepare_task`. `update_draft`: read `draftInput` and forward. (Both handlers stay `**params`-based; no Pydantic request model exists today.) |
| frontend generated types | After the `AgentTask`/draft list-entry shape changes, run `cd frontend && npm run generate` so `SessionSummary` / WS / RPC types pick up `draftInput`. |

## Interfaces / contracts

### Constants

```ts
export const SAVE_THRESHOLD = 5;        // non-whitespace chars to trigger first save
export const AUTOSAVE_DEBOUNCE_MS = 750; // trailing debounce after typing pauses
export const AUTOSAVE_MAX_WAIT_MS = 5000;// forced save during sustained typing
export const NAME_MAX = 15;             // max label length INCLUDING the ellipsis
export const DEFAULT_SESSION_NAME = "New session";

// "intent" test used by the threshold + no-duplicate-blanks guard:
const nonWs = (t: string) => t.replace(/\s/g, "").length;
```

### `sessionName.ts`

```ts
export function deriveSessionName(text: string): string;
// trim → collapse /\s+/ to " " → (len ≤ NAME_MAX ? as-is : slice(0, NAME_MAX - 1) + "…")
//   → final label is ≤ NAME_MAX chars INCLUDING the ellipsis
//     (validation 4: "Refactor the session store" → "Refactor the s…")
// empty/whitespace input → DEFAULT_SESSION_NAME
```

### `draftAutosave.ts` (store-level controller)

```ts
// Arms a 750 ms trailing timer + a 5 s max-wait timer; both call commit on fire.
export function noteInput(thinkrailSid: string): void;
// Cancels timers and commits synchronously (returns the in-flight promise).
export function flush(thinkrailSid: string): Promise<void>;
// Drops timers without committing (discard / end / unmount-with-no-text).
export function cancel(thinkrailSid: string): void;
```

`commit` is wired by `sessionStore` to call `commitDraft(thinkrailSid)`.

### `Session` type additions (`types/session.ts`)

```ts
interface Session {
  // …existing…
  unsaved?: boolean;          // true = frontend-only draft, no backend task yet
  nameManuallySet?: boolean;  // true = freeze live name derivation
}
```

### Session-store actions

```ts
createNewSession(prefill?): Promise<string>;
//   blank path: no RPC. Focus an existing untouched unsaved draft if present
//   (no-duplicate-blanks); else mint thinkrailSid + insert unsaved draft.

ensureSaved(thinkrailSid): Promise<void>;
//   if unsaved → agent/prepare({ thinkrailSid, config, skillId, specIds, filePaths,
//   name, draftInput }) then set unsaved=false. Single-flight; no-op if saved.

noteDraftInput(thinkrailSid, text): void;
//   live-derive name (when !nameManuallySet); arm autosave only when
//   nonWs(text) ≥ SAVE_THRESHOLD OR session already saved.

commitDraft(thinkrailSid): Promise<void>;
//   unsaved → ensureSaved; else agent/updateDraft({ draftInput, name }).

renameDraft(thinkrailSid, name): void;
//   nameManuallySet=true; local if unsaved, debounced updateDraft if saved.

updateDraft(thinkrailSid, changes): Promise<string>;  // UNCHANGED signature.
//   new behavior: when session.unsaved, apply changes locally, SKIP the RPC.
```

### Wire-format additions (backend RPC)

`agent/prepare` request — two **optional, additive** fields:

```json
{
  "thinkrailSid": "client-minted-uuid",   // NEW: reuse instead of server-mint
  "specIds": [], "config": { … }, "skillId": null,
  "name": "fix login",                 // derived name
  "draftInput": "fix login",           // NEW: persisted typed text (not session_prompt)
  "prompt": null, "ticketId": null, "filePaths": []
}
```

Response unchanged: `{ thinkrailSid, systemPrompt, sections, totalTokens }` (echoes
the supplied `thinkrailSid`).

`agent/updateDraft` request — one **optional, additive** field:

```json
{ "thinkrailSid": "…", "draftInput": "fix login flow", "name": "fix login flo…" }
```

`agent/startDraft` — **unchanged**. Called only after `ensureSaved`, so the task
always exists. The typed text is still passed as `prompt` and enqueued as the
first user message.

### Session-list contract (`SessionSummary`)

Draft entries from `agent/list` gain `draftInput?: string | null` (alongside the
existing `config`/`systemPrompt`/`sessionPrompt`/`filePaths`). Frontend restore
reads it to repopulate `inputDraftStore`.

### Backend signatures

```python
async def prepare_task(self, spec_ids, config, skill_id=None, session_prompt=None,
    name="", ticket_id=None, file_paths=None,
    thinkrail_sid: str | None = None, draft_input: str | None = None) -> AgentTask

async def update_draft(self, thinkrail_sid, *, …, draft_input: str | None = ...) -> str
```

### Compatibility

All wire additions are optional. Omitting `thinkrailSid` preserves today's
server-mint behavior (used by `agent/run` and pre-configured prepares); omitting
`draftInput` leaves it `None`. No migration of existing `.tr/sessions/`
files is required (requirement 12).

## Data flow

### 1. Create blank (`+ New` / `Cmd+T` / palette)

```
createNewSession()
  → no-dup guard: find session where unsaved && nonWs(inputDraft)==0
      → found?  switchSession(existing) ; return            (requirement 10)
  → else: id = crypto.randomUUID()
          sessions.set(id, { status:"draft", unsaved:true,
                             name:"New session", …default config })
          openTabs.add(id) ; activeSessionId = id
  (NO RPC, NO broadcast, NO file)                            (requirement 1)
```

### 2. Type below threshold (< 5 non-ws)

```
InputArea.handleChange(text)
  → inputDraftStore.setDraft(id, text)
  → noteDraftInput(id, text)
       → if !nameManuallySet: session.name = deriveSessionName(text)  (live tab label)
       → nonWs(text) < 5 && unsaved  → draftAutosave does NOT arm     (nothing saved)
```

### 3. Cross threshold (≥ 5 non-ws) then pause ~750 ms

```
noteDraftInput → arms trailing(750ms) + maxWait(5s)
  …pause…
  trailing fires → commitDraft(id)
     → unsaved → ensureSaved(id)
          → agent/prepare({ thinkrailSid:id, config, skillId, specIds,
                            filePaths, name, draftInput:text })
          → backend persists .tr/sessions/{id}.json (status draft)
            + broadcasts session/didCreate  → other clients’ lists update
          → unsaved = false
```

Exactly **one** draft is created (single-flight `ensureSaved`).

### 4. Continued sustained typing

```
each keystroke → noteDraftInput → re-arm trailing; maxWait keeps its deadline
  → maxWait (≤5s) OR a 750ms gap fires → commitDraft
     → already saved → agent/updateDraft({ draftInput, name })
```

Result: **at most ~one save per max-wait window** during nonstop typing
(success criterion).

### 5. Start / Send (works below threshold)

```
InputArea Start/Send → onSend(text) → sessionStore.sendMessage(id, text)
  → status==="draft":
       await ensureSaved(id)        // prepare if still unsaved (any length)
       → startDraft(id, text)       // agent/startDraft enqueues text as 1st msg
  → draftAutosave.cancel(id)        // stop pending timers; session is starting
```

`ensureSaved` ignores the 5-char threshold, so a 2-char prompt still starts
(requirement 4).

### 6. Flush on exit (blur / switch / page-hide)

```
textarea onBlur                     → draftAutosave.flush(id)
switchSession(prev → next)          → draftAutosave.flush(prev)
visibilitychange→hidden / pagehide  → draftAutosave.flush(activeId)
  flush: clear timers; if unsaved&&nonWs≥5 → ensureSaved ; else if saved → updateDraft
```

Below-threshold-and-unsaved flush is a **no-op** (still nothing worth saving) —
abandoning a 2-char blank leaves no trace, exactly as required.

### 7. Clear text after a save (requirement 8)

```
delete to empty → noteDraftInput(id, "")
  → !nameManuallySet → session.name = "New session"  (tab reverts)
  → session already saved → commit persists draftInput:"" , name:"New session"
  → backend draft FILE is KEPT (no delete)
type again → derivation resumes (flag still false)
```

### 8. Manual rename (requirement 7)

```
DraftConfigCard name input onChange → renameDraft(id, value)
  → nameManuallySet = true (permanent for this session)
  → name set locally (unsaved) or debounced agent/updateDraft (saved)
subsequent noteDraftInput → name derivation skipped (flag true)
```

### 9. Reload / reconnect restore (requirement 5)

```
loadActiveSessions / restoreSession
  → list entry for draft carries { name, draftInput, config, … }
  → sessions.set(id, { …, status:"draft", name })
  → inputDraftStore.setDraft(id, entry.draftInput ?? "")   // input box repopulated
  → unsaved = false (it came from disk → already persisted)
```

A reconnecting second client sees the saved draft in its list (it was
broadcast at first save) and, on opening it, restores the same `draftInput`.

## Error handling

| Failure | Handling |
|---------|----------|
| **`agent/prepare` fails on first save** | Leave `unsaved:true`; **keep** the typed text in `inputDraftStore` (never cleared on failure); surface a non-fatal toast (mirrors `sendMessage`'s error path). The next `noteDraftInput` tick or `flush` retries. No text is lost. |
| **Concurrent save triggers** (threshold timer fires while Start is also pressed) | `ensureSaved` is **single-flight**: store the in-flight promise per `thinkrailSid` (same pattern as `_restoring`/`_subscribed`). The second caller `await`s the first; only one `agent/prepare` runs, so only one draft is ever created. |
| **`agent/updateDraft` fails while saved** | Toast + keep local text/name; retry on the next debounce/flush. Edits are not lost; the on-disk copy is just stale until the next successful commit. |
| **Start while still unsaved and `ensureSaved` fails** | Do **not** call `agent/startDraft` (it would raise `TaskNotFoundError` — no task). Abort start, surface the error, leave the session as a recoverable local draft. |
| **Page-hide / hard-reload tail** | `flush` issues the save over the WebSocket but cannot block unload. `visibilitychange→hidden` fires earlier and more reliably than `beforeunload`, and the 750 ms/5 s window keeps the at-risk tail tiny. The **last < 750 ms of uninterrupted typing before a hard kill may not flush in time** — an accepted limitation. (We chose the backend `draft_input` field over a synchronous `localStorage` backstop; the debounce/max-wait window keeps the at-risk tail small.) |
| **Server restart orphans a saved draft** | Pre-existing limitation (DRAFT_SESSION_DESIGN): a draft persists on disk but the in-memory `Tracker` is empty, so `updateDraft`/`startDraft` raise `TaskNotFoundError`. Unsaved local drafts are **immune** (no backend task); once saved, this existing behavior applies unchanged — the draft can still be discarded. |
| **Discard of an unsaved draft** | Purely local: `draftAutosave.cancel(id)`, remove from `sessions`/`openTabs`, clear `inputDraftStore`. **No** `deleteSession` RPC (there's nothing on disk). Saved drafts discard exactly as today. |
| **`crypto.randomUUID` unavailable** | Available in all secure contexts; `localhost` is treated as secure by browsers. If a non-secure origin is ever introduced, fall back to a small UUID helper. Not a concern for the localhost-only product today. |
| **Multi-client no-dup** | The no-duplicate-blanks guard is intentionally **per-client** — other clients never see an unsaved draft, so they cannot (and should not) dedupe against it. Requirement 10 is scoped to "while a blank tab is already open" on the same client. |

## Testing strategy

### Backend (`uv run pytest`)

- **`prepare_task` honors a caller-supplied `thinkrail_sid`** — the persisted task
  and returned `thinkrailSid` equal the supplied id (no server re-mint).
- **`draft_input` round-trips** — `prepare_task` then `update_draft` persist it;
  `list_all_sessions` / `persistence.list_sessions` return `draftInput` for draft
  entries.
- **`draft_input` is non-context** — assert the built system prompt does **not**
  contain the `draft_input` text (it must never reach `build_context`, unlike
  `session_prompt`).
- **Backward-compat** — `prepare_task` with no `thinkrail_sid`/`draft_input` behaves
  exactly as today (server-mints id, `draftInput=None`).

### Frontend unit (`npm test`, vitest)

- **`sessionName.deriveSessionName`** (pure): short (≤15) as-is; exactly 15 as-is;
  >15 → first 14 + `…`; internal whitespace + newline runs collapse to single
  spaces; leading/trailing trimmed; empty/whitespace → `"New session"`.
- **`draftAutosave`** (vitest fake timers): arms only when `nonWs ≥ 5` or already
  saved; trailing fires at 750 ms; max-wait forces a commit by 5 s under
  continuous `noteInput`; `flush` commits immediately and clears timers; `cancel`
  drops timers with no commit.
- **`sessionStore`** (mocked RPC client): `createNewSession` issues **no** RPC and
  inserts an `unsaved` draft; no-duplicate-blanks focuses the existing untouched
  unsaved draft; `ensureSaved` is single-flight (one `prepare` under concurrent
  callers) and reuses the minted id; `updateDraft` skips the RPC while `unsaved`;
  `noteDraftInput` derives the name and respects `nameManuallySet`; clearing text
  after save reverts the name to default and does **not** delete the draft;
  `restoreSession`/`loadActiveSessions` repopulate `inputDraftStore` from
  `draftInput`.

### End-to-end (Playwright) — one per validation scenario

A dedicated spec covers the new behavior (per project rule: new UI surfaces ship
with their own e2e — contract tests are not a substitute). Scenarios 1-10 from
the validation criteria below map 1:1 to test cases: empty-abandon (no file, no
second-client entry), threshold+debounce (exactly one draft; ~≤2 saves over
10 s), config-only-then-type, name derivation + freeze, clear-after-save,
reload-restore, start-below-threshold, no-duplicate-blanks, flush-on-exit,
scope-unaffected (meta-ticket + Suggested still persist immediately).

**Known e2e gotchas to honor (from project memory):**

- `AppStore` is shared across e2e — seed `session_defaults` explicitly; don't
  assume isolation.
- Submit a draft via **keyboard** (`Ctrl/Alt+Enter` on the textarea), not the
  portal-rendered Send/Start button.
- "no file on disk" assertions check `.tr/sessions/`; "no broadcast" is
  verified with a second browser context whose session list must not gain an
  entry.

### CI gates

- `cd frontend && npm run generate` leaves the generated types clean (the
  `draftInput` additions are reflected; no uncommitted diff).
- `npm run lint` (tsc + eslint) and both test suites pass.

## Validation criteria

Behavioral (mirror the product validation scenarios):

1. **Empty abandon** — `+ New`, type nothing, switch/reload: no
   `.tr/sessions/{id}.json`; a second client's list gains no entry.
2. **Threshold + debounce** — "fix" (3) saves nothing; "fix login" (≥5) + ~1 s
   pause → exactly one draft file; ~10 s nonstop typing → ≤ ~2 saves.
3. **Config-only then type** — pick skill + spec, confirm nothing persisted;
   then ≥5 chars → draft created carrying the earlier skill + spec.
4. **Name derivation + freeze** — `Refactor   the\nsession store` → tab shows
   `Refactor the s…`; live updates while typing; manual rename to "WIP" freezes
   derivation permanently.
5. **Clear after save** — type to save, select-all-delete → label reverts to
   "New session", draft file still present; type again → name re-derives.
6. **Restore** — multi-line prompt, wait for save, reload → input box
   repopulated and tab shows the derived name.
7. **Start below threshold** — "hi" + Start/Send → session starts normally.
8. **No duplicate blanks** — with one untouched blank tab open, `+ New`/`Cmd+T`
   → focus returns to it; no second blank tab.
9. **Flush on exit** — type ≥5 then immediately (pre-debounce) Start / blur /
   switch tab → text saved, no loss.
10. **Scope unaffected** — meta-ticket session + approved Suggested session still
    persist immediately with their existing names.

Technical gates (deferral-specific):

11. **No broadcast without intent** — no `session/didCreate` is emitted for a
    blank/under-threshold draft (verified: no `agent/prepare` call leaves the
    client until the threshold/Start/flush).
12. **Single draft** — concurrent threshold-fire + Start produce exactly one
    `agent/prepare` (single-flight `ensureSaved`); the minted `thinkrailSid` is
    reused, never reconciled.
13. **`draft_input` is non-context** — the typed text is persisted as
    `draftInput` and never appears in the assembled system prompt.
14. **No migration** — pre-existing "Session N" drafts on disk are untouched.
