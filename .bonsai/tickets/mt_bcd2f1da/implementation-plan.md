# Plan: Draft-on-type — defer blank-session save until the user types a prompt

## Meta
- **Ticket:** mt_bcd2f1da
- **Status:** draft
- **Updated:** 2026-06-04

> Reference design: [DRAFT_SESSION_DESIGN.md](../../design_docs/DRAFT_SESSION_DESIGN.md) (Draft-on-Type section) plus this ticket's `product-design.md` and `technical-design.md`. All wire additions (`bonsaiSid`, `draftInput`) are **optional and additive** — omitting them preserves today's immediate-persist behavior.
>
> **Parallel-eligible at start:** S1, S5, S6 have no dependency on one another (backend data layer and the two pure frontend primitives).

## Milestone 1: Backend — defer-friendly persistence (`draftInput` + client-minted id reuse)

Thread a non-context `draft_input` field end-to-end and let `prepare` reuse a caller-supplied `bonsaiSid`. Everything here is additive; the immediate-persist path used by meta-ticket / suggested sessions is unchanged.

### Step 1: Thread `draft_input` through the backend data layer
- **Status:** pending
- **Skill:** default
- **Input specs:** [module-agent, agent-persistence, draft-session-design]
- **Depends on:** (none)
- **Parallel with:** Step 5, Step 6
- **Agent instructions:** Add `draft_input: str | None = None` (alias `draftInput`) to `AgentTask` in `backend/app/agent/models.py`. It is a **non-context** field — it must never be passed to `build_context`/the system-prompt assembly (`context.py`); it is distinct from `session_prompt`. In `backend/app/agent/tracker.py`, thread `draft_input` through `create_task` (the optional `bonsai_sid` param already exists — do not add a second id path; the supplied id is reused, not reconciled). In `backend/app/agent/persistence.py`, make `save_session` round-trip `draftInput` like any other metadata key, and add `draftInput` to the fields `list_sessions` returns for `status == "draft"` entries (alongside the existing `config`/`systemPrompt`/`sessionPrompt`). Follow the project Python style (`from __future__ import annotations` first, modern type hints, section separators).
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] `AgentTask.draft_input` exists with alias `draftInput` and is never referenced by context assembly
  - [ ] `persistence.save_session` persists `draftInput` and `list_sessions` returns it for `draft` entries only

### Step 2: Service + RPC wiring for `prepare`/`updateDraft`
- **Status:** pending
- **Skill:** default
- **Input specs:** [module-agent, draft-session-design, module-rpc]
- **Depends on:** Step 1
- **Parallel with:** (none)
- **Agent instructions:** In `backend/app/agent/service.py`: extend `prepare_task(...)` to accept `bonsai_sid: str | None = None` and `draft_input: str | None = None` and pass both to `create_task`; extend `update_draft(...)` to accept `draft_input` using the existing **Ellipsis-sentinel** convention (`...` = "not provided / keep current", explicit value = set) so autosave can update text without disturbing other config; have `_save_task` write `draftInput`; and include `draftInput` in the draft-only fields returned by `list_all_sessions` (and any startup disk-rehydration path that reads draft fields). In `backend/app/rpc/methods/agents.py`: `prepare_agent` reads optional `bonsaiSid` and `draftInput` from `**params` and forwards them to `prepare_task`; `update_draft` reads optional `draftInput` and forwards it. Keep both handlers `**params`-based (no new Pydantic request model). The response shape is unchanged and echoes the supplied `bonsaiSid`.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] `prepare_task` with a supplied `bonsai_sid` reuses it verbatim (no server re-mint); with neither arg it behaves exactly as today
  - [ ] `update_draft` uses Ellipsis-sentinel for `draft_input` so omitting it leaves stored text unchanged

### Step 3: Backend tests for the additive fields
- **Status:** pending
- **Skill:** default
- **Input specs:** [module-agent, agent-persistence, draft-session-design]
- **Depends on:** Step 2
- **Parallel with:** Step 4
- **Agent instructions:** Add pytest coverage under `backend/tests/` (mirror the `app/` layout; class-based, descriptive names, `pytest-asyncio` auto mode). Cover: (1) `prepare_task` honors a caller-supplied `bonsai_sid` — the persisted task and returned `bonsaiSid` equal the supplied id; (2) `draft_input` round-trips — `prepare_task` then `update_draft` persist it and `list_all_sessions` / `persistence.list_sessions` return `draftInput` for draft entries; (3) `draft_input` is **non-context** — assert the assembled system prompt does **not** contain the `draft_input` text (contrast with `session_prompt`, which does appear); (4) backward-compat — `prepare_task` with no `bonsai_sid`/`draft_input` server-mints an id and leaves `draftInput` `None`.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] A test explicitly asserts `draft_input` text is absent from the built system prompt
  - [ ] A test asserts the supplied `bonsai_sid` is reused (no re-mint) and the no-arg path is unchanged

