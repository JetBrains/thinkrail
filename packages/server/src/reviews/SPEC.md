---
id: submodule-server-reviews
type: submodule-design
status: active
title: reviews — draft comments on files/diffs + review sessions
parent: module-server
depends-on: [module-contracts]
references: [task-review-comments]
tags: [v1, review]
---

## Responsibility

The review layer: GitHub-style **draft comments** anchored to a workspace's files and diffs, collected
without starting the agent, then sent — grouped **per file**, each file's comments into that file's one
review chat — as a **structured context package**. Owns the per-workspace review store, anchor
re-anchoring, and package rendering. Design + user-confirmed decisions: [[task-review-comments]].

## Model (mirrors the wire DTOs in `contracts`)

- **One open `Review` per workspace** (auto-created lazily on the first read/comment; `review.close`
  archives it and the next touch starts a fresh one). `Review.fileSessions` pins each review KEY to
  its chat (key → sessionId): one chat per file for the review's life — the file's first send creates
  it, every later send (single or batch) follows up into it. The key is the comment's path, or the
  **empty string** for anchorless whole-change-set remarks, pinned exactly like a file (`reviewSessionKey`)
  so a second overall remark continues that discussion instead of opening a chat nothing can follow up.
  `Review.doneFiles` (same keys) marks files whose review the user FINISHED: a fully-resolved file
  stays in the review until `markFileDone` (wire: `review.fileDone`, rejected while anything is
  unresolved) says "we're done here" — and a new comment on the file clears the mark (`addComment`),
  re-opening it.
  `Review.baseSha` pins **the original side of the reviewed diff** — the branch range's `originalRef`,
  i.e. the **fork point** (`merge-base` of the diff target and `HEAD`) — **to a full commit oid, once, at
  creation**. Not `diffBaseRef`'s tip: the branch diff shows fork-point-vs-worktree (merge-base
  semantics), so a target that advanced past a diverged workspace has a tip carrying upstream commits
  this review never displayed. Deliberately the BRANCH range whatever scope the Changes panel shows — a scope switch must
  not redefine what the review *is* (a comment made in another scope still quotes its own
  `anchor.baseRef`). Immutable for the same reason: the target is re-pointable mid-review and its branch
  can move. It degrades to the raw ref when that wouldn't resolve, so the review surface
  survives an unreadable base instead of vanishing with
  it. `reviewBaseRef` is how `host` reads it.
- **`ReviewComment`**: `kind` inline/diff/file/review; `status` draft → sent → resolved (or
  dismissed). The wire (`review.commentUpdate`) may only land the terminal manual outcomes
  (resolved/dismissed, from draft or sent); `draft`↔`sent` moves are owned exclusively by the send
  path (`markCommentsSent`/`rollbackSend`) — a client that could un-send a comment could rewrite or
  delete a remark whose id an agent chat already quotes;
  `sessionId` links the chat the comment was sent into — its file's review chat. **A comment is a
  record once SENT**: a draft — the user's own unsent scratch — can still be deleted
  (`review.commentDelete`, draft-only, rejected otherwise), but a sent comment is never deleted, and
  the review offers no rollback of worktree changes (the old `git.revertFile` Reject is gone); the way
  to push back on a change is to say so in the comment.
