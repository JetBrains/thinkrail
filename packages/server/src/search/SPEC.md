---
id: submodule-server-search
type: submodule-design
status: active
title: search — the palette's host-side providers and the transcript preview
parent: module-server
depends-on: [module-contracts, submodule-server-history, submodule-server-spec, submodule-server-todos, submodule-server-git, submodule-server-fs]
references: [submodule-web-search]
tags: [search, public-surface-checked]
---

## Responsibility

Answer the search palette's `search.query` and `search.preview` for the corpora only the host can see —
file names, spec titles and bodies, TODO plans, chat titles and transcripts, and the workspaces of
projects the client has not expanded — ranking them with the one matcher from [[module-contracts]] so
the browser can merge host hits with its own by tier and score. Registry-free: `host/search.ts`
composes `createSearchService` with injected readers (open projects, persisted workspace records, the
history index, spec snapshots, stored plans), the same shape as `host/historyScope.ts`.

## Boundary

- **Public surface (barrel):** `createSearchService`, `SearchService`, `SearchReaders`.
- **Internals:** the file-list cache, root resolution and the providers are composed by the service and
  reached by tests per file, never through the barrel.
- **Allowed deps:** `contracts` (DTOs + the matcher), `history` (`HistoryIndex.sessions()` — the
  narrow read of titles and entries), `spec` (`specSnapshot` / `invalidateSpecSnapshot`), `todos`
  (`listStoredPlans`), `git` (`gitAsyncStream` for `ls-files`), Node `fs/promises`.
- **Forbidden:** `host`, `workspaces`, `projects`, `persistence`, `agent` (projects and records are
  injected; a preview never attaches a pi session); writing anything; a second matcher.

## Root and eligibility

`resolveSearchRoot` turns the client's context into **one** root: the active workspace's worktree, else
on Project Home the context project's folder through its Default record (the record's `workspaceId`
names the root, so every file and spec hit carries a workspace the client reads and opens through
`fs.readFile` / the preview tab without provisioning). No root — no context project, a closed project,
a project whose Default record is not persisted yet — answers empty `file` and `spec` groups. Other
open projects' folders and sibling worktrees are never searched (the field walked back global
multi-root file search: one root is faster and predictable). Chats and transcripts come from sessions
whose `cwd` is a persisted worktree of an open project (pi-CLI sessions and closed projects are
dropped, like `history.search`'s labels); plans from every open project's workspace records, skipping
plan files whose session has no transcript on disk (orphans).

## Query

- Terms come from `parseMatchTerms` over the query clamped to `MAX_SEARCH_QUERY_LENGTH`; an empty
  query answers empty groups (the browser owns the empty state). Field matches go through the matcher
  with the terms as parsed (a quoted term is a literal); a body or transcript match takes each term's
  text as a case-insensitive substring, so a quoted phrase matches as one. `kinds` narrows the providers; the
  per-group `limit` is clamped to `MAX_SEARCH_GROUP_LIMIT`, `total` keeps the true count.
- **Per-client superseding:** the service remembers the latest `seq` per `clientKey`; an older `seq`
  is answered `{ superseded: true }` immediately, and a query that was overtaken while it awaited the
  history index returns `superseded` instead of stale groups. `seq` is the client's monotonic counter
  across reopen and reconnect; `forgetClient` drops a reaped client's counter (the host calls it from
  its client reap).
- **Budgets:** each provider gets `SEARCH_BUDGET.providerMs`, all within `queryMs`; a provider that
  runs out of time returns what it has as `truncated`. A throwing provider reports `failed` (the
  client never polls a failed group). A file list that has never loaded reports the group `indexing`
  and starts loading (single-flight per root); a list or spec snapshot that is being reloaded behind a
  stale answer reports `indexing` too, with the stale hits — so the client's bounded polling picks up
  the refreshed corpus instead of taking the stale page as final.
- **Files:** `git ls-files -co --exclude-standard -z` streamed through `gitAsyncStream` and a capped
  NUL parser (`FILE_LIST_LIMITS`: 100k names / 16 MB, then `truncated`), a bounded `readdir` walk for a
  non-git root; `node_modules` and VCS directories are always hidden. Lists are cached per root with a
  twin folded by the matcher's `foldMatchCase`, so the prefilter never drops a path its case and
  diacritic folding would match (at most `maxRoots` roots, least recently asked first out, so switching workspaces
  keeps the recent ones warm; a list cut at its cap is still searched and its group reported
  `truncated`) and revalidated
  stale-while-reloading after a TTL or on `workspace.fsChanged` (`invalidateRoot`) — the old list keeps
  answering until the reload lands, and a reload that throws (spawn failure, `EMFILE`) keeps it too,
  left stale so the next ask retries; only a root with nothing cached falls back to an empty list.
  A change therefore never blanks the active workspace's files. Matching is
  two-pass: a substring prefilter over every term runs the matcher on the plain hits first, then every
  remaining path that passes a cheap subsequence test goes through the matcher too (acronym, camel-hump
  and subsequence tiers), both passes bounded by the deadline. 100k paths answer in tens of milliseconds.
- **Specs:** the `spec` module's per-root snapshot — built synchronously only on a root's first read,
  afterwards rebuilt off the request path (`setImmediate`) when its TTL lapses or the worktree changes,
  the previous snapshot answering meanwhile (title / id / path through the matcher; a body match from
  three characters becomes a `content`-tier hit with the matching line as `snippet`).
- **Chats and transcripts:** title hits through the matcher; transcript hits are substring-AND over
  entries (the history index's rule), one per message, `content` tier with an equal score so the
  timestamp alone orders them newest first (a user message never outranks a newer assistant one),
  carrying `messageIndex` / `anchorText` for the client's drift-tolerant jump.
- **Plans:** group and item titles through the matcher; hits carry the plan's session so the client
  opens the chat and its plan.
- **Workspaces:** name, branch and `#<pr>` through the matcher over persisted records — the client
  dedupes against the workspaces it already knows.

## Preview

`search.preview` has one target, `chat`: a window of `previewMessages` entries around the focused
message from the history index (never a pi session), each entry cut at `previewMessageChars`; a session
that is not an open project's workspace chat answers `unavailable`. Files and specs are not previewed
by the host — the client renders them through the shared resource renderers over `fs.readFile` (code,
images, HTML, markdown), the same path as a preview tab; a plan has no preview.

## Get right

- The host never blocks a keystroke on a corpus build: file lists load off the request, spec
  snapshots rebuild off the request after their first read, and the history index keeps its cold-build
  budget.
- Hit ids are stable (`kind:id[:locator]`) so the browser can keep a selection across replies.
