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
  `initSearchPreferences`, `createDoubleShiftDetector`, `buildWorkItems`, `waitingItems`, `commandItems`,
  `SearchScope`, `PaletteItem`, `PaletteFile`.
- **Allowed deps:** `contracts` (the shared matcher and the search DTOs), `commands`, `store`
  (`selectHostSearchAvailable` / `selectHostReachable`, the welcome generation), `transport`
  (`search.query` / `search.preview`, and the backend endpoint for browser preference keys), `clientPreferences`, `constants`, `components`, `lib`,
  `@thinkrail/locales` (UI strings), `@thinkrail/ui/*`, `@remixicon/react`.
- **Forbidden:** importing `panels`, `chat`, `shell` or `@thinkrail/resource-renderers` (shell injects
  the commands and their handlers, how a host hit opens, and the file renderer as the
  `PaletteHost.renderFilePreview` render prop); owning a chord another module binds; sending host
  mutations itself outside the injected handlers and the store's navigation actions.

## Query grammar

A leading prefix selects a scope and its chip, and a chip writes the prefix back: `@` work (projects,
workspaces, chats, transcripts, plans), `>` commands and settings, `/` files, `#` specs — the last two
exist only when the last welcome's host serves `search.query` (`selectHostSearchAvailable`) and a
context project gives them a root; otherwise a prefix whose scope is not offered searches the rest of the query in All (an older host
also shows a notice), so a doubled prefix (`##`, `//src`) never lands in an empty scope. `#<digits>` is a
pull-request number, never the specs scope — it matches the `#N` keyword of the workspace that carries
that review. Quoted text is one contiguous literal term — never matched as an acronym or a subsequence —
and escapes a prefix; an unterminated quote runs to the end of the query, so a phrase matches while it is
typed. Terms AND-combine through the shared matcher in [[module-contracts]], which folds case and the
accents of every script, in either Unicode spelling (`configuracion` finds `Configuración`, `еще` finds
`ещё`), and highlights the original text. Typing and pasting stop at `MAX_SEARCH_QUERY_LENGTH` characters (the input's
`maxLength`; a chip may add its prefix beyond it) and `parseSearchQuery` cuts the text after the prefix to
the same length, so the palette's terms and the host's are parsed from the same characters — a host row
can never answer terms the palette does not show. There is no filter grammar: triage happens through the
empty state's grouping and the status dots every row carries.

## Ranking

The matcher's tier decides first (exact > prefix > word start > substring > subsequence) — and at the
same tier a visible field beats a secondary one, so a word an unnamed chat's title shows is highlighted
there rather than in its hidden whole-prompt keyword; within a tier the match score, a decay-free frecency (Firefox's stored form, 14-day half-life), the learned
query→selection count (Firefox adaptive history: `0.9·n + 1`, prefix-matched, ×0.975 per day, keyed on
the query's text without its scope prefix and computed once per query, each query keeping its 32 most
recent picks), the current workspace/project boost, and the attention boost reorder. A top hit shows only when the best row
is prefix-or-better and clearly ahead, or the typed query has latched to it. Groups are ordered by their
best row and capped at four in All (thirty in a scope) with an "N more" row: in All it switches to the
group's scope, in a scope it expands the group in place. `N` counts the host's overflow too (the host's
`total` beyond the page it returned), a scoped query asks the host for its maximum page, and a scoped group
the host still capped says so in its meta instead of pretending the page is everything. The empty query
lists **Waiting for you** (every chat that needs the user across the open projects, most urgent first —
needs input, then failed, then finished unread, project order breaking ties, running chats left out — so
the cap of eight rows before an in-place "Show N more" never hides a blocked chat behind unread ones),
**Recent** (by frecency), and **Actions**.

A chat row is worded by `lib`'s `chatLabel` over the known title (`selectKnownChatTitle`: the title on the
host's state record, which every rename republishes, so no palette request is needed to name a chat in a
workspace this client never opened; against an older host that omits it, a named layout tab, else a history
row — and an unvisited chat then reads as its first prompt, so a word only its title holds does not find it)
and the host-reported first prompt (`selectRecordFirstPrompts`): an unnamed chat reads as
its first prompt, carries `data-title-source` and the full first line as its tooltip, and is matchable by
the whole prompt (a keyword), so words past the 48-character cut still find it; an unnamed chat with
neither a prompt nor attention is not listed.

## Host search

`useHostSearch` wraps the pure `createHostSearchController`: a 100 ms debounce, at most one request in
flight plus the latest queued input (a newer input drops a queued one, so only what the user typed last
is sent), and fencing — a reply paints only when it answers the current input, it is the controller's
latest request and the welcome generation it was asked in still holds; a failed request paints every
asked group `failed` (never a spinner that cannot end). The host is asked only for the scope's kinds
(`scopeKinds`), only when the text parses to a term, never on a page. One scheduler re-asks: kinds still
`indexing` poll on the cold schedule (ten times every 300 ms, then every second, about 30 s in all,
spinner shown), kinds `refreshing` are re-asked quietly at 300, 600 and 1 200 ms (no spinner, no message)
and the page then stands until the next keystroke; each schedule keeps its own allowance, a re-ask asks
only the kinds due, and a quiet re-ask answered `indexing` moves to the cold schedule.

