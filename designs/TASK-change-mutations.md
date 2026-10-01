---
id: task-change-mutations
type: task-spec
status: draft
title: Change mutations — host-owned revert of a hunk or file, undo receipts, ask-the-agent on a hunk, resource metadata
parent: module-server
depends-on: [module-contracts, submodule-server-git]
references: [task-review-surface, submodule-server-reviews, submodule-server-fs, submodule-web-panels]
tags: [review, git]
---

# Change mutations — host-owned revert, undo receipts, ask-the-agent, resource metadata

## Summary

The write-path of the review surface, as decided with the user (2026-10-01): **revert a hunk or a whole
file's change in the worktree** and **ask the agent to fix a hunk**. Plus the read-side metadata the
renderer registry ([[task-review-surface]]) needs for byte-only resources. Not part of this work:
stage/unstage, edit-in-diff, conflict resolution.

Principles (from the platform review): **git and the worktree are the authority; the client never
sends content to write.** A mutation names *what the user saw* (sides + ranges + hashes) and the host
re-derives the change from its own reads, applies it under a per-workspace lock, and answers with a
receipt that is also the undo token. Every destructive step is compare-and-swap guarded, so a view
that went stale (the agent wrote the file) fails loudly instead of clobbering.

## The contract

### A. Wire (`contracts`, additive, pinned by `CHANGE_MUTATIONS_PROTOCOL_VERSION`)

```ts
/** 1-based inclusive line span; `count: 0` names an insertion point before `start`. */
export interface LineSpan { start: number; count: number }

export type RevertTarget =
  | { kind: "file" }                                              // the whole change of `path` in `scope`
  | { kind: "range"; original: LineSpan; modified: LineSpan };   // one hunk as the renderer's diff computed it

export interface ChangeReceipt {
  id: string;                      // ulid; also the undo token
  workspaceId: string;
  path: string;
  kind: "revert" | "undo";
  at: number;
  before: { hash: string | null; byteLength: number | null };   // null = file absent
  after:  { hash: string | null; byteLength: number | null };
  trashed?: string;                // absolute path moved to the trash (whole-file revert of an untracked file)
}

"change.revert": {
  params: {
    workspaceId: string; path: string; scope: GitDiffScope;
    target: RevertTarget;
    expect: { originalHash: string | null; modifiedHash: string | null };  // sha-256 of the two sides the client rendered
  };
  result: { receipt: ChangeReceipt };
};
"change.undo": {
  params: { workspaceId: string; receiptId: string; expect: { modifiedHash: string | null } };
  result: { receipt: ChangeReceipt };
};

// Error codes (`WsErrorCode`, additive)
"STALE_VIEW"       // an `expect` hash does not match the host's current read → client re-reads and re-offers
"SCOPE_IMMUTABLE"  // the scope's modified side is not the worktree (commit scope) → nothing to revert
"RANGE_INVALID"    // a span lies outside the side it names, or the file is byte-only and target is a range
"RECEIPT_UNKNOWN"  // undo of a receipt the host no longer holds
```

- `scope` is resolved **once, on the host**, through `resolveDiffRange` — the single definition of what
  "the diff" is. Only ranges whose modified side is the worktree (`branch`, `uncommitted`, `pinned`) are
  mutable; `commit` is rejected with `SCOPE_IMMUTABLE`.
- **Hunk identity is engine-neutral.** Monaco's and Pierre's diff algorithms split hunks differently, so
  the wire carries *line spans on both sides*, not a `@@` header or patch text. The host does not need
  git's notion of the hunk: a `range` revert replaces modified lines `modified.start..+count` with
  original lines `original.start..+count`, both read by the host (`readBlobAt(originalRef, path)` and the
  worktree file). Validity of the spans is checked against *those* reads, never trusted.
- **CAS on both sides.** `expect.modifiedHash` must equal the hash of the worktree file as the host reads
  it inside the lock; `expect.originalHash` must equal the hash of the original side (`pinned`/`branch`
  originals are commit-addressed and effectively immutable, `uncommitted`'s `HEAD` is not — a commit made
  since the diff was rendered changes what "revert" would restore, so it is a stale view too). Either
  mismatch → `STALE_VIEW`, no write.
