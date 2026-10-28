---
id: submodule-web-search
type: submodule-design
status: active
title: search — the global search palette
parent: module-web
depends-on: [module-contracts]
references: [submodule-web-commands, submodule-web-shell, submodule-web-store]
tags: [ui, search, public-surface-checked]
---

## Responsibility

The one finder: a palette that finds chats and their transcripts, workspaces and projects, files,
specs and plans, runs commands and opens Settings sections, opened with `Mod+K`, double Shift, or the
topbar search button. It owns the presentation, the query grammar, ranking and learning, the
store-derived work items, and the host-search controller (`search.query` / `search.preview`); the
command catalog and its handlers, the way a host hit opens and the file preview renderer are composed
and injected by `shell`. It finds and jumps — it never mutates a setting in place (every setting row
opens its Settings section), and every verb runs through the command it was listed as.

## Boundary

- **Public surface:** `SearchPalette`, `SearchPaletteProps`, `PaletteHost`, `SearchSettings`,
  `initSearchPreferences`, `createDoubleShiftDetector`, `buildWorkItems`, `waitingItems`,
  `WorkItemsState`, `commandItems`, `SearchScope`, `PaletteItem`, `PaletteItemKind`, `PalettePreview`,
  `PaletteFile`.
- **Allowed deps:** `contracts` (the shared matcher and the search DTOs), `commands`, `store`,
  `transport` (`search.query` / `search.preview` behind `supportsHostSearch`, and the backend endpoint
  for browser preference keys), `clientPreferences`, `constants`, `components`, `lib`,
  `@thinkrail/locales` (UI strings), `@thinkrail/ui/*`, `@remixicon/react`.
- **Forbidden:** importing `panels`, `chat`, `shell` or `@thinkrail/resource-renderers` (shell injects
  the commands and their handlers, how a host hit opens, and the file renderer as the
  `PaletteHost.renderFilePreview` render prop); owning a chord another module binds; sending host
  mutations itself outside the injected handlers and the store's navigation actions.

## Query grammar

