---
id: submodule-server-search
type: submodule-design
status: active
title: search — the palette's host-side providers and previews
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

- **Public surface (barrel):** `createSearchService`, `SearchService`, `SearchReaders`,
  `resolveSearchRoots`, `SEARCH_BUDGET`, `FileListCache`, `FileList`, `FILE_LIST_LIMITS`,
  `listRootFiles`, `parseNulList`.
- **Allowed deps:** `contracts` (DTOs + the matcher), `history` (`HistoryIndex.sessions()` — the
  narrow read of titles and entries), `spec` (`specSnapshot` / `invalidateSpecSnapshot`), `todos`
  (`listStoredPlans`), `git` (`gitAsyncStream` for `ls-files`), `fs` (`resolveContainedFile` +
  `resourceMeta` for preview heads), Node `fs/promises`.
- **Forbidden:** `host`, `workspaces`, `projects`, `persistence`, `agent` (projects and records are
  injected; a preview never attaches a pi session); writing anything; a second matcher.

## Roots and eligibility

`resolveSearchRoots` turns the client's context into ordered roots: the active workspace's worktree
first (`current`), then every **open** project's folder (`Project.path`, with the Default record's
`workspaceId` when one exists so the client can open a hit without provisioning), the context project
first. Sibling worktrees are never roots (duplicates); closed projects are never searched. Files come
from every root; spec titles and bodies only from the `current` root; chats and transcripts only from
sessions whose `cwd` is a persisted worktree of an open project (pi-CLI sessions and closed projects
are dropped, like `history.search`'s labels); plans from every open project's workspace records,
skipping plan files whose session has no transcript on disk (orphans).

## Query

- Terms come from `parseMatchTerms` over the query clamped to `MAX_SEARCH_QUERY_LENGTH`; an empty
  query answers empty groups (the browser owns the empty state). `kinds` narrows the providers; the
  per-group `limit` is clamped to `MAX_SEARCH_GROUP_LIMIT`, `total` keeps the true count.
- **Per-client superseding:** the service remembers the latest `seq` per `clientKey`; an older `seq`
  is answered `{ superseded: true }` immediately, and a query that was overtaken while it awaited the
  history index returns `superseded` instead of stale groups. `seq` is the client's monotonic counter
  across reopen and reconnect.
- **Budgets:** each provider gets `SEARCH_BUDGET.providerMs`, all within `queryMs`; a provider that
  runs out of time returns what it has as `truncated`. A throwing provider reports `failed` (the
  client never polls a failed group). A cold file list reports `indexing` and starts loading
  (single-flight per root); the client re-asks.
- **Files:** `git ls-files -co --exclude-standard -z` streamed through `gitAsyncStream` and a capped
  NUL parser (`FILE_LIST_LIMITS`: 100k names / 16 MB, then `truncated`), a bounded `readdir` walk for a
  non-git root; `node_modules` and VCS directories are always hidden. Lists are cached per root with a
  lower-cased twin, revalidated after a TTL or on `workspace.fsChanged` (`invalidateRoot`). Matching is
  two-pass: a substring prefilter over every term, then — only when that cannot fill the page — the
  matcher's subsequence tier over the rest, gated by a cheap subsequence test. 100k paths answer in
  tens of milliseconds.
- **Specs:** the `spec` module's per-root snapshot (title / id / path through the matcher; a body
  match from three characters becomes a `content`-tier hit with the matching line as `snippet`).
- **Chats and transcripts:** title hits through the matcher; transcript hits are substring-AND over
  entries (the history index's rule), one per message, `content` tier, newest first, carrying
  `messageIndex` / `anchorText` for the client's drift-tolerant jump.
- **Plans:** group and item titles through the matcher; hits carry the plan's session so the client
  opens the chat and its plan.
- **Workspaces:** name, branch and `#<pr>` through the matcher over persisted records — the client
  dedupes against the workspaces it already knows.

## Preview

`search.preview` reads bounded content without side effects: a chat preview is a window of
`previewMessages` entries around the focused message from the history index (never a pi session); a
file preview is the first `previewBytes` of a root-contained file (`resolveContainedFile`), refused as
`binary` when `resourceMeta` says so; a spec preview is the cached body; a plan preview renders the
stored plan as a checklist. Anything unresolvable answers `unavailable`.

## Get right

- The host never blocks a keystroke on a corpus build: file lists load off the request, spec
  snapshots are TTL-cached per root, and the history index keeps its cold-build budget.
- Hit ids are stable (`kind:id[:locator]`) so the browser can keep a selection across replies.
