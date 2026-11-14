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
opens its Settings section), and every verb runs through the command it was listed as (Start work through
the injected `PaletteStart`).

## Boundary

- **Public surface:** `SearchPalette`, `SearchPaletteProps`, `PaletteHost`, `PaletteStart`, `PaletteAsk`,
  `SearchSettings`, `initSearchPreferences`, `createDoubleShiftDetector`, `buildWorkItems`,
  `waitingItems`, `commandItems`, `SearchScope`, `PaletteItem`, `PaletteFile`.
- **Allowed deps:** `contracts` (the shared matcher and the search DTOs), `commands`, `store`
  (`selectHostSearchAvailable` / `selectHostReachable`, the welcome generation, the location Recent
  stamps), `transport`
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
context project gives them a root — `#` only a repository's (a chat without a project has files but no
specs, so its palette offers no Specs scope); otherwise a prefix whose scope is not offered searches the rest of the query in All (an older host
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
needs input, then failed, then finished unread, running chats left out — so the cap of eight rows before
an in-place "Show N more" never hides a blocked chat behind unread ones), **Recent** and **Actions**.

**Freshness.** `buildWorkItems` emits chats and workspaces newest activity first, so Waiting's urgency sort
(stable), the `@` listing and equal-score ties all read newest first. Activity is the workspace's
host-stamped `lastActiveAt` (agent runs, terminal writes, HEAD moves; at most a minute coarse) — the
signal the topbar switcher and the Chats section sort by. Equal stamps follow the rail: the Chats
container first (the rail shows it above Projects), then projects in the user's order, then a project's
Default, then its newest created workspace, so a chat without a project competes on freshness rather than
trailing every repository. A per-chat event time from the host was rejected: exact, but a contract change
for the rare tie of two waiting chats in one workspace, which keeps the snapshot's order.

**Recent** is where the user has been, newest first, by any route — the rail, the topbar, a link, the
palette — plus anything run from the palette: up to five rows by `lastUsed`, never the place the user is in
now (`currentPlaceIds`, read when the palette opens) nor a row Waiting or Actions already shows.
`initSearchPreferences` watches the store's location (the active workspace's attention center chat tab,
else the workspace, else Project Home) and stamps a visit when the place changes; a chat's visit retires
its workspace's stamp, and a pick of a row the current place already covers (its workspace, picked from
its chat — a navigation that changes nothing, so no visit follows) stamps the place instead, so one place
is one row while the pick still feeds frecency and adaptive learning. Visits order Recent only — typed-query ranking keeps
counting palette picks, so habitual places never outrank what a query has learned.

A chat or workspace row's second line names where it lives: its project and workspace
(`PaletteItem.subtitleEmphasis`) are drawn one colour step above the rest of the line, the separators
stay dim, and a chat without a project reads **No project** — never the container's stored name; the host
rows' `projectName` uses the same label.

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
(`searchHitFields`) — a message row only while every term is in its snippet (`matchContent`), so a
multi-term row whose later term lies outside the snippet leaves while stale and returns with the reply, and
a section row only while every term is somewhere in its spec title, heading and snippet (the engine ranks
by words, so this keeps only rows it would surely return) — so Enter only ever opens a row the typed text matches; a fresh row carries the host's matcher result
(`PaletteItem.match`) and ranks with the local rows by the same tiers; the host is asked only for what the
palette cannot list itself — files, specs, spec sections, plans and message text — while chats and workspaces are the
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