A leading prefix selects a scope and its chip, and a chip writes the prefix back: `@` work (projects,
workspaces, chats, transcripts, plans), `>` commands and settings, `/` files, `#` specs — the last two
exist only when the host serves `search.query` (`supportsHostSearch`; an older host keeps the local
scopes, searches `/…` and `#…` in All and shows a notice). `#<digits>` is a pull-request number, never the
specs scope — it matches the `#N` keyword of the workspace that carries that review. Quoted text is one
contiguous literal term — never matched as an acronym or a subsequence — and escapes a prefix; an
unterminated quote runs to the end of the query, so a phrase matches while it is typed. Terms AND-combine
through the shared matcher in [[module-contracts]], which folds case and Latin diacritics
(`configuracion` finds `Configuración`) without moving highlight offsets. Typing and pasting stop at
`MAX_SEARCH_QUERY_LENGTH` characters (the input's `maxLength`; a chip may add its prefix beyond it) and
`parseSearchQuery` cuts the text after the prefix to the same length, so the palette's terms and the
host's are parsed from the same characters — a host row can never
answer terms the palette does not show. There is no filter grammar: triage happens through the empty
state's grouping and the status dots every row carries.

## Ranking

The matcher's tier decides first (exact > prefix > word start > substring > subsequence); within a tier
the match score, a decay-free frecency (Firefox's stored form, 14-day half-life), the learned
query→selection count (Firefox adaptive history: `0.9·n + 1`, prefix-matched, ×0.975 per day, keyed on
the query's text without its scope prefix and computed once per query, each query keeping its 32 most
recent picks), the current workspace/project boost, and the attention boost reorder. A top hit shows only when the best row
is prefix-or-better and clearly ahead, or the typed query has latched to it. Groups are ordered by their
best row and capped at four in All (thirty in a scope) with an "N more" row: in All it switches to the
group's scope, in a scope it expands the group in place. `N` counts the host's overflow too (the host's
`total` beyond the page it returned), a scoped query asks the host for its maximum page, and a scoped group
the host still capped says so in its meta instead of pretending the page is everything. The empty query
lists **Waiting for you** (the former session switcher's attention set without running chats — a chat that
needs input, failed or finished unread — across every open project, eight rows before an in-place "Show N
more"), **Recent** (by frecency), and **Actions**.

A chat row is worded by `lib`'s `chatLabel` over the known title (a named layout tab, else a history row
— the title backfill installs listed chats into the history projection, so a rename broadcast updates them
like any other row) and the host-reported first prompt (`selectRecordFirstPrompts`): an unnamed chat reads as
its first prompt, carries `data-title-source` and the full first line as its tooltip, and is matchable by
the whole prompt (a keyword), so words past the 48-character cut still find it; an unnamed chat with
neither a prompt nor attention is not listed.

## Host search

`useHostSearch` wraps the pure `createHostSearchController`: a 100 ms debounce, at most one request in
flight plus the latest queued input, a monotonic `seq` seeded from the clock (a reloaded page never
reissues a number the host has seen) for the host's per-client superseding, and fencing — a reply
paints only when it answers the current input, its `seq` is the latest issued and the welcome
generation is unchanged; a latest reply the host still marked `superseded` paints an empty result and
stops, and a failed request paints every asked group `failed` (never a spinner that cannot end). An
`indexing` group polls — ten times every 300 ms, then every second, about 30 s in all — asking only the
kinds still indexing; `truncated` and `failed` never poll. The host is asked only for the scope's kinds
(`scopeKinds`) and never on a page or for an empty query.

**Result lifecycle.** A reply for the input already on screen (a poll, a reconnect's re-ask) replaces
the groups it answers but keeps every hit the previous page showed that the new one left out
(`mergeHostGroups`), so a refreshed corpus or a better page never pulls a row from under the
selection; the rows go when the query changes. While a new input is pending the previous host rows stay
on screen — replaced, never blanked — but they answered another query (`stale`): `rematchHit` matches
each again against the current terms on the fields the host matches it on (a file's path, a spec's
title / id / path, a chat's or plan's title, a workspace's name and branch), so it takes the tier the
host's answer will give it, and a body or message hit stays in the `content` tier and must still
contain every term in its snippet as a case-folded substring — the content providers' rule, so never an
acronym; a row that no longer matches leaves at once, and Enter can only open a row
the typed text matches; their counts are ignored.
A fresh reply's rows carry the host's matcher result as `PaletteItem.match`, ranked with the local rows
by the same tiers instead of re-matching the title. A host chat or workspace hit is dropped only when
its local twin matches the query too (`matchingIds`), so a twin the query misses — a Default workspace
whose branch its row does not show, a chat still labelled by its first prompt — never hides the host's
hit, and either way one row per id remains. Rows that land while the user holds a selection
join an arrival cohort (`noteArrivals`, `PaletteItem.late`): each later reply's newcomers sort after
every row already on screen and every earlier cohort, across tiers and groups — a group that already
shows rows continues below all of them in a section of its own (`cohortParts`) — and they neither take
the top hit nor unseat the one shown, so neither the selection nor a row above it moves. A group's
"N more" row sits below with the newcomers when they alone overflow the group; while the host reports
more than it sent for the group, the row stays with the first rows — the one way a reply can still add a
row above the selection (or move that row back up) is a host count that grows past what the group shows.
A newcomer is a hit neither on screen nor in the previous reply for the same search (stale groups list
nothing), so a hit already held behind a group's cap — re-sent by an indexing poll — never becomes late. The selected host row never
leaves the list while the same search stands — the same text, scope and root (`withPinned`): a reply
that no longer brings it keeps it (a local twin the query misses does not stand in for it), no group's cap hides it (`keep`), and a changed root or a host that
stops searching drops it. A group's "N more" is the host's count beyond its page less the local rows the
page left out that the host's own fields also match (a chat's title; a workspace's name, branch and PR
number — `PaletteItem.hostFields`), so a chat both the browser and the host know is never counted twice,
while a local row only its project label matches is not taken for one of the host's hits. Results the palette shows as final but are not complete say so in a status line and the
live region: part of the search failed, it is still indexing after polling stopped, or a provider ran
out of time (`hostSearchStatus`). A file or spec hit without a workspace is dropped (nothing could read
or open it). A host row opens through the injected `PaletteHost.openHit`. The `/` and `#` scopes are
offered only when the host searches files and specs and a context project gives them a root, and the
placeholder names files and specs exactly then.

## Preview pane

`Mod+I` opens a pane with one of three renderings, chosen by the selected row: a **transcript window**
around a chat or transcript hit (`search.preview`, memoized per target for the open palette and the
connection, with the focused message marked — the hit's `anchorText` travels with the target, so a
transcript compacted since the search still focuses the right message, or none); a **file or spec**
rendered by the shell-injected `renderFilePreview` over `PaletteItem.file` (`{ workspaceId, path, size }`)
— the shared resource renderers, so code highlights, images and sandboxed HTML display, and a `SPEC.md`
renders as markdown, the same path as a preview tab; or the local **metadata card** (`PaletteItem.preview`)
for a project, workspace or chat without a transcript hit. A host preview is read only once the
selection rests on its row for 150 ms, so sweeping the mouse or arrows across rows reads only the row it
stops on, and a file or spec whose hit is over `MAX_SEARCH_PREVIEW_BYTES` (2 MiB) is not read at all — the
pane says it is too large to preview and Enter opens it. Every `fs.readFile` the pane does make, a refresh
on a change included, asks the host for at most that cap, so a file that grows past it while shown is
refused rather than read; an image's bytes come over the resource renderers' asset route, fetched again
only when a bounded read reports a new version. A plan row and a command have no preview. The pane never fetches a text head from the
host.

## Interaction

DOM focus stays in the input (WAI-ARIA combobox + listbox with `aria-activedescendant`, one named group
per section and a polite result count; chips and footer buttons are not tabbable, and Tab is always
consumed). The chord layer is the dialog frame, not the input: a click on a non-interactive part of the
palette moves focus to the frame, and the next key still runs and returns focus to the input; a key from
an interactive control inside the palette (a preview's own buttons) stays that control's, except Escape.
↑/↓ select, ↵ opens or runs the row and closes the palette, Tab/Shift+Tab and `Alt+1…n` change scope (a
chip writes its prefix into the query, so the prefix is the one source of scope), `Mod+I` toggles the
preview pane, `Mod+K` closes the palette (the chord that opened it). Escape clears the query, then
closes; an untrusted (synthetic) Escape — the desktop close-item command — closes outright. An active
IME owns every key (`isComposing` or the `keyCode` 229 sentinel): composing Escape, arrows, Enter and
`Alt+n` do nothing to the palette, and Tab only stays in the input. Plain `Ctrl+R` is swallowed while
the palette is open; `Ctrl+Shift+R` still reloads. Mutating rows are disabled while offline or before
the current welcome, and a command may carry its own disabled reason (Settle while an agent works or a
chat needs you). The palette has one level: no pages, no per-row action panel — a row is a destination
or a command.

## Preferences

The learning snapshot (≤ 500 items, ≤ 500 queries of ≤ 32 picks, < 200 KB), the preview choice and the
double-Shift choice are client-local: the stable native preference adapter when present (per backend
profile and window), otherwise browser storage qualified by the backend endpoint, where concurrent
windows keep their own snapshot and the last writer wins. Only ids and query prefixes are stored, never
row text.

## Double Shift

`createDoubleShiftDetector` is IntelliJ's gesture: press → release → press → release of a bare Shift,
each step within 300 ms, ignored when another key went down less than 100 ms before the first press,
reset by any other key, key repeat, IME composition (`isComposing`/229), another held modifier, pointer
down, blur or a hidden document, and firing on the second release. The sandboxed HTML preview iframe never
delivers keys to the parent window, so the gesture does not fire from inside it.
