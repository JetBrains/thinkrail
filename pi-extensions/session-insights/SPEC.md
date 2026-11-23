---
id: module-pi-session-insights
type: module-design
status: draft
title: "@thinkrail/pi-session-insights — deterministic analysis of pi session files"
parent: module-pi-extensions
tags: [pi-extension, session-insights]
---

## Responsibility

Deterministic, LLM-free analysis of the session files pi writes, portable to vanilla pi. It reads session
JSONL and subagent transcripts and turns them into per-session summaries and the views built over them;
it never runs an agent, calls a model, or writes a pi file. ThinkRail composes it from
[[module-ext-session-insights]] and injects where ThinkRail keeps things. Vanilla pi reaches it through
the package's own `/insights` command over pi's default locations (S11 in [[module-ext-session-insights]]
§ Slices): a text report of the scope's findings and usage, or of one session, with optional exports.
The package is publish-ready and awaits its first, human release ([[module-pi-extensions]] § Release).

It owns session-file discovery, a streaming parse, the per-session summary, the incremental index and
its summary cache, the recorded-totals mirror, the subagent join, the session-list and session-header
builders, the trace (event skeletons, bodies re-read on demand, full-text search), the session timeline
(turn cards, who-waits bands, packed lanes, counters), the day timeline, the session analysis (the
pi-todos plan, skill activations, repeats, recovery chains, error clusters), subagent waves with their
quotes, results and activity, each call's context composition and cache split, the read-only
reconstruction of adjacent requests, why a session was expensive, the files matrix, the statistics across
sessions (per-session digests, usage and cost by day, file hotspots, the "what to do" findings and a small
store for the user's choices about them, action sequences, slice comparison), the step alignment of two
sessions, search across sessions (the filter syntax, facets from per-session columns, free text by a
byte-prefiltered read of candidate lines), the user's labels and notes (kept in the embedder's store),
exports of a session (a self-contained HTML page, a Chrome trace, an e2e fixture cut) with a
post-export secret check, redaction, and the provenance of every figure it reports.

## Public surface

- **`./core`** is the result contract. It has **no runtime imports**, only types and constants, because
  the ThinkRail web half type-imports it and a type graph that reaches `node:` breaks the browser's type
  check. It holds the payload version (`SESSION_INSIGHTS_API_VERSION`, 11 since `session.overview`
  joined; 10 since the payloads carry the
  figures the web used to derive — a call's `CallUsage.context`, the timeline's `peak`, `waitsTotal` and
  `llmCalls`, the analysis' `toolFailures`, a run's `readDelayMs`, a day row's `cacheMisses` — and
  `newerRevision`, `DigestProgress.stale` and the summary's, trace's and alignment's `pending` are always
  present; the list's `fresh` and the pinned
  `revision` / `revisions` are optional params),
  the query names (`SESSIONS_LIST_QUERY`, `SESSION_SUMMARY_QUERY`, `SESSION_OVERVIEW_QUERY`,
  `SESSION_TRACE_QUERY`, `EVENT_GET_QUERY`, `EVENT_ANCHOR_QUERY`, `TRACE_SEARCH_QUERY`,
  `SESSION_TIMELINE_QUERY`, `DAY_TIMELINE_QUERY`, `SESSION_ANALYSIS_QUERY`, `ERROR_DETAIL_QUERY`,
  `SESSION_SUBAGENTS_QUERY`, `SUBAGENT_GET_QUERY`, `SESSION_CONTEXT_QUERY`, `REQUEST_DIFF_QUERY`,
  `SESSION_COST_QUERY`, `SESSION_FILES_QUERY`, `FILE_DETAIL_QUERY`, `STATS_USAGE_QUERY`,
  `STATS_HOTSPOTS_QUERY`, `FINDINGS_LIST_QUERY`, `FINDINGS_HIDE_QUERY`, `STATS_SEQUENCES_QUERY`,
  `SLICES_COMPARE_QUERY`, `SESSIONS_ALIGN_QUERY`, `SESSIONS_SEARCH_QUERY`, `LABELS_GET_QUERY`,
  `LABELS_SET_QUERY`, `EXPORT_HTML_QUERY`, `EXPORT_TRACE_QUERY`, `EXPORT_FIXTURE_QUERY`), the limits and rules
  (`TRACE_PAGE_EVENTS`, `TRACE_LABEL_CHARS`, `TRACE_SEARCH_MAX_IDS`, `TRACE_GAP_MIN_MS`, `CACHE_TTL_MS`,
  `TIMELINE_TOOL_TRACKS`, `TIMELINE_SUBAGENT_TRACKS`, `DAY_TICK_MS`, `RETRY_WINDOW_CALLS`,
  `RETRY_SHARED_WORDS`, `ACTIVITY_TICKS`, `EXCERPT_CHARS`, `CHILD_EVENT_PREFIX`, `CONTEXT_CATEGORIES`,
  `REWORK_CHANGES`, `COST_MOMENTS`, `OVERVIEW_RULES`, `USAGE_CHART_SERIES`, `SPARK_POINTS`, `USAGE_COMMANDS`,
  `HOTSPOT_FILES`, `HOTSPOT_RULES`, `FINDING_RULES`, `KNOWN_EXIT_CODES`, `ACTIVITIES`,
  `SEQUENCE_RULES`, `COMPARE_RULES`, `ALIGN_RULES`, `SEARCH_FILTER_KEYS`, `SEARCH_RULES`, `LABEL_RULES`,
  `EXPORT_RULES`), the figure model (`Origin`,
  `BADGED_ORIGINS`, `Figure`,
  `MetricId`, `METRIC_SOURCES`), the other packages' record literals and shapes it reads structurally
  (`SUBAGENT_SPAWN_TOOL`, `SUBAGENT_RESULT_TOOL`, `SUBAGENT_TOOLS`, `SUBAGENT_COMPLETION_MESSAGE`,
  `BACKGROUND_COMPLETION_MESSAGE`, `WAKE_DELIVERY`, `SUBAGENT_USAGE_KIND`, `UNFINISHED_RUN_STATUSES`,
  `FAILED_RUN_STATUSES`, `SubagentRunRecord`, `TODO_TOOLS`, `TODO_STATUSES`, `TODO_TEXT_GROUP`,
  `TODO_TEXT_ITEM`, `TodoRecord`, `TodoGroupRecord`, `TodoPlanRecord`; *Structural shapes* below), and
  every query's params and result shapes (the list, `SessionOverview` (the header row),
  `SessionOverviewResult` with `SessionOverviewCards` — `OverviewHappened` / `OverviewPlan` /
  `OverviewPlanStep`, `OverviewCost`, `OverviewErrors` / `OverviewChain` / `OverviewAttempt`,
  `OverviewContext`, `OverviewFiles` / `OverviewFile`, `OverviewSubagents`, `OverviewTurns`,
  `OverviewFinding` / `OverviewFindingLink` —,
  the `TraceEvent` union with `TurnTrigger`, `TraceMeta`, `TraceGap`, `EventBody` with `CappedText` /
  `CappedJson`, `ChatAnchor`, `SessionTimeline` with `TurnSummary` / `WaitBand` / `TimelineLanes` /
  `ContextPoint` / `ContextLimit` / `SpendPoint`, `DayTimelineResult` with `DaySession` / `DayTurn` /
  `DayTick`, `SessionAnalysis` with `SessionPlan` / `PlanStep` / `SkillActivation` / `TurnBadges` /
  `RepeatGroup` / `RecoveryChain` / `ErrorCluster` / `ToolRecovery` / `ModelRecovery`, `ErrorDetail` with
  `ChainAttempt` / `DiffSegment`, `SessionSubagents` with `SpawnWave` / `SubagentRun` /
  `SubagentActivity`, `SubagentDetail`, `SessionContext` with `ContextCall` / `MissCause` /
  `CompactionCliff` / `ModelSwitch`, `RequestDiff` with `RequestSide` / `RequestMessage` / `SectionDiff` /
  `ToolSetDiff` / `MissCheck` / `FirstDifference`, `SessionCost` with `CostCall` / `CostMoment` /
  `CostSpike` / `CostDiagnosis`, `SessionFiles` with `FileColumn` / `FileCell` / `FileRow`, and
  `FileDetail` with `FileTouch` / `FileDiff` / `FileReceipt`, and the statistics: `Rate`,
  `DigestProgress`, `SessionRef`, `StatsUsage` with `UsageSeries` / `UsageMarker` / `UsageModelRow` /
  `UsageProjectRow` / `UsageToolRow` / `UsageSkillRow` / `UsageRoleRow`, `StatsHotspots` with
  `HotspotFile` / `HotspotDir` / `HotspotAction`, `Finding` with `FindingRule` / `FindingGroup` /
  `FindingLink` / `FindingDiff`, the hide params, `StatsSequences` with `Activity` / `ActivityNode` /
  `SequenceCell` / `SequenceExample` / `EdgeThreshold` / `SequenceChain` / `SequenceFlow` / `FlowNode` /
  `FlowLink` / `FailureRow`, `SlicesCompare` with `SliceBy` / `SliceSide` / `CompareMetric` /
  `CompareVerdict` / `SliceConfound`, `SessionAlignment` with `AlignSide` / `AlignTurn` /
  `AlignStep` / `AlignRow` / `TurnPair`, and the search: `SessionsSearchParams`, `SessionsSearchResult`
  with `ParsedSearch` / `SearchFilter` / `SearchTerm` / `SearchSpan` / `SearchStatus` / `SearchGroup` /
  `SearchHit` / `SearchSnippet` / `SearchField` / `SearchFacets` / `FacetValues` / `FacetCount` /
  `SearchVocabulary`), the labels (`SessionLabels`, `LabelsGetParams` / `LabelsGetResult` with
  `LabelCount`, `LabelsSetParams` / `LabelsSetResult`, `LabelRules`) and the exports (`ExportKind`,
  `ExportParams`, `ExportFixtureParams` with `ExportCut`, `ExportResult` with `ExportNote` /
  `ExportErrorCode` / `ExportCheckFinding`, `ExportRules`). Literal types (`SessionsListQuery`, `SessionTraceQuery`, …,
  `TracePageEvents`, `SessionInsightsApiVersion`, `ChildEventPrefix`) let a browser type its own constants
  without a value import.
