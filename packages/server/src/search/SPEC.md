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
file names, spec titles and bodies, TODO plans and chat transcripts (chat titles and workspaces the palette
lists itself, from the host's session records and workspace lists) — ranking them with the one matcher from [[module-contracts]] so
the browser can merge host hits with its own by tier and score. Registry-free: `host/search.ts`
composes `createSearchService` with injected readers (open projects, persisted workspace records, the
history index, spec snapshots, stored plans, and the file check — `fs`'s `readableFileSize`, the
reader's own containment rule), the same shape as `host/historyScope.ts`.

## Boundary

- **Public surface (barrel):** `createSearchService`, `SearchService`, `SearchReaders`.
- **Internals:** the file-list cache, root resolution and the providers are composed by the service and
  reached by tests per file, never through the barrel.
- **Allowed deps:** `contracts` (DTOs, the matcher, the content matcher and `searchHitFields`), `git`
  (`gitAsyncStream` for `ls-files`), `log` (a failed load or provider, error type only); `history`,
  `spec` and `todos` for types only — their readers, the Default provisioning and the root watch are
  injected. A file hit's size and readability come from the
  injected `stat`, never a second containment rule here.
- **Forbidden:** `host`, `workspaces`, `projects`, `persistence`, `agent` (projects and records are
  injected; a preview never attaches a pi session); writing anything; a second matcher.

## Root and eligibility

`resolveSearchRoot` turns the client's context into **one** root: the active workspace's worktree, else
on Project Home the context project's folder through its Default record (`kind: "default"`; the record's
`workspaceId` names the root, so every file and spec hit carries a workspace the client reads and opens
through `fs.readFile` / the preview tab). An open project whose Default record does not exist yet gets it
from the injected `ensureDefault` (the host composes `listWorkspaces`, the same lazy creation
`workspace.list` does), once per project however many queries ask meanwhile; if that fails, `file` and
`spec` answer `failed` and the provisioning is not tried again (nor logged) for `provisionRetryMs` (5 s). No
root — no context project, a closed or unknown project — answers empty `file` and
`spec` groups. The resolved root is watched through the injected `watchRoot` (the host's prewarm-pool
watch, not awaited) so its changes reach `invalidateRoot` from its first search on. Other
open projects' folders and sibling worktrees are never searched (the field walked back global
multi-root file search: one root is faster and predictable). Transcripts come from sessions
whose `cwd` is a persisted worktree of an open project (pi-CLI sessions and closed projects are
dropped, like `history.search`'s labels); plans from every open project's workspace records, skipping
plan files whose session has no transcript on disk (orphans). **Audience:** `query` and `preview` take
what the asking client may learn of (`{ chats }`, from the host's one visibility policy; in-process callers
see everything). A client older than chats without a project gets the projects without the Chats
container, so every corpus — the root, files, plans, transcripts and previews — is built without its
chats before any provider ranks or pages, and totals never count them.
A chat whose deletion did not finish (`deletionPending`) is out of every corpus for every audience: its
transcript may still be on disk, but nothing may reopen it.

## Query

- Terms come from `parseMatchTerms` over the query clamped to `MAX_SEARCH_QUERY_LENGTH`; an empty
  query answers empty groups (the browser owns the empty state). Field matches go through the matcher
  with the terms as parsed (a quoted term is a literal); a body or transcript match takes each term's
  text as a case-insensitive substring, so a quoted phrase matches as one. `kinds` narrows the providers; the
  per-group `limit` is clamped to `MAX_SEARCH_GROUP_LIMIT`, `total` keeps the true count.
- **Lifecycle (per group `state`):** `indexing` — the corpus has never loaded (a file list, the first
  spec snapshot, a cold history index; or a plan whose session a cold index has not reached) and the
  client polls; `refreshing` — a reload runs behind the hits shown (the client re-asks quietly a few
  times); `failed` — the provider threw, the history read failed (transcripts and plans both), or the
  root's last list load failed (its last good hits still answer, and the group stays `failed`, also while
  a retry runs, until a load succeeds); else `ready`. Before the providers run, the query waits — at most
  `reloadWaitMs` (150 ms), in parallel — for the reloads the asked corpora have in flight, cold ones
  included, so a small or medium root answers fresh in one reply and only a slow reload is re-asked.
- **Budgets and cuts:** each provider gets `SEARCH_BUDGET.providerMs`, all within `queryMs` counted
  after that wait; a provider that runs out of time returns what it has with `cut.time`. A file list cut at
  a limit answers with `cut.fileList`, the number of files actually listed, so the client can say how many
  are searched. Lifecycle and cuts are independent: a capped list can be refreshing and out of time at
  once.
