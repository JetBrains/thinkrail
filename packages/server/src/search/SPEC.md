---
id: submodule-server-search
type: submodule-design
status: active
title: search — the palette's host-side providers and the transcript preview
parent: module-server
depends-on: [module-contracts, submodule-server-history, submodule-server-spec, submodule-server-todos, submodule-server-git, submodule-server-log]
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
  (`listStoredPlans`), `git` (`gitAsyncStream` for `ls-files`), `log` (a failed load or provider,
  error type only), Node `fs` (`readdir` for a walk, `stat` for a returned file hit's size).
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
  folder git refuses (not a repository); `node_modules` and VCS directories are always hidden, and the
  untracked side excludes them before the cap counts them. A path git lists once per conflict stage is
  listed once. A failure that may pass — a timeout, descriptor or memory pressure, in git or in the
  walk — rejects the load instead of answering a partial or empty list; a folder the walk may not read
  is skipped. Lists are cached per root with a
  twin folded by the matcher's `foldMatchCase`, so the prefilter never drops a path its case and
  diacritic folding would match (at most `maxRoots` roots, least recently asked first out, so switching workspaces
  keeps the recent ones warm; a list cut at its cap is still searched and its group reported
  `truncated`) and revalidated
  stale-while-reloading after a TTL or on `workspace.fsChanged` (`invalidateRoot`) — the old list keeps
  answering until the reload lands, and a reload that throws keeps it too, left stale so the next ask
  retries; a root with nothing cached answers its group `failed` while the next ask retries. A change
  that lands while a load runs leaves the loaded list stale, so the next ask loads again (the load may
  have enumerated the tree before the change). A change therefore never blanks the active workspace's
  files, and none is lost. Matching is two-pass: a substring prefilter over every term runs the matcher
  on the plain hits first, then every remaining path that passes a cheap subsequence test (a quoted term
  must still be a substring) goes through the matcher too (acronym, camel-hump and subsequence tiers),
  both passes bounded by the deadline. 100k paths answer in tens of milliseconds. Each returned file
  hit carries its `size` (one `stat` per hit on the page) and each spec hit its content's byte length,
  so the client can decline to preview a large one.
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
  per-file memo).
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
  snapshots build off the request (and only when read), plans are re-parsed only when changed, and
  the history index keeps its cold-build budget. A throwing provider or history read is logged
  (`log`, error type only) and answers its group `failed`.
- Hit ids are stable (`kind:id[:locator]`) so the browser can keep a selection across replies.