- **`.`** is the engine: discovery (`defaultSessionsRoot`, `listSessionFiles`,
  `vanillaChildTranscriptDirs`), the parse and summary (`PARSER_VERSION`, `summarizeSessionText`,
  `recordedTotals`), the index and cache (`SessionIndex`, `fileSummaryCache`), the list and header
  (`parseSessionsListParams`, `parseSessionParams`, `buildSessionsList`, `buildSessionSummary`), the trace
  (`TraceStore`, `tracePage`, `parseTraceParams`, `parseEventParams`, `parseSearchParams`), the
  timelines (`buildSessionTimeline` with an injected `contextWindow` lookup and the per-child outside
  spend from `subagentJoinOf`; `buildDayTimeline`, `DayRowCache`, `parseDayTimelineParams`, `localDay`),
  the analysis (`buildSessionAnalysis`, `buildErrorDetail`, `parseErrorDetailParams`, `wordDiff`), the
  subagent waves (`buildSessionSubagents`, `buildSubagentDetail`, `parseSubagentParams`,
  `childActivity`, `SubagentActivityCache`, `childTranscriptsOf`), context and cache
  (`buildContextView`), the request diff (`buildRequestDiff`, `parseRequestDiffParams`), why expensive
  (`buildSessionCost`), the Overview (`buildSessionOverview` with `SessionOverviewInput`), the files matrix (`buildSessionFiles`, `buildFileDetail`, `parseFileDetailParams`,
  with an embedder's `ChangeReceipt`s), the statistics (`DigestStore`, `digestOf` / `digestInStages`,
  `buildStatsUsage`, `buildStatsHotspots`, `buildFindingsList`, `parseStatsParams`,
  `parseHotspotsParams`, `parseFindingsHideParams`, `setFindingHidden`, `buildStatsSequences`,
  `parseSequencesParams`, `buildSlicesCompare`, `parseCompareParams`, the `StatsInput` they read and the
  `JsonStore` they keep the hidden findings in), the alignment (`buildSessionsAlign` with `AlignInput`,
  `AlignmentCache`, `parseAlignParams`), the search (`SearchJobs`, `parseSearchQuery`, `parseSessionsSearchParams`; a
  `StatsInput.labelsOf` lookup feeds `label:` and the comparison by label), the labels (`readLabels`,
  `setSessionLabels`, `labelsView`, `labelLookup`, `parseLabelsGetParams`, `parseLabelsSetParams`), the
  exports (`renderSessionHtml`, `exportTitle`, `chromeTraceOutput`, `fixtureOutput`, `receiptForTurn`,
  `writeExport`, `exportBaseName`, `exportFailure`, `parseExportParams`, `parseExportFixtureParams`, with
  the embedder's `ExportTarget` and `TreeFile`) and redaction (`createRedactor`,
  injectable into `TraceStore` and `SessionIndex` for another home folder), with their types. It re-exports `./core`, whose
  shapes its signatures use.
- **`./extension`** (`extension.ts`, the `pi.extensions` manifest entry) is the vanilla-pi command:
  default export `createSessionInsightsExtension()`; `createSessionInsightsExtension({ agentDir,
  locations, command })` for a host with its own layout; and the pieces under it — `InsightsEngine`
  (the index, trace store, digests and stores one pi process keeps warm), `vanillaInsightsLocations`,
  `parseInsightsArgs`, `runInsights` — with `InsightsLocations` and `InsightsRequest`. ThinkRail imports
  none of it and leaves a user's install of the package out of its sessions, since its panel covers the
  command ([[module-ext-session-insights]]).

## Boundary

- **Allowed deps:** pi SDK peers — from `@earendil-works/pi-coding-agent` the values `getAgentDir`,
  `migrateSessionEntries`, `CURRENT_SESSION_VERSION` and `buildSessionProjection`, plus types (the
  extension entry's `ExtensionAPI`, `ExtensionCommandContext`, `ExtensionFactory`) — and the `node:` builtins
  `fs/promises`, `path`, `crypto`, `os` (the redactor's default home) and `buffer` (the search's byte
  prefilter reads a run of lines as Latin-1). The same code runs under Node ≥ 22.19 and Bun
  ([[module-pi-extensions]] § Vanilla-parity bar); `runtime.test.ts` scans `src/` and the extension
  entry for both, and the parity gate and an `extension.test.ts` smoke run the command under Node.
- **Forbidden:** `@thinkrail/*`; `pi-delegation`, `pi-subagents` and `pi-todos` (their records are read
  structurally, below); any `~/.thinkrail` path; `Bun.*` / `bun:*`; network I/O; writing pi files;
  `SessionManager.list` / `listAll` in production code, since they parse every file they list
  ([[pi-compatibility]] holds the discovery and parse mirrors).

## Invariants

- **No network I/O**, anywhere in the package.
- **The cache holds no message text.** The per-session digests behind the statistics and the search
  (which keep error lines and prompt-sentence excerpts, redacted, and the search columns: interned facet
  values and line ranges, no text) live in memory only, and the `JsonStore` keeps finding ids and the
  user's own labels and notes (their data, not pi's text).
  It keeps metadata and the session title (the latest `session_info`
  name); the first prompt is a byte range re-read from the pi file on demand and held in memory as its
  redacted excerpt. The cache
  is disposable: a load failure or a new `PARSER_VERSION` rebuilds it. Traces are never cached on disk:
  `TraceStore` keeps the latest few skeletons in memory (byte ranges and one-line labels, no bodies), and
  every body is re-read from the pi file by offset when asked for.