- **Line endings and trailing newline are preserved from the side the lines come from**: a restored
  original span carries its own EOLs; the worktree's final-newline state is kept unless the span is the
  last lines of the file, in which case the original's final-newline state wins (what the user saw as
  "the base").

### B. Host module `packages/server/src/changes/` (new, `submodule-server-changes`)

- **Owns:** `revertChange(workspaceId, params)` and `undoChange(workspaceId, params)` — load→verify→
  write passes that run **synchronously after their git awaits**, like the `reviews` module's snapshot
  passes; the in-memory **receipt ring** per workspace (newest 20; undo consumes its receipt and emits an
  `undo` receipt that is itself undoable once — redo); the whole-file semantics table below.
- **Whole-file revert** by the file's status in the scope:
  - modified → write the original blob (bytes, so binary files are covered);
  - added (tracked at `HEAD`/base: absent in original) → **move to the trash** through the existing trash
    helper (promoted from `agent/trash.ts` to its own leaf module `packages/server/src/trash/`, since
    two features now need it) — never `unlink`; `receipt.trashed` records where;
  - untracked → same as added;
  - deleted (absent in worktree) → restore the original blob.
- **Range revert** is text-only (`RANGE_INVALID` for byte-only resources) and never changes the file's
  existence.
- **Writes are atomic** (temp file in the same directory + rename, mode preserved) and path-contained
  through `fs`'s `resolveWorktreeFile`. The `.git` directory and symlinks escaping the worktree are
  refused by that resolver already.
- **Serialization:** `host` runs every `change.*` request under a **per-workspace change lock**
  (same shape as `withReviewLock`; a separate chain, because reviews and changes are independent
  resources). The agent is *not* paused: CAS is the protection, and the fs watcher's `fsChanged` tick
  re-reads the open tabs after the write exactly as it does after an agent edit.
- **Receipts are host memory only** — lost on restart, and that is fine: the worktree is git-tracked and
  a trashed file is recoverable from the trash. Nothing is persisted in the data dir.
