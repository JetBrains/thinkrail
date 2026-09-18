---
id: submodule-server-host-plan-review
type: submodule-design
status: active
title: plan review — a hidden delegation subagent, not a reviewer chat
parent: submodule-server-host
depends-on: [submodule-server-host, submodule-server-todos, module-pi-delegation]
references: [submodule-server-todos, submodule-server-reviews, submodule-server-agent]
tags: [v1, host, review]
---

## Responsibility

Review one completed plan step, independently of the agent that wrote it, and turn the outcome into
state: the item's review record, findings in the Review tab, and — when the fix budget allows — a fix
request delivered to the worker chat.

Files: `requestReview.ts` (the flow), `reviewerRole.ts` (the reviewer's prompt + output contract),
`planReviewQueue.ts` (per-plan serialization + per-item claim).

## Why a subagent and not a chat

The first implementation ran the reviewer as a **second visible pi session** pinned per plan, holding
its own tools (`add_review_comment`, `review_verdict`, `reflect_finding`). That shape cost more than it
bought:

- **A session is a lifetime to police.** A reviewer that crashed, aborted, or simply finished its turn
  without calling `review_verdict` left the item's `pending` mark set forever, spinning `Reviewing…` and
  deadlocking Review All. Recovering from that needed a settle tee, a reviewer→worker registry, a
  termination classifier, and a queue that advanced on settles rather than on results
  (`reviewerSessionMonitor`, `reviewQueue`) — roughly 400 lines whose only job was to notice that a
  session had stopped.
- **Tools made the verdict a mid-turn side effect.** `review_verdict` cleared the durable mark while the
  reviewer was still streaming, so every guard downstream had to distinguish "verdict recorded" from
  "turn over", and provenance had to be pinned in a `currentReview` map that could be clobbered by the
  next package.
- **The user never wanted the chat.** Its only affordance was watching the reviewer think.

A delegation child inverts all of it: `runReviewSubagent` returns a **promise**. Completion is the
resolution, failure is a rejection, and the whole recovery surface collapses into one `catch` that calls
`cancelTodoReview`. The reviewer needs no tools of ours — it reads the code with `read`/`grep`/`find`/
`ls`/`bash` and returns a fenced-JSON verdict the host parses and applies.

## Invariants

- **The reviewer runs the user's model with the repository's reviewer profile.** `runReview` resolves the
  child's model as the pinned `reviewModel`, else `getDefaultModel()` (what Review Settings shows as
  “your default model”) — never the worker's silently inherited model. `runReviewSubagent` spawns the child
  with `contextFiles: true` and `extensions: true`, and `REVIEWER_TOOLS` carries `spec_grep`/`spec_get`/
  `spec_graph` alongside `read`/`grep`/`find`/`ls`/`bash`, reproducing the built-in `reviewer` agent's
  context/tool policy so plan review follows repository guidance and can audit invariants. Only the
  system prompt + JSON output contract differ (the host parses the verdict).
- **The host owns the reviewer's role, the package owns only facts.** `reviewerRole.ts` holds the
  system prompt (review order, what counts as a finding, the JSON contract); `todos.renderReviewPackage`
  renders a change-set *reference* and the worker's claims, and names no tool. A package that instructs
  tools the reviewer does not have is a prompt that contradicts itself — the bug this split prevents.
- **Model output is untrusted.** `parseVerdict` is strict on the verdict word and validates every finding
  through contracts' `isPlanReviewResult`: each needs a non-empty `id` + `body`, a `kind` (if present) from
  the known enum, and a coherent positive line range (a line requires a path, an `endLine` requires a
  `startLine`, `endLine >= startLine`) — a malformed location would otherwise throw in `fileFinding`'s
  anchor resolution and drop the finding silently. Cardinality is enforced too: a `request_changes` with no
  finding is rejected (it would strand the worker with nothing to fix), while an `approve` may carry none.
  Any invalid output is a failed review, not a silent approve: the mark is cleared and the item returns to
  unreviewed. `parseVerdict` also **constructs the result explicitly** (verdict/summary/findings only) rather
  than spreading the model object, so a host-only field the model hallucinates — e.g. `blockedByOpenFindings`
  — can never survive to mislead the card; the host sets it solely from its own open-finding check.
- **The `reviewing` mark is set synchronously** at start/enqueue, so the panel pulses the instant the
  client re-reads the plan — before any await.
- **A detached failure is published, not just logged.** `todo.startReview`/`todo.reviewAll` ack the moment
  the review is enqueued; the run then fails on a detached path (provider error, invalid output, abort) with
  no chat of its own to show it. `startPlanReview` clears the `reviewing` mark and calls
  `reviewFailedPublisher` (`ReviewFailedPayload`, broadcast on `review.failed`) so the plan page can raise a
  toast — the panel spec's requirement that the toast carry failure. The payload carries the owning
  `sessionId` so only that plan's view toasts (not every plan in the workspace); split views of one session
  dedupe on the toast body. The awaited tool path needs no publish: it rejects to the worker. Pinned by the
  post-ack failure test in `planReview.test.ts`.