### Step 4: Regenerate frontend types
- **Status:** pending
- **Skill:** default
- **Input specs:** [draft-session-design, state-management, frontend-module]
- **Depends on:** Step 2
- **Parallel with:** Step 3
- **Agent instructions:** Run `cd frontend && npm run generate` so the OpenAPI/WS/RPC type pipelines pick up the `draftInput` additions. Confirm the draft session-list entry type (`SessionSummary` in `frontend/src/api/methods/sessions.ts`, alongside the existing optional `config`/`systemPrompt`/`sessionPrompt`) exposes `draftInput?: string | null`; if it is hand-maintained rather than generated, add the field there. Do not hand-edit any file with a "DO NOT EDIT" generated header — change the source model instead and regenerate. Commit the regenerated artifacts so CI sees a clean `npm run generate` diff.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] `npm run generate` leaves no uncommitted diff (generated types reflect `draftInput`)
  - [ ] `SessionSummary` exposes `draftInput?: string | null`

## Milestone 2: Frontend primitives (pure, unit-testable)

Two dependency-free modules built and tested in isolation, runnable in parallel with the backend. No React, no store coupling.

### Step 5: `utils/sessionName.ts` — name derivation + constants
- **Status:** pending
- **Skill:** default
- **Input specs:** [draft-session-design, state-management]
- **Depends on:** (none)
- **Parallel with:** Step 1, Step 6
- **Agent instructions:** Create `frontend/src/utils/sessionName.ts` exporting: `DEFAULT_SESSION_NAME = "New session"`; `NAME_MAX = 15` (max label length **including** the ellipsis); `SAVE_THRESHOLD = 5` (non-whitespace chars); a `nonWs(text)` helper (`text.replace(/\s/g, "").length`); and `deriveSessionName(text): string` = trim → collapse internal `/\s+/` runs (incl. newlines) to single spaces → return as-is if length ≤ `NAME_MAX`, else `slice(0, NAME_MAX - 1) + "…"`; empty/whitespace input → `DEFAULT_SESSION_NAME`. No React/store imports. Add a vitest unit test file covering: short (≤15) as-is; exactly 15 as-is; >15 → first 14 + "…" (validation scenario 4: `"Refactor   the\nsession store"` → `"Refactor the s…"`); internal whitespace/newline runs collapse; leading/trailing trim; empty/whitespace → default.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] `deriveSessionName("Refactor   the\nsession store") === "Refactor the s…"` and the label is ≤ 15 chars including the ellipsis
  - [ ] Module has zero React/store imports (pure, trivially testable)

### Step 6: `store/draftAutosave.ts` — autosave controller
- **Status:** pending
- **Skill:** default
- **Input specs:** [draft-session-design, state-management]
- **Depends on:** (none)
- **Parallel with:** Step 1, Step 5
- **Agent instructions:** Create `frontend/src/store/draftAutosave.ts` as a **module-scoped controller** (not a React hook, not a Zustand store), holding `Map<bonsaiSid, { trailingTimer, maxWaitTimer }>` and its own timing constants `AUTOSAVE_DEBOUNCE_MS = 750` and `AUTOSAVE_MAX_WAIT_MS = 5000`. Export `noteInput(bonsaiSid)` — (re)arms a 750 ms **trailing** timer and, if not already running, a 5 s **max-wait** timer; both fire `commit(bonsaiSid)`; `flush(bonsaiSid): Promise<void>` — cancels timers and commits immediately, returning the in-flight promise; `cancel(bonsaiSid)` — drops timers without committing. The `commit` target is injected/wired by `sessionStore` (it calls `commitDraft(bonsaiSid)`); keep the controller decoupled from the store so it is unit-testable with a stubbed commit. **Threshold gating lives in the caller (`noteDraftInput`), not here** — `noteInput` always arms when called. Add vitest tests with fake timers: trailing fires at 750 ms; under continuous `noteInput`, max-wait forces a commit by 5 s; `flush` commits immediately and clears timers; `cancel` drops timers with no commit; per-`bonsaiSid` isolation.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] Fake-timer tests prove the 750 ms trailing fire and the 5 s max-wait forced commit under sustained input
  - [ ] `flush` commits synchronously-then-clears; `cancel` clears without committing; survives component unmount (module-scoped)

## Milestone 3: Frontend wiring (store + components + app shell)

Connect the primitives into the session store, then the input/config UI and the page-hide flush.