- **Every string that leaves the list, the trace or the search is redacted.** The redactor (ported from
  the prototype extractor) strips ANSI and control characters first (so a coloured secret still matches),
  then turns the home folder and any `/home/<user>`, `/Users/<user>` or `<drive>:\Users\<user>` prefix
  into `~` (a Windows one in any case and with either separator) — a home of `/` or of one segment
  (`/root`, `C:\`) names no user and rewrites nothing — and masks key shapes (`sk-`, `ghp_`,
  `github_pat_`, `glpat-`, `AKIA`, `xox?-`, `AIza`, `npm_`, JWTs), Bearer/Basic tokens,
  `*_KEY|TOKEN|SECRET|PASSWORD` assignments, `api_key=` query values, URL basic auth, private-key blocks
  (PEM and PGP: `BEGIN … PRIVATE KEY` to its END or the text's end; and, failing closed for a block whose
  markers lie outside the text, two or more lines of 64 or 70 base64 characters — a PEM or OpenSSH body,
  certificates' too — and a dangling END marker with the body line before it) and emails. A
  secret-named key (`isSecretName`: ending in `…key`, `token`, `credential(s)`, `auth` or
  `authorization`, or holding `api_key`, `secret` or `password` anywhere, any case; not a bare `key`,
  `tokenizer`, `max_tokens`, `author` or `authMode`) masks its whole value. In JSON text that is a
  non-empty string value (a value cut before its closing quote too, so a prefix cut never leaves one
  bare); text is matched pair by pair, so a container inside a text body (a result that prints JSON) is
  masked only where its own leaves are secret-named. In every JSON walk — `event.get` arguments, details
  and raw entries (`capJson`, so the HTML export too), the fixture cut, `maskSecretFields`, search's
  argument leaves (which skip them), the export check and its source credentials — it is every leaf at
  or under the key: a secret-named key holding an object or array makes everything inside it secret at
  any depth, whatever the inner names (`{"credentials": {"value": …}}`, `{"secrets": […]}`,
  `{"auth": {"headers": …}}`), numbers and booleans too (`isSecretLeaf`; `""` and `null` stay). One
  rule carries the flag down every walk (`secretUnder`; a walk that took each key's flag afresh let a
  container's inner leaves out, review of #1417), and `maskSecretFields` masks whole what lies past its
  depth limit. A key is masked like a string wherever it is shown, and so is every path or name built
  from keys: `capJson` emits masked keys and builds each cut path from them (paths from the keys as
  written let a credential-bearing URL key out unmasked in `event.get`'s `cuts`, review of #1417), the
  fixture cut maps keys like values (the session's folder rewritten too) and the request diff names its
  sections masked; a subagent's role (`subagent_type`, `roleName`) is masked like a label. Identifiers
  pi records (tool and model names, statuses, stop reasons, ids) are shown as recorded. Nothing is
  picked from under such a key:
  a call's label falls back to its first top-level string argument that is not secret-named, and every
  serialized argument (`mainArgument`, `trace.search`'s call text) is built from the arguments with
  those values masked first (`maskSecretFields`). **Every window is cut from masked text, never masked
  after the cut**, since a multiline secret is recognized only with its context (a PEM body by its
  BEGIN line kilobytes earlier): caps (head, head and tail), labels and first lines, search snippets,
  error lines, prompt sentences, first-prompt excerpts, task paragraphs, a bash command's head and JSON
  string caps all mask first and cut the masked text, and the request diff's sections are masked whole
  before they are split. `Redactor.around` masks a window with `MASK_CONTEXT` (32 KB, past any key
  shape: a 4096-bit PEM block is 3.3 KB) on each side, or the whole text when that covers it — every
  result of pi's own tools, which keep 50 KB. A longer text is masked per window, so the work is bounded
  by the window, not the text (a 5 MB result's head and tail in 4 ms; masking it whole takes 140 ms
  under Bun and 430 ms under Node). A secret longer than the context that crosses its far edge could be
  cut; a key block fails closed by its body lines and END marker at any size. A cut never splits a
  `[redacted]` (it moves before it, a kept tail starts after it), and each capped value carries its
  original size. Masking is best effort. Every pattern that scans a run starts at the run's start (the
  email and `api_key=` patterns look behind for it, a PEM body line for a line break) and JSON string
  values match as an unrolled loop, so masking stays linear on long runs such as base64 output (400 KB
  of base64url in about 8 ms). Exports go through the same redactor, and a post-export check (below)
  refuses an output masking would still change.
- **Headline tokens and cost are pi's recorded totals**: every spend-bearing entry on every branch, at
  parity with `getSessionStats` ([[pi-compatibility]] § Recorded totals, second mirror). Never price ×
  tokens. A model that records $0 still reports its tokens, and its cost reads as not recorded.
- **Every figure carries an `Origin`.** `recorded`, `counted` and `host` are exact; `approximated`,
  `notRecorded`, `partiallyRecorded` and `notMeasured` are flagged (`BADGED_ORIGINS`). `METRIC_SOURCES`
  names the pi fields behind each metric, so every number can say where it came from. Cost is
  `recorded` when every spend-bearing entry with tokens is priced, `notRecorded` when none is, otherwise
  `partiallyRecorded`. The subagent count and outside spend are `notMeasured` when a child cannot be
  measured or the embedder places the session in a removed workspace.
- **A median is a median.** Every figure labelled a median or p50 (call price, durations, latencies, the
  outliers' median, the slice comparison and its bootstrap) comes from the one `median` in `stats.ts`:
  the middle value for an odd count, the mean of the two middle values for an even one, never the upper
  middle or a mean (review of #1417: the cost view's call price was both). A mean is labelled an average.
- **Deterministic.** Output is a pure function of the files, `PARSER_VERSION` and the params, with stable
  sorts (start descending, then session id) and strings compared by UTF-16 code units (`byText`; never a
  locale-less `localeCompare`, whose order depends on the runtime's locale); a session id found in two
  files is listed once, from the first path. Resuming a parse or restoring it from the cache gives the same summary as a full parse.
- **Never stalls or fails on input.** Indexing, and the cache's load and save, yield cooperatively, with
  no event-loop slice over about 8 ms beyond the parse of a single line (a multi-megabyte line is parsed
  in one piece). An unreadable or invalid file is skipped, never fatal, and a background refresh failure
  goes to the embedder's `onError`.
- **An embedder can stop the work for good.** `SessionIndex`, `DigestStore`, `TraceStore` and
  `SearchJobs` take an optional `signal` (`AbortSignal`); once it aborts, the work stops at its next
  cooperative yield — `sliceYielder(sliceMs, clock, signal)` is due at once and its pause rejects with the
  reason, so every scan unwinds where it would have yielded — and nothing starts again: the index writes
  no cache after it (`SummaryCache.save(document, signal)` checks before its write and its rename, so an
  aborted save leaves the previous file), never revalidates and reports no error for the abort; the digest
  store records no build that ends after it, drops its digests and queue and answers every waiter; a
  trace build answers `null` and keeps nothing; search cancels every job and answers `superseded`. The
  writes take one too and reject with its reason, writing nothing more: a `JsonStore` update (labels,
  hidden findings) checks before its write and its rename, the previous document kept; an export
  (`renderSessionHtml` and `fixtureOutput` stop at their next yield, `writeExport(target, output, {
  signal })` checks after each step and right before a name is taken) publishes nothing and removes its
  temporary output. The vanilla command passes none: its engine lives as long as pi's process.

## Decisions

- **Its own index, on HistoryIndex's rules** ([[submodule-server-history]]), rather than an extension of
  it. Entries are keyed by path, size, mtime and `PARSER_VERSION`. A file that only grew, and whose last
  consumed 4 KiB still hash the same, is parsed from where the last parse stopped; a torn last line is
  left for the next parse, a complete unterminated one counts without being consumed. Any other change
  of size or mtime, a version change or a legacy header (migrated through pi's `migrateSessionEntries`)
  re-parses the whole file. A query waits a short budget for a fresh index and otherwise answers with
  what is indexed plus its `IndexState`; a session lookup the index has not reached while it is not
  `ready` answers `pending` (`session.summary`, `session.trace`, `sessions.align`) rather than a final
  not-found, so a client asks again instead of reading a cold start as a deleted session; a cold start serves the cached summaries while it revalidates
  them. Revalidations are at least `revalidateMs` apart, counted from the end of the previous one, so a
  client polling a slow refresh never restarts it; a `fresh` request (the list's `fresh: true`, sent on
  the panel's mount and Refresh) revalidates at once, or right after the running revalidation. A parent's child-transcript directories are asked for once per parent file version, and their
  files are re-checked on every refresh, since a background subagent writes while its parent is idle.
- **Locators are injected** (architecture Decision 20). The sessions root and a parent's
  child-transcript directories arrive as functions, defaulting to `<agentDir>/sessions` and
  `<agentDir>/delegation/default/<parentSessionId>/`. Embedder facts such as projects, workspaces and
  outcomes never enter the core: the list builder takes `place(cwd)` and `status(sessionId)` callbacks.
- **Active time is approximated** as the sum of gaps under five minutes between each entry and the
  latest earlier timestamp, and the start time is counted from entry timestamps (the header's when there
  are none). **A session ends at its last work** (`recordsActivity`): model and thinking-level changes,
  names, labels, extensions' private `custom` entries and system-prompt messages record settings, not
  work, so the end is the last other entry and a settings entry's gap counts as active only once work
  follows it; a session of settings alone ends at its start. A restored chat appends a
  `thinking_level_change` stamped with the day it was reopened, which read as a 725-day wall time
  (followup #2 of #1417); the host writing it is a separate host issue. The trace's `meta.end` follows the
  same rule, while the settings marks themselves stay in the trace and may lie after it. The summary reads neither `durationMs` nor message timestamps; the trace does (below).
- **The trace is the active branch, in pre-order.** The leaf is the file's last entry, as pi loads it;
  abandoned branches are counted (`offBranch`), not shown. Events are a prompt's (or a waking completion's) `turn`, an assistant
  message's `llm` call, one `tool` per issued call (id `tool:<assistant entry>:<call index>`, a call
  without a result kept as `missing`), a `subagent` under its `Agent` call, and `mark`s for compactions,
  model and thinking-level changes, names, labels, branch summaries, system-prompt updates and custom
  messages; `usage` and private `custom` entries are not shown. Legacy entries without ids take
  `@<byte offset>`, never pi's random migration ids, so an event id stays stable across reads.
- **Timing origins.** A model call spans `message.timestamp` (request start) to `+ durationMs` when pi
  recorded it (`recorded`); else request start to the entry's write time, else the previous entry to it
  (`approximated`); a tool call ends at its result's `timestamp` and starts `durationMs` before it, else at
  the issuing call's end. An approximated span over two hours (a result written after a restart) collapses
  to a point (`notMeasured`). A turn spans its calls and subagents (markers excluded, below). A background subagent ends at its
  `subagent-completion` message.
- **Turns start at a prompt or at a completion that woke the agent.** A user message starts a turn
  (`trigger: "prompt"`); so does a `background-command-completion` or `subagent-completion` custom message
  whose `details.delivery` is `wake` (pi-background-commands / pi-subagents record it), or — when the
  message predates that field — that arrives while the agent is idle (its last model call stopped with
  anything but `toolUse`). A completion delivered into a running turn (`run`, `appended`, or mid-run) stays
  a marker. Turns are numbered in order whatever started them. A turn spans its start to the end of its
  last call or subagent; markers never stretch it, because a restored chat appends model or
  thinking-level changes days later.
- **Who waits is a labelled inference** (`waitBands`). Over the trace's span, running work wins in the
  order an open `ask_user_question` (the user), a tool (`Agent` / `get_subagent_result` count as the
  subagent), the model, a subagent; a stretch where nothing runs belongs to what ends it: a prompt → the
  user, a completion message → background work, the agent resuming on its own within a minute → the
  model, longer → nobody (`idle`). Bands of one actor merge.
- **Idle gaps come from those bands.** Runs of user, background and idle bands at least a minute long
  are the trace's `gaps`, their `cause` the actor with the most time in the run; an open question to the
  user therefore compresses like a wait for the next prompt.
- **The session timeline is server work** (`session.timeline`, one query for the turn cards and the
  timeline). Turn figures: duration (`approximated` when the last call's span is), the user-wait inside
  the turn (`approximated`), counted calls, failures and subagents, and the recorded spend of the turn's
  active-branch entries with the list's cost origin. Lanes: tool calls (asks excluded, they sit in the
  user lane) and subagents greedily packed by start onto at most 8 and 24 tracks (overflow shares the last
  track); only off-first-track ids are sent. Counters: each model call's request context (input + cache
  read + cache write), heuristic cache misses (a call with ≥ 4,096 tokens of context reading under half
  of the smaller of its and the previous context from cache, for models that read from cache at all), the
  model's context window from the host's `contextWindow` — or the largest observed context, `approximated`,
  when the host knows none or a smaller one —, pi's recorded spend over time (every branch, so it ends at
  the headline) and, when subagents spent outside pi's total, the same plus each child's outside spend at
  the subagent's end. The headline is tokens when every recorded cost is $0. Its summary figures come
  with it, so the web derives none: the who-blocks total (`waitsTotal`, approximated), the peak request
  context (`peak`, recorded) and the model calls (`llmCalls`, counted).
- **The day timeline is cut in the host's local time zone.** `day.timeline {scope, day?}` lists the
  scope's sessions whose first entry falls on that local calendar day (latest day by default; the response
  names the zone), each with its turn bars clipped to the day, tool calls merged into one-minute ticks
  coloured by the most frequent family, asks, heuristic cache misses and warm-cache stretches (a heuristic:
  `CACHE_TTL_MS`, 5 minutes, after each model reply), plus the count of warm caches at once and the whole
  hours with no turn (the strip compresses them). Row figures are the list row's; day totals sum them.
  `DayRowCache` keeps each file revision's row so paging through days rebuilds no unchanged trace.
- **Bodies are verified, not trusted.** `event.get` re-reads the event's entry (and its tool result) by
  byte range and checks the parsed entry id (`TraceStore.locate`, behind `event.anchor`, reads no body: it
  names the entry and tool call from the skeleton); a mismatch — the file was rewritten without changing size or
  mtime — rebuilds the skeleton once before answering. Search streams the file again and matches raw text
  (prompt, reply, thinking, call arguments, result text, summaries) plus the skeleton's labels,
  case-insensitively, returning event ids only.
- **Paging pins a revision.** A trace's pages (`session.trace`) and an alignment's (`sessions.align`) carry
  the first page's revision back (`revision`, `revisions`); `TraceStore.traceAt` serves that snapshot
  while it is the store's current one or one of the last two it served a pager per file (pins of at most
  `capacity` files), and says when the file has moved past it (`newerRevision`), so a live session's
  pages never mix two revisions and the client offers a reload once paging ends. A revision no longer retained
  answers from the current one, whose `meta.revision` then differs and restarts the client's paging.
- **Subagent join.** The parent references a child through `Agent` / `get_subagent_result` tool results
  and `subagent-completion` custom messages (`details.childSessionId`, `status`, `usage`), and mirrors its
  spend through `usage` entries of `kind: "subagent"` whose `note` is the child id. A child's figure is its
  transcript, else its final reported usage, else the mirror. The spend outside pi's total is that figure
  minus what the parent mirrored, never negative. A referenced child with neither a transcript nor final
  details is `notMeasured`. Final reports of one run (the same usage and duration, repeated by `Agent`,
  `get_subagent_result` and the completion message) count once; distinct runs add up. A transcript in
  the parent's child directories that the parent never referenced still counts; a forked transcript
  (header `parentSession`) carries copied parent spend and is never a spend source.
- **Structural shapes, one source.** Because the core may not import the delegation packages or
  pi-todos, it matches their records itself, and every literal and shape it matches is declared once in
  `./core` (*Public surface*) and used from there: the `Agent` / `get_subagent_result` tools and their
  run details (`childSessionId`, `status`, `usage`), the `subagent-completion` and
  `background-command-completion` messages and their `details.delivery: "wake"`, the `subagent` usage
  kind, the unfinished and failed run statuses, pi-todos' tools, statuses, `details.plan` / `todo` /
  `paused` / `group` and its `▸ Group [s n/m]` / `[x] Title — t_…` text lines. Fixtures here and the
  host-side tripwire tests in [[submodule-server-agent]] pin them: `subagentRecordShapes.test.ts` checks
  the packages' exported literals, completion delivery and run-status union against these values and
  their types against `SubagentRunRecord`, and `todoRecordShapes.test.ts` runs the real pi-todos tools
  and parses their results and text with these patterns and shapes. The host reaches the values through
  the extension's public `./server` entry, which re-exports them ([[module-ext-session-insights]]),
  since the host depends on no pi package an extension owns. A rename on either side fails a test
  instead of silently skewing the analysis.
- **Facts are read once, while the trace is collected.** Per call: a hash of its tool and normalized
  arguments (repeats), hashed words of its main argument and a hashed path (retries), hashed objects of
  its arguments (alignment), a `SKILL.md` read, the pi-todos arguments and parsed result, and a failure's
  normalized first error line; per model call its failure line; per prompt its hashed words (turn
  pairing); per subagent its task's paragraphs. Hashes, redacted labels and plan titles only, so
  the analyses never re-read bodies and the "no bodies held" rule of the trace stays true.
- **A call without a result never ran.** A tool call succeeded only with a recorded result that is no
  error (`succeeded`); one without a result (`missing`: pi 1.5.2 persists a reply stopped before its
  calls ran with the calls and no results) neither succeeded nor failed. So it loads no skill (the
  analysis' activations and bands, the digests' loads, hence never-loaded skills), touches no file (the
  matrix, its columns, lines and diffs, the digests' touches, hotspots and rework), changes no plan,
  counts as no edit or test run before a claim ("done without verification"), never recovers a chain
  (`unfinished`) or a flow (`notRun`, never `later`), and is in no failure rate of the usage tables or
  the failing-commands finding (both count `calls − notRun` runs; the list's tool-call figures stay the
  file's counts of issued calls and error results). Wherever a view lists such a call it says "no result"
  (the trace's wording) or "not run", never succeeded or failed: `file.detail`'s touches (`missing`, column `null`),
  `error.detail`'s attempts and the calls between them, the sequences' example steps, the usage
  tables' `notRun`, `/insights`. Counting `!error` as success once reported a stopped reply's
  `SKILL.md` read as a load and its write as a change with added lines (review of #1417).
- **The plan is rebuilt from pi-todos calls** (`session.analysis`). On the active branch, in trace order:
  `todo_write` replaces the plan (steps it leaves out become `removed`), `todo_list` is a snapshot (a
  status first seen there is flagged `snapshot` — an edit the user made in the TODO panel, which is not in
  the session file, so its real time is unknown; a step known only from lists is `listedOnly`), `todo_add`
  / `todo_update` (with its `paused` steps back to pending) / `todo_promote` / `todo_remove` change one
  step, `todo_plan_summary` adds a note. A step's calls, failures and recorded spend are those made while
  it was the step in progress (the call that finishes it still counts). Each turn's badges count the
  steps it worked on or changed by a call, and the skills it activated.
- **Skill scope is a labelled heuristic.** A skill activates on a successful read of `…/SKILL.md` (name =
  its folder; either separator and any case in a Windows session) or on a prompt pi expanded from
  `/skill:name` (`<skill name="…">`); it applies until the end of that turn or the next activation in the
  same turn. Workflow skills are marked by name.
- **Errors and repeats are labelled heuristics.** A repeat is two or more consecutive calls (issue order)
  with the same tool and identical arguments. A retry is, after a failure, the first call of the same tool
  within the next `RETRY_WINDOW_CALLS` calls of the same turn, if it shares the path or
  `RETRY_SHARED_WORDS` of the main argument's words (Jaccard); retries chain while attempts fail. Every
  failed tool call is in one chain: `recovered`, `gaveUp` (retried, last attempt failed),
  `unfinished` (the last retry has no result) or `changedApproach` (no retry); an unfinished chain is in
  no recovery share. Model chains run from a failed model call (`error` / `aborted`) to the
  next successful one: `sameModel`, `afterSwitch` or `never`, with the model switches and prompts on the
  way. Clusters key failures by tool and the first error-looking line with paths, ids, hex, numbers and
  quoted literals replaced. `error.detail` re-reads a chain's attempts for their main arguments, a
  word-level LCS diff between consecutive attempts (bounded at 600 words a side), error heads and the
  calls (edits marked) between attempts.
- **Subagent waves.** A wave is the spawns of one turn whose runs overlap; runs are packed onto lanes by
  start inside a wave. A run's title is its task's first paragraph that no other task of the session
  opens with (so a shared preamble is skipped). The rationale is a quote, not an inference: the reply
  text before the `Agent` call in the same message, else its thinking, else the previous reply. The
  result is the first final report (`Agent`, `get_subagent_result`, else the completion message) and the
  parent read it in its first model call after that entry (`SubagentEvent.consumedBy`), `readDelayMs`
  after the result arrived (or the run ended, whichever is later; never negative). Activity comes
  from the child transcript (model and tool calls as at most `ACTIVITY_TICKS` ticks, merged per slot),
  cached per transcript revision; without a transcript a run is `missing`, or `removed` when the session's
  workspace was removed, and its activity is not measured. `session.trace` and `event.get` take a
  `childId` to page a subagent's own transcript, which the web nests under its row.
- **Context composition is an estimate scaled to pi's exact total.** While the trace is collected each
  entry's contribution is measured once (characters, no text kept) and `ContextLedger` replays the active
  branch the way pi builds a request: system messages patch sections by name and tools by name (`skills`
  and `tools` sections count as their own categories), the latest compaction keeps its summary, its
  `firstKeptEntryId` range and its `systemMessage` checkpoint, context edits omit or replace their target.
  A model call's request is the ledger before its own message, in `CONTEXT_CATEGORIES` order, at pi's four
  characters a token (an earlier reply counts its recorded output tokens, reasoning as thinking); the
  parts are then scaled by largest remainder to integers summing to `input + cacheRead + cacheWrite`.
  When nothing persisted a system message yet (older sessions) the remainder of the exact total is shown
  as the system prompt (`unpersisted`), since that is what pi did not record. Every call also carries
  each part's change since the previous counted call, so the web never subtracts figures.
- **Cache-miss causes are a labelled heuristic.** A miss is the timeline's (`cacheMisses`); its causes are
  what the file shows changed since the previous call with a context: another model, a `model_change`
  re-selecting the same model, changed system sections, changed tools, a compaction, a context edit, a
  thinking-level change, or a pause over `CACHE_TTL_MS` from the previous call's end. A section or tool
  is known by its size and a hash of its text (taken once while the entry is read, no text kept), so an
  equal-length replacement is a change as the request diff sees it; a size alone missed one (review of
  #1417). None of these is "not explainable from the data" (an empty list), never a guess. Compaction
  cliffs pair the last call before a compaction with the first after it.
- **The request diff is a read-only reconstruction** (`request.diff`, [[pi-compatibility]] § Request
  reconstruction). The file is parsed up to the call's entry and pi's `buildSessionProjection` rebuilds
  the request at the call's parent and at the previous model call's parent; system messages are replayed
  into sections and tools. Messages are keyed by their entry and position (a changed content signature is
  a context edit), sections differ character by character (the changed middle with 160 characters of
  context, cut at 1,200; both texts are masked whole before they are compared, so a secret keeps the
  context that names it — `API_KEY=` before a changed value — and a change only inside masked text shows
  no segment), and every miss cause is checked against the two
  requests. Nothing is assembled for a model or sent.
- **Why expensive is arithmetic over recorded spend.** Moments are consecutive calls of one plan step (or
  turn without a plan), split by turns and compactions, valued by recorded cost — tokens when every
  recorded cost is $0 — and ranked; spikes are calls that wrote at least half of a context of 32,768+ tokens
  to the cache, with their miss causes or none. The diagnosis kind is chosen by fixed thresholds over the
  measured figures (cache rewrites ≥ 30 % of the total, else an average context ≥ 50k read ≥ 50 % from
  cache, else ≥ 200 calls, else spread); the web fills a fixed template. The call-price figures are
  medians — the median call, and the median call and context of the 30 counted calls before the first
  compaction and of the 30 after it —; the average context is a mean and says so. Its focus clause names
  the two costliest plan steps (turns without a plan) unless together they hold 99 % or more of the
  spend, which says nothing. High-context calls are those at ≥ 80 % of their own model's context window, for models
  whose window the host reports (and covers what was seen); a window known only as the largest context
  seen is no limit to be near, so that model's calls are not judged. Never one session-wide window: the
  smallest one flagged a 1M model's calls against a 200k model's window (review of #1417). The figure
  carries each model's threshold. A file's touches span the session from its first model or tool call to
  its last (`SessionFiles.start` / `end`), so a restored chat's late markers never stretch it.
- **Files come from the tool calls** (analytics only; the host's turn tracker keeps snapshots). `read`,
  `edit` and `write` paths resolve against the session header's `cwd` as pi's tools do (`@` dropped,
  `~` the home), in that folder's own path flavor, never the host's (`paths.ts`): `path.win32` for a
  drive-letter or UNC folder — either separator, compared case-insensitively, a drive- or root-relative
  path against the folder's drive — else `path.posix`, case-sensitive. Inside it a path is keyed
  workspace-relative with `/` separators (a Windows session keeps each file's first spelling, so `src\A.ts`
  and `C:\repo\src\a.ts` are one file) and is openable; a `..` that leaves the folder and anything else is
  outside, redacted and never opened. Every view keys files this way (the matrix, `file.detail`, the
  digests' touches and their `node_modules` and hidden-folder rules, hotspots and the heat tree, search's
  `file:` facet, the findings), so a session reads the same on any host. Lines come from an edit's
  `details.patch` (else its numbered `diff`) and a write's content, of the calls that succeeded (a call
  without a result touched nothing: *A call without a result never ran*). Columns are turns, or plan
  steps inside turns when at most three turns touched a file and the session has a plan. Rework is
  `REWORK_CHANGES` changes or more. An embedder's change receipts join by path; `file.detail` re-reads
  each change's patch or content by offset (the last 40, redacted and cut).
- **Statistics read per-session digests, not files** (`stats.usage`, `stats.hotspots`, `findings.list`,
  `stats.sequences`, `slices.compare`).
  A digest is the facts one session contributes — spend by host-local day and model (pi's mirror of
  subagent spend and summaries apart), tool and command calls with failures, exit codes and recorded
  durations (and the calls without a result, `notRun`), model latencies and peak context, the persisted
  skills list and skill loads, subagent runs by
  role, file touches, context-limit failures, heuristic misses with their causes, oversized results,
  loops, recovery chains, claims of passing tests, hashed prompt sentences, the issue-ordered tool calls
  (activity, failure, tool and head, event id, redacted label), turns and retries — built once per file
  revision from its trace (`DigestStore`: one per file, built for the index's summary object, which
  changes with the file) in the background, newest first, in stages that yield to the event loop. While a
  file's new revision is built its previous digest stays counted, so a live session that keeps growing
  never drops out of the totals; the new digest replaces it once built. A query waits a short budget and
  otherwise answers with the digests built so far and their `DigestProgress`: `ready` counts the
  sessions with a digest of either revision, so `ready < total` — the panel's reason to keep polling —
  holds only while some session has none at all, and `stale` counts those still on the previous
  revision. Search scans only a digest of the current revision (its suggestions take either). A deleted
  file's digest stays until restart, or until the store's `signal` aborts, which drops them all. Digests are kept in memory only (they hold redacted error lines and sentence
  excerpts); a restart rebuilds them. Sessions are the list's rows in scope, by index into the result's
  `sessions`, so a row or card can filter the list without sending ids per row.
- **Usage is pi-recorded spend, by day.** Every spend-bearing entry (every branch) lands on its host-local
  day: model calls by model (the six largest, the rest as `otherModels`), `usage` entries of kind
  `subagent` as their own `subagents` series, summaries and other `usage` as `other`; projects the same way
  (six, then `otherProjects`). Subagent spend outside pi's total is a separate `outside` series on the day
  each child ran, never stacked into the headline. The axis is every calendar day of the range; tables'
  sparklines fold days into at most `SPARK_POINTS` points. Markers: the first day of a model that never
  records cost after priced spend (`unpricedModel`), the day a priced model starts recording $0 for good
  (`costStopped`), the first day with subagent spend — none before the second day with spend, since a
  change needs a day before it to change from. Rates carry a 95 % Wilson score interval (a tool's
  failure rate over the calls that ran, its calls without a result counted apart as `notRun`); durations
  are medians and means of pi's `durationMs` where recorded (`notMeasured` otherwise); a model's window is
  the host's, or the largest context seen (`approximated`) when the host knows none or a smaller one; a
  skill's description cost is its `<skill>` entry at four characters a token (`approximated`).
- **Hotspots are successful touches by workspace-relative path.** A touch is a successful `read`, `edit`
  or `write` inside the session's folder; failed edits count apart, touches outside it or under
  `node_modules` only as footnote totals. Files of one project merge across its workspaces by relative path
  (sessions outside every project merge by path too). One action per file, first rule in order
  (`HOTSPOT_RULES`): a spec (`SPEC.md`, `*.spec.md`) changed in ≥ 3 sessions → check it; a test with rework
  (≥ `REWORK_CHANGES` changes in a session) → stabilize it; a notes file (Markdown in a hidden folder) with
  rework → write the plan upfront; a notes file changed in ≥ 3 sessions → template; ≥ 10 changes in a
  session → split the task; changed in ≥ 3 sessions → describe it in AGENTS.md; ≥ 70 % reads in ≥ 4
  sessions → describe the file upfront; rework → review the edits. The top `HOTSPOT_FILES` by the chosen
  sort are sent with every folder of theirs summed over them (the heat tree).
- **Findings are fixed rules over the digests** (`FINDING_RULES`, decision 12 of the task spec for the
  first and the outlier thresholds). Skills: listed in a persisted list yet loaded in no session of the
  scope (with the entries' per-request tokens; loads inside subagent transcripts are not seen), loaded in
  a session that listed others but not it. Commands and tools: a command head failing ≥ 3 times, in ≥ 8 %
  of its runs, in ≥ 2 sessions (the four that fail most plus any whose Wilson lower bound reaches 30 %),
  quoting the first real line of its most common normalized error and the argument diff between a failure
  and the next successful run of the same head in that session (the first of up to five sessions whose run
  changed the arguments); known non-error exit codes (`KNOWN_EXIT_CODES`, e.g. `gh pr checks` exit 8 =
  checks pending) seen ≥ 2 times; loops (≥ 3 identical calls in a row, ≥ 2 times for a tool); poor recovery
  (≥ 5 chains in ≥ 2 sessions recovered by a retry under half the time, labelled heuristic); results of
  ≥ 50,000 characters ≥ 3 times. Context, cache and cost: model failures saying the prompt is too long
  (with the largest context of a model that hit it and that model's host window), ≥ 5 heuristic misses
  with their causes' shares, sessions over 3× the median cost (or tokens, among sessions that record no cost; at least 5 sessions), subagent
  spend outside pi's total over half a cent. Files and repeats: the three files with the most changes in
  one session; near-verbatim prompt sentences (6–60 words, code and tagged blocks dropped, three-word
  shingles, MinHash bands then Jaccard ≥ 0.6) in ≥ 3 sessions; "done without verification", a reply that
  says tests pass with no test command since the last edit (≥ 2 times; a noisy heuristic: runs inside
  subagents are not seen). Every card carries its numbers, sessions (at most six linked, with up to three
  calls each) and every session for *Show sessions*; ids are stable (`command:<head>`, `skills:never`, …).
  Hiding writes the id to `findings.json` in the embedder's data folder (`JsonStore`: small documents,
  serialized atomic writes, reused by labels later); nothing is ever applied.
- **Action sequences are each session's own tool calls, by activity** (`stats.sequences`, from the
  digests' issue-ordered steps; subagent transcripts are not included). The activity map (`ACTIVITIES`):
  `read`, `grep` / `find` / `ls` → read, search; `edit` / `write` → edit; `todo_*` → plan; `spec_*` →
  specs; `Agent` / `get_subagent_result` → subagent; `ask_user_question` → ask; `web_search`,
  `fetch_content`, `get_search_content`, `source_check` → web; a successful or failed `SKILL.md` read →
  skill; `mcp__*` / `mcp_*` → mcp; anything else → other. A shell call goes by its head: words such as
  `test`, `vitest`, `jest`, `pytest`, `playwright`, `e2e` → test; `lint`, `eslint`, `biome`, `prettier`,
  `ruff`, `clippy`, `fmt`, `format` → lint; `build`, `tsc`, `typecheck`, `compile`, `make`, `gradle`,
  `mvn` → build; any other `git` / `gh` command → git; a command that writes into a file — an output
  redirect to a real file, `tee`, in-place `sed` / `perl`, quoted text and heredoc bodies ignored
  (`shellWrites`) — → edit; then the head's reading family (search, read, edit) or run. A transition is a call and the next one in the same session (across turns); a cell is marked
  when ≥ `errorMarkShare` of it starts at a failed call. Each cell names the sessions where it occurs most
  with their first occurrence, and its example is the first occurrence in the leading session with a call
  on each side. The process map's thresholds (`edgeShares`) keep edges with at least `ceil(share ×
  transitions)` and report what they hide. Chains are three-grams after collapsing repeats.
- **What follows an error is merged and grouped deterministically.** From each failed call the next calls
  become states — the same tool and head again (`recovered` or `repeatFailed`), a call without a result
  (`notRun`), another failure, look (read / search), edit, run (test, build, lint, git, run), other —
  with identical consecutive states
  merged, three states followed, `recovered` and `end` passing through; the outcome is `recovered` within
  them, `ended`, `later` (a later success of the same tool and head) or `never`. Per column, states under
  `flowRareShare` of the failures (the failed activity too) become `other`, except the four the flow is
  about. The failing table groups by tool and head; the example is the first failure of the most failing
  one that recovered within `exampleSteps` calls (preferring one with a call in between).
- **Slice comparison is a seeded bootstrap over sessions** (`slices.compare`, conflict C8). A slice is the
  scope's sessions with one main model (most recorded model calls), before or from a day, of one project,
  or whose title or first prompt contains a text (B is the rest when its text is empty). Metrics: the
  failure share as the ratio of the sums, retries (retried attempts plus repeated calls, the errors
  section's heuristics) as a mean, the rest — tool calls, turns, pi-recorded tokens, recorded cost (only
  sessions whose cost is `recorded`), approximated active time, peak request context — as medians.
  Δ = B − A with a percentile interval from `resamples` resamples of both slices' sessions drawn by
  Mulberry32 seeded with the FNV-1a hash of the slice definition and the metric, pinned by a test. Verdict:
  `tooFew` under `minSessions` sessions with a value in either slice, `noData` with none, `same` when the
  interval includes 0, else `better` / `worse` (lower is better) or `higher` / `lower` for neutral
  metrics (calls and turns per session). Confounds: start ranges overlapping less than `timeOverlap` of
  the shorter one (unless cut by period); project or main-model mixes at least `mixDistance` apart in
  total variation (unless cut by them). Each metric carries every session behind it and its value.
- **Two sessions align turn pair by turn pair** (`sessions.align`). The first turns pair; later turns pair
  by a weighted LCS over prompt-word Jaccard (≥ `turnSimilarity`, words hashed while the trace is
  collected). Inside a pair, calls match only within one class, following the call's activity
  (`skill:<name>`, `file` for reads and reading commands, `edit` for edits, writes and shell commands that
  write into a file, `search`, `git checkout` for checkouts, switches and worktrees, a git / gh / package
  manager command by its head, any other command by its head, else the tool), so a `cat >> tests/x.py`
  never pairs with a `read README.md` as similar (followup #10 of #1417) and score 1 + 3 × Jaccard of
  their objects — file names, `sed` ranges and camelCase / CONST_CASE names hashed from the full arguments
  while the trace is collected, minus objects in more than `commonObjects` of both sessions' calls. A
  match is `same` when its objects overlap ≥ `sameObjects`, the two calls are identical (tool and
  normalized arguments), or its class is a skill, `set_title` or `ask_user_question`; otherwise `similar`.
  Calls of unpaired turns are one-sided. Both weighted LCSs — the turns' and each pair's calls' — use
  Hirschberg's split (blocks of at most 4,096 cells use a full table) on one clock, so memory stays linear
  in the turns and the calls — tests pin the peak below 10 × (n + 1) floats at 2,400 × 2,400 calls and
  1,600 × 1,600 turns — with ties broken deterministically and a turn of the event loop every 8 ms. A row
  of prompt similarities is counted from an index of B's prompt words (the turns holding each), the same
  Jaccard at the cost of the words' occurrences rather than a merge per cell. Two 1,600-turn sessions with
  200-word prompts align in about 0.3 s with no event-loop stall over 20 ms (16 ms measured; asserted as
  written with `SESSION_INSIGHTS_PERF=1`, ten times that by default); the turn pairs used to fill one
  turns × turns table synchronously, a 3–7 s stall (review of #1417).
  Rows page by `pageRows` with the steps they name; `AlignmentCache` keeps the latest two alignments by
  both files' revisions so paging aligns once, and paging pins both revisions (*Paging pins a revision*).
- **Search across sessions: facets from columns, free text from the lines that can match** (`search`;
  `trace.search` stays the per-session search). The query language (`parseSearchQuery`)
  is free-text terms (all must occur in one event; `"quoted phrases"` with `\"` / `\\` escapes) and
  `key:value` filters (`key:"a value"`) for `SEARCH_FILTER_KEYS`, any case: every key must match, any of
  one key's values. `tool:` and `skill:` match exactly, `model:`, `file:` and an `error:` cluster text by
  containment, `error:yes` / `error:no` by failure, `project:` a project's name or id, `skill:none` /
  `project:none` events with none. A `key:` with an unknown key is searched as text and reported; a filter
  without a value, terms under `termMin` characters and terms past `maxTerms` are ignored and reported.
  Each digest carries the session's searchable events (prompts or waking messages, model calls and tool
  calls of the active branch, in trace order) as typed columns: kind, turn, time, interned tool, model
  (a tool call's issuing model, a turn's first answering model), the skill in action (the labelled
  heuristic of the analysis), the workspace-relative file of a `read` / `edit` / `write`, failure and
  error cluster key, and the byte ranges of the event's line and a tool's result line. Filters alone are
  answered from the columns. Free text reads only the candidate events' lines, merged into runs of at most
  2 MB, newest session first: a run is read once as Latin-1 and the JSON-escaped term is found by an
  ASCII-case-insensitive pattern (no non-ASCII byte folds to ASCII, so the prefilter never misses a line
  whose strings match); a term with non-ASCII characters is looked for in each decoded line with Unicode
  simple case folding. Only lines the prefilter keeps are parsed, and each string field (prompt or
  message text blocks, reply text, the error message, a call's argument leaves, result text blocks) is
  matched on its own, so the prefilter and the match agree exactly; a test compares both against a full
  parse, and another against a file pi's `SessionManager` wrote ([[pi-compatibility]] § Byte prefilter
  over session lines). An event matches when every term occurs in one of its fields (a tool call's
  arguments and its result count as one event). Hits carry the event's turn, time, tool, model, skill,
  a redacted one-line label, the snippet around the first match masking kept (`snippetChars`, cut from the
  field masked `around` the match; a match inside a mask centres the snippet on where it lands), how
  often the terms occur per field and a failure's error line; the web never re-reads text.
