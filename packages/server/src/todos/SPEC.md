---
id: submodule-server-todos
type: submodule-design
status: active
title: todos — a chat's per-session TODO plan (read/write)
parent: module-server
depends-on: [module-contracts, submodule-server-git, submodule-server-assist]
references: [module-pi-todos, submodule-server-pr, submodule-web-chat]
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
index mid-commit. Every `maybeAttachChangeArtifacts` call first inspects the fresh plan and synchronously
captures any newly `in_progress` window **before enqueueing**; that stays true when an older reconcile
already occupies the queue or a done item precedes the active one. The queued pass never opens a missing
window in production — missing means capture failed, so later completion degrades to the no-baseline
path-list fallback rather than excluding work from a late baseline. The
whole path is best-effort and never throws into the event stream. The same chain serializes **every host
plan/sidecar writer** — the UI's `todo.add` / `todo.update` / `todo.remove` and `session.delete`'s window
removal enqueue behind any in-flight reconcile (`enqueueTodoMutation`) — because a reconcile reads plan +
baselines, awaits git, and ends with a whole-map baseline write: an unqueued removal landing inside that
window would be resurrected by the stale write, exactly the permanent-orphan case below. Agent-side
`todo_*` plan writes can't be queued (they happen inside pi), so a reconcile fingerprints both the plan
and persisted baseline sidecar it read and re-checks the authoritative fingerprint before each
corresponding write. Drift aborts that stale pass before it can open a too-late baseline, commit a
reopened item, erase an externally captured/shared window, or overwrite newer artifacts; the
agent tool's already-enqueued follow-up reconcile operates on the new plan. Each successfully reconciled
item checkpoints its baseline add/drop before the loop can await Git for the next item, so later drift
cannot roll back an earlier item's completed window.

