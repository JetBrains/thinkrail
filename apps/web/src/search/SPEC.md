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

The one finder: a palette that finds chats, workspaces and projects, runs commands and opens Settings
sections, opened with `Mod+K`, double Shift, or the topbar search button. It owns the presentation,
the query grammar, ranking and learning, and the store-derived work items; the command catalog and its
handlers are composed and injected by `shell`. It finds and jumps — it never mutates a setting in
place (every setting row opens its Settings section), and every verb runs through the command it was
listed as.

## Boundary

- **Public surface:** `SearchPalette`, `SearchPaletteProps`, `SearchSettings`, `initSearchPreferences`,
  `createDoubleShiftDetector`, `buildWorkItems`, `waitingItems`, `WorkItemsState`, `commandItems`,
  `SearchScope`, `PaletteItem`, `PaletteItemKind`, `PalettePreview`.
- **Allowed deps:** `contracts` (the shared matcher and domain types), `commands`, `store`, `transport`
  (the backend endpoint for browser preference keys), `clientPreferences`, `constants`, `components`,
  `lib`, `@thinkrail/ui/*`, `@remixicon/react`.
- **Forbidden:** importing `panels`, `chat` or `shell` (shell injects the commands and their handlers);
  owning a chord another module binds; sending host mutations itself outside the injected handlers and
  the store's navigation actions.

## Query grammar

A leading prefix selects a scope and its chip, and a chip writes the prefix back: `@` work (projects,
workspaces, chats), `>` commands and settings; `/` files and `#` specs join with host search. `#<digits>`
is a pull-request number, never the specs scope — it matches the `#N` keyword of the workspace that
carries that review. Quoted text is one contiguous literal term — never matched as an acronym or a
subsequence — and escapes a prefix; an unterminated quote runs to the end of the query, so a phrase
matches while it is typed. Terms AND-combine through the shared matcher in [[module-contracts]], which
folds case and Latin diacritics (`configuracion` finds `Configuración`) without moving highlight offsets.
`/` and `#` fall back to All on a host without host search. There is no filter grammar: triage happens
through the empty state's grouping and the status dots every row carries.

## Ranking

The matcher's tier decides first (exact > prefix > word start > substring > subsequence); within a tier
the match score, a decay-free frecency (Firefox's stored form, 14-day half-life), the learned
query→selection count (Firefox adaptive history: `0.9·n + 1`, prefix-matched, ×0.975 per day, keyed on
the query's text without its scope prefix and computed once per query, each query keeping its 32 most
recent picks), the current workspace/project boost, and the attention boost reorder. A top hit shows only when the best row
is prefix-or-better and clearly ahead, or the typed query has latched to it. Groups are ordered by their
best row and capped at four in All (thirty in a scope) with an "N more" row: in All it switches to the
group's scope, in a scope it expands the group in place. The empty query lists **Waiting for you** (the
former session switcher's attention set without running chats — a chat that needs input, failed or
finished unread — across every open project, eight rows before an in-place "Show N more"), **Recent** (by
frecency), and **Actions**.

A chat row is worded by `lib`'s `chatLabel` over the known title (a layout tab, a history row, the
title backfill) and the host-reported first prompt (`selectRecordFirstPrompts`): an unnamed chat reads as
its first prompt, carries `data-title-source` and the full first line as its tooltip, and is matchable by
the whole prompt (a keyword), so words past the 48-character cut still find it; an unnamed chat with
neither a prompt nor attention is not listed.

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
