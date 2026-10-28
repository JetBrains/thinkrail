---
id: submodule-server-search
type: submodule-design
status: active
title: search — the palette's host-side providers, Find in Files and the transcript preview
parent: module-server
depends-on: [module-contracts, submodule-server-history, submodule-server-spec, submodule-server-todos, submodule-server-git, submodule-server-log]
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
history index, spec snapshots, stored plans, and the file check — `fs`'s `readableFileSize`, the
reader's own containment rule), the same shape as `host/historyScope.ts`.

## Boundary

- **Public surface (barrel):** `createSearchService`, `SearchService`, `SearchReaders`.
- **Internals:** the file-list cache, root resolution, the providers and the text search are composed
  by the service and reached by tests per file, never through the barrel.
- **Allowed deps:** `contracts` (DTOs + the matcher), `history` (`HistoryIndex.sessions()` — the
  narrow read of titles and entries), `spec` (`specSnapshot` / `invalidateSpecSnapshot`), `todos`
  (`listStoredPlans`), `git` (`gitAsyncStream` for `ls-files` and `grep`), `log` (a failed load or
  provider, error type only), Node `fs` (`readdir` for a walk). A file hit's size and readability come
  from the injected `stat`, never a second containment rule here.
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
plan files whose session has no transcript on disk (orphans). **Audience:** `query` and `preview` take
what the asking client may learn of (`{ chats }`, from the host's one visibility policy; in-process callers
see everything). A client older than chats without a project gets the projects without the Chats
container, so every corpus — workspace records, the root, files, plans, chat titles, transcripts and
previews — is built without its chats before any provider ranks or pages, and totals never count them.
A chat whose deletion did not finish (`deletionPending`) is out of every corpus for every audience: its
transcript may still be on disk, but nothing may reopen it.

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
  folder git refuses (not a repository); `node_modules` and VCS directories are always hidden, and the
  untracked side excludes them before the cap counts them. A path git lists once per conflict stage is
  listed once. A failure that may pass — a timeout, descriptor or memory pressure, in git or in the
  walk — rejects the load instead of answering a partial or empty list; a folder the walk may not read
  is skipped. Lists are cached per root with a
  twin folded by the matcher's `foldMatchCase`, so the prefilter never drops a path its case and
  diacritic folding would match (at most `maxRoots` roots, least recently asked first out, so switching workspaces
  keeps the recent ones warm; a list cut at its cap is still searched and its group reported
  `truncated`) and revalidated
  stale-while-reloading after a TTL or on `workspace.fsChanged` (`invalidateRoot`; the host's
  `search.query` handler watches the context workspace, so a root searched from Project Home or before
  any panel asked for it still hears its changes) — the old list keeps
  answering until the reload lands, and a reload that throws keeps it too, left stale so the next ask
  retries; a root with nothing cached answers its group `failed` while the next ask retries. A change
  that lands while a load runs leaves the loaded list stale, so the next ask loads again (the load may
  have enumerated the tree before the change). A change therefore never blanks the active workspace's
  files, and none is lost. Matching is two-pass: a substring prefilter over every term runs the matcher
  on the plain hits first, then every remaining path that passes a cheap subsequence test (a quoted term
  must still be a substring) goes through the matcher too (acronym, camel-hump and subsequence tiers),
  both passes bounded by the deadline. 100k paths answer in tens of milliseconds. Each returned file
  hit carries its `size` (one injected `stat` per hit on the page) and each spec hit its content's byte
  length, so the client can decline to preview a large one. A path the `stat` finds gone — tracked, but
  deleted in the worktree and not staged — not a regular file (a checked-out submodule, a tracked symlink
  to a directory) or refused by the file reader (a tracked symlink out of the worktree or into `.git`) is
  neither a hit nor counted — every hit previews and opens — and the next matches fill the page;
  the matches the page keeps are always checked, and the walk checks the budget after each path it
  finds gone, so a mass of deleted paths answers `truncated` in time rather than stalling the host.
- **Specs:** the `spec` module's per-root snapshot — every build runs off the request path, the first
  included (a root's first read answers `indexing` with no hits), and only on a read after its TTL lapsed
  or the worktree changed, the previous snapshot answering meanwhile (title / id / path through the
  matcher; a body match from three characters becomes a `content`-tier hit with the matching line as
  `snippet`). Body matching folds case only, unlike the matcher's diacritic folding: folding every
  body per keystroke costs too much.
- **Chats and transcripts:** two providers with a budget each. Title hits through the matcher over every
  chat. Transcript hits are substring-AND over entries (the history index's rule; case folded only), one
  per message, `content` tier with an equal score so the timestamp alone orders them newest first (a
  user message never outranks a newer assistant one), carrying `messageIndex` / `anchorText` for the
  client's drift-tolerant jump. The scan visits the newest chat first and each chat's newest message
  first, checking the budget before every message, so a budget that runs out (`truncated`) leaves only
  older messages unsearched.
- **Plans:** group and item titles through the matcher; hits carry the plan's session so the client
  opens the chat and its plan. A plan file is parsed again only when it changed (`todos`'
  per-file memo). While the history index is still building, a plan whose session it has not reached yet
  is skipped and the group answers `indexing`, so the client asks again once the session is known.
- **Workspaces:** name, branch and `#<pr>` through the matcher over persisted records — the client
  dedupes against the workspaces it already knows. A chat without a project's record is never a
  workspace hit (it has no branch or PR; its chats are found as chats and transcripts).
- **A chat's root** (`SearchRoot.git: false`) is never a repository: its file list is always walked —
  the cache keeps the git mode each root was loaded with through every TTL or invalidation reload — and
  it answers no specs (an empty `spec` group), while its files, transcripts and plans stay searchable.

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
that is not an open project's workspace chat answers `unavailable`. The focus is the hit's message while
it still starts with the target's `anchorText` (cut at 120 characters), else the nearest message that
does — compaction or a branch may have shifted the index since the search — else none. Files and specs are not previewed
by the host — the client renders them through the shared resource renderers over `fs.readFile` (code,
images, HTML, markdown), the same path as a preview tab; a plan has no preview.

## Get right

- The host never blocks a keystroke on a corpus build: file lists load off the request, spec
  snapshots build off the request (and only when read), plans are re-parsed only when changed, and
  the history index keeps its cold-build budget. A throwing provider or history read is logged
  (`log`, error type only) and answers its group `failed`.
- Hit ids are stable (`kind:id[:locator]`) so the browser can keep a selection across replies; a
  transcript hit's locator is its message's pi entry id (`HistoryEntry.entryId`), never its index,
  which compaction shifts (`messageIndex` stays the jump target).
