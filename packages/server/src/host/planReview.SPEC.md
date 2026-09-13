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

- **The host owns the reviewer's role, the package owns only facts.** `reviewerRole.ts` holds the
  system prompt (review order, what counts as a finding, the JSON contract); `todos.renderReviewPackage`
  renders a change-set *reference* and the worker's claims, and names no tool. A package that instructs
  tools the reviewer does not have is a prompt that contradicts itself — the bug this split prevents.
- **Model output is untrusted.** `parseVerdict` is strict on the verdict word and lenient on findings
  (each needs `id` + `body`; location optional). Unparsable output is a failed review, not a silent
  approve: the mark is cleared and the item returns to unreviewed.
- **The `reviewing` mark is set synchronously** at start/enqueue, so the panel pulses the instant the
  client re-reads the plan — before any await.
- **`autoCycles` must match what actually happened.** `1` stands only when the worker really accepted the
  fix request; a rejected send or a refused fix latch re-records `2` (terminal). Writing `1` without a
  delivered request strands the item: the auto-re-review trigger waits for a delta that nothing will
  produce, and a later review reads the cycle as already spent. Pinned by the rejected-send test in
  `planReview.test.ts`.
- **An approve is a verdict, not a settlement.** `recordVerdict` settles `reviewed` only when
  `itemOpenFindings` is empty; otherwise it clears the mark, leaves the record, and reports
  `approve-blocked` so the worker is told to resolve what it fixed. Round 2 of a fix cycle is a separate
  run from round 1, so nothing structural stops an approve from landing over an unresolved `sent`
  finding — only this check does.
- **A claim must not outlive the call that took it.** `handleRequestReview` claims the item, so every
  post-claim exit — including `startTodoReview` throwing on a step with no change set — has to run the
  release. Leaking it wedges that step as "already being reviewed" until the host restarts. Both are
  pinned in `planReview.test.ts`.
- **Both entry points share the cap.** The worker's `request_review` tool and the Start review button
  compute the same `canAutoFix`; the tool path reports it in the tool result text, the button path acts
  on it by sending the fix. Without a shared cap the tool path loops fix → review → fix forever.
- **One review per plan at a time, one per step ever.** The serial chain keeps Review All from opening N
  provider streams; the per-item claim keeps two verdicts from racing onto one record.

## Boundary

- **Owns / public surface:** `startPlanReview(workspaceId, sessionId, itemId, runSubagent?)`,
  `maybeAutoReReview(workspaceId, sessionId)`, `installRequestReviewSeam()`, and the pure
  `parseVerdict` / `composeText`; `planReviewQueue`'s `enqueuePlanReview` / `claimItemReview` /
  `releaseItemReview` / `itemReviewActive` / `planReviewRunning`.
- **Allowed deps:** `agent` (`runReviewSubagent`, `sendReviewFixToSession`, `getSessionWorkspaceId`,
  `notifyExtUi`), `todos`, `reviews`, `settings`, and host siblings `ackSend` / `reviewLock` /
  `todoReview` (the fix latch + finding scoping).
- **Forbidden:** importing `requestReview` from `todoReview` (the dependency runs one way, so
  `planReviewQueue` — which has no imports at all — is where both sides read the in-flight state);
  reaching into `todos/reviews.ts` or `reviews/*` internals past their barrels.
- **Testing:** `planReview.test.ts` injects a stub runner through `startPlanReview`'s last parameter and
  drives the real record → file-findings → deliver path against a faux-model worker session, so the
  verdict semantics are covered with no provider. `requestReview.test.ts` pins the pure parsing/compose
  rules.