- **Search runs as a job per panel, paged and superseded by `seq`.** `SearchJobs` keeps the latest job
  of each client (16 clients): a request with a newer `seq` cancels the older job's scan at its next
  yield (an older `seq` answers `superseded`); a request with the job's `next` cursor continues it. One
  request scans for `budgetMs` (at least one line), then answers `scanning` with what it found; a
  session is read to its end before its group is shown, so a group's `matches` is exact, and shows
  `groupEvents` events (the rest by its `more` cursor, `moreEvents` at a time). The scan stops early
  once a page reaches `pageEvents` (answer `more`); filters alone then count the remaining sessions whose
  digests are built, so their totals are exact at once. Totals and facet counts (tool, model, skill,
  project, failed or not, `facetValues` each with the rest summed) are cumulative and `exact` only once
  every session was read; the scope's vocabulary (values with event counts for suggestions, failures for
  error clusters) comes with `facets: true`. A session whose digest is not built is built next, ahead of
  the background queue, so a search on a cold host reads at the digests' cold pace while its answers keep
  coming. A stale cursor answers `expired`. A job started while the index is not `ready` is not final:
  each request appends the sessions indexed since (newest first among themselves), and the job answers
  `scanning` (or `more`) with inexact totals until a request finds the index ready and every session
  read, so a search started on a cold host covers the sessions indexed after it.