On `in_progress` it **opens the item's work window**: a baseline of the worktree's **uncommitted**
changed-path set + the current `HEAD` sha, captured through the git module's deliberately synchronous
`gitUncommittedPaths` leaf before the tool-end publisher returns, then **persisted** in a host-owned sidecar next to the todos JSON
(`.thinkrail/context/todos/<sessionId>.baselines.json`, read-modify-write like the store) — so a host
restart mid-item changes nothing; `head` is the range base for **in-window commit adoption** (below).
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
  work, never "everything currently dirty" — `--no-verify` (the commit must not run/fail the
  user's hooks; author/committer stay the user's own config — it's their branch). It
  preserves the user's index across any failure (see [[submodule-server-git]]). The item gets **one
  `commit` artifact** (the sha, `label` = the item title) and **nothing else**: the commit is
  self-sufficient — its file list is *derived*, never denormalized into the JSON (see the `listTodos`
  decoration below).
- **Adopt in-window commits.** The host is the intended sole committer during an item's window (the
  worker subagent's prompt forbids it from committing — [[module-pi-subagents]]), but that is guidance,
  not enforcement, and the user may hand-commit too. So before the delta commit, any commit that landed
  in `base.head..HEAD` while the item was open (`git.listCommitsSince`) and is owned by no plan item is
  **attached to the item as a `commit` artifact** — oldest-first, ahead of the delta commit, so the
  step's revision history reads chronologically. Without this a subagent that commits its own work
  empties the delta at `done` — the step would show no change set and the work would leak to
  `adoptedCommits` (below) as an orphan. Adoption rides the **same exclusive-window gate** as the delta
  commit (gate 3: never `shared`, no other chat mid-work), needs a recorded `base.head`, **and requires
  the item's to be the sole same-session window in the pass**. The sole-window rule is load-bearing: the
  range is `base.head..HEAD`, so on a linear branch an *earlier* item's range is a **superset** of a
  *later* item's window — if a done item reconciled while another same-session window was open (its own
  done-pass deferred behind the per-workspace queue while the next item started and its subagent
  committed), a naive `base.head..HEAD` would let the earlier item greedily claim the later item's
  commits (the `owned` dedup only stops the *same* sha being claimed twice, not this cross-window
  over-reach). So when a second same-session window exists the item adopts **nothing** and those commits
  degrade to the safe `adoptedCommits` fallback — the pre-existing behavior, never a mis-attribution.
  Adoption does **not** need gate 2 (foreign *uncommitted* dirt), which governs the delta commit alone.
  An `owned` sha set across the pass additionally prevents a commit already owned by any item (e.g. a
  redo's prior commit) from being re-adopted.
- **The message is a single subject line the user can push unedited.** These commits land on the user's
  own branch, in the same history as their hand-written ones, and the branch ships straight to a PR
  ([[submodule-server-pr]] pushes it) — so anything the user would have to reword before pushing is a
  defect. The subject is the item's agent-authored **`commitSubject`** (see [[module-pi-todos]]: written
  at `done` in the *host repository's* commit style, which the agent reads off `git log`), falling back
  to the item `title` when absent. Nothing else: **no `todo:` prefix and no body/trailer.** An earlier
  version wrote `todo: <title>` plus a `ThinkRail-Todo: <sessionId>/<todoId>` trailer; both are gone.
  The prefix + a plan-step title read as a foreign artifact in a Conventional-Commits history (this
  repo's own `todo: Get design sign-off, promote decisions into apps/website/SPEC.md` is the
  specimen), and the trailer was **write-only** — item↔commit attribution is the `commit` artifact's
  `sha`, nothing ever parsed the trailer back, so it bought only a leaked internal session UUID in
  public history. The `CommitWindow` seam is correspondingly `{ subject, paths }`: choosing the
  subject is the reconcile's job, and the git leaf only commits.
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
  are replaced (a live delta has no history to keep). A redo whose fresh attachment includes **any**
  path-list `change` **drops the item's review record** (→ `unreviewed`): a live-path delta can't be
  watermarked by sha and `reviewInfo` derives `unreviewedShas` from commits only, so a `change` riding
  alongside adopted commits would be invisible to review state (a covered sha set could read fully
  reviewed while the path delta went unseen) — so "review only the new delta" honestly degrades to
  reviewing the change set afresh. The record is **kept only when the fresh attachment is entirely
  SHA-backed** (pure in-window commit adoption, no leftover path-list): the adopted shas are
  watermarkable, so the `unreviewedShas` delta flags them without discarding the prior verdict. The **auto-cycle
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
[[module-pi-todos]]). Known limitations (accepted): an agent that commits *itself* mid-item is handled by
in-window commit adoption above (its commits attach to the step) **only for an exclusive, sole window
with a recorded `base.head`** — a shared window, a missing baseline, an unborn-HEAD baseline, or a second
same-session window open in the same pass still leaves those commits as orphan `adoptedCommits`; and a writer this mechanism cannot see — the user editing
through a terminal or an external editor mid-window, or a chat with no plan at all — is indistinguishable
from agent work in `git status`, so its uncommitted edits can land in the item's delta commit **and its
commits can be adopted into the step** (the app's own editor is read-only, and anything already dirty when
the window opened is caught by gate 2).

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

**`listTodos` decoration — adopted commits (the committed remainder).** `unattributed` only covers
*uncommitted* rows; the moment work is committed it leaves the uncommitted set and would vanish from the
review map entirely (an empty-plan chat whose agent committed via bash, a user's hand commit, the
host's own todo-commits for a plan that was since cleared). So the same pass also ships
**`TodoPlan.adoptedCommits`** (present only when non-empty): every `base..HEAD` commit
(`git.listCommits`) whose sha is owned by **no** item's `commit` artifact, surfaced as a **wire-only
`done` `TodoItem`** — `id: "commit:<sha>"`, `origin: "adopted"`, `title` = the commit subject, a single
`commit` artifact decorated with the same per-sha `files` list, and the `review` decoration read from the
sidecar keyed by that id. These items are **never written to the store** — the agent's plan JSON stays
the agent's plan (the invariant), and `"adopted"` never reaches `pi-todos`; they are recomputed on every
read. Lifecycle is free: `commit:<sha>` is stable, a rebased-away commit's id simply vanishes (its
sidecar record goes inert, as any orphan does), and a loose commit later claimed by a real item drops out
automatically (now owned). A commit owned by *another* session's plan item appears here too — accepted
noise, same family as the shared-window limitations. Derived best-effort; a git failure omits the field.

