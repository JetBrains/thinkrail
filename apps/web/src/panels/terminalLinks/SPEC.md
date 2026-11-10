---
id: submodule-web-panels-terminal-links
type: submodule-design
status: active
title: panels/terminalLinks — Mod+click links in terminal output
parent: submodule-web-panels
depends-on: [module-contracts]
tags: [terminal, public-surface-checked]
---

## Responsibility

Turn what a terminal printed into links: find URL and path candidates in a row of xterm's buffer, ask the
host which paths exist, and hand xterm only the links worth underlining. Opening a target is the caller's
business; this module never touches the store, the transport, or tabs.

## Boundary

- **Owns:** the pure candidate parser (`parseTerminalLinks`), the soft-wrap-aware reading of one logical
  line out of an xterm buffer with its string-index → cell map (`readLogicalLine`), and the xterm
  `ILinkProvider` factory with its per-line batching, short-lived answer cache, overlap rule and
  modifier-gated activation.
- **Public surface (`index.ts`):**
  - `createTerminalLinkProvider`
  - `type TerminalLinkTarget`
- **Allowed deps:** `@thinkrail/contracts` (`TerminalPathTarget`, the path-candidate limits); `@xterm/xterm`
  types only.
- **Forbidden:** store, transport, `openTabs`, i18n, React; deciding what a path names (the host does,
  through `terminal.resolvePaths`); xterm addons (the link API is core).

## Decisions

- **The parser over-collects; the host decides.** A candidate is any http(s) URL; a `file://` URL (its
  decoded path); Python's `File "x.py", line 12`; a quoted string containing whitespace that looks like a
  path; and any unquoted token that has a letter and either a location suffix (`:12`, `:12:5`, `(12,5)`,
  `: line 12, col 5`), an explicit prefix (`/`, `./`, `../`, `~/`, a drive letter), a separator, or a final
  `.ext`. Unquoted spaces split paths — `my file.ts` is only a path when quoted. Unquoted tokens stop at
  whitespace, quotes, `()<>|;,:=*?!{}&`, arrows (U+2190–21FF) and box-drawing glyphs (U+2500–257F, so a
  miette/oxlint `╭─[src/a.ts:3:1]` frame yields its path); brackets stay so `app/[slug]/page.tsx` survives, but a token
  wrapped in or ending with unbalanced brackets loses them, and trailing dots are sentence punctuation.
  URLs lose trailing `.,;:!?'"` and any unbalanced closing bracket, so `(https://x/a_(b))` keeps its inner
  pair; bracket balance is counted once, so a long run of closers trims in linear time. URL and Python-frame spans are masked from the other scans. Line or column numbers of zero or
  beyond ten million are dropped rather than trusted. Words like `and/or` or `e.g.` become candidates and
  are simply not confirmed: one batched request per hovered line is cheaper than a parser that guesses.
- **Overlap: the longest confirmed candidate wins.** A quoted path with spaces also yields the unquoted
  tokens inside it, so `"see src/a.ts for details"` still links `src/a.ts` while `"my dir/f.ts"` links whole
  when it exists. URLs are always confirmed.
- **Only confirmed targets are underlined.** A path becomes a link only when `terminal.resolvePaths`
  names a file or folder for it; a URL always does. The hover adds the pointer cursor, the underline and
  the caller's hint; activation does nothing unless the caller's `isActivation` (the platform modifier)
  accepts the mouse event, so a plain click still selects text.
- **One request per line, answers reused for 2 s.** Unique path candidates of the hovered logical line (at
  most `MAX_TERMINAL_PATH_CANDIDATES`, and none longer than `MAX_TERMINAL_PATH_LENGTH`, which the host would
  reject together with every valid path beside it) go in one request; answers, including "no", are cached per candidate
  string for 2 s, so sweeping the mouse over output costs a request per new line, while a file created or a
  `cd` made a moment later is picked up on the next hover. A failed request answers "no" for that window.
- **Soft wraps are one line.** xterm marks a row that continues the previous one `isWrapped`; the provider
  joins up to 32 rows each way, keeps a wrapped row's trailing blanks (they are content) and trims only the
  logical line's end, and maps each string index to its cell so a link may span rows. Wide characters map
  to their first cell and their spacer cell is skipped. Only links touching the asked row are offered,
  because xterm asks per row.
- **A superseded ask is never answered.** xterm keeps one reply map for the row under the mouse and lets a
  late reply for a row the mouse has left land in it. Each `provideLinks` call supersedes the previous one;
  an earlier call whose request resolves late is dropped instead of answered.

## Validation

- `parseTerminalLinks.test.ts` — fixtures for tsc (both formats), eslint (stylish, compact, unix), pytest
  (location and summary), Python tracebacks (with and without spaces), cargo and Rust panics, Go, gcc,
  MSBuild with a drive path, Node stack frames (path and `file://`), Vite; path shapes (incl. box-drawing
  frames), punctuation, quoted paths with spaces, URLs with trailing punctuation and parentheses (incl. a
  linear-time run of closers), and non-links.
- `terminalLinkProvider.test.ts` — logical-line joining and cell mapping (wrapped rows, trailing blanks,
  wide characters); URL links without a request; one batched request per line and only confirmed paths;
  an over-long candidate never sent;
  answer reuse and expiry; wrapped link ranges; overlap; modifier-gated activation and target shapes;
  hover hint; a failing host; a superseded ask.