- **No full-text index.** Measured on the 410 MB synthetic corpus (111 sessions, warm digests, p95 of
  five runs): the first answer within 75 ms for a term in every session and 254 ms (one request's budget)
  for an absent one; a whole scan to the last page 698 ms for a term in every session, 477 ms for an ASCII
  term nobody wrote, 770 ms for a Cyrillic one; filters alone 73 ms; no event-loop stall over 23 ms. On a
  211 MB real corpus (58 sessions) every whole scan stayed under 600 ms. The 1 s p95 budget holds, so SQLite
  FTS (behind a port, with a Bun-only driver and an on-disk copy of the text) is not added. The search
  columns add about 45 MB of digest heap on the synthetic corpus (64 MB in all, under the 100 MB budget).
- **Labels and notes live in the embedder's store, never in pi's files** (user decision). `labels.json`
  (`JsonStore`: atomic, serialized writes) maps a session id to its labels — trimmed, whitespace
  collapsed, unique case-insensitively, sorted, at most `LABEL_RULES.labelsPerSession` of
  `labelChars` — and an optional note (`noteChars`, line breaks kept, control characters dropped). Empty
  labels and note forget the session; a new session past `LABEL_RULES.sessions` is refused (`LABELS_FULL`),
  which keeps `labels.get` (every labelled session's labels, notes only for up to `notesPerRequest` asked
  ids, the vocabulary most used first) bounded. A malformed document reads as what it can. Labels reach
  the statistics through `StatsInput.labelsOf`: search's `label:` (exact, any case, `label:none`), its
  vocabulary, and the slice comparison by label (B the rest when empty; the options are the scope's
  labels). They leave the machine in no export unless the request asks (`includeLabels`).
- **Exports are files the embedder places** (`writeExport` into `<artifacts>/<EXPORT_RULES.folder>/`), named
  `<day>-<title slug>-<session id head>` (the slug masked again: joined words can make a key shape such as
  `sk-learn-migration-plan`, which the name check below refuses) and never overwritten (`-2`, `-3`…), concurrent exports of one
  session included. Each request writes a temporary path of its own beside the target (a random suffix),
  then claims the first free name atomically, on Linux, macOS and Windows under Node and Bun: a file by
  a hard link to the name (`EEXIST`: the next name; the temporary file is then removed), so the name
  appears only with the whole file — where the file system has no hard links, an exclusive create
  (`wx`) reserves the name and the file is renamed over that empty reservation; a folder (the fixture)
  by `mkdir` of the name, which fails on an existing one, then a rename over the empty reservation —
  where a folder cannot replace another (Windows), its entries move in one by one, the provenance last
  (`publishFile`, `publishFolder`). Failures are coded in the result, not thrown: `SESSION_NOT_FOUND`,
  `NO_ARTIFACTS_DIR`, `CUT_NOT_FOUND`, `CHECK_FAILED` (with what was found, never the text) and
  `WRITE_FAILED` (an errno code, never a path). An abort is no failure: it rejects with the embedder's
  signal's reason, so the embedder's own cancellation error reaches its caller.
- **The HTML export is the core's own** (pi's exporter is not a root export and masks nothing). One file
  from the same model the panels read: the header figures with their origin and source fields in each
  title and a badge on flagged ones, the turn list, the full active-branch trace as nested `<details>`
  (turns open, calls closed) with every body re-read by offset, redacted and cut to `EXPORT_RULES.html`
  (no raw entries, no result details, no images), the recovery chains and clusters and the subagent runs.
  Inline CSS with light and dark variables, system fonts, a few lines of script for expand / collapse, a
  `default-src 'none'` policy, timestamps in UTC and no export time, so one file revision exports byte for
  byte the same. The title is the session's name, else its first-prompt excerpt (both redacted like every
  list string). The page's text is English (the core has no locale catalog) and names no product
  ("Exported by session insights"; `host` figures read "reported by the host app"), since vanilla pi
  exports it too.
