---
id: submodule-server-todos
type: submodule-design
status: active
title: todos — a chat's per-session TODO plan (read/write)
parent: module-server
depends-on: [module-contracts, submodule-server-git]
references: [module-pi-todos, submodule-web-chat]
tags: [v2, todos]
---

## Responsibility

Serve the in-chat TODO plan for a chat session, mapped to the wire DTOs. The list is **scoped by
`sessionId`** (one JSON file per session under the workspace's worktree, in the ephemeral context scratch
dir `.thinkrail/context/todos/<sessionId>.json`), not the worktree. Read-modify-write on demand: every call re-reads
through `pi-todos`' pi-free `TodoStore`, so the agent's in-session `todo_*` writes and the user's UI edits
converge on the same file with no staleness window. `listTodos` also **decorates each group with its
derived `status`** (`pi-todos`' `groupStatus`) on the way out: the rule belongs to the package that owns plan
semantics, and shipping the result keeps `apps/web` — which may import `contracts` only — from carrying a
second copy of it.

Unlike the agent's own tools (which own status), the host's write surface is the **user's** edit lever:
`todo.add` tags new items `origin: "user"` so the agent's `todo_write` re-plans never drop them, and
`todo.remove` deletes by id. `todo.update` exists on the wire (accepts status/title/note) but no current
UI path calls it — status stays agent-owned (see [[module-pi-todos]]). `updateTodo` unwraps the store's
`TodoUpdateResult` (`{ todo, paused }` — `paused` = items auto-demoted to keep one `in_progress`); the
wire response stays a bare `TodoItem` — the UI re-reads the whole plan on change, so demotions arrive
with the next `todo.list`.

This module does **not** push: a user edit isn't broadcast to other clients. The acting client updates
optimistically; a second viewer reconciles on the next `pi.event`-driven refetch. Fine for single-owner
V1 (the chat-plan UX this feeds: [[submodule-web-chat]]'s "Chat TODO plan").

**Change artifacts (`artifacts.ts`) — a commit-based review map.** Status stays agent-owned, but the host
*observes* the transitions to attach an item's code changes, so the plan becomes a durable review map.
`host/server.ts` tees `isTodoToolEnd` off the session event stream and fires
`maybeAttachChangeArtifacts(workspaceId, sessionId)` off the publish path (`void` — it runs git writes).
Reconciles are **serialized per workspace** (a promise chain) so two quick `todo_*` ends can't race the
index mid-commit; the whole path is best-effort and never throws into the event stream.

On `in_progress` it **opens the item's work window**: a baseline of the worktree's **uncommitted**
changed-path set + the current `HEAD` sha, **persisted** in a host-owned sidecar next to the todos JSON
(`.thinkrail/context/todos/<sessionId>.baselines.json`, read-modify-write like the store) — so a host
restart mid-item changes nothing; `head` is recorded for future window-commit attribution, unused today.
A window opening while **another chat** already has one records `shared: true` and marks that other
window shared too (`markOtherSessionWindowsShared`) — the flag is **sticky**, because "was this window
exclusive for its whole life?" is what the gate needs and can't be re-derived once the other closed.
(Two items of *one* plan can't overlap: `pi-todos` keeps exactly one item `in_progress` and a demoted
item's window is dropped — pinned by a test, since the gate leans on it.) **Windows never outlive their
owner**: a baseline whose item has vanished from the plan is pruned at the top of every reconcile, the
UI's `todo.remove` drops the removed item's baseline directly (no `todo_*` tool end fires for a UI edit),
and `session.delete` removes the chat's whole sidecar (`removeSessionTodoWindows`) — an orphan would read
as a permanently open foreign window and force every sibling chat into the fallback forever. On `done`:

- **Commit the item's delta.** `git.gitCommitPaths` commits **exactly the delta paths** — the item's own
  work, never "everything currently dirty" — `--no-verify` (the bookkeeping commit must not run/fail the
  user's hooks; author/committer stay the user's own config — it's their branch) with a `todo: <title>`
  subject + a `ThinkRail-Todo: <sessionId>/<todoId>` trailer (recoverable/squashable by tooling). It
  preserves the user's index across any failure (see [[submodule-server-git]]). The item gets **one
  `commit` artifact** (the sha, `label` = the item title) and **nothing else**: the commit is
  self-sufficient — its file list is *derived*, never denormalized into the JSON (see the `listTodos`
  decoration below).
- **Commit gate (safety on the user's branch).** A commit may only contain work the item can be *proven*
  to own, so all four must hold — else **no commit**, and the live-diff `change` path-list artifacts stand
  in (branch scope; `change` survives **only** as this fallback):
  1. **A recorded baseline.** No baseline = no observed window (an item flipped straight to `done`, a plan
     predating the sidecar), and then every dirty path in the worktree merely *looks* like the item's
     delta. Reportable, never committable.
  2. **No foreign dirt left** — every path dirty at the baseline is clean again by `done`. This is what
     quietly disables auto-commit in a Default workspace holding the user's WIP, the intended guard.
  3. **A window never shared** (`shared` unset) and no other chat mid-work right now — concurrent windows
     share one worktree, so their dirt can't be split between them.
  4. **A non-empty delta.**

  Each committed item leaves the uncommitted set, so the memoized changed-path read is **dropped after
  every commit** — otherwise a second item reconciled in the same pass would inherit the first's
  already-committed paths as its own delta.
- **Merge + append-on-redo.** The agent's `file`/`spec` artifacts are always kept. A `done` item already
  carrying a change set with **no fresh baseline** is a steady-state no-op (idempotent); a re-opened,
  re-worked item (fresh baseline present) gets its new `commit` **appended** to the existing ones — the
  artifact list is the item's **revision history** (1 TODO = N commits is first-class; each fix cycle is
  one more commit, and the review watermark below diffs against the list) — while old `change` path-lists
  are replaced (a live delta has no history to keep). A redo that lands in the path-list fallback also
  **drops the item's review record** (→ `unreviewed`): a live-path delta can't be watermarked by sha, so
  "review only the new delta" honestly degrades to reviewing the change set afresh. The **auto-cycle
  count survives that drop** — it is kept in a separate durable map (`reviews.ts`'s `autoCycles`, keyed
  by item id, sibling to `items`/`pending`), not embedded in the review record, so dropping the record
  for the sha-watermark reset above can never silently regrant a spent auto-fix cycle (a bug once fixed:
  the fallback's `dropReviewRecord` used to wipe `autoCycles` along with the verdict, so a later manual
  review read `spent` as 0 and granted a second automated cycle past the cap). `approveTodoReview` clears
  it (a settled round resets the counter for the next one); `recordAgentChangesRequested` writes it
  independently of the record it also writes; `todoReviewAutoCycles` is the read side.

The host's own on-disk state (anything under `WORKSPACE_INTERNAL_DIR` = `.thinkrail/…`, e.g. the todos
JSON under `context/todos/`) is filtered out of every change set — writing a todo shows up in `git status`
but is never a change the step *produced*. The pi-free `TodoStore` never touches git; `commit`/`change`
are host-only, while the agent attaches `file`/`spec` itself through the `todo_*` tools (see
[[module-pi-todos]]). Known limitations (accepted): an agent that commits *itself* mid-item leaves an empty
delta at `done` → no artifacts; and a writer this mechanism cannot see — the user editing through a
terminal or an external editor mid-window, or a chat with no plan at all — is indistinguishable from agent
work in `git status`, so its edits can land in the item's commit (the app's own editor is read-only, and
anything already dirty when the window opened is caught by gate 2).

**`listTodos` decoration — unfolding the commit.** The wire DTO's `commit` artifact carries a derived
**`files`** list — full `GitFileChange[]` rows (path + status + `+/−` line counts), read through
`git.gitStatus` at the **`commit:{sha}` scope** (the exact rows the Changes panel renders there, one
derivation) — memoized in-memory **by workspace + sha** (resolvability is repository-local: two clones
can share a sha while only one still has the object, so one workspace's hit must never satisfy another's
resolution check) — immutable, so the cache never staleness-checks; only
successful resolutions are cached, a transient git failure (or `UNKNOWN_COMMIT`) retries on the next
list. An **unresolvable sha** (GC'd after a history rewrite — reflog keeps rewritten commits alive ~90
days, far longer than a chat plan's ephemeral life; we deliberately pin nothing) yields **no `files`** —
that absence is the client's signal to degrade the affordance silently (no chip, never a broken diff
tab). The same decoration pass is where `groupStatus` already ships, so the pattern has one home.

**`listTodos` decoration — the unattributed remainder.** The same pass ships **`TodoPlan.unattributed`**
(present only when non-empty): the worktree's uncommitted `gitStatus` rows that belong to **no item of
this plan** — the uncommitted set minus app-state paths, minus every item's `change`-artifact paths,
and, while a work window is open, minus the open item's in-flight delta (paths *outside* its baseline
are presumed the item's work; the baseline's own paths are exactly the pre-existing dirt the attribution
above can never claim). This is the plan's honesty section: without it, work the reconcile can't
attribute — edits made before the first window opened, after the last item settled, or in a chat that
never planned at all — is simply absent from the review map, which reads as "nothing else changed".
Derived on every read (`unattributedChanges`, pure — same home as the attribution rules), never stored;
a git failure degrades to omitting the field. A concurrent chat's work-in-flight in the same worktree
shows here too — it *is* outside this plan — accepted noise, same family as the shared-window
limitations above.

**The review workflow (`reviews.ts` + the ops in `todos.ts`).** A completed item that carries a host
change set is **reviewable** — the gate is that artifact presence, so research/verification steps never
demand review and no LLM attribution is involved. The user's decision lives in a second host-owned
sidecar, `.thinkrail/context/todos/<sessionId>.reviews.json` (read-modify-write, atomic, same lifecycle
as the baselines: `todo.remove` prunes the item's record, `session.delete` removes the file; orphan
records are inert either way) — deliberately **not** the agent-writable todos JSON: an agent re-plan must
never flip a review decision. A record is `reviewed` or `changes_requested` plus **`reviewedShas`, the
watermark**: the sha set the reviewer actually acted on. For a HUMAN action that is the item's commit
shas at that moment; for the AGENT flow the pending mark carries the truth — **`startTodoReview` stamps
the item's start-time sha list into the in-flight `pending` entry** (`{ at, shas }`, durable in the
sidecar), and `approveTodoReview` / `recordAgentChangesRequested` prefer those over the current shas, so
a commit the worker lands WHILE the reviewer's turn is streaming stays an unreviewed delta instead of
being silently watermarked as read. `unreviewed` is the absence of a record.
The same `listTodos` decoration pass ships `TodoItem.review` (state, `revision` = commit count,
`unreviewedShas` = commits appended since the watermark — the "changed since review" delta the UI
re-reviews instead of the original diff — and the `feedback` echo) and `TodoPlan.summary` (the plan-level
completion note, agent-authored via `todo_plan_summary`; item `summary` rides the item DTO as stored).