**Connection.** Host search is available from the **last** welcome's protocol, so a reconnect keeps the
host scopes, the rows and the selection; while the host is unreachable (`selectHostReachable`: connected
and this connection's welcome) the controller cancels its timers and queued input, asks nothing and paints
no late reply, a changed text marks the rows stale (they are re-matched as below), and host rows are
disabled with the offline reason. A new welcome re-asks the current input once and merges the answer; a
welcome from a host that does not search removes the host scopes and rows.

**Result lifecycle** — the invariants: a reply for the input on screen keeps every hit the previous page
showed (`mergeHostGroups`), so rows go only when the query changes; while a new input is pending the
previous host rows stay, re-matched against the current terms on the host's own fields
(`searchHitFields`) — a body or message row only while every term is in its snippet (`matchContent`), so a
multi-term row whose later term lies outside the snippet leaves while stale and returns with the reply —
so Enter only ever opens a row the typed text matches; a fresh row carries the host's matcher result
(`PaletteItem.match`) and ranks with the local rows by the same tiers; the host is asked only for what the
palette cannot list itself — files, specs, plans and message text — while chats and workspaces are the
store's rows (a chat row previews its transcript, the Default workspace is found by its branch), so no
section mixes local and host rows and one row per id holds by construction. Rows that land while the user
holds a selection are marked late in the very state that shows them (the controller notes arrivals from
the rows on screen the palette last reported, `observe`): each later reply's newcomers sort after every
row already on screen and every earlier cohort, across tiers and groups, in a section of their own
(`cohortParts`), never take or unseat the top hit, and a hit already held behind a group's cap is no
newcomer — so neither the selection nor a row above it moves, except when the host's count grows past
what a group shows and its "N more" row appears. A host group's "N more" is the host's count beyond the
hits it sent. Ranking runs once per input (`rankSections`); moving the selection only regroups
(`groupSections`, `keep` holds the selected row above its group's cap).

**Status.** Right of the input, the `RunningIcon` shows once a search has been pending for 200 ms; a
settled search that may be incomplete shows a yellow mark instead, whose tip (hover, or tap on touch)
names every reason — part of it failed, it is still indexing after polling stopped, only N files of the
folder are listed (`cut.fileList`), or a provider ran out of time (`cut.time`) (`hostSearchReasons`). The
reasons also describe the input (`aria-describedby`) and reach the live region; Escape closes an open tip
before anything else. A host row opens through the injected `PaletteHost.openHit`. The `/` and `#`
scopes are offered only when the host searches files and specs and a context project gives them a root,
and the placeholder names files and specs exactly then.

## Preview pane

`Mod+I` opens a pane — on a viewport at least `md` wide; below it the pane, its toggle and its chord are
absent while the saved choice is kept — with one of three renderings, chosen by the selected row: a
**transcript window** around a chat or transcript hit (`search.preview`; a transcript is cached per
target for the open palette and the connection, a miss is asked again on the next selection, the focused
message is marked — the hit's `anchorText` travels with the target, so a transcript compacted since the
search still focuses the right message, or none — and a chat without a transcript shows its card); a
**file or spec**
rendered by the shell-injected `renderFilePreview` over `PaletteItem.file` (`{ workspaceId, path, size }`)
— the shared resource renderers, so code highlights, images and sandboxed HTML display, and a `SPEC.md`
renders as markdown, the same path as a preview tab; or the local **metadata card** (`PaletteItem.preview`)
for a project, workspace or chat without a transcript hit. A host preview is read only once the
selection rests on its row for 150 ms, so sweeping the mouse or arrows across rows reads only the row it
stops on, and a file or spec whose hit is over `MAX_SEARCH_PREVIEW_BYTES` (2 MiB) is not read at all — the
pane says it is too large to preview and Enter opens it. Every read the pane makes — `fs.readFile`, a
refresh on a change, an image's or PDF's bytes and a document's relative assets over the `/files` route —
asks the host for at most that cap (the shell's palette resource host), so a file that grows past it is
refused rather than read, and an embedded image over the cap does not render here. While the host is
unreachable a loaded preview stays, a new one asks nothing and says to reconnect, and the next welcome
refreshes it once. The pane has a definite height while shown, so a code view fills it. A plan row and a
command have no preview.

## Interaction

DOM focus stays in the input (WAI-ARIA combobox + listbox with `aria-activedescendant`, one named group
per section and a polite result count; chips and footer buttons are not tabbable, and Tab is always
consumed). The chord layer is the dialog frame, not the input: a click on a non-interactive part of the
palette moves focus to the frame, and the next key the palette handles — or a character typed — returns
focus to the input, while a bare modifier or a Ctrl/⌘ chord leaves it, so text selected in the preview
can be copied. ↑/↓ select, ↵ opens or runs the row and closes the palette, Tab/Shift+Tab change scope,
and so does `Alt+1…n` on Windows and Linux when Alt types no character there — a character a layout types
with AltGr or Option on a digit key (`#`, `@`, `|`) stays the input's, and macOS has no digit chord at all,
since Option always types one (a chip writes its prefix into the query, so the prefix is the one source
of scope). `Mod+I` toggles the preview pane where it is shown, `Mod+K` closes the palette (the chord that
opened it).
Escape clears the query, then closes; an untrusted (synthetic) Escape — the desktop close-item command —
closes outright. Closing without a pick returns focus to the element that held it when the palette
opened (the composer an accidental double Shift interrupted, the topbar button); a pick leaves focus to
its destination. An active IME owns every key ([[module-ui]]'s `isImeComposing`): composing
Escape, arrows, Enter and `Alt+n` do nothing to the palette, and Tab only stays in the input. Mutating rows
are disabled while offline or before the current welcome, and a command may carry its own disabled reason
(Settle while an agent works or a chat needs you). The palette has one level: no pages, no per-row action
panel — a row is a destination or a command.

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