- **Files:** `git ls-files -co --exclude-standard -z` streamed through `gitAsyncStream` and a capped
  NUL parser (`FILE_LIST_LIMITS`: 128k names / 16 MiB of names; a list is capped only when an entry beyond
  a limit was seen, so a root of exactly 128k files is complete); the parser drops a repeated path (git
  lists a conflicted path once per stage) and paths under `node_modules` and VCS directories before the
  cap counts them. Every repository root is a git working tree (`openProject` refuses a
  non-repository; a chat's root is walked instead, below), so a git failure — a timeout, descriptor or memory pressure, not a repository — rejects
  the load (`FileListUnavailable`); it is logged once per root until a load succeeds and retried no sooner
  than `retryMs` (5 s) later — the failure is kept apart from the cached lists, so evicting a root's list
  never cuts its retry interval short — so a broken repository never spawns git per keystroke. Lists are cached per
  root with a twin folded by the matcher's own fold (`foldMatchText`), and each term is folded the same
  way, so the prefilter never drops a path the matcher would accept. At most `maxRoots` roots and
  `maxCachedPaths` paths are held together (least recently asked first out, so switching workspaces keeps
  the recent ones warm). A list is revalidated stale-while-reloading after a TTL or on
  `workspace.fsChanged` (`invalidateRoot`) — the old list keeps answering until the reload lands. A change
  that lands while a load runs leaves the loaded list stale, so the next ask loads again (the load may have
  enumerated the tree before the change). A change therefore never blanks the active workspace's files,
  and none is lost. Matching is two-pass: a substring prefilter over every term runs the matcher
  on the plain hits first, then every remaining path that passes a cheap subsequence test (a quoted term
  must still be a substring) goes through the matcher too (acronym, camel-hump and subsequence tiers),
  both passes bounded by the deadline. 100k paths answer in tens of milliseconds. Each returned file
  hit carries its `size` (one injected `stat` per hit on the page) and each spec hit its content's byte
  length, so the client can decline to preview a large one. A path the `stat` finds gone — tracked, but
  deleted in the worktree and not staged — not a regular file (a checked-out submodule, a tracked symlink
  to a directory) or refused by the file reader (a tracked symlink out of the worktree or into `.git`) is
  neither a hit nor counted — every hit previews and opens — and the next matches fill the page;
  the matches the page keeps are always checked, and the check stops at the budget after each path it
  finds gone, so a mass of deleted paths answers `cut.time` in time rather than stalling the host.
- **Specs:** the `spec` module's per-root snapshot — every build runs off the request path, the first
  included (a root's first read answers `indexing` with no hits unless the build lands within the wait),
  and only on a read after its TTL lapsed or the worktree changed, the previous snapshot answering
  meanwhile as `refreshing` (title / id / path through the
  matcher; a body match from three characters becomes a `content`-tier hit with the matching line as
  `snippet`).
- **Content folding:** spec bodies and messages match through `matchContent`, so a body folds exactly
  like a title. Each entry's prepared fold is cached against the entry object (`WeakMap`): history
  entries survive revalidation, so the cost is about one more copy of the indexed message text, released
  with the index's records; a spec body is prepared again once per snapshot rebuild. A snippet is cut
  from the raw text around the first match and highlighted with `contentRanges` on the snippet itself.
- **Transcripts:** hits are substring-AND over entries, one per message, `content` tier with an equal score so the timestamp alone orders them newest first (a
  user message never outranks a newer assistant one), carrying `messageIndex` / `anchorText` for the
  client's drift-tolerant jump. The scan visits the newest chat first and each chat's newest message
  first, checking the budget before every message, so a budget that runs out (`cut.time`) leaves only
  older messages unsearched.
- **Plans:** group and item titles through the matcher; hits carry the plan's session so the client
  opens the chat and its plan. A plan file is parsed again only when it changed (`todos`'
  per-file memo). While the history index is cold or refreshing, a plan whose session it has not reached
  yet is skipped and the group answers `indexing` or `refreshing`, so the client asks again once the
  session is known; a ready index skips it as an orphan.
- **A chat's root** (`SearchRoot.git: false`) is never a repository: its file list is walked, never asked
  of git (`walkFileList`: breadth-first, skipping the VCS folders and `node_modules`, at most
  `walkMaxFiles` files, capped only when one beyond the cap was seen) — the root's mode travels with every
  load, refresh and invalidation reload. A folder that vanished or cannot be read is skipped; the root's
  own failure, or any other, fails the load like a git failure. It answers no specs (an empty `spec`
  group; no snapshot is built for it), while its files, transcripts and plans stay searchable. The Chats
  container itself is never a root: a query in its context provisions nothing and answers no files.

## Preview

`search.preview` has one target, `chat`: a window of `previewMessages` entries around the focused
message from the history index (never a pi session), each entry cut at `previewMessageChars`. A preview
is asked once per settled selection, so it waits until the index is ready — a cold build or a warm
refresh may be reloading that very chat — in bounded rounds of the index's own wait, before answering; a
session still unknown then, or one that is not an open project's workspace chat, answers `unavailable`. The focus is the hit's message while
it still starts with the target's `anchorText` (cut at 120 characters), else the nearest message that
does — compaction or a branch may have shifted the index since the search — else none. Files and specs are not previewed
by the host — the client renders them through the shared resource renderers over `fs.readFile` (code,
images, HTML, markdown), the same path as a preview tab; a plan has no preview.

## Get right

- The host never blocks a keystroke on a corpus build beyond the bounded reload wait: file lists load off
  the request, spec snapshots build off the request (and only when read), plans are re-parsed only when
  changed, and the history index keeps its build budget. A throwing provider or history read is logged
  (`log`, error type only) and answers its group `failed`.
- Hit ids are stable (`kind:id[:locator]`) so the browser can keep a selection across replies; a
  transcript hit's locator is its message's pi entry id (`HistoryEntry.entryId`), never its index,
  which compaction shifts (`messageIndex` stays the jump target).