- **`ReviewAnchor` = `path` + `side` + `contentHash` + an ordered `selectors` fallback chain**
  (`lineRange`, `textQuote` with exact/prefix/suffix, `structural` as a V2 slot; the `diffHunk` member
  exists in the union but V1 authors don't populate it — `textQuote` carries re-anchoring). The
  `anchorState` axis (`anchored`/`moved`/`outdated`) is **orthogonal to `status`**: "was it discussed"
  and "is the anchor alive" never overwrite each other.
- **The two diff sides are two anchor spaces.** A `side: "worktree"` anchor is captured from the
  worktree file; a `side: "base"` anchor is captured from the blob the diff's ORIGINAL editor is
  showing — the host resolves it from the tab's `scope` (`resolveDiffRange(...).originalRef`), **pins that ref to a
  full commit oid** (`git.resolveCommitOid`) and stamps it on the anchor as **`baseRef`**, so the fragment
  and its context stay readable — and stay the SAME — for the review's life. The pin is the load-bearing
  part: a scope's `originalRef` is symbolic for `uncommitted` (the literal `HEAD`) and degrades to the raw
  base ref when `merge-base` fails, so storing it verbatim means the user's next commit re-points it and
  the package reads today's content at yesterday's line numbers. A ref that names no commit is refused
  outright rather than anchored to something that moves.
  A base selection is **never translated into worktree line numbers**: the two sides say different
  things at the same numbers, so a remark on a deleted or rewritten line would end up attached to
  whatever now occupies that spot — and *that* is what the send package would show the agent. A base
  anchor whose path isn't in the base at all is rejected up front, never silently re-pointed.

## Re-anchoring (the file changed under a comment)

Recomputed on every snapshot read and before any send (`reanchorWorkspace`), against the worktree:
1. `contentHash` (sha-256 of the file) unchanged → `anchored`.
2. Else search `textQuote.exact` (disambiguated by prefix/suffix) → exactly one match → update
   `lineRange`, state `moved` (silent re-pin). **`moved` is sticky**: the re-pin refreshes the
   anchor's `contentHash`, so the very next pass would otherwise see a hash match and silently
   downgrade it to `anchored` — losing the "drifted since creation" fact the state records.
3. No/ambiguous match or file gone → `outdated`; the comment keeps its creation-time snapshot
   (`textQuote.exact`) so it stays meaningful and sendable (the package marks it outdated).
`side: "base"` anchors are never re-anchored: `baseRef` is a commit oid, so the blob it names is
immutable and there is nothing to drift — and re-anchoring them against the *worktree* would be the very re-pointing the
per-side capture exists to prevent.

## Send flows & the context package

`review.sendComment` / `review.sendBatch` are **composed in `host`'s handlers** (this module never
imports `agent`): reanchor → render the package (one structured user message with stable comment ids,
fragment + surrounding context per comment — never the full diff; the agent reads the worktree with its
own tools; **each side reads its own content** — the worktree for worktree anchors, the anchor's
`baseRef` blob for base ones, since base line numbers index the pre-change file) →
`agent.createSession` (or `followUp` into the client's **last open chat** when the send names one —
the conversation already on the user's screen — else the chat already pinned for that KEY, **re-attached
from disk when it isn't live**, since review state and pi transcripts both survive a host restart; a
batch spanning several keys sends each group separately and answers with all of them, so none is left
running unseen; whatever received the package becomes the key's pin) → `markSent` → prompt. The whole sequence is **serialized per
workspace together with every review mutation** (`host`'s `withReviewLock`): the draft/session check
happens *before* the awaited session creation, so in that gap two concurrent sends would both see
"drafts, no session" and fork the review — and a concurrent `close` would invalidate the package
already built, leaving the agent with comment ids no open review contains.
**The prompt is fired DETACHED** (`fireReviewPrompt`): the handler returns the
moment the session exists so the client opens the chat immediately — awaiting the ack meant sitting
out pi's 10s acceptance window on every send. Because `markSent` runs synchronously (before the turn is
known-accepted — it must, so the key's pin exists inside the lock and a concurrent send can't fork the
chat), a pre-turn rejection (bad model, missing/expired key) both surfaces INSIDE the just-opened chat
as an extension-UI notice AND **rolls the comments back to `draft`** (`rollbackSend`, keyed off
`ackSend`'s accept-vs-reject window): a review the agent never received stays retryable instead of
stranding as `sent` with its send/edit/delete actions gone, and a chat spun up solely for that failed
send is unpinned unless another comment still backs it. A fault AFTER acceptance is a real turn fault
(the package *was* delivered) and rides the event stream, leaving the `sent` state correct. The
rollback runs DETACHED (after the send's lock released) and fully synchronously, so — like
`reanchorWorkspace` — it stays correct unlocked, and it reads with `load` (never `ensureSnapshot`): a
`close`/archive that lands first makes it a clean no-op instead of resurrecting an empty open review. The **`resolve_comment`** capability is an agent-module custom tool
(`agent/reviewTool.ts`, registered on every session like `ask_user_question`) whose execution is
delegated back here through a host-installed seam — the agent module stays dependency-free.

## Boundary

- **Owns:** `reviews/<workspaceId>.json` under the data dir (via `persistence.dataDir`; the id
  becomes the FILENAME, so every file touch refuses ids with path segments — `/^[\w-]+$/` — or a
  wire-supplied `../config`-style string would aim reads/writes/unlinks outside the reviews dir:
  defense in depth behind the handlers' own lookups), comment CRUD +
  status/lifecycle transitions, anchor capture + re-anchoring (pure, unit-tested `anchoring.ts`),
  package rendering (pure `packageRender.ts`), and the `review.changed` publisher seam
  (`setReviewPublisher`, installed by `host` — full-snapshot pushes, idempotent under last-value replay).
- **Public surface (barrel):** `getReviewSnapshot`, `addComment`, `updateComment`, `deleteComment`
  (draft-only), `closeReview`, `markCommentsSent`, `rollbackSend` (undo `markCommentsSent` on a
  pre-turn send rejection), `markFileDone`, `fileReviewSession` + `reviewSessionKey`/`REVIEW_LEVEL_KEY` (the
  per-key chat pin), `resolveCommentFromAgent`, `reanchorWorkspace`, `sendableComments`,
  `buildSendPackage`, `removeWorkspaceReviews`, `setReviewPublisher` (+ the pure
  anchoring/render helpers: `reanchor`, `buildTextQuote`, `hashContent`, `lineRangeOf`, `textQuoteOf`,
  `renderPackage`).
- **Allowed deps:** `contracts` (types), `persistence` (data dir), `workspaces` (worktree path lookup),
  `git` (the review's `baseSha` resolve, the diff range behind a base anchor's `baseRef`, and blob
  reads for the base side), Node `fs`/`crypto`.
- **Forbidden:** importing `host`/`agent` or any pi package; publishing except through the seam.

## Get right

- **Statuses converge via the push, never optimism** — every mutation (UI edit, agent resolve, a
  reanchor that changed states) emits one full `review.changed` snapshot; clients fold it.
- Sends **re-anchor first**, so the package's line numbers are true at send time — and are **serialized
  per workspace with every mutation**, so nothing can close or re-send out from under a
  check-then-mark. A package that quotes a comment id is a promise the id still exists.
- **A fragment is read from the side it was captured on.** Base anchors never read the worktree, and
  worktree anchors never read a blob: showing the agent the wrong side is indistinguishable, from its
  point of view, from the user having said something wrong. A base anchor also carries the **`scope`**
  it was captured in (next to the resolved `baseRef`) — the diff identity the Review sidebar reopens
  that remark's own surface by (see `panels/SPEC.md`).
- **Persistence never loses a review to a damaged file.** Writes are **atomic** (temp file + rename, so
  a host killed mid-write can't leave a truncated review), and the read treats **only `ENOENT`** as "no
  review": a file that doesn't parse — or that can't be read at all — **throws** and is left on disk,
  because the one caller acting on "absent" (`ensureSnapshot`) responds by writing a fresh empty review
  over it. The failure surfaces on `review.get` (the panel says so) instead of silently discarding every
  comment. The one exception is the cross-workspace scan behind an agent resolve: a damaged *sibling*
  is logged and skipped, never allowed to fail a resolve belonging to a healthy review.
- An **unknown/duplicate agent resolve fails loud** (error text back to the model), never silently.
- Workspace removal purges the review file (`removeWorkspaceReviews`, called by the archive handler).