- **`autoCycles` must match what actually happened.** `1` stands only when the worker really accepted the
  fix request; a rejected fix — the send OR any of its preparation steps (snapshot/package/mark) failing —
  or a refused fix latch re-records `2` (terminal), always after rolling the marked findings back to
  `draft`. `deliverFixToWorker` wraps prepare+send in one catch precisely so a preparation failure cannot
  slip out as a throw and leave the optimistic `1` standing. Writing `1` without a delivered request
  strands the item: the auto-re-review trigger waits for a delta that nothing will produce, and a later
  review reads the cycle as already spent. Pinned by the rejected-send and rejected-preparation tests in
  `planReview.test.ts`.
- **An approve is a verdict, not a settlement.** `recordVerdict` settles `reviewed` only when
  `itemOpenFindings` is empty; otherwise it clears the mark, leaves the record, and reports
  `approve-blocked` so the worker is told to resolve what it fixed. Round 2 of a fix cycle is a separate
  run from round 1, so nothing structural stops an approve from landing over an unresolved `sent`
  finding — only this check does.
- **The tool path awaits artifact reconciliation before it snapshots the change set.** `request_review`
  fires immediately after `todo_update`, while `maybeAttachChangeArtifacts` may still be committing the
  step's work. `handleRequestReview` awaits `settleChangeArtifacts` (the same barrier `listTodos` uses)
  before `startTodoReview`, so the reviewer never sees a step with no change set, nor snapshots a
  superseded artifact. The button path needs no such await — the user starts it on an already-reconciled
  plan. Pinned by the held-reconcile ordering test in `planReview.test.ts`.
- **A claim must not outlive the call that took it.** `handleRequestReview` claims the item, so every
  post-claim exit — including `startTodoReview` throwing on a step with no change set — has to run the
  release. Leaking it wedges that step as "already being reviewed" until the host restarts. Both are
  pinned in `planReview.test.ts`.
- **Both entry points share the cap.** The worker's `request_review` tool and the Start review button
  compute the same `canAutoFix`; the tool path reports it in the tool result text, the button path acts
  on it by sending the fix. Without a shared cap the tool path loops fix → review → fix forever.
- **The static tool guidance is policy-neutral; the tool result carries the next action.** `composeText`
  can say either “fix and request_review again” or “do NOT fix now — report to the user” depending on
  `canAutoFix`. So `requestReviewTool`'s description/promptGuidelines must NOT hardcode “always fix and
  re-review” — they tell the worker to follow the tool result's stated next action, so a stronger
  system-level prompt can't override the configured stop.
- **The worker-facing finding identity is the persisted comment, not the model's id.** `fileFinding`
  persists each finding as a new `rc_*` comment; the model's own ids (`f1`…) are transient. On the tool
  path the tool result *is* the delivery, so when the worker is asked to fix (`canAutoFix`), `recordVerdict`
  files and marks those `rc_*` comments `sent` to the invoking session as one `withReviewLock`
  transaction (before spending the cycle) and the result text/card names their canonical ids. Filing and
  marking must be atomic: a concurrent Review clear or a non-draft collision mid-flight would otherwise
  leave open findings whose canonical ids the worker never received, wedging a later approve behind
  drafts it cannot name — so a mark failure deletes the just-filed drafts and rejects the request. Otherwise `resolve_comment` — which only closes a `sent` comment
  assigned to this worker, by its persisted id — can never satisfy the open-finding gate, wedging
  request_changes → fix → approve. The terminal path ("do not fix") leaves them `draft` for the user.
  Pinned by the tool-path finding-identity test in `planReview.test.ts`.
- **One review per plan at a time, one per step ever.** Both entry points serialize on the plan's chain
  (`planReviewQueue.onPlanChain`): the button path via `enqueuePlanReview` (fire-and-forget), the worker's
  `request_review` tool by awaiting `onPlanChain` for its result. The chain keeps Review All — and a tool
  request racing a button review of a different step — from opening two provider streams at once; the
  per-item claim keeps two verdicts from racing onto one record.

## Boundary

- **Owns / public surface:** `startPlanReview(workspaceId, sessionId, itemId, runSubagent?)`,
  `maybeAutoReReview(workspaceId, sessionId)`, `installRequestReviewSeam()`,
  `setReviewFailedPublisher(fn)`, and the pure `parseVerdict` / `composeText`; `planReviewQueue`'s `enqueuePlanReview` / `onPlanChain` / `claimItemReview` /
  `releaseItemReview` / `itemReviewActive` / `planReviewRunning`.
- **Allowed deps:** `agent` (`runReviewSubagent`, `sendReviewFixToSession`, `getSessionWorkspaceId`,
  `notifyExtUi`), `todos`, `reviews`, `settings`, and host siblings `ackSend` / `reviewLock` /
  `todoReview` (the fix latch + finding scoping).
- **Forbidden:** importing `requestReview` from `todoReview` (the dependency runs one way, so
  `planReviewQueue` — which has no imports at all — is where both sides read the in-flight state);
  reaching into `todos/reviews.ts` or `reviews/*` internals past their barrels.
- **Testing:** `planReview.test.ts` injects a stub runner through `startPlanReview`'s last parameter and
  drives the real record → file-findings → deliver path against a faux-model worker session, so the
  verdict semantics are covered with no provider. One integration test omits the stub so the real
  `runReviewSubagent` creates a delegated child (faux model, scripted verdict) and exercises child
  creation → request_changes → canonical finding resolution → re-review → approve end to end.
  `requestReview.test.ts` pins the pure parsing/compose rules.
