---
id: module-ext-session-insights
type: module-design
status: draft
title: Session insights extension
parent: module-thinkrail-extensions
depends-on: [module-pi-session-insights, module-extension-api, module-ui, module-locales]
references: [submodule-server-extensions, submodule-web-extensions, submodule-web-shell, submodule-server-history, module-ext-hint-mode]
tags: [extensions, session-insights]
---

## Responsibility

The ThinkRail halves of session insights: a local, on-demand breakdown of the user's past pi sessions,
per project or across all of them. The figures come from [[module-pi-session-insights]] on the host;
nothing leaves the machine. It is the first consumer of extension queries and panels
([[module-thinkrail-extensions]]).

- `./server` is the descriptor `session-insights` with `extensions: []` (no tools, skills or session
  factories), `supersedesPackages: ["@thinkrail/pi-session-insights"]` (see *Decisions*), `apiVersion`
  from the core and thirty queries: `sessions.list`, `session.summary`,
  `session.trace`, `event.get`, `event.anchor`, `trace.search`, `session.timeline`, `day.timeline`,
  `session.analysis`, `error.detail`, `session.subagents`, `subagent.get`, `session.context`,
  `request.diff`, `session.cost`, `session.files`, `file.detail`, `stats.usage`, `stats.hotspots`,
  `findings.list`, `findings.hide` (a write: a finding's hidden flag in `dataDir`),
  `stats.sequences`, `slices.compare`, `sessions.align`, `search`, `labels.get`, `labels.set` (a write:
  a session's labels and note in `dataDir`), and `export.html`, `export.trace` and `export.fixture` (writes
  into the asking workspace's artifacts folder, see *Exports*). `session.trace` and
  `event.get` take an optional `childId`, resolved to a transcript in the session's child directories
  (unknown ids answer `found: false`). `sessions.list` takes `fresh: true` (revalidate the index now),
  and `session.trace` / `sessions.align` a pinned `revision` / `revisions` answered from that snapshot
  while the core retains it, with `newerRevision` ([[module-pi-session-insights]] § Paging pins a
  revision); the web half sends `fresh` on the list's mount and *Refresh* and pins every later page.
  While the index is not `ready`, a session it has not reached yet answers `pending` from
  `session.summary`, `session.trace` (a subagent transcript not indexed yet too) and `sessions.align`
  instead of a final not-found; the queries a panel asks once the trace arrived keep `found` alone. Beside the descriptor, `./server` re-exports the core's
  record literals and shapes (`SUBAGENT_*`, `TODO_*`, `WAKE_DELIVERY`, …) for the host's tripwire tests,
  since the host reaches the core only through this entry.
  It adapts the `ExtensionHostServices` to the core's locators and callbacks: session files under
  `sessionsRoot()`, child transcripts from `childTranscriptDirs`, the summary cache in `dataDir`, rows
  placed by `sessionScope(scope).locate`, live and outcome from `sessionStatus`, chat positions from
  `messageAnchor`, model context windows from `contextWindow`, the files matrix's receipts from
  `turnReceipts` (only for a session whose workspace is open, since receipt paths are that worktree's), a
  fixture's workspace snapshot from `turnTree` and the exports' folder from `ensureArtifactsDir`. The index, the core's `TraceStore`,
  its `DayRowCache`, the statistics' `DigestStore` (built from `TraceStore.peek`, so a background digest
  never evicts the trace the user is reading), the `AlignmentCache`, the `SearchJobs` (with the trace store's redactor) and the `JsonStore` over `dataDir` are created on the first query, because the catalog builds `queries` against inert
  services and that must do no I/O; background failures go to `log.warn`. They all take the host's
  `signal`: switching the extension off stops the index's revalidation, the digest builder, a trace build
  and every search job at their next cooperative yield — no summary cache is written after it, no digest
  recorded — and the table lets go of all of them, so the host can drop it; a switch back on builds a
  fresh table that starts from the summary cache on disk (digests rebuild, as after a restart). A
  session the host hides
  (`sessionScope({ kind: "all" }).locate` is `null`) answers like an unknown one: `found: false`.
- `./web` declares three panels. `sessions` ("Session insights", «Разбор сессий», scope `project`, with
  translated `keywords` — cost, tokens, stats, usage, session history, analysis / стоимость, токены,
  статистика, расход, история сессий, разбор, анализ — so the palette finds it by what it shows): the
  session list as a sortable table grouped by project, the day view, the statistics (findings, usage
  and cost, hotspots, sequences, slice comparison) or search results across sessions, with a
  this-project / all-projects switch. It polls while the index is still building and offers *Open chat* for rows whose
  workspace is open and *Open analysis* for every row. `session` ("Session analysis", «Разбор сессии»,
  scope `session`, params `{ sessionId }`): one session's header (with its labels, note and *Export*
  menu) and eight sections — the trace
  explorer, the turn cards, the timeline, the subagent waves, the errors, context and cache, why it was
  expensive, and its files — sharing one selection and the call details. `compare` ("Session
  comparison", «Сравнение сессий», scope `session`, params `{ a, b }`): two sessions' calls aligned step
  by step (see *Session comparison*). The entry points are the SDK's generic ones (*Entry points*).

## Entry points

The palette was the only way in; the user chose (2026-11-18) the chat's own entry, a left-rail icon with a
shortcut and the chat lists' menus — not a Project Home card or small hints. Each is a declaration the
shell renders ([[submodule-web-shell]] § Extension panels), so each is hidden while the extension is off,
the host too old to answer queries or its catalog lacks the extension, like the palette row.
- **From a chat.** `session` declares a `chatAction` (`params: { sessionId }`, the menu item "Analyze
  session" / «Разобрать сессию»): the chat header shows "Session analysis ↗" / «Разбор сессии ↗» after the
  token and cost figures, before *Resources*, and the chat tab's menu, a Chats list row's ⋯ menu and each
  recently closed chat offer *Analyze session*. All open that chat's analysis tab, named after the chat —
  the one tab per session the list's *Open analysis* opens too —, for a closed chat as well; a chat with no
  message yet has no session file and offers none. pi's session id is ThinkRail's, so no lookup is needed,
  and a chat the index has not reached yet reads `pending` until it has.
- **The rail and its shortcut.** `sessions` declares a `rail` whose command is the extension's one global
  command, `session-insights.openSessions` ("Open Session insights", default `Ctrl+Alt+I`, ⌃⌥I on macOS —
  ⌘⌥I opens the browser's developer tools; the registry tests pin that the chord is free in the app
  table, among the reserved chords and in every element's local keys, on every platform): the
  bar-chart icon above the keyboard icon, in a workspace and on Project Home (which enters the project's
  Default first), opens the session list, its tooltip and the palette row show the chord as currently
  bound, and Settings → Keyboard rebinds it under *Session insights*, where the cheatsheet lists it too.

## Boundary

- The server half imports `extension-api/server` and its pi package only. The web half imports
  `extension-api/web`, `ui`, `locales`, React, react-virtuoso and Remix Icon, `@xyflow/react` and
  `@dagrejs/dagre` (the process map only, in its own lazy chunk), and **type-only**
  `@thinkrail/pi-session-insights/core`. Constants it needs are typed against the core's literal types,
  and the metric sources arrive in the payload.
- **Forbidden:** network I/O; PostHog or any other analytics capture (a failing query still reaches Error
  Tracking as the host's classifier-only request report); host imports; value imports of pi in `web/`;
  computing any figure in the browser, which only formats server figures (the error share beside the
  error count is the two server counts formatted as a percent; the trace's, timeline's and day view's
  layout — rows, lanes, pixel spans, merged ticks, activity strips, the axis — is presentation of server
  events and intervals, not a figure; so are which calls started inside a picked step's or skill's
  server stretches, and the widths of the recovery bars, drawn from the server's counts; so are the
  context chart's pixels, the waffle's cells allotted by largest remainder from the server's parts, a
  request's growth beside the previous one in the request list, and the cost chart's scale; and in the
  statistics the usage chart's axis maximum over the stacked server series, the sparklines' and share
  bars' heights, sorting and paging server rows, and the table filter by the server's session ids; in the
  sequences the matrix cells' colour steps and the slider's greying against the server's counts, the
  process map's dagre layout and edge widths, and the flow's band heights; in the slice comparison the
  intervals' and dot strip's scales; in the list, keeping the rows whose server labels carry the picked
  label; in the session comparison folding one-sided runs and hiding the
  same actions; in the search, merging the server's groups as they arrive, filtering the server's
  vocabulary by what is typed for suggestions and finding the token under the caret — input editing; the
  server parses the query that is searched);
  writes outside `dataDir` and the asking workspace's artifacts folder (`<artifacts>/session-insights/`,
  through `ensureArtifactsDir`).
- Malformed params of any query reject with the core parser's plain error before the index is touched;
  the web half only sends what it builds, so this is a broken-client path, not a coded refusal.
- Rows address sessions by `sessionId`; no request names a file path.
- UI text is `sessionInsights.*` keys in `en.json` and `ru.json` in the same change, plus
  `settings.extensions.session-insights.description` for Settings, whose row takes the web half's
  `title` (`sessionInsights.panel.title`) like its keyboard area and cheatsheet section. Origin and
  metric copy is looked up
  through literal key maps, because the i18n gate needs literal keys.

The core's invariants hold end to end ([[module-pi-session-insights]] § Invariants): no network, no
message text in the cache, pi-recorded headline totals, an origin on every figure, and ThinkRail paths
only through host-injected locators.

## Panel

- **Data.** `sessions.list` on mount and on every scope switch, re-polled every second while the index
  phase is not `ready` (rows already read show at once, the toolbar shows the phase with a `<progress>`),
  and on *Refresh*; the mount, a scope switch and *Refresh* ask `fresh: true`, so the host revalidates its
  index at once instead of on its own schedule. States: loading, empty (this project offers *Show all projects*), coded error
  (`EXTENSION_DISABLED`, `UNKNOWN_EXTENSION_QUERY` → update notice, anything else → *Retry*), version
  notice.
- **Table.** A native `<table>`: one project reads as a flat list, all projects group by project in the
  server's order with sessions outside every project last; the first three groups start open. Each group
  shows 25 rows and a *Show N more* line instead of virtualization, so the DOM stays bounded while table
  semantics and per-figure tooltips stay cheap. Seven figure columns sort (descending first, missing
  values last, the server's order between ties); the sort applies within groups.
- **Width.** Every column shows without sideways scrolling down to a 900 px panel (the default center
  area at 1920 px with both side panels open is about 955 px); only below 880 px does the table scroll. The
  Session column takes what the fixed columns leave and truncates (the full title stays in its `title`).
  Start reads day and time within the current year and the date alone before it; the figure's tooltip
  keeps the full timestamp. Below 1152 px of panel width (a container query on the scroll area) the figure
  columns halve their side padding; the Outcome column keeps its own so it doesn't run into Subagents. A
  figure or header too wide for its column ends in "…" rather than being clipped or overlapping.
- **Labels in the rows.** The user's labels show as chips under the name (three, then "+N") and a tag
  button after the compare button opens the labels editor (filled when the session has labels or a note).
  The toolbar's label filter (beside the mode buttons, with the table only) lists the labels in use with
  their sessions; picking one filters the table through the filter bar ("Label: good · N sessions").
- **Keyboard.** One roving tab stop enters the body; arrows, Home/End (with ⌘/Ctrl: the grid's ends) and
  PageUp/PageDown move between the session name, *Open analysis*, the compare and labels buttons and the
  figure buttons. Focusing a figure
  opens its tooltip. The session name is the row's *Open chat* button (inert, `aria-disabled`, for a
  removed workspace or a session outside every project), and Enter on any figure of an openable row opens
  it too. *Open analysis* (an icon button beside the name) opens the `session` panel for any row, removed
  workspaces included, since the analysis reads only the session file.
- **Rebindable keys.** Besides the rail's global command (*Entry points*), every letter or symbol key the
  panels take is a local `command` in one scope,
  `session-insights.panel` (`web/keys.ts`): `/` search, `n`/`N` matches, `e`/`E` failures, `r`/`R` retries,
  `z` zoom to the selection, `+` (also `=` and the numpad's), `-` and `0` zoom. The elements that take
  them — the panel root (search), the trace tree, the timeline's and the context chart's key buttons —
  carry `data-key-scope` and match through `useLocalKeys`, so Settings → Keyboard lists and rebinds them
  under *Session insights* and each one acts wherever it applies; the hints, zoom tooltips and
  `aria-keyshortcuts` show the resolved keys. One scope rather than one per view, so a rebind of zoom
  applies to every chart (the editor names every extension scope the same way anyway). Arrows,
  Home/End, PageUp/PageDown and Enter stay the elements' own and are listed as `shortcuts`; they act
  only unmodified. No default holds plain `F`: inside its element a local key would win over hint mode
  ([[module-ext-hint-mode]]), whose `F` must keep working in the trace, hence `z` (a test pins it).

## Statistics

- **A third list mode.** The toolbar's chart button switches the list panel to *Statistics* with five
  sections (*What to do*, *Usage and cost*, *Hotspots*, *Sequences*, *Compare*) over the same scope switch.
  Only the shown section asks its query (`findings.list`, `stats.usage`, `stats.hotspots {sort}`,
  `stats.sequences`, `slices.compare {by, a, b}`), re-asked after 1 s, 2 s, then every 5 s while the index
  is not `ready` or some session has no digest at all (`ready < total`; a progress line names how many),
  and never while the document is hidden (a due poll waits for its return). Sessions only being updated
  (`stale`: a live session counted from its previous revision) read "updating N sessions" beside the
  figures and keep nothing polling. A scope, option or refresh change keeps the last answer on screen
  (`busy`): the section's own controls stay, and only its results show a skeleton (the hotspots' table
  under another sort, the comparison under another slice). The switch between the five sections is a
  toolbar of toggle buttons, not tabs.
- **Show sessions.** A finding's *Show sessions*, a usage row's name, a hotspot's *Show sessions*, a
  transition cell's or failing call's sessions and a compared metric's sessions switch
  to the table filtered to those sessions (by the server's session indices), named in a filter bar with
  *Show all sessions*; switching scope or mode drops the filter. A row stays a list row: the filter only
  hides others.
- **Jump to a call.** A finding's session chip opens that session's analysis at its first linked call:
  the list panel records the event in a module the two panels share (`focus.ts`) and opens the session
  tab; a tab already open hears it and remounts its trace on the event, a new one reads it on mount. One
  tab per session stays one tab per session (a call in the tab params would open a tab per call).
- **Findings** (`FindingsView`): cards in four groups (skills; commands and tools; context, cache and cost;
  files and your repeats) in the server's order, with severity counts above. A card: an icon in its
  severity, a title and an explanation filled from fixed templates with the server's numbers, a
  *heuristic* pill where the rule is one, skill chips, a Wilson bar (0–50 % or wider, the interval, the
  point and the rule's 8 % threshold), the quoted error line with how many failures share it, what worked
  after a failure as a word diff, session chips (four, then "+N more"), "What to do" and, where the rule has
  one, a labelled template — or the argument diff — never applied. Its count pill's tooltip carries the
  provenance. *Hide* persists (`findings.hide`) and applies the hidden list the write answers in place,
  without asking `findings.list` again; hidden cards return under *Hidden: N* with *Show again*.
- **Usage and cost** (`UsageView`): totals (tokens, the headline cost with its provenance badge, and
  "+$X subagents outside pi's total"), Cost / Tokens and By model / By project switches, an SVG chart of
  per-day stacked bars on the calendar axis with the outside spend as a dashed segment (toggle), the change
  markers as dashed rules with their labels and a sentence each below, a legend ("$0 · not recorded · N
  tokens" for a model that records no cost) and a hover line naming the day's series. Below, tabs of
  sortable tables — models, projects, tools, commands, skills (never-loaded flag, listed-in, per-request
  tokens), subagent roles — with per-day sparklines and every figure behind its provenance tooltip (error
  rates with the Wilson interval).
- **Hotspots** (`HotspotsView`): a ranked table (rank, file and folder, touches, a read/edit/write bar,
  sessions, the signal its rule matched, the action) by touches, changes or sessions, chips filtering by
  action, and per row a *why* expansion: the counts, the session with the most changes and its day, the
  rule with its threshold, the action's steps (templates), *Open the session*, *Show sessions* and *Open
  file* (`PanelHost.openFile` in the newest open workspace of the project, else disabled). The footnote
  writes every rule and the touches not shown. The auxiliary *heat tree* nests the same files under their
  folders (one root per project in all projects) with `TreeRow`, `DiffStatBadge` and `folderChains` from
  `@thinkrail/ui`: touches with a heat bar, changes, rework `⟳N` and +/− lines per row; a picked file shows
  its *why* below. Each root is a `role=tree` (named by its project, or "Heat tree" for one) whose rows
  are `TreeRow` treeitems at their `aria-level`; outside the app's keyboard `Tree` they are plain Tab
  stops, without its arrow keys and `S` search.

- **Sequences** (`SequencesView`): the scope line (sessions with calls, calls, transitions) and a switch
  between three views of the server's activity families ([[module-pi-session-insights]] § Action
  sequences). *Transition matrix* (`TransitionMatrix`): a native `<table>` of activity → next activity,
  each cell its row share (or count) on the `ramp-1…4` steps with its count, loops outlined, a red dot where
  failed calls start ≥ 5 % of the cell, cells under the slider's threshold grey; the cells are one roving
  tab stop (arrows, Home/End). A picked cell (the largest by default) shows its counts, where its source
  goes next as a share bar, the sessions where it occurs most (each opens that session at its first
  occurrence) with *Show sessions*, and its real example — the pair and a call on each side — whose steps
  open the trace. *Process map* (`ProcessMap`, `React.lazy`, its own chunk with xyflow, dagre and xyflow's
  structural `base.css` in `@layer xyflow`): the directly-follows graph at the chosen edge threshold (≥ 1 / 2 / 5 % of the
  transitions) laid out left to right by dagre, nodes with calls, failures and ▶ starts / ■ ends, edges
  thick by count with count, share and after-error share as SVG labels, self-loops as arcs over the node,
  paired directions bent apart; the note names what the threshold hides (edges, transitions, nodes) from
  the server's figures; frequent three-step chains below. Nothing is draggable or zoomed by the wheel, so
  the page scrolls. *After an error* (`ErrorFlow`): a hand-laid SVG of five columns — the failed call's
  activity, three step states, the outcome — with bands as wide as the failures through them (into a
  recovery in the success colour, into a failure in the error colour, else the source's colour), the
  outcome labels with counts and shares, the counting note, the most failing tools and commands with an
  outcome bar and recovered share (a click shows their sessions), and the server's real recovery example.
- **Compare** (`CompareView`): slice A and B by model (two pickers over the sessions' main models), before
  / after a day (a date field committed on blur or Enter, so typing a date asks nothing; B starts on it), by project, by the user's label (two pickers over the
  scope's labels, B also "the rest"; with no labels yet a line says where to add them), or by a text
  filter, kept as the fallback (two fields; an empty B is the rest); the server picks defaults on first open. The A / B chips with their session counts and the
  method line, then a table per metric — A, B (provenance tooltips; heuristic retries and approximated
  active time badged), Δ with its relative change and the 95 % interval, the interval against zero as a
  mini chart, and the verdict pill: *B better* / *B worse* (success / error), *B higher* / *B lower* for
  neutral metrics (info), grey *not distinguishable*, dashed *no data* and *too few sessions*. Each
  metric names how many sessions are behind it as a *Show sessions* link. A note explains the grey verdict,
  carries the server's confound sentences (the slices also differ in time, project mix or main model) and
  how many metrics were checked at once. A picked metric (the first distinguishable one by default) draws
  a dot strip of its sessions per slice with the slice's figure as a line, and lists each slice's sessions
  by value, each opening its analysis.

## Search

- **A field in the toolbar, not a fourth mode button.** The list panel's toolbar holds the search field
  (`SearchBox`) after the mode buttons; `/` focuses it from anywhere in the panel outside a text field.
  Typing switches the body to the search results (`SearchView`); Esc clears the field and returns to the
  previous mode, a mode button leaves the search. The field is a `combobox`: for the filter under the
  caret it lists the scope's values from the server's vocabulary with their event counts (`model:` → the
  models, `error:` → yes, no and the error clusters, `file:` → workspace-relative paths, `label:` → the
  user's labels), a bare word
  starting a key suggests the key; ↑/↓ choose, Enter takes a chosen value, Tab the first, Esc closes.
  `project:` is offered across projects only. ↓ with no suggestions open moves into the results.
- **Data.** `useSearch` drives the panel's job (`search`, a random client id per panel): a query, after
  200 ms of no typing, starts a new `seq` with `facets: true`; an answer that ran out of time is followed
  by its `next` at once until a page is full, the scan ends or the user presses *Stop* (the answer in
  flight lands, *Continue* resumes from its cursor); *Load more sessions* asks the next page and a
  group's *Show N more in this session* its `more`. A search started while the host's index is still
  being built keeps scanning — its totals inexact — until the index is ready, reading the sessions
  indexed meanwhile ([[module-pi-session-insights]] § Search runs as a job per panel). Answers of an older `seq` are dropped, `expired`
  restarts the query, a version skew is the update notice, coded errors as in the list.
- **The view.** A bar of the server's reading — filters as removable chips, terms, keys it did not know
  ("searched as text"), parts it ignored — with the totals ("3 events · 2 sessions"; "≥53 events · ≥10
  sessions so far · read 10 of 14 sessions" with *Stop* while scanning), the filter keys as buttons that
  start a filter and an example query; a facet column of checkboxes (tool, model, skill in action — with
  its heuristic note —, project across projects, failed or not) with the server's counts ("≥" until
  exact) that add or remove the filter in the field; and the results grouped by session (newest first:
  title, project, start, matches), each hit a button: time, turn, kind (prompt, reply or the tool), the
  snippet with the matches marked (arguments, prompt and reply inline; a result or error snippet on a
  second line), "in result ×3" where else the terms occur, the model, and a failure's error line. ↑/↓,
  Home/End move between hits, ↑ from the first and Esc return to the field, Enter opens the session's
  analysis at the event (`focus.ts`, as findings do). States: the syntax help before a query, loading,
  no matches (with a hint when filters narrow it), error with *Retry*.

## Session comparison

- **Picking two sessions.** Each list row has a compare button beside *Open analysis* (a grid column of
  its own): the first click marks that session and shows a bar naming it with *Cancel*, a click on another
  row opens `PanelHost.openPanel("compare", { a, b }, "A ↔ B")` — one tab per ordered pair. Switching scope
  cancels.
- **The tab** (`ComparePanel`): both sessions' header cards (`session.summary`; start, turns, calls,
  failures, tokens, recorded cost, active time, subagents, outcome, every figure with its provenance), a
  strip of both sessions' turns sized by calls with the turn pairs as bands labelled *first turns* or the
  prompt similarity, the similarity line and the legend counts, *All steps* / *Differences*, and the
  aligned rows from `sessions.align` (paged in with both first-page revisions pinned, virtualized; when
  a side was still being written the complete snapshot stays with a "still being written · Reload"
  line): a heading per turn pair (or one-sided turn),
  then per row both calls — index, activity dot (red when failed), tool, argument, *failed*, time into the
  turn — with `=` (the same action) or a dashed `≈` (the same kind) between; a call only one side made has
  its side's edge (A `series-1`, B `series-6`) and an empty other half; runs of three or more plain
  one-sided calls fold into "N more steps only in A: …" until opened. A call opens its session's analysis
  tab at that call (`focus.ts`, as findings do).

## Session view

- **One tab per session.** *Open analysis* calls `PanelHost.openPanel("session", { sessionId }, title)`;
  the shell keeps one tab per (extension, panel, params) and names it after the session, so two sessions
  compare side by side and a reload restores them. An in-panel route was rejected: it would lose the list
  state, show one session at a time and persist nothing.
- **Header** from `session.summary`: the title (else the quoted first prompt), project › workspace with
  the live and removed badges, start, wall time (first to last entry, `counted`), active time
  (`approximated`), tokens, cost by the headline rule with the "+$X subagents outside pi's total" line, the
  models and the outcome, every figure with the list's provenance tooltip, the user's labels as chips and
  their note (three lines, the rest in its title), and *Labels* (the editor), *Export* and *Open chat*
  (disabled with a reason when the workspace is not open).
- **Sections.** A tab strip below the header: *Trace*, *Turns*, *Timeline*, *Subagents*, *Errors*,
  *Context*, *Why expensive*, *Files* — the extension's one `Tabs` component (one tab stop, ←/→ wrapping,
  Home/End, the tab panel labelled by the selected tab), as are the call details' tabs and the usage
  tables. The panel loads the
  trace once for every section, `session.analysis` once its last page arrived (bands, filters, badges and
  the errors section), `session.timeline` once a card or timeline section first opens,
  `session.subagents` once the subagents section does, and `session.context`, `session.cost` and
  `session.files` once their section does, and keeps them across switches. The selection is
  the panel's — an event id — so a step picked in a card is the trace's selected row and the timeline's
  outlined item; the trace falls back to its first row, the other sections to no selection. Another
  section can send the trace an intent (rows to focus, rows to open) that the explorer reads when it
  mounts. Subagent transcripts the trace expanded are kept by the panel and nested into the trace's model
  only (the turn cards and timeline keep the parent's own events); a transcript that failed to load loads
  again on the next expand, and loads still running when the tab closes are aborted. The panel's async
  loads share one keyed hook (`useKeyedQuery`: a new key aborts the previous load; a `pending` answer is
  asked again with the backoff), its header and data
  hooks live beside it (`Header.tsx`, `hooks.ts`).

## Labels and notes

- **The user's, kept by ThinkRail** (user decision: never in pi's session files). `labels.get` answers
  every labelled session's labels with the vocabulary, and a session's note when asked; `labels.set`
  replaces one session's labels and note (validated and limited by the core, atomic in `dataDir`).
- **The editor** (`LabelsEditor`, a popover from the row's tag button or the header's *Labels*): the labels
  as removable chips, a field that adds on Enter (Backspace on an empty field removes the last),
  suggestions from the labels in use and the quick `good` / `bad`, filtered by what is typed, and the note
  with its count; it says where they are kept and that exports leave them out. Save writes, then every
  panel of the web half re-reads (`announceLabelsChanged`); a refused set (`LABELS_FULL`) or a failure
  stays in the editor with its message. A note that fails to load keeps the field and Save disabled
  and offers *Retry*, so a save never erases a note it could not read.

## Exports

- **An *Export* menu in the session header** opens one dialog per kind — self-contained HTML, Chrome trace,
  e2e fixture — with *Include my labels and note* (off), the best-effort masking notice, and for the fixture
  the cut (each turn's end, the selection's turn by default, or right after the selected step) and a name.
  While it runs the dialog shows progress; then the written workspace-relative path with its size and
  notes (labels included, the snapshot or why there is none, binary files left out, subagent transcripts
  missing) and *Open in Artifacts* when the host offers `PanelHost.openArtifacts`; a failure shows its
  coded message (for `CHECK_FAILED`, what the check found) with *Retry*. The trace's dialog names the
  viewers that open the file — Perfetto UI, chrome://tracing, speedscope — and opens none.
- **The server writes, the browser never sees a body.** Concurrent exports of one session each take a
  name of their own and never overwrite one another ([[module-pi-session-insights]] § Exports are files
  the embedder places). `export.*` take the session and the panel's
  workspace id; the server builds the output from the core (HTML from the summary, timeline, analysis and
  subagents; the trace with each subagent transcript it has; the fixture with the host's `turnTree` for the
  turn's receipt when the session's workspace is open), runs the core's post-export check and writes into
  `<artifacts>/session-insights/` (fixtures under `fixtures/<name>/`), where the Artifacts tool lists it.

## Trace explorer

- **Data.** `session.trace` pages pre-order skeletons (2,000 events per page, a parent always before its
  children) and the explorer renders from the first page. Later pages ask for the first page's revision,
  so a session still being written pages one snapshot to its end; when the host says the file has moved
  past it (`newerRevision`), the panel keeps that complete snapshot and shows "still being written ·
  Reload" instead of restarting. Only a revision the host no longer keeps restarts the paging (a few
  times, then a failure with *Retry*; "no longer on disk" means the host does not have the session, and
  shows only once its index is ready: a `pending` header or trace keeps the section loading and is asked
  again with the statistics' backoff — 1 s, 2 s, then every 5 s, never while the document is hidden
  (`retryWithBackoff`, shared with `usePolled`) — as are the comparison tab's cards and alignment).
  Turns start collapsed when the whole trace (`meta.total` of the first page) holds over 2,500 events, so
  neither later pages nor a nested subagent transcript collapse an open tree; a jump to an event on a
  page still to come stays pending and opens its ancestors once it arrives. Bodies come one event at a time from `event.get` when a row is
  selected; the search box asks `trace.search` (debounced, two characters at least) and highlights the
  returned ids.
- **Tree column.** react-virtuoso with fixed 24 px rows: turn (a prompt, or a completion that woke the
  agent, titled "#n · background done" / "#n · subagent done" with a terminal or robot icon, whose details
  show the message as *Content*) → model call → tool calls → a subagent row (role in its role colour — a
  stable hash onto the categorical series —, the task title without the shared preamble, status,
  duration). A subagent with a transcript expands into its own trace, paged with `session.trace
  {childId}` on first open and nested under the row (ids `child:<childId>/<id>`, bodies from `event.get
  {childId}`; *Open in chat* is off for them). Identical consecutive calls fold into their first call
  with a `×N` badge (→ or a click unfolds; a model call whose tools are all folded folds with them). It is
  a `tree`: the container takes focus and names the selection with `aria-activedescendant`, rows are
  `treeitem`s with level, expansion and selection; ↑/↓/PageUp/PageDown/Home/End move, →/← open, close or
  go to the parent, Enter moves focus to the details tabs, `n`/`N` step through search matches, `e`/`E`
  through failures, `r`/`R` through retry attempts, `/` focuses search, `z` zooms to the selection,
  `+`/`-`/`0` zoom (the defaults of the panel's rebindable keys, *Panel*). Plain `F` is left to hint mode
  ([[module-ext-hint-mode]]), whose app-wide command takes it in the tree. A `treegrid` was the plan; a row
  has one cell, so `tree` is the honest role.
- **Gantt.** Custom Canvas 2D in three layers: the body (bars of the rows in view only, LOD-merged
  descendants of a collapsed turn per pixel with failures winning), an overlay redrawn alone for hover,
  the selection outline and a hover label, and the header (an overview with a draggable brush above the
  axis). The canvas is `aria-hidden` and mirrors the tree's selection; the tree carries every semantic.
  Laying out 10,000 spans in collapsed turns fits the 8 ms frame budget; its test asserts that only with
  `SESSION_INSIGHTS_PERF=1`, as the core's budgets do, and otherwise allows 500 ms, which a quadratic layout
  still exceeds and a loaded CI runner (86 ms seen) does not.
  Idle stretches over 2 minutes are compressed into labelled breaks (*Compress idle gaps*, on by default;
  the break shows its length, coloured when the user was being waited for). Axis ticks are cut per
  activity segment, each starting at its first round step, so a break costs nothing however long it is
  (walking real time through a year-long break took 31.5 million steps, review of #1417); the trace and
  timeline engines keep their last ticks (`tickMemo`), so a hover that redraws the axis computes none.
  Ctrl/⌘/Alt+wheel zooms at the pointer, Shift+wheel and drag pan, a plain wheel scrolls the rows, a
  double click zooms to a row, the overview brush selects, moves or recenters the window. Bars are coloured by tool family through the
  categorical palette (`series-1…8`, the model call on its own series, waiting for the user on `primary`),
  failures in `feedback-error`, approximated spans dashed; the legend lists only families present.
  Selecting a subagent (or its `Agent` call) draws two arrows: spawn → the run's first row, and the run's
  end → the parent call that read its result (dashed).
- **Plan and skill bands** (*Plan & skills*, on when the session has either): two sticky rows between the
  overview and the axis — each plan step's in-progress spans as numbered bars with a check when done and
  an error edge when it had failures; skills as an activation diamond with a hatched heuristic scope.
  The tree column's header names both rows; each is a menu of its steps or skills for the keyboard.
  Hovering a band names the step (status, spend) or skill (scope); picking one (click or menu) highlights
  the calls that started inside its stretches with focus mode on.
- **Filters.** *All* / *Errors · N* / *Repeats · N* / *Retries · N* (failed calls, repeat members, retry
  attempts, each with their ancestors opened), plus a removable chip for a selection another view made (a
  recovery chain, a cluster, a repeat, a plan step or skill). *Focus* switches from hiding non-matching
  rows to dimming them and folding runs of three or more into a "… N rows hidden" row that opens on a
  click (canvas bars dim with them).

## Turn cards

- One card per turn from `session.timeline`'s `turns`, in order: the number, what started it (a prompt,
  or a *background command finished* / *subagent finished* chip), the prompt or message excerpt and the
  start; the duration, *waited for you* when an ask was open, model calls, tool calls, errors and spend
  by the headline rule (tokens where the turn's cost is $0), all behind one tooltip with every figure's
  origin; a subagent badge; and an activity strip (canvas) of the turn on its own axis with the trace's
  idle stretches compressed: tool calls by family, asks behind them, model calls as a thin line,
  failures in the error colour. The badge slot shows the plan steps the turn worked on or changed (with
  how many it finished) and each skill it activated.
- The header button opens the card and selects the turn. An open card lists its steps — each model call
  with a mini bar of its place in the turn, its duration and its tool calls as chips (12, then "+N") —
  40 at a time with *Show N more*. A step or chip selects that event; the details' zoom button opens it
  in the trace. Filters: all, with errors, with subagents. The card holding the selection opens.

## Timeline

- Actor swimlanes on one canvas: *Who's blocking* (the core's bands), *You* (turn flags — prompts in
  `primary`, completion-started turns grey — and asks as boxes), *Model*, *Tools* (the server's packed
  tracks), *Subagents* (packed summary bars; the trace and the subagents section open them), *Context* (a step chart of each call's
  request context, heuristic misses as triangles, each model's context window as a dashed line over
  that model's calls, as the Context chart draws it, or, off scale, a label) and *Cost* / *Tokens* (pi's cumulative spend, dashed with subagents outside pi's total).
  Compaction and model-change markers are rules across the lanes. Below them, when the session has a
  plan or skills (*Plan & skills*), a skills row and one row per plan step: pending dashed (dotted when it
  is known only from `todo_list` reads), in progress as a bar, done as a check, removed as a cross,
  failures inside its in-progress stretches as red ticks and its spend on the right. Clicking a step or
  skill (or picking it from the toolbar's menu) dims every item outside its stretches. Lane labels are
  drawn in a gutter; a hover tooltip names whatever is under the pointer and the lane's meaning.
- It reuses the trace's scale, view maths, ticks and brush: compressed idle gaps (toggle), each labelled
  with its length and who was waited on — the labels are SVG text over the canvas, in the DOM, so they
  read and test like text; the axis switches between time and steps (`StepScale`: one step per model
  call, compression off); an overview strip with the brush; Ctrl/⌘/Alt+wheel zooms, Shift+wheel and drag
  pan, a double click zooms to an item or pause. A click selects the item (a context point selects its
  call) and pans the view to it when the selection comes from elsewhere.
- Beside the toolbar a summary row keeps the figures in the DOM: who blocked for how long (one tooltip,
  `approximated`), each model's context window with its provenance badge, and the spend.
- **Keyboard.** The canvas is `aria-hidden`; a visually hidden button over it takes focus (the lanes' box
  shows the ring through `has-[:focus-visible]`), describes the keys and carries them: ←/→ previous and
  next item in time, Home/End, Enter to the details, `z` zoom to the selection, `+`/`-`/`0` zoom; a live
  region names the selection. A focusable `div` was rejected: the lint gate forbids `tabIndex` on a
  non-interactive role, and no interactive role fits a chart.

## Day view

- The list's toolbar switches between the table and the day (icon buttons beside the scope switch).
  `day.timeline` answers the scope's sessions started on one day of the host's time zone, the latest day
  with a session first; previous and next jump between days that have sessions, and the zone is named.
  It is re-asked with the statistics' backoff while the index is not `ready` (never in a hidden tab), and
  keeps the shown day while another loads.
- A header line totals the day (model calls, tool calls, errors, tokens, spend by the headline rule and
  heuristic cache misses, one tooltip). Below, one row per session on a shared strip with the empty hours
  compressed into labelled breaks: turn bars (completion-started ones grey), one-minute tool ticks
  coloured by family with error marks, asks, cache-miss triangles, a warm-cache band and "→ continues"
  for a session that ran past midnight; a top row counts warm caches at once. The strip is canvas; the
  rows' names, time ranges, turn and subagent counts and figures are DOM buttons, and a row (or a click on
  its strip) opens that session's analysis tab.

## Subagents

- `session.subagents` drives a summary (runs by role in their colours, the most running at once, their
  recorded spend with provenance, failed or aborted runs, runs with failures inside, runs not measured)
  and one block per spawn wave (the first four, then *Show N more*): its turn and prompt, size, time span
  and spend, the first spawn's rationale as a quote with its source, and a fan-out / fan-in diagram — the
  parent's line with a ring per spawn and a dot where it read each result, a curve to each run's bar
  (dashed when the parent waited, solid for background runs, red when it failed) with the run's own
  activity ticks, and a dashed curve from its end to the read, so read delays show as distance. Each run
  is a DOM row (role, title, failures inside) over a canvas; its tooltip quotes why, the parent's words
  and what came back with the read delay (the server's `readDelayMs`), and a click opens it in the trace, expanded and selected.
- **The subagent tab** of a subagent row (`subagent.get`): role, status, waited-for or background,
  model, duration / spend / tokens with provenance; *Why* — the title, the parent's words before the spawn
  as a labelled quote linking to that call, the full task and the `Agent` call; *How* — its activity strip,
  counts, tool histogram, failed calls (each opens in the trace, loading the transcript), skills and
  *Expand in the trace*, or "no data" when the transcript is missing or its workspace was removed; *What
  came back* — how it arrived, a link to that event and to the parent call that read it, and the result;
  then its siblings in the same wave.

## Errors

- `session.analysis` drives chips (tool and model errors, clusters, retried and recovered chains,
  repeats), a recovery table — per tool: failures and a bar of its chains recovered by a retry / changed
  approach / gave up, with the rate; then model errors: same model / after a switch / never — whose
  tooltip states the heuristic, and the chains as cards: outcome and time to recover, the first error
  line, and the attempts as chips with the number of calls between them (chains without a retry fold
  into one list). Repeats ×N list below; each shows its calls in the trace with focus on.
- A chain opens its detail beside the list (`error.detail`): its error cluster (normalized key, how often
  it occurred, every occurrence in the trace), each attempt's main argument and error head, the calls made
  between attempts (edits marked) and the word-level diff from the previous attempt (removed struck
  through, added highlighted); *Show in the trace* opens the trace on its attempts and the calls between
  them, focus on.

## Context and cache

- `session.context` drives figures (peak with its share of the window, average, cache-read share, misses
  with the tokens written again, compactions), the estimate note (badged; it names the sessions whose
  system prompt was not persisted) and a chart: per call, the categories stacked bottom up in prompt order
  (tools, system prompt, skills list, summaries, your and extension messages, replies, tool results,
  thinking), the cache-read level as a dashed line, each model's context window as a grey dashed line
  (dotted when it is the largest observed rather than the host's), compaction and model-switch rules
  with their labels as SVG text (`compaction 977k → 68k (−93%)`), a miss row of triangles (the only
  error colour) and a cache strip (read / written / uncached on the sequential ramp, its own *Cache*
  legend group; the request diff's share bars use the same steps). It is canvas with a pixel-column LOD (each column draws its largest call; a miss inside
  always marks it), an overview strip whose drag picks a range, Ctrl/⌘/Alt+wheel zoom, Shift+wheel and
  drag pan, a double click for all calls, and a visually hidden button with ←/→, Home/End, +/−/0.
- Below: the misses table (call, time, written, read share, cause chips — "not explainable from the data"
  dashed) and the selected call's card: exact figures, the miss with its causes (badged heuristic), a
  waffle (1 cell = 1 % of the window, or of the context when it exceeds the known window) and what grew
  since the previous call (the server's per-category changes, badged estimate), *Compare with the previous
  request* and *Show in the trace*. The selection is the panel's: a selected tool selects the call that
  issued it.
- **Request diff** (the section's second view, `request.diff`): a virtualized list of every call (context,
  growth, a cache share bar, flags S system or tools, M model, P pause, U new turn; ↑/↓/PageUp/PageDown/
  Home/End) beside the reconstruction of the selected call: the two requests' figures and the pause, the
  share served from cache, on a miss where the requests first differ (an inference), the checked causes,
  the system prompt's changed sections with their character-level diff and the count of unchanged ones,
  the tool set before and after, and the messages — new, changed (context edit) and the unchanged ones at
  the edges with "… N unchanged" between — plus what a compaction stopped sending. It says it is a
  read-only reconstruction that sent nothing (C11).

## Why expensive

- `session.cost` drives a one-line diagnosis — a fixed template per kind (`longContext`, `cacheRewrites`,
  `manyCalls`, `spread`, `none`) filled with the server's figures and a focus clause (the two costliest
  plan steps, or turns, with their share and peak context) — under a note that it is a template over
  measured figures; the totals (recorded cost, or tokens with "$0 · not recorded"); evidence chips (cache-read
  share, median call price before and after the first compaction, calls at ≥ 80 % of their own model's
  window — each model's threshold named when several —, cache rewrites); and an SVG chart of $ (or tokens) per call capped near the 98th percentile with the highest
  labelled, the context as a line, compaction rules and the top three moments' ranges.
- The costliest moments, by $ (or tokens) or by time: rank, value with its share bar, plan step or turn
  title, a before/after-compaction tag when a step spans one, time range, calls × price per call, context
  range, failures and top tools; links to its costliest call and its prompt open the trace there. Then
  the rest summed, and one-off spikes with their cache write and the causes found — or "cause not
  derivable from the data", labelled.

## Files

- `session.files` drives filters (all, changed, rework, failed edits), a summary line and a native
  `<table>` matrix: files (path with a muted folder; sticky) × turns, or plan steps grouped under their
  turns when the server says so; reads as rings, edits (or writes) as filled squares with their count,
  failed edits as a red diamond, rework rows (≥ `REWORK_CHANGES` changes) tinted with an error edge and an
  `N×` badge, then reads / edits / writes and lines from tool calls. Forty rows at a time; the path buttons
  form one roving tab stop (↑/↓/Home/End).
- A picked file (`file.detail`) shows its counts, lines badged "from tool calls" (and the turn receipts'
  lines and runs when the host has receipts), its touches over the session as an SVG strip and as buttons
  into the trace, and its diffs (each edit's patch, each write's content, coloured by line) with *Open at
  this line* and *Show in the trace*. *Open file* uses `PanelHost.openFile` with the workspace-relative
  path when the file is inside the session's folder and its workspace is open; otherwise it is disabled
  and says why.

## Call details

- A side panel beside the trace (resizable, as are the tree and Gantt columns): icon, name, status,
  the ancestor path as buttons, start, duration (its origin in a tooltip: pi's `durationMs`, approximated
  from timestamps, or not measured), result size or tokens, and actions *Open in chat*, zoom to the row
  and copy the raw entries.
- **Tabs by kind:** turn → Prompt, Raw; model call → Model reply (reply, stop reason, request start,
  thinking — or how many blocks the provider encrypted —, pi's usage including cache, the tool calls it
  issued as links), Raw; tool call → Input, Result, Raw; subagent → Subagent (see *Subagents*), Input,
  Raw; marker → Content, Raw. A failing call opens on Result; otherwise the last picked tab the kind has.
- **Tool-aware input.** For `bash`, `edit`, `write` and `read` the Input tab defaults to *Rendered*:
  `PanelHost.renderToolCall` draws the chat's own renderer from the recorded arguments and output (edit →
  diff, bash → command and output); *JSON* and every other tool use the JSON viewer.
- **JSON viewer** (extension-local): collapsible nodes with counts, type colours from the categorical
  palette, long strings cut with *Show all*, multi-line strings as preformatted blocks, a parse toggle
  for strings holding JSON, a click on a key copies its path and on a value copies it, its own search with
  highlighted matches, and a chip with the original size wherever the server cut a string or an array.
- **Cut text** keeps the server's cut visible where it happened (70 % head, 30 % tail for tool output)
  with the omitted lines and characters and the original length.
- **What happened next:** the next three calls after the row's own subtree, as links.
- **Open in chat** asks `event.anchor` for the host's position of the event's message and calls
  `openChat` with it and, for a tool call, its `toolCallId`; the chat lands on the tool's row (or the
  activity row grouping it) and says so when it can only show the nearest message.

## Decisions

- **The vanilla `/insights` command stays out of ThinkRail.** The core package ships it for vanilla pi
  (S11); ThinkRail composes only the library. A user who installed the package for vanilla pi shares
  `~/.pi/agent/settings.json` with ThinkRail, so the descriptor lists the package in
  `supersedesPackages` and the host drops its extensions from every session's loader while this
  extension is on ([[submodule-server-extensions]] `omitSupersededPackages`) — the panel covers the
  command, which would read with vanilla locators and miss ThinkRail's delegation folders. Switching
  this extension off lets the user's install load again — in chats already open too, which reload for it
  once their turn ends (only those that load the package) — and Settings → pi packages says the package
  is replaced by Session insights while this extension is on.
- **The headline is pi-recorded.** Tokens and cost are pi's recorded totals. Subagent spend that pi's
  total misses shows as its own labelled line, "+$X subagents outside pi's total", and is never folded
  in. A model that records $0 reads "$0 · not recorded" with its tokens.
- **Hybrid provenance.** Only `approximated`, `notRecorded`, `partiallyRecorded` and `notMeasured`
  figures get a visible badge; exact figures stay clean. Every figure has a tooltip with its origin, how it
  was computed, and its source fields.
- **Sessions of removed workspaces stay listed**, with a badge, subagent figures "not measured" and no
  *Open chat*. `workspace.remove` deletes a workspace's pi sessions and delegation folder, so only
  survivors appear: sessions from older builds, a failed teardown, or a worktree removed outside
  ThinkRail.
- **A generic extension tab**, not a tool of its own: the shell's `extension` center tab and the palette's
  `view.extension.session-insights.sessions` ([[submodule-web-shell]] § Extension panels). The rail icon
  is still no tool (no `LayoutToolId`, no pane, no protocol change): a footer button that opens the tab.
- **Version skew is a notice, not a misread.** When the server half's declared version
  (`PanelHost.hostApiVersion`) or a result's `apiVersion` differs from the web half's, the panel asks the
  user to update ThinkRail instead of rendering the payload.
- **The name avoids "analytics"**, which in ThinkRail means product analytics (PostHog).
- **The JSON viewer is the extension's own.** `resource-renderers`' `JsonTree` is coupled to review
  threads and not exported; making it props-only would reshape a shared renderer for one consumer, and the
  viewer needs cut chips and embedded-JSON parsing nobody else does. It moves to `packages/ui` with a
  second consumer.
- **Canvas never parses a token's `color-mix()`.** Colours reach canvas through a probe's computed
  `color` canonicalized by `cssColorToHex` (moved to `@thinkrail/ui/theme`), re-read on `onThemeSwap` and
  `onFontsChange`. This resolves the unconfirmed assumption that WebKit 17's canvas accepts `color-mix()`:
  it was not verified (no WebKit runtime here), and the trace no longer depends on it.
- **Files open by workspace-relative path only.** Bodies are redacted (home → `~`), so the server resolves
  each `read`/`edit`/`write` path against the session's `cwd` (the workspace's worktree) before anything
  leaves it: inside, the browser receives the relative path and `PanelHost.openFile` opens it in that
  workspace; outside (skills, `/tmp`, another checkout), it receives the redacted path and no link.
- **Tool-call diffs stay analytics** (C3). The matrix and diffs come from the edit and write calls and are
  badged "from tool calls"; the host's turn receipts join by path when present and are never fed back into
  the turns module.
- **The heat tree's shared rows moved with it.** `TreeRow`, `DiffStatBadge` and `folderChains` moved
  from `apps/web/src/panels` to `@thinkrail/ui/tree-row`, `/diff-stat-badge` and `/folder-chains` when the
  heat tree became their second consumer; `ChangesTree` stays app-local. The heat tree is the auxiliary
  hotspot view; a treemap only if it proves insufficient.
- **The process map is its own lazy chunk.** `@xyflow/react` and `@dagrejs/dagre` (exact catalog pins)
  load only when the map view is shown: about 186 KB (60 KB gzipped) plus 11 KB of xyflow's structural
  CSS, none of it in the entry chunk or the statistics chunk. That CSS is imported `layer(xyflow)`, a layer
  the app orders below `components` and `utilities`, so token utilities win over it. Edge labels are SVG inside the custom edge
  (an HTML label renderer would need an inline style), nodes carry their own token classes, and the
  attribution stays (xyflow asks that only Pro subscribers hide it), restyled with token utilities on the
  map's frame (`[&_.react-flow\_\_attribution]:…`); it is a link that leaves only when clicked. "What follows an error" stays hand-laid
  SVG (no unmaintained sankey dependency); the matrix publishes the sequential ramp's first four steps.
- **A two-session diff is its own panel, not a section.** It reads two sessions, so it fits neither
  session tab; `compare {a, b}` keeps one tab per ordered pair through the generic extension tab and
  restores on reload.
- **Search reads the digests' columns and the lines that can match.** Facets and filters come from the
  per-session search columns built with each digest; free text re-reads only the candidate events' lines
  with a byte prefilter, newest session first, cancelled by a newer `seq` and paged by cursor
  ([[module-pi-session-insights]] § Decisions). SQLite FTS stays out: the streaming scan met the 1 s p95
  budget on the real-size corpus.
- **Exports go to the asking workspace's Artifacts, the session's own may be gone.** The panel's scope names
  the workspace (`PanelHost.scope`), so an export of a session from a removed workspace still lands where
  the user is; the fixture's snapshot needs the session's workspace open, since its tree is in that
  worktree's repository.
- **Statistics are memory-only digests, polled with a backoff.** The cold build reads every session of the scope once in
  the background (7–9 s for a 410 MB synthetic corpus, under 3 s for a 205 MB real one, no event-loop
  stall over ~30 ms); warm answers take tens of milliseconds. Persisting digests would put error lines and
  prompt excerpts on disk, against the core's no-message-text cache rule, so a restart rebuilds them, and
  so does a switch-off and back on, which drops them.

## Slices

Each slice is visible and shippable; the SDK arrived with the first. S1+S2: SDK, index, session list
and provenance. S3 (shipped): the session view, trace explorer, call details, the categorical palette and
the jump to a message or tool call. S4 (shipped): turn cards, the actor timeline, the day view and the
host's context-window service. S5 (shipped): subagent waves and nested subagent traces, todo-plan and
skill bands, errors and repeats as recovery chains. S6 (shipped): context and cache with the adjacent
request diff, why a session is expensive, the files matrix and `PanelHost.openFile`. S7 (shipped): the
statistics mode — findings in all four rule groups, usage and cost by day with its tables, hotspots with the
heat tree (and the `TreeRow` / `DiffStatBadge` / `folderChains` move). S8 (shipped): action
sequences (matrix, lazy process map, what follows an error), slice comparison with seeded bootstrap
intervals, and the step-aligned two-session diff in its own panel. S9 (shipped): faceted search across
sessions from the list panel's toolbar. S10 (shipped): labels and notes in ThinkRail's store with the list's
label filter, `label:` and the comparison by label, and the HTML, Chrome-trace and e2e-fixture exports into
Artifacts with the post-export secret check. S11 (shipped): the
vanilla-pi `/insights` command in the core package, which left `private` and passes the parity gate with
its first changeset — publishing it is a human release step — and the host keeping a user's install of it
out of ThinkRail sessions.

Accepted view choices for the remaining slices (product walkthrough, all deterministic, no LLM):
- Trace: a tree column + Gantt with todo and skill bands, switchable with per-turn summary cards; call
  details in a side panel with tabs, a JSON viewer and tool-aware renderers.
- Timeline: actor swimlanes with a who-waits band and labelled idle-gap compression, plus a day view of
  all sessions on one strip with a warm-cache band.
- Subagents: fan-out/fan-in waves per spawn with the rationale quote, the result and where the parent
  read it.
- Errors: recovery chains with per-tool recovery rates; a chain opens its cluster, the argument diff
  between attempts and the edits made in between.
- Todo plan and skills: bands on the shared time axis; skill scope is a labelled heuristic.
- Context and cache: per-call composition bars (estimates scaled to pi's total) with compaction drops and
  a cache strip with causes, plus a read-only diff of adjacent model requests.
- Cost: a one-line diagnosis and the costliest moments linked to calls; tokens where cost is $0.
- Files: a file × turn matrix; hotspots as a ranked list with a rule-based action, with a heat tree as
  the auxiliary view.
- Statistics: per-day usage with sortable tables; findings as evidence cards (skills, commands and
  tools, context/cache/cost, files and repeated instructions); action sequences as a transition
  matrix, a process map and "what follows an error" behind one switch; slice comparison with bootstrap
  intervals and a grey "not distinguishable" verdict; a step-aligned two-session diff.
- Search: faceted (`tool:`, `error:`, `file:`, `skill:`, `model:`) across sessions.
- Exports: self-contained HTML with secret masking, a Chrome-trace file (no "Open in Perfetto"), and an
  e2e fixture cut (session + workspace snapshot when a turn tree exists), all into Artifacts.
