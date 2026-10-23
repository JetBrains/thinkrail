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

The universal entry point: one palette that finds chats, workspaces and projects, files, specs, plans
and chat transcripts, runs commands, and manages settings, opened with `Mod+K`, double Shift, or the
topbar search button. It owns the presentation, the query grammar, ranking and learning, the
store-derived work items, and the host-search controller (`search.query` / `search.preview`); the
command catalog, settings pages, their handlers and the way a host hit opens are composed and injected
by `shell`.

## Boundary

- **Public surface:** `SearchPalette`, `SearchPaletteProps`, `PaletteHost`, `SearchSettings`,
  `initSearchPreferences`, `createDoubleShiftDetector`, `buildWorkItems`, `waitingItems`,
  `WorkItemsState`, `commandItems`, `SearchScope`, `PalettePage`, `PalettePageSection`, `PaletteItem`,
  `PaletteItemKind`, `PaletteAction`, `PalettePreview`, `PaletteToggle`.
- **Allowed deps:** `contracts` (the shared matcher and domain types), `commands`, `store`, `transport`
  (the backend endpoint for browser preference keys), `clientPreferences`, `constants`, `components`,
  `lib`, `@thinkrail/ui/*`, `@remixicon/react`.
- **Forbidden:** importing `panels`, `chat` or `shell` (shell injects commands, pages and actions);
  owning a chord another module binds; sending host mutations itself outside the injected handlers and
  the store's navigation actions.

## Query grammar

A leading prefix selects a scope and its chip, and a chip writes the prefix back: `@` work (projects,
workspaces, chats, transcripts, plans), `>` commands and settings, `/` files, `#` specs — the last two
exist only when the host serves `search.query` (`supportsHostSearch`; an older host keeps the local
scopes and shows a notice). `#<digits>` is a pull-request lookup, never the specs scope. `is:waiting|error|unread|running|settled` and `has:pr`
filter work items anywhere in the query (`is:settled` is the workspace shelf rule, `has:pr` an open
review); a bare `is:` lists the filters. Quoted text is one contiguous literal term, escapes a prefix, and is
never read as a filter (`"is:running"` searches for that text).
Terms AND-combine through the shared matcher in [[module-contracts]].

## Ranking

The matcher's tier decides first (exact > prefix > word start > substring > subsequence); within a tier
the match score, a decay-free frecency (Firefox's stored form, 14-day half-life), the learned
query→selection count (Firefox adaptive history: `0.9·n + 1`, prefix-matched, ×0.975 per day), the
current workspace/project boost, and the attention boost reorder. A top hit shows only when the best row
is prefix-or-better and clearly ahead, or the typed query has latched to it. Groups are ordered by their
best row and capped at four in All (thirty in a scope) with an "N more" row that switches the scope.
The empty query lists **Waiting for you** (the former session switcher's attention set, every open
project), **Recent** (by frecency), and **Actions**.

## Host search

`useHostSearch` wraps the pure `createHostSearchController`: a 100 ms debounce, at most one request in
flight plus the latest queued input, a monotonic `seq` for the host's per-client superseding, and
fencing — a reply paints only when it answers the current input, its `seq` is the latest issued, the
welcome generation is unchanged and the host did not mark it `superseded`; a failed request paints
nothing and never retries; an `indexing` group polls every 300 ms up to twenty times, `truncated` and
`failed` never poll. The host is asked only for the scope's kinds (`scopeKinds`) and never on a page or
for an empty query. `hostItems` turns the host's groups into rows — files, specs, plans, transcripts, plus
chats and workspaces the client does not already list — carrying the host's matcher result as
`PaletteItem.match`, so `rankItems` ranks them with the local rows by the same tiers instead of
re-matching the title. Host hits that arrive after the user moved the selection are flagged `late` and
sort after their group's earlier rows, so the rows above the selection never reorder. A host row's
preview is loaded through `search.preview` (memoized per target) and renders a transcript window, a text
head, or the unavailable notice; a host row opens through the injected `PaletteHost.openHit`.

## Interaction

DOM focus stays in the input (WAI-ARIA combobox + listbox with `aria-activedescendant` and a polite
result count; chips and footer buttons are not tabbable, and Tab is always consumed). ↑/↓ select, ↵
runs the row (a toggle flips in place and the palette stays open; a page row pushes its page),
Tab/Shift+Tab and `Alt+1…n` change scope at the root (a chip writes its prefix into the query, so the
prefix is the one source of scope), `Mod+I` toggles the preview pane,
`Mod+K` opens the selected row's searchable action panel, Backspace on an empty page query pops it.
Escape closes the action panel, then pops a page, then clears, then closes; an untrusted (synthetic)
Escape — the desktop close-item command — closes outright. `Ctrl+R` is swallowed while the palette is
open. Mutating rows are disabled while offline or before the current welcome.

## Preferences

The learning snapshot (≤ 500 items, ≤ 500 queries, < 200 KB), the preview choice and the double-Shift
choice are client-local: the stable native preference adapter when present, otherwise browser storage
qualified by the backend endpoint. Only ids and query prefixes are stored, never row text.

## Double Shift

`createDoubleShiftDetector` is IntelliJ's gesture: press → release → press → release of a bare Shift,
each step within 300 ms, ignored when another key went down less than 100 ms before the first press,
reset by any other key, key repeat, IME composition (`isComposing`/229), another held modifier, pointer
down, blur or a hidden document, and firing on the second release. The sandboxed HTML preview iframe never
delivers keys to the parent window, so the gesture does not fire from inside it.