- **The Chrome trace is a pure writer** (`chromeTrace`, JSON object format, file only — no "Open in
  Perfetto", which would load a web app). The session is process 1; threads are the turns, the model calls,
  tool calls packed greedily onto lanes so parallel calls never share one, and per subagent run its span,
  its transcript's model calls and its tool lanes; a `s` / `f` flow binds each spawning `Agent` call to its
  run; compactions and other markers are process-scoped instants; `context` (each request's input + cache)
  and pi's cumulative `tokens` and `cost` are counters. Timestamps are microseconds from the first entry;
  metadata first, then by time.
- **The fixture cut is the active branch up to the cut** (`cutSessionFile`). A turn's end is the entry the
  next turn's start hangs from (the file's last entry after the last turn); an event is its own entry, or
  its tool result. The kept lines are the header and the `parentId` chain from the root to that entry in
  file order — what pi would load at that point, abandoned branches left out (a legacy file without ids is
  cut by position). Every string is redacted with the session's folder replaced by
  `EXPORT_RULES.fixtureCwd` first (a Windows folder in any spelling, the path after it with `/`; the
  workflow harness rewrites the recorded `cwd` at replay), every leaf at or under a secret-named key
  masked whole, yielding between entries. The workspace snapshot comes from the embedder's tree for the
  turn (`receiptForTurn`: the run overlapping the turn most) only at a turn's end; text files are
  redacted, `*.md` stored as `*.md.test`, binary files left out; past `EXPORT_RULES.snapshot` or without
  a tree the note says so. A file is stored under its tree path, which the replay keeps, so a path that is
  absolute or that masking would change (a home folder, an email, a key shape, a credential, a
  private-key marker) leaves the file out (`privatePath`, note `privatePathOmitted`) and the cut still
  exports: its content was masked, its name was not, and `customers/alice@example.com.json` once
  published under that name with a clean check (review of #1417). A file the harness's replay could not put back where it was is left out too
  (`placeSnapshot`, note `maskClashOmitted`) and the cut still exports: one named `*.md.test` (the replay
  unmasks it to `*.md`, the name a masked sibling `*.md` takes) or a `*.md` whose masked name is a folder
  of the tree — both once landed on one path and failed the whole export with `WRITE_FAILED` (review of
  #1417). A reversible escape (`*.md.test` stored as `*.md.test.test`) was rejected: the replay strips
  `.test` from `*.md.test` names only, so no stored name brings a `*.md.test` file back, and an escape
  would have to change the harness's masking and unmasking with it. An `insights-export.json` records the
  provenance (session, revision, cut, recorded cwd, the omitted files' tree paths as `omitted` when there
  are any — masked, then sorted, never the raw path —, labels when asked).
- **The post-export check knows the redactor's rules and the sources' credentials** (`checkExport`, the
  prototype's `verify.mjs` idea). Before anything is written, every string a reader would see must come
  out of masking unchanged (a home folder, a key shape, a credential…), one string at a time — the
  output's name and every file's path (the page's and the trace's file names, the fixture's folder and
  its files' paths) as well as their contents, since a check of contents alone passed a fixture whose
  snapshot kept a file named after an email (review of #1417): each text
  node and attribute value of a page, entities decoded (never the page as one string, whose tag boundaries
  would join a body that ends in `KEY=` to the markup after it), each JSON or JSONL key and string value
  (and no non-empty string at or under a secret-named key — inside its objects and arrays too — may be
  unmasked; a number there is not a credential and is not checked), each snapshot text; a key block's
  interior fails it even with its markers cut away (its base64 body lines or a dangling END marker). A
  page may hold no `src` / `href` (or other URL attribute) to the network, `<link>`, or CSS `url()` to the
  network or `@import` in its markup — its tags and `<style>` / `<script>` blocks; text is escaped
  wherever the page puts it, so a body that quotes CSS, a Spring `@Import` or HTML stays text. A value
  that left its key — a label or a trace event's name or `args` holding what a call passed as `password` —
  reads as plain text to those rules, so the check also reads the export's sources
  (`ExportOutput.sources`: the session and the transcripts it was built from) for the credentials they
  hold at or under secret-named keys (`sourceCredentials`: 8+ characters without whitespace, letters with
  a digit or a symbol, not a placeholder or a path such as `${TOKEN}` or `~/.ssh/id_rsa`; a long one by
  its first and last 32 characters) and fails on any of them anywhere in the output (`jsonKey`). Anything
  found fails the export with its kinds. Best effort: the check catches text that skipped the redactor or
  left its key, not a secret neither knows. Measured on a 2,400-call session with 2,000-character results:
  the page in about 0.45 s (7.2 MB, bodies read through one file handle), the check 0.2 s (about 100,000
  text nodes, each skipped unless it holds a character some pattern needs), the sources' credentials 50
  ms, the trace 15 ms, a fixture cut 0.23 s.
- **Wall-clock budgets are measured, and asserted as written only on request.** On the synthetic
  2,400-call session: the trace's build and first page 1.5 s, the analysis 0.3 s, the timeline, context,
  cost, files and request diff 0.5 s each, the HTML page 3 s, its check 1 s, the Chrome trace 0.5 s, a
  fixture cut 1 s; redaction of 1 MB of word runs 50 ms and of a 100–400 KB dash or base64url run 10 ms
  plus 1 ms per 40 KB; a 5 MB tool result's head and tail 15 ms, its `event.get` 150 ms. Tests assert
  these budgets with `SESSION_INSIGHTS_PERF=1` (a quiet machine); by default they allow ten times as much,
  which a complexity regression (the quadratic `api_key=` pattern took 25 s on 400 KB) still fails and a
  busy CI runner does not, and a test over the large session has a 60 s timeout so that ceiling, not the
  runner's default, bounds it. A perf run passes on the development machine (Bun 1.4); the export and
  redaction figures it measured are above.
- **The Overview is one composition from one trace snapshot** (`session.overview`,
  `buildSessionOverview`). It reuses the sections' own builders — summary, timeline, analysis, cost,
  context, files and subagents — on one revision, so its cards never disagree, and carries only what the
  cards show (`OVERVIEW_RULES`: twelve plan steps, five files, 120 per-call bars — past that each bar is
  the costliest of its run of calls). Recovered failures count the failed attempts of chains that
  recovered and their time sums those chains; the highlighted chain is a tool chain first, then the one
  with most attempts, then the earliest; an attempt without a recorded result is `missing`, neither failed
  nor succeeded. Plan steps leave out removed ones and keep the plan's numbering.
  Its findings are `findings.list` over the session's project, keeping those that link this session and
  are not hidden; until the index and the project's digests are ready they are `null` with the
  `DigestProgress`, so the cards never wait on the statistics.
- **`/insights` is a text report over the same queries, nothing of its own** (S11). The command builds
  the list, `stats.usage` and `findings.list` for a scope — sessions whose header `cwd` is pi's current
  folder (resolved; case-folded on Windows), or every folder with `--all`, each folder a list "project"
  so usage sums by folder — or, with `--session <id or unique prefix>`, one session's header, timeline,
  analysis and cost (turns, failures and their recovery chains, the peak request context against the
  model's window from pi's model registry, the cost diagnosis), and formats them in English from fixed
  templates (`insightsReport.ts`; the core has no locale catalog). Findings are ordered by severity, eight
  at most; ids show as the shortest unique prefix of at least eight characters. Provenance becomes text
  marks with a legend of the marks used: `≈` approximated, `≥` partially recorded (a lower bound), `?`
  not recorded or not measured; heuristic findings say "(heuristic)". Titles, prompts, quotes and paths
  go through the redactor, the written exports' paths included.
- **Vanilla locations under the agent dir, nothing under `~/.thinkrail`** (Decision 20). Sessions from
  `<agentDir>/sessions`, subagent transcripts from `<agentDir>/delegation/default/<parent>/`, the summary
  cache and the (read-only) hidden-findings document in `<agentDir>/session-insights/cache/`, exports
  (`--html`, `--trace`: the `--session` one, else the scope's latest) through `writeExport` into
  `<agentDir>/session-insights/` — the agent dir, not the cwd, so a report never drops files into a
  repository. The e2e-fixture export stays ThinkRail's: it needs the host's turn trees.
- **Never long on the event loop; output by mode.** The run waits on the index and the digests in slices
  of 250 ms (at least 10 ms: a zero wait would spin on microtasks and starve their I/O) and reports
  progress between them through pi's status line; everything under it yields as the queries do. Measured
  read-only on a real 213 MB history (58 sessions, Bun): 4.3–4.9 s cold, 3.5–3.9 s in a new process
  from the summary cache (the digests are memory-only), about 45 ms warm, no event-loop stall over 35 ms. The report is `ctx.ui.notify(…, "info")` in the
  interactive and RPC modes — shown in the chat, never appended to the session or sent to the model —
  and stderr in print and JSON modes (pi keeps stdout for itself); a bad argument warns with the usage.
  The engine stays warm between runs of one process and is dropped on `session_shutdown`; the factory
  starts nothing.
