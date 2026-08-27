---
id: submodule-server-host-reviewer-monitor
type: submodule-design
status: active
title: reviewerSessionMonitor — auto-cleanup for stuck reviewer sessions
parent: submodule-server-host
depends-on: [submodule-server-host, submodule-server-todos]
references: [submodule-server-todos, submodule-server-reviews]
tags: [v1, host, review-safety]
---

## Responsibility

Detect and recover from reviewer session crashes that would otherwise leave the `reviewing` flag set
permanently, deadlocking the Review All queue. When a reviewer session crashes/times out without
sending a verdict, this monitor clears the item's `pending` review mark immediately, unblocking the
UI spinner and allowing Review All to resume.

The monitor operates as a **session-settlement tee**: every time a session settles (terminal
settlement, not intermediate turns), we check if it's a registered reviewer session with a crash
signature, and if so, clean up the pending flags it left behind.

## The problem it solves

**Before this monitor:**
- `startTodoReviewFlow()` sets `pending[id]` to mark the item as `reviewing: true` (UI spinner)
- Reviewer session starts and streams its work
- If the reviewer crashes (network timeout, model error, provider outage), the session never sends
  a `review_verdict` tool call
- No mechanism detects the crash; `pending[id]` persists indefinitely
- `reviewing: true` flag stays forever, UI shows "Reviewing..." eternally
- Review All queue blocks: `startReviewAllFlow` filters out items with `reviewing === true`, so
  subsequent items never get a chance
- User is stuck; manual workaround needed

**After this monitor:**
- Reviewer session crashes with no verdict → caught by `maybeCleanupStuckReviewSession`
- cleanup is GATED on stuck `pending` flags; `reviewerTermination` (pinned pi `StopReason` union) only picks the notice
- `onReviewerSessionTerminated` immediately calls `clearReviewPending(id)` for the item
- UI spinner vanishes, Review All queue advances to next item
- User notified with an error toast; can retry the review

## Design

The monitor tracks a **reviewer→worker session mapping** — which reviewer session is attached to
which plan:

```typescript
const reviewerToWorker = Map<reviewerSessionId, { workspaceId, sessionId: workerSessionId }>
```

**Lifecycle:**
1. **Register:** `startTodoReviewFlow()` calls `setReviewerSessionWorkspaceMapping(reviewerId, workspaceId, workerId)`
2. **Monitor:** Every settled turn, `maybeCleanupStuckReviewSession()` checks if this settled session
   is a registered reviewer in our map
3. **Stuck check — gated on pending flags, not on the stop reason:** a settled turn means the
   automatic work is over (`agent_settled` is the settlement invariant), so if the worker's review
   meta still has `pending` entries, NO verdict is coming for them — regardless of how the turn
   ended. A reviewer that settles with `pending` empty (the verdict landed mid-turn) is a no-op.
   `reviewerTermination(terminal)` only picks the NOTICE, classified against pi-ai's pinned
   `StopReason` union (`pending | stop | length | toolUse | error | aborted | deferred` — NOT
   Anthropic's `endTurn`/`contentFilter` vocabulary, which this protocol never emits; matching those
   once classified every normal `stop` as a crash):
   - `terminal.errorMessage`, `stopReason "error"` / `"length"` → `"crashed"` (error notice)
   - `stopReason "aborted"` (user stopped the reviewer) → `"aborted"` (info notice)
   - anything else, including a null settlement → `"no-verdict"` (warning notice — the model
     finished its turn without ever calling review_verdict; before this arm the original deadlock
     survived exactly here)
4. **Cleanup:** `maybeCleanupStuckReviewSession` clears `pending[id]` for every stuck item, notifies
   the user, removes the mapping, and RETURNS `{ workspaceId, sessionId, itemIds }` — the caller
   (`todoReview.maybeCleanupCrashedReviewSession`) then advances the Review All queue past each
   cleared item via `onReviewStartFailed` and drops the session's `currentReview` stamp. Clearing
   the persisted spinner alone is NOT recovery: `queue.current` would stay occupied, every later
   Review All would return `alreadyRunning`, and the pass would never resume.

**Why separate check functions:**
- `reviewerTermination()` — pure, typed (`AgentSettlement | null`) notice picker, unit-covered for
  every pinned stop reason
