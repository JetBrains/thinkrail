---
id: submodule-web-find-in-files
type: submodule-design
status: active
title: findInFiles — the ⌘⇧F Find in Files window
parent: module-web
depends-on: [module-contracts]
references: [submodule-web-shell, submodule-web-store, submodule-web-search, submodule-server-search]
tags: [ui, search]
---

## Responsibility

The "where does it occur" surface beside the palette's "what to open": one window over the workbench that
searches the **contents** of the active workspace's files as you type, lists every matching line grouped by
file with the match marked, previews the selected match's code, and opens the file at that line. It owns the
query, the toggles, the results and the selection as client-local state so a reopen restores them, and the
one controller that talks to the host's `search.text` ([[submodule-server-search]]). It renders nothing
store-bound itself: the shell composes it (`FindInFilesHost`) and injects what a match opens with and how a
preview renders.

## Boundary

- **Public surface (barrel):** `FindInFilesDialog`, `FindInFilesDialogProps`, `FindInFilesHostState`,
  `FindInFilesTarget`, `useFindInFiles`, `openFindInFiles`, `closeFindInFiles`, `effectiveCaseSensitive`,
  `mergeFiles`.
- **Allowed deps:** `contracts` (the Find in Files DTOs and `TEXT_SEARCH_LIMITS`), `transport`
  (`search.text` and the `search.textResults` subscription), `commands` (`shortcutKeys` for the footer's
  platform keycaps), `components` (`Keycaps`, `highlightRanges`), `lib` (`hasPlatformModifier`),
  `@thinkrail/ui/*`, `zustand`, React, Remix Icon.
- **Forbidden:** importing `store`, `panels`, `shell`, `search` or `@thinkrail/resource-renderers` — the
  host injects `onOpen` (what `↵` / `⌘↵` do) and `renderPreview` (the source renderer over `fs.readFile`);
  binding the chord (the shell's `useGlobalHotkeys` owns `Mod+Shift+F`); taking double Shift, which stays
  the palette's; owning any search beyond file contents.

## Behavior

- **State (`state.ts`)** is a module-level zustand store, not the app store: `open`, `query`,
  `caseSensitive`, `wholeWord`, `searching`, `failed`, `results` (`seq`, the context key it was asked for,
  the host's `root`, the files, `done`) and `selected` (`path` + `line`). Everything but `open` survives
  a close, so ⌘⇧F again shows the last query, results and selection; `openFindInFiles` / `closeFindInFiles`
  are the only open-state writers (the chord, the palette command, `↵`, Escape and the overlay click).
- **Controller (`runner.ts`)**: a request is `{ query, caseSensitive, wholeWord, context }`; the dialog
  debounces 150 ms and skips a request identical to the last one asked (so a reopen does not re-search,
  while a changed workspace context does re-run the same query there). Smart-case is resolved here —
  `effectiveCaseSensitive`: a capital letter (any `\p{Lu}`) in the query makes the search exact, as the
  `Aa` toggle does — so the host only sees an explicit flag. Under `TEXT_SEARCH_LIMITS.minQuery` characters
  the results are cleared without a request; the query is clamped to `maxQuery`. `seq` is a clock-seeded
  monotonic counter per page (a reload never reuses one the host has seen); the one `search.textResults`
  subscription applies a batch only when its `seq` is the latest asked — a superseded or older search can
  never repaint the list. The first batch of a `seq` replaces the results and selects the first match;
  later batches merge by file (`mergeFiles`, keeping file order) and keep the selection while its file is
  still listed; `done` ends `searching`, `done.reason === "failed"` or a rejected request marks `failed`
  (and forgets the request key, so the same query can be retried).
- **Window (`FindInFilesDialog`)**: a Radix dialog at the top of the viewport — the query field with the
  `Aa` / `W` toggles (`⌥C` / `⌥W`, `aria-pressed`), a scope line ("in <workspace>") with the status (counts
  once `done`, searching, failed, offline, older host, or no workspace), the limit banner when the host
  stopped at `TEXT_SEARCH_LIMITS.lines`, the results as a `listbox` of file headers (name, directory, count)
  and `option` rows (line number, the cut line with `highlightRanges`), the selected match's preview below
  (`renderPreview`, keyed by workspace + path so changing the match within a file only re-reveals), and a
  footer of keycaps. `↑` / `↓` move the selection across file groups and scroll it into view; `↵` opens the
  selected match as a preview tab and `⌘↵` (`Ctrl+↵`) as a kept tab — both through `onOpen` with the
  `FindInFilesTarget` (the host's `root` workspace, path, line, column, length) and close the window; a
  click on a row does the same, hover selects. Escape closes. Keys are handled on the input; the rows are
  `tabIndex=-1` and `mousedown`-prevented so focus never leaves the field. Strings are `en.json` keys;
  icons are Remix; typography is `tr-code-text` for the query and lines.
- **Host state**: the dialog is told `ready`, `offline` or `unsupported` (a host before `search.text`,
  [[submodule-web-shell]] derives it from `supportsTextSearch`); only `ready` sends requests, the other two
  explain why nothing is searched. With no context (no project selected) the status says so.

## Get right

- A superseded search must never repaint the list: the `seq` gate lives in `applyTextSearchBatch`, not in
  the dialog.
- The results belong to the context they were asked for: results from another workspace are hidden (not
  cleared) when the context changes, and the same query re-runs there.
- Opening a match closes the window first, so the file tab receives focus and the reveal is seen.