### Step 7: `sessionStore` deferral + `Session` type flags
- **Status:** pending
- **Skill:** default
- **Input specs:** [state-management, draft-session-design]
- **Depends on:** Step 4, Step 5, Step 6
- **Parallel with:** (none)
- **Agent instructions:** In `frontend/src/types/session.ts` add `unsaved?: boolean` and `nameManuallySet?: boolean` to `Session` (no change to the `SessionStatus` union — `unsaved` layers on `"draft"`). In `frontend/src/store/sessionStore.ts`:
  - **`createNewSession`**: stop calling `createDraft`/`agent/prepare`. First run the **no-duplicate-blanks** guard — if a session exists with `unsaved && nonWs(inputDraft)===0`, `switchSession` to it and return its id. Else mint `crypto.randomUUID()` and insert a `Session` with `status:"draft"`, `unsaved:true`, `name:DEFAULT_SESSION_NAME`, and locally-built default config (`buildDefaultSessionConfig()`); add to `openTabs`; set active. **No RPC, no broadcast, no file.**
  - **`ensureSaved(bonsaiSid)`**: if `unsaved`, call `agent/prepare` with the minted id + held config (skillId/specIds/filePaths) + `name` + `draftInput`, then set `unsaved:false`. **Single-flight** — store the in-flight promise per `bonsaiSid` (same pattern as `_restoring`/`_subscribed`); a no-op once saved.
  - **`noteDraftInput(bonsaiSid, text)`**: when `!nameManuallySet`, set `session.name = deriveSessionName(text)` (reverts to `DEFAULT_SESSION_NAME` on empty); then arm autosave via `draftAutosave.noteInput` **only when** `nonWs(text) >= SAVE_THRESHOLD` **or** the session is already saved.
  - **`commitDraft(bonsaiSid)`** (wired as the controller's commit): `unsaved` → `ensureSaved`; else `agent/updateDraft({ draftInput, name })`.
  - **`renameDraft(bonsaiSid, name)`**: set `nameManuallySet:true`; update name locally if `unsaved`, debounced `updateDraft` if saved.
  - **`updateDraft`**: keep the signature; when `session.unsaved`, apply changes to the in-memory session and **skip the RPC**.
  - **`startDraft`/`sendMessage`**: `await ensureSaved` before `agent/startDraft` (so Start works below threshold); `draftAutosave.cancel` once starting.
  - **`restoreSession`/`loadActiveSessions`**: seed `inputDraftStore` from the entry's `draftInput` and set `session.name` from persisted name; restored drafts are `unsaved:false`.
  - **`discard`/`endSession`**: `draftAutosave.cancel`; discarding an `unsaved` draft is purely local (no `deleteSession` RPC).
  Add vitest tests (mocked RPC client) per the technical design's frontend-unit list.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] `createNewSession` issues **no** RPC and inserts an `unsaved` draft; a second trigger focuses the existing untouched blank tab
  - [ ] `ensureSaved` is single-flight (one `agent/prepare` under concurrent callers) and reuses the minted id; `updateDraft` skips the RPC while `unsaved`
  - [ ] Clearing text after a save reverts name to default and does **not** delete the draft; restore repopulates `inputDraftStore` from `draftInput`
  - [ ] Scope guard intact: `createDraft` (meta-ticket / stage-default) and `agent/run` (Suggested) still persist immediately

### Step 8: `InputArea` + `DraftConfigCard` wiring
- **Status:** pending
- **Skill:** default
- **Input specs:** [draft-session-design]
- **Depends on:** Step 7
- **Parallel with:** Step 9
- **Agent instructions:** In `frontend/src/components/ChatStream/InputArea.tsx`: `handleChange` additionally calls `noteDraftInput(sessionId, value)` (after the existing `inputDraftStore.setDraft`); add a textarea `onBlur` that calls `draftAutosave.flush(sessionId)`. The existing draft Start/Send path already routes through `onSend → sendMessage`, which now ensures-saved first — no change needed there. In `frontend/src/components/ChatStream/DraftConfigCard.tsx`: the name input `onChange` calls `renameDraft` (which sets the freeze flag) instead of `debouncedUpdate({ name })`; config-field edits keep calling `updateDraft` (now local-only while `unsaved`); the prompt preview (`PromptPreview`) shows a **placeholder hint** while `unsaved` (no `systemPrompt`/sections yet) and the live preview after the first save.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] Typing in `InputArea` derives the tab name live and arms autosave only past the threshold; blur flushes pending text
  - [ ] `DraftConfigCard` name edits freeze derivation; prompt preview shows a placeholder while `unsaved`