- **Allowed deps:** `git` (`resolveDiffRange`, `readBlobAt`, `gitStatus` for the file's status),
  `fs` (`resolveWorktreeFile`), `persistence` (workspace lookup), `trash`, `log`, Node `fs`/`crypto`.
  **Forbidden:** `host`, `agent`, `reviews`.

### C. Ask the agent to fix a hunk — no new wire

A hunk-level **"Ask agent"** affordance is a review comment: the pane opens the existing inline composer
with an `AnchorDraft` whose selectors are the hunk's modified `lineRange` **plus the reserved
`diffHunk` selector, now populated** (`hunkHeader: "@@ -oStart,oCount +mStart,mCount @@"`), prefilled
with a short instruction stub the user edits, and sends through `review.commentAdd` + `review.sendComment`
(the composer's "Send now"). Two consequences, both in `submodule-server-reviews`:

- The send package renders a `diffHunk`-bearing comment with **both sides of the hunk** (original lines
  from the anchor's `baseRef`, modified lines from the worktree) instead of the modified fragment alone,
  so the agent sees what changed, not only what is there now.
- `diffHunk` is informational: re-anchoring stays on `textQuote`; a hunk whose original side can no
  longer be read (base ref gone) degrades to the modified-only fragment with an `outdated` eyebrow.

This keeps one lifecycle for every "tell the agent about this code" gesture (draft → sent → resolved,
one chat per file, `resolve_comment` from the agent) and needs no second prompt path.

### D. Resource metadata for the renderer registry (`contracts`, additive, `RESOURCE_META_PROTOCOL_VERSION`)

```ts
export interface ResourceMeta {
  hash: string | null;        // sha-256 of the bytes; null = absent
  byteLength: number | null;
  text: boolean;              // valid UTF-8 (host-decided, BOM-aware)
  mime?: string;              // sniffed by magic bytes first, extension second
}
"fs.readFile":  { result: { content: string; meta: ResourceMeta } }                    // `content` is "" for byte-only
"git.diffFile": { result: { original: string; modified: string; meta: { original: ResourceMeta; modified: ResourceMeta } } }
```

Byte-only sides are fetched by the client over HTTP: the existing **`/files/<workspaceId>/<path>`**
route (worktree bytes) plus a new **`/blob/<workspaceId>/<oid>/<path>`** route serving `readBlobAt`
for the original side — commit-addressed (`oid` is the resolved range start, so the URL is immutable
and cacheable), same path-containment as `/files`, `Content-Type` from `meta.mime`,
`Cache-Control: immutable` for `/blob`, `no-store` for `/files`. The web turns these into
`ResourceContent { kind: "bytes", url }` for the image/PDF renderers.

## Client side (panes, [[task-review-surface]])

- `HunkActions` (passed to a diff renderer) = `{ revert(range), revertFile(), askAgent(range) }`; the
  renderer only reports the ranges its diff produced; the pane owns the wire calls, the expectation hashes
  (it has both sides' content), and the outcome UI.
- **Undo instead of confirmation.** A revert applies immediately and raises a toast *"Reverted hunk in
  `path` — Undo"* for 8 s; Undo calls `change.undo` with the current hash. A whole-file revert that
  trashed a file says so (*"Moved `path` to the trash — Undo"*). Rationale: confirmation dialogs on every
  hunk make granular review unusable (the Windsurf regression), while a guaranteed inverse keeps the
  action safe.
- `STALE_VIEW` → the pane re-reads the diff (same `useLiveTabContent` path as an fs tick), shows *"This
  file changed since you opened it — review the new diff"*, and offers nothing else automatically.
- While a session in this workspace is **running**, the hunk toolbar carries a quiet notice (*"the agent
  is working in this workspace"*) and stays enabled: CAS makes the race safe, and a disabled toolbar would
  couple review to the session lifecycle.
- `revert`/`askAgent` appear only for scopes whose modified side is the worktree; a `commit` diff shows
  neither (same gate the review already applies).

## Scope, order, acceptance

1. `contracts`: `LineSpan`, `RevertTarget`, `ChangeReceipt`, the two methods, error codes, `ResourceMeta`
   fields; both protocol-version pins.
2. `trash` promoted to a leaf module; `changes` module with unit tests: range revert on a modified file;
   insertion-point (`count: 0`) spans both ways; last-line / final-newline handling; CRLF preservation;
   whole-file for modified/added/untracked/deleted; byte-only range → `RANGE_INVALID`; CAS mismatch on
   either side → `STALE_VIEW` and no write; undo round-trip restores byte-exact content; receipt ring cap.
3. `host`: handlers + change lock + `/blob` route; `fs.readFile`/`git.diffFile` metadata.
4. `reviews`: `diffHunk` populated by the composer, package renders both sides; unit test on
   `packageRender`.
5. Web: `HunkActions` supplied by `DiffPane` to the Pierre diff renderer's hunk toolbar
   ([[task-review-surface]] step 3), toast-with-undo, `STALE_VIEW` handling; one e2e covering revert →
   undo and the stale-view path (the fixture edits the file between render and revert). The full
   `bun run e2e` runs once at the end of this work, not per step.

## Not in this spec

Stage/unstage, edit-in-diff, conflict resolution, checkpoints. The protocol's properties — host-derived
changes, CAS on every side, receipts as inverse — are the same ones any of those would need; nothing here
is written for them.

## Decision log

- **Line spans, not patches** — hunk identity must survive two diff engines on the client and must never
  let the client dictate bytes; spans + host reads + CAS give the same safety as `git apply --check` with
  none of the hunk-boundary mismatch.
- **Undo, not confirm** — see above; receipts make the inverse exact, so confirmation buys nothing but
  friction.
- **Trash, never unlink** for files the revert removes — the helper exists, recovery is free, and a
  mistaken "revert file" on a new file is the most likely destructive mistake in review.
- **Ask-agent = review comment with `diffHunk`** — one lifecycle, one chat-per-file pin, one package
  renderer; the alternative (a bespoke prompt path) would fork the "tell the agent" semantics that
  `resolve_comment` and the sidebar depend on.
- **Receipts in memory** — persistence would add a data-dir file format for a convenience that git and the
  trash already back.
- **No agent pause on mutation** — CAS makes the race safe; pausing would couple the review surface to the
  session lifecycle and surprise users who expect the agent to keep working.