**Adopted commits are reviewable without a store item.** The review ops resolve their target through
`reviewableItem`, which first reads the `TodoStore` and, on a miss, reconstructs a synthetic `StoredItem`
for an adopted `commit:<sha>` id — but **only after re-validating the exact set the derivation emits**:
`git.resolveListedCommit` resolves the sha to its **canonical OID** and confirms membership in the **same
capped `base..HEAD` list `listCommits` emits** (shared `COMMIT_LIST_MAX` — so a commit past the newest
200, for which no adopted item is ever emitted, is not reviewable either), the requested id must equal
`commit:<canonical-oid>` (the exact form `listTodos` emits — an abbreviated or non-canonical id is
rejected, so review state can never be written under an id no adopted item will ever carry), **and** the
canonical sha must be owned by no plan item. An id that fell out of the set — rebased into the base, GC'd,
abbreviated, past the cap, or since claimed by a step — is rejected (`No TODO with id`), so a stale Plan
action can never start/approve/fix review state against a commit that vanishes on the next reload.
Every op (`startTodoReview`,
`approveTodoReview`, `cancelTodoReview`, `requestTodoFix`, `recordAgentChangesRequested`,
`renderReviewPackage`) therefore drives Start-review / Review All / verdicts over an adopted commit with
**zero store writes**; review state persists in the existing sidecar keyed by `commit:<sha>`, and each
finding carries its origin plan session + item id (`{ todoId, sessionId }`) — the reviewer is a hidden
delegation child of that plan session, so routing needs no reviewer-session identity and works whether or
not a stored item exists. The fix
package's "re-open this exact item" instruction has no todo to re-open for an adopted commit, so it reads
as "revise the change in commit `<sha>`"; the worker's follow-up commit surfaces as a new adopted entry
(or a revision, once appended).