- **`approveTodoReview`** records `reviewed` + the watermark — the pending mark's start-time shas when
  an agent review is in flight, else the current shas (throws on unknown or non-reviewable ids →
  `{ ok:false }` on the wire).
- **`requestTodoFix`** records `changes_requested` + the feedback + the watermark and renders the
  **fix package** (`renderFixPackage`, pure): the original step (title/note), its completion summary, the
  change-set *reference* (short shas / paths — never the full diff; the agent reads content with its own
  tools), the feedback verbatim, and the instruction to re-open **this exact item** — the revision must
  attach to the step it revises (the todos skill mirrors this from the agent's side). The **send is
  composed in `host`** (this module never imports `agent`): `followUpSession` into the item's **own chat**
  (per-session plan/windows force it), fired detached with the review-send pattern — a pre-turn rejection
  calls **`rollbackTodoFix`** (restores the record the request replaced) and surfaces in the chat, so an
  undelivered fix request never strands as `changes_requested`.

**The agent reviewer ([[submodule-server-reviews]] is the findings' home).** `todo.startReview` puts a
reviewable item in front of the plan's **dedicated reviewer chat** — one per worker session, pinned as
`reviewerSessionId` in the same sidecar (created on first use by `host`, re-attached from disk). This
module owns the state + packages: `startTodoReview` (marks the item's in-flight `pending` mark — the
DTO's `reviewing` — and renders `renderReviewPackage`: refs + the worker's summary/verification claims
to VERIFY, a re-review names only the unreviewed delta), `cancelTodoReview` (pre-turn rejection),
`approveTodoReview(…, "agent")` (labeled `reviewedBy`), `recordAgentChangesRequested` (verdict note as
feedback + `autoCycles` — the host's **1-auto-cycle cap**: cycle 0's verdict auto-sends the reviewer's
comments to the worker (autoCycles 1), the fixed revision auto-re-reviews once (trigger requires
autoCycles === 1 + a fresh delta — a sha appended past the watermark, OR the state reading `unreviewed`
because the path-list fallback reset it, itself the delta signal a path-list item has no sha to carry —
see the fallback's autoCycles durability above), and that verdict records autoCycles 2 — terminal, the human decides;
the whole cap is **short-circuited when the `reviewAutoFix` setting is off** — `host/todoReview` then
records the verdict terminally (autoCycles 2) with no send, so findings just wait for the human),
and `workerSessionForReviewer` (the verdict seam's reverse lookup, enumerating sidecars). The reviewer's
findings are **agent-authored review comments** in the reviews module (`author: "agent"`), never a
parallel store; orchestration/sends live in `host/todoReview.ts`. **Reviewer session crash safety:**
when a reviewer session crashes/times out without sending a verdict, `host/reviewerSessionMonitor`
detects the crash (terminal errors, unexpected stop reasons) and immediately clears the item's
`pending` mark (the `reviewing` flag), allowing Review All to resume instead of deadlocking. The
monitor tracks reviewer→worker session mappings (set by `startTodoReview`, checked on every settled
turn in the session publisher hook). **Host-restart safety:** that crash-safety net is itself
memory-only (the mappings reset on process restart), so a `pending` mark from a review still in flight
when the host last stopped would otherwise never clear — `clearAllPendingReviews(root)` sweeps every
session's sidecar under a workspace and drops every `pending` entry unconditionally; `host/todoReview`'s
`reconcilePendingReviewsOnBoot` calls it for every workspace once, at boot, before any client can observe
the stale spinner (see host/SPEC.md). Only the spinner is cleared — the underlying review record, if any,
is untouched. **Review All** (`todo.reviewAll`) is pure host orchestration over
this same flow: `host/reviewQueue.ts` drives a per-(workspace, session) FIFO of the unsettled
reviewable items one at a time, so it adds no state here (see host/SPEC.md).

**The read barrier.** `listTodos` first awaits the workspace's in-flight reconciles
(`settleChangeArtifacts` — the same per-workspace chain). A client's only refresh signal is the `pi.event`
a `todo_*` tool end publishes, and the reconcile is enqueued *synchronously with that publish* but settles
later (it commits) — so without the barrier a commit slower than the client's refetch debounce would hand
back a `done` item with no change set, leaving an open plan page promising an affordance it doesn't show
until some unrelated event. Awaiting makes the read **causally after** the write it was triggered by;
it resolves immediately when nothing is in flight, and never rejects.

## Boundary

- **Owns / public surface (barrel):** `listTodos({workspaceId, sessionId}) → Promise<TodoPlan>` (async
  only for the read barrier above),
  `countOpenTodos({workspaceId, sessionId}) → number` + its pure rule `openTodoCount(plan)` (unfinished =
  any status but `done`, loose + grouped—the `SessionSummary.openTodos` decoration the host's
  `session.list` handler attaches for client history/status presentation; a session with no todo file counts
  0),
  `addTodo(...) → TodoItem` (validates a non-empty title; tags `origin: "user"`),
  `updateTodo(...) → TodoItem` (throws on unknown id → a `{ ok:false }` WS response),
  `removeTodo(...) → { ok:true }` (idempotent; **throws while the item is `pending` an agent review** —
  a removal mid-review would strand `host`'s in-flight registration (`currentReview`, the per-plan
  latch — both memory-only, cleared only by the reviewer session's settle) and let a stray
  `add_review_comment` file a finding against an id that no longer exists; the client disables Remove
  on a `reviewing` row the same way it already disables Start review). This durable check alone only
  covers start→verdict: `review_verdict` clears `pending` mid-turn, before the reviewer session
  settles, so `host/todoReview.ts`'s `todo.remove` handler layers `isItemUnderActiveReview` (reads
  `currentReview` directly) in front of this call — closing the verdict→settle tail the durable mark
  can't see. See host/SPEC.md.),
  `approveTodoReview(...)` / `requestTodoFix(...) → { pkg, previous }` / `rollbackTodoFix(...)` + the
  pure `renderFixPackage` (the review ops; the send itself is `host`'s composition), and the
  `TodoReviewRecord` type. **Mapping only** — no plan logic; `TodoStore` owns disk.
- **Allowed deps:** `workspaces` (worktree-path lookup via `getWorkspace`, which throws on unknown);
  `git` (`gitStatus` — the uncommitted changed-path set + the commit-scope DTO decoration;
  `gitCommitPaths` — the per-done-item delta commit; `gitHeadSha` — the baseline's head);
  `contracts` (DTOs + `PiEvent` for `isTodoToolEnd`); `@thinkrail/shared/paths` (`WORKSPACE_INTERNAL_DIR`
  — the app-state prefix filtered out of change sets); **`pi-todos/core`** (the pi-free read/write model — a sanctioned host-side
  value-import of the extension package, the same pattern as `spec` → `pi-spec-graph/core`); `log`.
- **Forbidden:** `host`; sibling features other than `workspaces` + `git` + `log`; `pi-todos`' extension entry or
  `tools/` (pi-coupled); any pi package.
