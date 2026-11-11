---
id: submodule-server-search
type: submodule-design
status: active
title: search — the palette's host-side providers, Find in Files and the transcript preview
parent: module-server
depends-on: [module-contracts, submodule-server-history, submodule-server-spec, submodule-server-todos, submodule-server-git, submodule-server-fs]
references: [submodule-web-search]
tags: [search, public-surface-checked]
---

## Responsibility

Answer the search palette's `search.query` and `search.preview` for the corpora only the host can see —
file names, spec titles and bodies, TODO plans, chat titles and transcripts, and the workspaces of
projects the client has not expanded — ranking them with the one matcher from [[module-contracts]] so
the browser can merge host hits with its own by tier and score; and run Find in Files' `search.text`,
streaming `git grep` matches over the same one root. Registry-free: `host/search.ts`
composes `createSearchService` with injected readers (open projects, persisted workspace records, the
history index, spec snapshots, stored plans), the same shape as `host/historyScope.ts`.

## Boundary

- **Public surface (barrel):** `createSearchService`, `SearchService`, `SearchReaders`.
- **Internals:** the file-list cache, root resolution, the providers and the text search are composed
  by the service and reached by tests per file, never through the barrel.
- **Allowed deps:** `contracts` (DTOs + the matcher), `history` (`HistoryIndex.sessions()` — the
  narrow read of titles and entries), `spec` (`specSnapshot` / `invalidateSpecSnapshot`), `todos`
  (`listStoredPlans`), `git` (`gitAsyncStream` for `ls-files` and `grep`), Node `fs/promises`.
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
  query answers empty groups (the browser owns the empty state). `kinds` narrows the providers; the
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
  lower-cased twin (at most `maxRoots` roots, least recently asked first out, so switching workspaces
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

## Text (Find in Files)

`search.text { seq, query, context, caseSensitive, wholeWord }` searches file **contents** in the same
one root as the `file` kind (so both searches see one file set) and answers at once — `{ seq }` or
`{ seq, superseded }` for a `seq` older than the client's latest; the matches follow on the addressed
`search.textResults` push through the `emit` the host hands in (one socket, never a broadcast).

- **Engine:** one `git grep --no-color -n -z -I --fixed-strings [-i] [-w] --untracked --exclude-standard`
  process per search in the root (`--no-index` for a folder that is not a repository), streamed through
  `gitAsyncStream`; the records are split on NUL/newline with a capped record buffer, CRLF trimmed. The
  query is a plain substring clamped to `TEXT_SEARCH_LIMITS.maxQuery`; under `minQuery` characters or
  without a root the search completes empty without spawning. Smart-case is the client's: the host
  only sees an explicit `caseSensitive`.
- **Matches:** per matching line, 1-based `line`, the first match's `column` / `length` (so the client
  can open at it) and every match's `[start, end)` range inside `text`, which is cut to
  `TEXT_SEARCH_LIMITS.lineChars` around the first match; the host recomputes ranges itself (git only
  reports lines). A file over `fileBytes` is dropped after one `stat` per path. Matches are grouped by
  file in the order git emits them and flushed every `TEXT_SEARCH_BUDGET.flushMs`.
- **End:** the final batch carries `done: { reason, files, lines }` — `complete`, `limit` when
  `TEXT_SEARCH_LIMITS.lines` matching lines were reached (the process is killed), or `failed` (git exited
  abnormally, timed out or could not launch; git's "no match" exit is `complete`).
- **Per-client superseding:** the service keeps the latest text `seq` and the running search's
  `AbortController` per `clientKey`; a newer `search.text` aborts the older one (cancelling the stream
  kills the process tree) and an aborted search emits nothing more — the client never sees a stale
  batch or `done`. `forgetClient` aborts the reaped client's search.

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