**Status.** Right of the input, the `RunningIcon` shows once a search — one input on one connection — has
been pending for 200 ms; a settled search that may be incomplete shows a yellow mark instead, whose tip
names every reason — part of it failed, it is still indexing after polling stopped, only N files of the
folder are listed (`cut.fileList`, in the interface language's digits), or a provider ran out of time
(`cut.time`) (`hostSearchReasons`). A mouse opens the tip by hovering (a click leaves it to the hover); a
touch toggles it per tap; pressing the mark never moves focus out of the input. The tip's state lives
with the mark, so a tip never reopens on its own when the mark returns. The reasons also describe the input
(`aria-describedby`) and reach the live region. Escape closes an open tip before anything else because the
tip is the highest layer of the one shared Radix dismissable-layer stack the dialog belongs to; an
active IME's Escape leaves it open. A host row opens through the injected `PaletteHost.openHit`. The `/` and `#`
scopes are offered only when the host searches files and specs and a context project gives them a root,
and the placeholder names files and specs exactly then.

## Spec sections

`#` asks the host for spec titles **and** sections; All never asks for sections (`scopeKinds`), so they
stay out of the mixed list. A section row is the host's `section` hit — ranked by words by the engine the
agent's `spec_search` uses, so both answer a question with the same sections — titled `Spec › Heading`
with the spec's name muted (`PaletteItem.titleLead`), the section's best line beneath with the matched
words highlighted, and an `n/m words` badge. Its group, **Sections**, follows the title matches by tier.
`↵` opens the spec in the Specs tool scrolled to the heading (`requestSpecView` with the heading line);
`Mod+I` previews the rendered spec at the section (`PaletteFile.line`).

## Ask the agent

Word search cannot meet a question that shares no words with the spec (a paraphrase, another language),
so whenever `#` has text its **last** row is «Ask the agent: “<text>”», naming the workspace it opens
in — last before rows that landed while a selection was held, which go after it as they go after Start
work, so a late Sections reply never moves a selected Ask row. `↵` on it, or `Alt+↵` from any row (`askEligible`, the one rule the row, the shortcut and its footer
hint share), closes the palette and calls the injected `PaletteAsk.ask(text)`: shell starts a **new**
chat in the context workspace — the active one, on Project Home the project's Default — with the text
as typed and the visible note «Find the answer in this project's specs and cite the sections.», so the
agent searches with its own model's words and the current chat is not interrupted. The row is always
there rather than only when results look weak: a fixed place keeps muscle memory, where a "weak results"
heuristic misfires both ways. While the host is unreachable the row is disabled with the host rows'
offline reason and `Alt+↵` does nothing (the chat start could only wait out the reconnect and drop the
question), and like Start work it is never remembered by the learning store.

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
renders as markdown (scrolled to `line` for a section), the same path as a preview tab; or the local **metadata card** (`PaletteItem.preview`)
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

## Start from the typed text

Whenever the query has a term in the All or Work scope and shell injects a `PaletteStart` (a context
project gives the dialog its project) — `startEligible`, the one rule the row, the shortcut and its
footer hint share — the last section before rows that land late is **Start work**: one row «Start work with “<text>”…» showing its
`Mod+↵` chord. `↵` on it, or `Mod+↵` from any row, closes the palette and calls the injected
`PaletteStart.openDialog(text)` — shell opens its Create-workspace dialog with the text as the prompt,
so the target, base branch and model are chosen where they always are, and a Create dialog already open
is kept as it is, its draft untouched (`openDialog` then returns `false`, and the palette hands focus back
to that dialog instead of leaving it nowhere). The prompt is the text as typed (`startPrompt`: only a scope prefix
stripped, one the palette does not offer included, as the parser drops it — inner whitespace, quotes
and tokens untouched), never the matcher's normalized terms. Nothing starts without the dialog: a held
`↵` / `Mod+↵` acts once in the palette, and the dialog ignores the key's repeats, so the same press never
submits it (the field keeps creation out of the finder: Warp walked its "search and run" box back,
Claude bound creation to an explicit `n:` mode). Like New workspace, the row is offered offline too (the
dialog itself needs the host to create). It is never remembered by the learning store and never counted
as a result in the live region. Rows a host reply brings while a selection is held land after every row
on screen, the Start row included, and never become the top hit, so a selected Start row does not move.
An implicit selection follows the ranking as host rows land, a lone Start row's too — like any first row
it may be overtaken while results stream in, and `Mod+↵` is the start that never depends on rows.
Holding a lone Start row as a selection was rejected: every host-only match would then land below it,
and plain search would open the Create dialog on `↵`.

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
opened it), `Mod+↵` starts work from the typed text and `Alt+↵` asks the agent from a `#` query (both
above).
Escape clears the query, then closes; an untrusted (synthetic) Escape — the desktop close-item command —
closes outright. Closing without a pick returns focus to the element that held it when the palette
opened (the composer an accidental double Shift interrupted, the topbar button); a pick leaves focus to
its destination. An active IME owns every key ([[module-ui]]'s `isImeComposing`): composing
Escape, arrows, Enter and `Alt+n` do nothing to the palette, and Tab only stays in the input. Mutating rows
are disabled while offline or before the current welcome, and a command may carry its own disabled reason
(Settle while an agent works or a chat needs you). The palette has one level: no pages, no per-row action
panel — a row is a destination or a command.

## Preferences

The learning snapshot (≤ 500 frecency items, ≤ 500 `lastUsed` stamps, ≤ 500 queries of ≤ 32 picks,
< 200 KB; a snapshot without `lastUsed` reads as none), the preview choice and the
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