**Adopted-commit limitations (accepted).** (1) The `base..HEAD` enumeration is capped at `git`'s
`COMMIT_LIST_MAX` (200) — a branch with more commits drops the oldest from `adoptedCommits`, the same cap
the Changes/commits menus live under. (2) A commit is immutable, so the auto-fix cycle cannot self-heal
one: an agent `changes_requested` verdict on an adopted commit leaves it permanently flagged and the
worker's fix lands as a *new* adopted entry rather than a revision of the original (and `maybeAutoReReview`
intentionally excludes `adoptedCommits` — a new sha is a new id, so there is no fresh delta on the flagged
one to re-review). (3) A commit owned by *another* session's plan item shows as adopted here (the `owned`
set is this session's plan only), and each session may hold its own review record for the same sha —
accepted noise, same family as the shared-window limitations. (4) A path committed in an adopted commit
that is then re-edited uncommitted appears in both `adoptedCommits` (the commit's files) and
`unattributed` (the newer uncommitted row) — they are genuinely two different artifacts.

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

- **`generateTodoSummary` (`todo.generateSummary`)** is the host's best-effort fallback for that note: when
  a plan is **fully done but carries no `summary`**, the client asks the host to draft one. It returns an
  existing agent note untouched, `null` when the plan isn't complete or the draft fails, else the freshly
  drafted note. The slow model call (`assist.suggestPlanSummary` over the done steps' title/summary/
  verification) runs OUTSIDE the write lock; the final re-check + `setSummary` runs inside
  `enqueueTodoMutation` and never clobbers a note that landed meanwhile or a plan that re-opened, with one
  in-flight generation per session. It never overwrites the agent's own `todo_plan_summary`.

- **`approveTodoReview`** records `reviewed` + the watermark — the pending mark's start-time shas when
  an agent review is in flight, else the current shas (throws on unknown or non-reviewable ids →
  `{ ok:false }` on the wire).
- **`requestTodoFix`** records `changes_requested` + the feedback + the watermark and renders the
  **fix package** (`renderFixPackage`, pure): the original step (title/note), its completion summary, the
  change-set *reference* (short shas / paths — never the full diff; the agent reads content with its own
  tools), the feedback verbatim, and the instruction to re-open **this exact item** — the revision must
  attach to the step it revises (the todos skill mirrors this from the agent's side). The **send is
  composed in `host`** (this module never imports `agent`): the host delivers it as a structured
  `todo-review-fix` custom message (`sendReviewFixToSession`) into the item's **own chat** (per-session
  plan/windows force it) — the rendered package is the message `content` the agent reads, and
  `ReviewFixDetails` (`buildReviewFixDetails`, exported from `reviews/`) rides as `details` for the chat
  card; fired detached with the review-send pattern — a pre-turn rejection
  calls **`rollbackTodoFix`** (restores the record the request replaced) and surfaces in the chat, so an
  undelivered fix request never strands as `changes_requested`. Manual requests carry an opaque
  `requestId`; compensation restores the previous record only while that exact request is still current,
  so a delayed send failure cannot erase a newer verdict or retry.

**The agent reviewer ([[submodule-server-reviews]] is the findings' home).** `todo.startReview` and the
worker's own `request_review` tool put a reviewable item in front of a **hidden, ephemeral review
subagent** — a delegation child of the plan session carrying the host's reviewer role
([[submodule-server-host]] owns the prompt + output contract). There is no reviewer chat and no pinned
reviewer session: nothing here stores a `reviewerSessionId`, and the reviewer holds no tools of this
module's. This module owns the state + packages: `startTodoReview` (marks the item's in-flight `pending`
mark — the DTO's `reviewing` — and renders `renderReviewPackage`: a change-set **reference** plus the
worker's summary/verification claims to VERIFY, a re-review naming only the unreviewed delta; it names
no tools, because the reviewer's role and output contract are the host's, not the package's),
`cancelTodoReview` (the review failed or returned no parsable verdict), `approveTodoReview(…, "agent")`
(labeled `reviewedBy`), and `recordAgentChangesRequested` (verdict note as feedback + `autoCycles`). The
last two mutate three things at once — the item's record, its `autoCycles` count, and its `pending`
clear — so they persist all three as ONE snapshot write (`commitReviewTransition`), never a sequence: a
partial failure between writes could otherwise strand an item `changes_requested` at a spent cycle with
its pending mark still set, which no cancel would undo. The auto-cycle mechanics — the
host's **1-auto-cycle cap**: cycle 0's verdict auto-sends the reviewer's findings to the worker
(autoCycles 1), the fixed revision auto-re-reviews once (trigger requires autoCycles === 1 + a fresh
delta — a sha appended past the watermark, OR the state reading `unreviewed` because the path-list
fallback reset it, itself the delta signal a path-list item has no sha to carry — see the fallback's
autoCycles durability above), and that verdict records autoCycles 2 — terminal, the human decides; the
cap is **short-circuited when the `reviewAutoFix` setting is off** — `host/requestReview` then records
the verdict terminally (autoCycles 2) with no send, so findings just wait for the human). The reviewer's
findings are **agent-authored review comments** in the reviews module (`author: "agent"`), never a
parallel store; orchestration/sends live in `host/requestReview.ts`. **Host-restart safety:** the
in-flight bookkeeping is memory-only, so a `pending` mark from a review still running when the host last
stopped would otherwise never clear — `clearAllPendingReviews(root)` sweeps every session's sidecar under
a workspace and drops every `pending` entry unconditionally; `host/todoReview`'s
`reconcilePendingReviewsOnBoot` calls it for every workspace once, at boot, before any client can observe
the stale spinner (see host/SPEC.md). Only the spinner is cleared — the underlying review record, if any,
is untouched. **Review All** (`todo.reviewAll`) is pure host orchestration over this same flow: it starts
every unsettled reviewable item on the plan's serial chain (`host/planReviewQueue.ts`), so it adds no
state here (see host/SPEC.md).

**The read barrier.** `listTodos` first awaits the workspace's in-flight reconciles
(`settleChangeArtifacts` — the same per-workspace chain). A client's only refresh signal is the `pi.event`
a `todo_*` tool end publishes, and the reconcile is enqueued *synchronously with that publish* but settles
later (it commits) — so without the barrier a commit slower than the client's refetch debounce would hand
back a `done` item with no change set, leaving an open plan page promising an affordance it doesn't show
until some unrelated event. Awaiting makes the read **causally after** the write it was triggered by;
it resolves immediately when nothing is in flight, and never rejects. The barrier follows any newer
workspace queue tail installed while it waits, so a stale pass aborted by plan drift cannot release readers
before the already-enqueued replacement pass has reconciled the current plan.

## Boundary

- **Owns / public surface (barrel):** `listTodos({workspaceId, sessionId}) → Promise<TodoPlan>` (async
  only for the read barrier above),
  `countOpenTodos({workspaceId, sessionId}) → number` + its pure rule `openTodoCount(plan)` (unfinished =
  any status but `done`, loose + grouped—the `SessionSummary.openTodos` decoration the host's
  `session.list` handler attaches for client history/status presentation; a session with no todo file counts
  0),
  `addTodo(...) → TodoItem` (validates a non-empty title; tags `origin: "user"`),
  `updateTodo(...) → TodoItem` (throws on unknown id → a `{ ok:false }` WS response),
  `removeTodo(...) → Promise<{ ok:true }>` (idempotent; enqueued on the per-workspace reconcile chain —
  see the sidecar-writer serialization above — as is `removeSessionTodoWindows`;
  **throws while the item is `pending` an agent review** —
  a removal mid-review would strand `host`'s in-flight bookkeeping (the per-item review claim and the
  fix latch, both memory-only) and let the verdict file findings against an id that no longer exists;
  the client disables Remove on a `reviewing` row the same way it already disables Start review). This
  durable check alone only covers start→verdict: the verdict clears `pending` while the fix delivery it
  triggers is still in flight, so `host/todoReview.ts`'s `todo.remove` handler layers
  `isItemUnderActiveReview` (the in-memory latches) in front of this call — closing the verdict→delivery
  tail the durable mark can't see. See host/SPEC.md.),
  `approveTodoReview(...)` / `requestTodoFix(...) → { pkg, previous }` / `rollbackTodoFix(...)` + the
  pure `renderFixPackage` (the review ops; the send itself is `host`'s composition), and the
  `TodoReviewRecord` type. **Mapping only** — no plan logic; `TodoStore` owns disk.
- **Allowed deps:** `workspaces` (worktree-path lookup via `getWorkspace`, which throws on unknown);
  `git` (`gitStatus` — the uncommitted changed-path set + the commit-scope DTO decoration;
  `gitCommitPaths` — the per-done-item delta commit; `gitHeadSha` — the baseline's head;
  `listCommits` — the `base..HEAD` enumeration behind `adoptedCommits` + the review resolver's
  synthetic-item reconstruction);
  `contracts` (DTOs + `PiEvent` for `isTodoToolEnd`); `@thinkrail/shared/paths` (`WORKSPACE_INTERNAL_DIR`
  — the app-state prefix filtered out of change sets); **`pi-todos/core`** (the pi-free read/write model — a sanctioned host-side
  value-import of the extension package, the same pattern as `spec` → `pi-spec-graph/core`); `log`.
- **Forbidden:** `host`; sibling features other than `workspaces` + `git` + `log`; `pi-todos`' extension entry or
  `tools/` (pi-coupled); any pi package.