- `onReviewerSessionTerminated()` — orchestration + side effects (file I/O, notifications)
- `maybeCleanupStuckReviewSession()` — the entry point called from the session-publisher hook

## Termination notices

Cleanup fires for ANY settlement that leaves `pending` entries (see above); the settlement only
picks the notice:

| Condition | Notice |
|-----------|--------|
| `terminal.errorMessage` present | error — "Review session crashed …" |
| `stopReason === "error"` | error — crashed |
| `stopReason === "length"` | error — crashed (token limit; a verdict can't arrive) |
| `stopReason === "aborted"` | info — user stopped the reviewer themselves |
| anything else / `null` | warning — reviewer finished without a verdict |

An unlisted future stop reason degrades to the no-verdict warning — the pending-gated cleanup still
runs, so no new value can resurrect the stuck-spinner deadlock.

## Integration points

### 1. Registration: `todoReview.ts` — `startTodoReviewFlow()`

When starting a reviewer session, register its mapping:

```typescript
const reviewerSessionId = created.sessionId;
setReviewerSessionWorkspaceMapping(reviewerSessionId, p.workspaceId, p.sessionId);
```

### 2. Detection: `server.ts` — session-publisher hook

Tee the cleanup handler into the settled-turn hook, before advancing Review All:

```typescript
if (isSettledTurn(payload.event)) {
  maybeCleanupCrashedReviewSession(payload.sessionId, payload.event);  // NEW
  maybeAdvanceReviewAll(payload.sessionId);                           // existing
  maybeResumeReflection(payload.sessionId);                           // existing
}
```

### 3. Unregistration (implicit)

When the reviewer session is no longer needed (Review All pass ends, workspace closes), the mapping
naturally decays — it's only consulted on settled turns. No explicit cleanup is needed because:
- If the session lives, its final settled turn will check the mapping (harmless no-op if no pending)
- If the session is gone, the next settled turn of *another* session won't find it in the map
- Mappings are ephemeral (in-memory only, lost on host restart)

## Edge cases

**Reflector crash:**
Reflectors are transient sessions created per fix cycle. They don't use this monitor (they're not
registered in `reviewerToWorker`). Instead, their crash is detected by `maybeResumeReflection()`
which is called on *every* settled turn — it finds the pending fix by reflector sessionId
(`pendingFix.get(settledSessionId)`) and if there's no verdict data yet, it sends the fix unreflected.
This is the existing pattern and works well.

**Multiple pending items:**
If a reviewer session was only checking item A, that's the one in `pending[id]`. If the same
reviewer is reused for item B (Review All pass), then `currentReview.set()` tracks the current
item, and `pending` is updated. A crash clears *all* `pending[id]` for that session, which is safe
because the session has crashed and nothing more will come from it.

**Concurrent Review All passes:**
`startReviewAllFlow` claims the slot synchronously before its first await: `if (!claimReviewQueue(...))
return { alreadyRunning: true }` — a second concurrent press can't race past a check-only guard while
the first is still loading the plan. Only one pass per (workspace, worker session) can run. So there's
exactly one in-flight item per reviewer at a time.

## Testing

The monitor itself is synchronous and best-effort:
- All logic is in `reviewerSessionMonitor.ts` (pure functions `reviewerTermination`, orchestration
  `onReviewerSessionTerminated`, entry point `maybeCleanupStuckReviewSession`)
- Integration is in `server.ts` (one line in the settled-turn hook) and `todoReview.ts` (one line
  per reviewer start)
- Unit tests of the crash-detection logic can be added if needed; the integration is thin and
  covered by e2e tests

## Boundary

- **Owns / public surface:**
  - `setReviewerSessionWorkspaceMapping(reviewerId, workspaceId, workerId)` — register a reviewer
  - `maybeCleanupStuckReviewSession(sessionId, event)` — check & cleanup (called from host hook)
- **Allowed deps:** `agent` (`getSessionWorkspaceId`, `notifyExtUi`); `todos` (`clearReviewPending`,
  `readReviewMeta`, `workerSessionForReviewer` — all through the barrel, never `todos/reviews` directly);
  `workspaces` (`getWorkspace`)
- **Forbidden:** feature modules other than those above; `pi` packages