### Step 9: App-shell page-hide flush
- **Status:** pending
- **Skill:** default
- **Input specs:** [draft-session-design, app-shell, state-management]
- **Depends on:** Step 7
- **Parallel with:** Step 8
- **Agent instructions:** Add one `visibilitychange`/`pagehide` listener that flushes the active session's draft so a reload/backgrounding captures the unsaved tail. Implement as a small `useDraftFlushOnHide` hook (or inline in `AppShell.tsx`) that, on `document.visibilitychange → hidden` and `pagehide`, calls `draftAutosave.flush(activeSessionId)`. Prefer `visibilitychange→hidden` (fires earlier and more reliably than `beforeunload`). Register/unregister the listener cleanly on mount/unmount. Below-threshold-and-unsaved flush is a no-op by construction (nothing armed / nothing worth saving), so abandoning a blank still leaves no trace.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] A `visibilitychange→hidden` / `pagehide` event flushes the active draft via `draftAutosave.flush`
  - [ ] Listener is registered and torn down without leaks; flushing an unsaved sub-threshold draft is a no-op

## Milestone 4: End-to-end validation

### Step 10: Playwright e2e — all 10 validation scenarios
- **Status:** pending
- **Skill:** default
- **Input specs:** [module-e2e, draft-session-design]
- **Depends on:** Step 3, Step 8, Step 9
- **Parallel with:** (none)
- **Agent instructions:** Add a dedicated Playwright spec under `e2e/` covering the 10 validation scenarios from `product-design.md` / `technical-design.md` 1:1: (1) empty abandon — no file in `.bonsai/sessions/`, no entry in a second browser context's session list; (2) threshold + debounce — "fix" (3) saves nothing, "fix login" (≥5) + ~1 s pause → exactly one draft, ~10 s nonstop typing → ≤ ~2 saves; (3) config-only then type — pick skill+spec, confirm nothing persisted, then ≥5 chars creates a draft carrying those choices; (4) name derivation + freeze; (5) clear after save reverts label but keeps the file; (6) reload restores text + name; (7) Start below threshold starts; (8) no duplicate blanks focuses the existing tab; (9) flush on exit (pre-debounce Start / blur / tab switch) loses nothing; (10) scope unaffected — meta-ticket + approved Suggested still persist immediately. **Honor project-memory e2e gotchas:** the shared `AppStore` has no per-test isolation — seed `session_defaults` explicitly; submit a draft via **keyboard** (`Ctrl/Alt+Enter` on the textarea), not the portal-rendered Start/Send button; "no file" assertions check `.bonsai/sessions/`; "no broadcast" is verified with a **second browser context** whose session list must not gain an entry.
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] All 10 validation scenarios are covered by passing e2e cases
  - [ ] "No file" and "no broadcast" are verified concretely (disk check + second browser context)

## Verification

Ticket-level success criteria — each is addressed by at least one step above:

- [ ] **+ New, type nothing → no session file + no `session/didCreate` broadcast** — S7 (defer, no RPC) · S10 scenario 1
- [ ] **≥ 5 non-ws then pause → exactly one draft; sustained typing → ~one save per max-wait** — S6 (controller) · S7 (single-flight `ensureSaved`, threshold-gated arming) · S10 scenario 2
- [ ] **Skill/spec chosen but no text persists nothing; crossing threshold creates a draft carrying those choices** — S7 (config held locally, applied on first save) · S10 scenario 3
- [ ] **Derived name: cleanup + first-15 + "…", live updates, freezes after manual rename** — S5 (`deriveSessionName`) · S7 (`noteDraftInput`/`renameDraft`) · S8 (name input) · S10 scenario 4
- [ ] **Delete all text after save → reverts to "New session", keeps draft on disk** — S7 (revert name, no delete) · S10 scenario 5
- [ ] **Reload mid-draft restores typed text + derived name** — S1/S2 (`draftInput` persisted) · S4 (`SessionSummary.draftInput`) · S7 (restore seeds `inputDraftStore`) · S10 scenario 6
- [ ] **Start/Send starts even below threshold** — S7 (`ensureSaved` ignores threshold) · S8 (Start path) · S10 scenario 7
- [ ] **Second new-blank trigger focuses the existing blank tab** — S7 (no-duplicate-blanks guard) · S10 scenario 8
- [ ] **Guaranteed capture on exit (blur / switch / page hide / Start)** — S8 (`onBlur` flush) · S9 (page-hide flush) · S7 (`switchSession`/Start flush) · S10 scenario 9
- [ ] **Meta-ticket + approved Suggested sessions still persist immediately (no regression)** — S7 (scope guard by construction) · S10 scenario 10
- [ ] **`draftInput` is non-context (never in the system prompt)** — S1 (field separate from `session_prompt`) · S3 (asserting test)
- [ ] **No migration of pre-existing "Session N" drafts** — inherent (behavior applies only to sessions created from now on; no migration code)
- [ ] All success criteria from all steps verified
