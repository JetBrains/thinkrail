---
id: submodule-web-chat
type: submodule-design
status: active
title: chat — pi conversation UI primitives
parent: module-web
depends-on: [module-contracts]
tags: [v1, chat]
---

## Responsibility

The chat/agent conversation UI: **presentational React primitives** that render pi's **canonical
message / content-block model**, a **tool-renderer registry** (the extension point), and `ChatView`
(the app-integration layer). Hand-rolled — pi ships no web UI, and the official
`@earendil-works/pi-web-ui` (MIT, **Lit**, runs the agent in-browser / "Direct Mode") is the canonical
event→render *reference* we learn from but do **not** adopt (architecture + framework mismatch with our
host-runs-pi / typed-WS / React+shadcn model). Built so others can reuse/contribute (extraction-ready as
a future `packages/chat-ui`). Built-in tool renderers live in the child
[tools/SPEC.md](tools/SPEC.md).

## Rendering model — rows and progressive disclosure

The transcript is pi-canonical turns (`ChatTurn` in `types.ts`: user/assistant are pi messages; `system`,
`error`, `retry` are web-local notices; `compaction` carries both the live lifecycle and the durable summary
record pi leaves where it replaced earlier messages), but the list renders **derived rows, not raw turns** — folding
spans assistant-message boundaries (pi emits one assistant message per tool round), so a per-turn item
model can't group. The pure **`deriveRows(turns, toolResults, isStreaming, isSpec?)`** (`rows.ts`) walks
blocks in order into rows; `ChatTurnView` dispatches on row kind:

- `user` / `system` / `retry` — 1:1 renderers. A user message that is Pi's canonical expanded skill block (`<skill name="…" location="…">`) renders
  as one **collapsed skill-invocation card** rather than exposing the full `SKILL.md`: the skill name is
  always visible, any request supplied after `/skill:<name>` stays visible as ordinary user text beneath
  it, and disclosure reveals the exact persisted instructions as Markdown. Parsing comes from `lib`'s
  anchored Pi-format mirror (browser code cannot value-import Pi); the disclosure rides the shared fold
  cache, so a manual choice survives virtualization. A user message that IS a review context package
  (`reviewPackage.ts` recognizes the `<review …>` header + `<comment …>` items the server's
  `packageRender` emits — the parser is the read half of that format, pinned in unit tests against the
  renderer's verbatim output) renders as a **compact card**: the one-sentence
  summary ("Sent 3 review comments on script.ts") with the COMMENT rows right under it — no file
  level, because a send is ONE MESSAGE PER FILE (`review.sendBatch` groups by file and fires each
  group as its own message), so a file row would always hold exactly one entry the summary already
  names. Each row is one comment (`▸ L2 · the remark…`, one line), unfolding to its full text plus
  the quoted `<fragment>` verbatim (monospace, height-capped). Everything is parsed from the MESSAGE
  itself — never the review snapshot, which the next review replaces — so any transcript answers
  "what was sent" forever, on any client; the comment-row folds ride the shared fold cache (keyed
  `rowId:<content-key>`), surviving virtualization. The retry countdown carries a `source` (`turn` =
  pi `auto_retry_*`; `summarization` = compaction/branch-summary `summarization_retry_*`, pi ≥0.81.1) —
  the flows can overlap mid-run, each keeps exactly one indicator (re-scheduling replaces, each source's
  end event clears only its own), and `RetryIndicator` labels them apart ("Retrying" vs "Retrying
  summarization"). **`ErrorTurn`** is a persistent tinted failure notice
  (provider/model error, an unrecovered `length` truncation, or a rejected send) — **never folded**, so
  a failed turn can't look like nothing happened. Only the current settlement-derived failure carries the
  web-local `try-again` recovery action; its **Try again** button sends one visible ordinary `Try again.` user
  message through `ChatView`'s existing immediate-send path. Rejected sends, extension notifications, and
  generic app errors stay non-actionable because the missing prompt or repair may not be in Pi's context.
  The optimistic user append consumes the action immediately, and any later `agent_start` consumes it for
  other-client/custom-message starts, so a historical error never regains the affordance. Live settlement
  and transcript hydration share the same assistant-failure classifier and action derivation, so reload
  cannot turn the latest unresolved failure into success or lose its recovery; recovered historical
  `length` attempts followed by later work are not re-labeled as current failures.
- `compaction` — a 1:1, fold-breaking row with two sources that converge. Live `compaction_start` /
  `compaction_end` events produce `CompactionNotice` (see the store SPEC): running "Compacting context…"
  (spinner), done **"Context compacted"** (+ "— resuming…" while pi's overflow retry continues the run, +
  tokens before→after when the result carried them), failed with the actionable error text, or cancelled as a
  muted notice. These states are assertable via `data-testid="compaction-notice"` +
  `data-status="running|done|failed|cancelled"`. A successful live end asks the app-integration transcript
  synchronizer to read Pi's canonical summary-plus-tail; reconnect does the same for a runtime from an older
  connection generation. **No snapshot is installed while its host summary is streaming**, whether the need
  came from reconnect or compaction: Pi's persisted `session.messages` omits the in-flight assistant partial,
  and a revision fence cannot protect an update already folded before the read began. The synchronizer waits
  for settlement and re-reads rather than deleting that partial and clearing its correlation id. A pending
  connection-generation sync dominates even when the same read also satisfies an unresolved compaction need.
  Transient transcript-read failures retry with a bounded backoff; only exhaustion
  raises the refresh error, and a new generation/compaction key gets a fresh budget. Store reconciliation
  replaces only host-derived conversation state and preserves browser-local state. The persisted
  `compactionSummary` then becomes the same row in place (the live id,
  estimated-after count, and live `resuming` flag survive when they still apply), and the messages Pi
  summarized disappear immediately rather than only after reload. Its `summary` opens on click
  (`data-testid="chat-compaction"`). Hydration/reopen starts directly from that same durable form. Both forms
  share the **"Context compacted"** title; only facts unavailable after reload disappear.
- `markdown` — a non-empty assistant text block (react-markdown + remark-gfm + shiki). A fenced
  ```mermaid block renders as a themed diagram via `tools/visualize`'s `MermaidView` (fullscreen
  pan-zoom, error → source fallback) — uniform across every `Markdown` surface (chat, file/specs
  preview); until mounted it renders as highlighted source, so static contexts (`RenderedDiff`'s
  `renderToStaticMarkup`) degrade to code exactly like shiki blocks do.
- `tool` — a **primary** tool call: the collapsible `ToolCard` frame (collapsed unless registered
  `defaultExpanded`; errors auto-expand; a manual toggle wins), or a `"bare"` renderer that owns its
  frame. A `"bare"` call on a dead message (`stopReason` aborted/error — pi never executes those calls)
  renders as errored rather than staying interactive forever. Every renderer invocation — registered or
  fallback, routine or primary, card or bare — passes through one common result-content layer. Once a result
  completes, each valid canonical image block appends a bounded in-card preview with an explicit full-screen
  dialog action; multiple images retain block order. This is content-type behavior, not a `read` special case,
  and it does not promote or auto-expand the tool. The result bytes are already in the transcript, so preview
  needs no host fetch and works for paths outside the workspace. Previewable blocks require non-empty data
  and one of `contracts`' shared raster media types (PNG/JPEG/GIF/WebP); malformed shapes and unsupported
  media types are ignored, while canonical content arrays are never serialized into base64 JSON.
- `activity` — one contiguous run of routine work stays one **collapsed outer disclosure** whose header
  summarizes every atomic step (thinking blocks + routine tool calls). Expanding it preserves tools before
  the first thought as direct rows, then renders each non-empty thinking block as a nested disclosure. When
  that block's first non-empty line is a complete standalone Markdown strong span (`**…**` or `__…__`),
  its folded header surfaces the model-authored inner text in place of the redundant visible `Thinking`
  label, using the row's ordinary inherited weight while retaining its default text colour, before the
  trailing tool/character metadata; the teaser truncates before that metadata and
  disappears when expanded, where the disclosure retains the generic label and contains the exact text.
  Blocks without that convention keep the generic label while folded. Semantic breadcrumb and assistive
  labels remain `Thinking` in every state. Every following routine
  tool call stays under that thought until the next thinking block or activity boundary. Those thinking
  groups are siblings **inside** the outer run, even across assistant-message
  boundaries; the hierarchy is presentational, never invented pi entry parentage. A single atomic step
  still renders directly. Non-empty text, primary tools, and non-assistant turns break the outer run. Only
  its trailing instance carries the live ticker. Errored routine tools get **no special treatment**
  (deliberate — agents often recover; `ErrorTurn` and primary error-auto-expand are the safety nets).
- `subagentCompletion` — a `subagent-completion` custom message: a detached (background) subagent run's
  terminal report, injected into the parent by `pi-subagents` when the run finishes. Rendered as a compact
  self-framed card (`tools/subagent/SubagentCompletionCard`) — **the** terminal signal for a background
  run, whose `Agent` tool card froze at its ack (why + card anatomy:
  [tools/subagent/SPEC.md](tools/subagent/SPEC.md)). Never folded into activity groups.
- `divider` — the round-end summary (`TurnDivider` + pure `turnDivider` deriver), anchored the instant a
  round ends: elapsed time, tool-call count, and the round's written files as **two chips split by owning
  tool** — “N specs” and “N files changed”. The split is a **partition** (a path lands on exactly
  one side, never counted twice) computed in the deriver from the injected `isSpec` predicate — the store's
  `specPathMatcher` over the workspace's spec graph, plus `spec_create`'s target, which is a spec by
  construction even before the graph snapshot catches up. Why it matters: a spec is often **gitignored**
  scratch (`.thinkrail/context/`), so counting it as a "changed file" deep-linked the user to a Changes view
  that structurally cannot show it. Each chip now routes to the panel that owns the artifact.
  **One artifact → the chip is a direct deep link; several → it is a disclosure** that expands the round's
  set as a list right here in the transcript (`ArtifactChip` + `ArtifactList`), each row deep-linking one
  path. The set is kept in the chat rather than framed over the panels on purpose: it belongs to *this
  round*, while the panels show *now* — a round from days ago would mark rows that have since moved on (or,
  for Changes, are no longer in the diff at all). It also keeps the count honest: clicking "5 files changed"
  can never quietly surface just the first one, and the handlers take exactly ONE path, so nothing
  downstream has to guess which of several the user meant.
- The two chips are a **switch, not two independent folds**: at most one list is open, choosing the other
  side replaces it, and re-choosing the open one clears the selection. That invariant is *structural* — the
  divider stores the **selected key** (`useSelection`, one entry per divider row), so no state exists in
  which both are expanded. Expanding also **reveals the owning singleton side tool** (`onReveal` → the
  store's arrangement-agnostic tool-reveal intent) without surfacing any path, which is what makes the pair
  read as switching between Specs and Changes; closing is “never mind” and leaves the tool where the user
  last sent it.

Row/step ids are stable across streaming snapshots (the outer run's first atomic-step id, each thinking
block's message-anchored index, and each tool's own id — pi appends, never reorders), so fold state survives
re-derivation and virtualization: **every fold surface (outer activity groups, nested thinking groups, tool
rows, `ToolCard`, the divider's multi-artifact chips) records manual toggles in the shared `foldState` cache**
(`foldState.ts`, keyed by row/step id. Two hooks over that module: **`useFold`** for independent booleans,
and **`useSelection`** for a single-choice group — the divider's chips, which store the *selected key* under
`${rowId}:artifacts` rather than a boolean per side, so "only one list open" cannot be violated;
the `AskUserQuestionCard` pattern, see tools/SPEC.md; deliberately
never evicted — growth is bounded by manual toggles). A manual toggle always wins — over auto-expand
defaults *and* over a virtualization remount.

**Sticky activity breadcrumb.** While the transcript's top visible content remains inside expanded
Activity → Thinking → tool disclosures whose original headers have scrolled above the viewport, one
opaque compact row overlays the scroller with that active root-to-leaf path. Segments join only after
their own header crosses the top, leave at sibling/end boundaries or when folded, and include the active
leaf tool. A segment label scrolls and focuses its original header just below the sticky row without
changing fold state; its separate chevron writes through the existing fold-state source. The trail is
always one line: metadata truncates before names, then a narrow pane preserves the outermost and active
segments while compressing middle ancestry to `…`. It never reflows transcript content, creates parallel
navigation/fold state, or disturbs Virtuoso's initial-bottom, follow-output, and jump-to-message behavior.
The root-to-leaf labels and chevrons are distinct keyboard targets in a labelled navigation region; visual
entry/exit obeys reduced motion.

## Extension point — the tool registry

`toolRegistry.tsx` is **THE extension point**; a tool has two decoupled sides joined by **tool name**:
the **capability** registers with the pi session server-side (custom tool or pi extension/skill), the
**presentation** registers here. A registration is:

- a **renderer** (the specialized card body; `ToolRenderProps` carries `toolCallId`/`args`/`result`/
  `status`/`workspaceRoot`/`streaming` plus an optional shell-injected `onOpenFile` callback — enough to
  stay props-driven; the common invocation seam decorates its completed canonical image results
  consistently), plus optionally
- a **`summary`** — a pure one-liner for collapsed headers and activity-step rows,
- a **`chrome`** — `"card"` (default, the `ToolCard` frame) or `"bare"` (owns its frame; for
  interactive/primary tools like `ask_user_question`),
- **prominence metadata** — `prominence`: `"routine"` (default, incl. unregistered tools — enters the
  outer Activity run, directly before the first thought or under the current nested Thinking disclosure)
  or `"primary"` (escapes the fold; `"bare"` chrome implies it **unconditionally**, even
  over an explicit `prominence: "routine"` — a self-framed renderer can't live inside a fold's step
  rows, so a misregistration must not silently break the fold), and `defaultExpanded` (a
  primary card renders expanded once complete, e.g. `visualize`). Read through the single
  **`resolveProminence`** seam — where a per-user override map (settings) can plug in later.

Unregistered tools fall back to `DefaultToolRenderer`. Tools needing user input mid-run either route
through the extension-UI bridge (`pi.extensionUi` → `ExtUiDialog`) or — for a rich inline card — render
from their `toolCall` args and reply through **`ChatActions`** (see below). Worked example: the
`ask_user_question` flow in [tools/SPEC.md](tools/SPEC.md).

## Interaction seams

- **Structured tool-file navigation** — `ChatView` accepts an optional `onOpenFile(path)` from the shell and
  passes it through every `ToolRenderProps` path (routine, primary, card, or bare). The shared tool-file
  primitive offers that action only for a non-empty relative path or an absolute path contained by
  `workspaceRoot`; URLs, escaping relatives, and foreign absolute paths remain selectable text. Renderers
  source candidates only from explicit tool args/details — never regex guesses over Bash output, code, or
  prose. A standalone renderer has no callback and therefore stays inert. The callback's preview-slot
  semantics belong to [[submodule-web-panels]].
- **`ChatActions`** — a React context (provided by `ChatView`, `null` standalone): how a renderer talks
  **back** to the agent — or asks the integration layer to open something — without importing
  store/transport. Today: `answerQuestion(toolCallId, result)` —
  it rejects when the host refuses (unknown/answered/superseded call), and the caller owns the failure UX —
  plus `focusComposer()`, for a renderer that resolves *itself*: it unmounts the control the user was
  standing on, and focus would otherwise fall to `<body>` and swallow every following keystroke (the same
  stranding the history overlay's dismiss refocus avoids). Only the card's own reply path calls it, and
  only while the card still holds focus. Plus `openSubagentTranscript(childSessionId)` — the subagent
  cards' transcript link (no provider → the cards hide the action).
- **Subagent transcript view** (`SubagentTranscriptDialog.tsx` — an integration file, like
  `SkillsDialog`): a **read-only overlay** over the chat rendering a hidden child's transcript with the
  same primitives (`messagesToRuntime` → `deriveRows` → `ChatTurnView`), fetched via
  `subagent.getTranscript` keyed `(workspaceId, parentSessionId = this chat, childSessionId)`. Opened
  through `ChatActions.openSubagentTranscript`; rendered under a `null` `ChatActions` provider so
  nothing inside can talk back (and a nested transcript link cannot exist). Liveness comes from the
  **host** with each response: `subagent.getTranscript` carries the run's current registry `status`
  (absent once the host no longer knows the run — restart, dispose). The open dialog keeps exactly one
  read in flight, scheduling the next ~2.5s poll only after a response while status is queued/running —
  never from this chat's own runtime, whose frozen background ack can't tell a live run from one lost to
  a restart. A terminal/absent status or the wire's permanent `SUBAGENT_TRANSCRIPT_NOT_FOUND` stops;
  plain transport failures retry while the dialog stays open with a capped backoff. Poll snapshots
  hydrate with child-scoped ids derived from each persisted message's role/timestamp/index, so an
  append-only refresh preserves row identity and manual folds instead of remounting the transcript.
  Works during the run, after completion, and after a host restart (transcripts persist on disk; only
  the in-memory registry is lost — and its absence is precisely what stops the polling).
- **`askState`** — the questionnaire lifecycle seam: the pure `deriveAskStates(turns, askAnswers)` +
  `AskStatesContext`/`useAskState` (provided by `ChatView`, `null` standalone). The ask tool is **ack +
  terminate** (its tool result is just an ack; the reply arrives later as an `ask-user-answers` message),
  so "answered / superseded / awaiting" is a fact about the transcript, not a tool status — derived once
  per runtime snapshot and consumed by the card via context, keeping it props-driven everywhere else.
  The same seam supplies an opaque **per-mounted-ChatView focus scope**: an awaiting card claims attention
  once within that scope (so Virtuoso remounts cannot steal focus), while a fresh mount creates a new scope
  and may focus the still-pending question again. "Fresh mount" is broader than closing/reopening the chat:
  `CenterTabs` renders only the active tab's body, so **every switch back to the chat tab** — from a file,
  a diff, another chat — is a new scope and re-claims attention for a question still waiting. That is the
  intended read (you returned to the chat that needs you), not just a side effect. It carries no store or
  transport state.
- **Hydration** (`hydrate.ts`) — the pure
  `messagesToRuntime(TranscriptMessage[], lastSettlement?, { idScope? })` converter (read-side counterpart
  of the event reducer): rebuilds `{ turns, toolResults, askAnswers, turnIdByMessageIndex }` (a
  `HydratedRuntime`) from a persisted transcript so a reconnecting/second client renders identically to
  the live path (same `raw` result shape). One-shot consumers keep freshly minted ids; a repeated-snapshot
  consumer supplies its session scope to derive stable role/timestamp/index ids for persisted turns. When supplied, the live summary's `lastSettlement` is authoritative; otherwise only the
  final conversational assistant can synthesize an error/length turn. Compacted historical length attempts
  followed by later messages remain history, not a stale current warning. One retry-presentation rule on
  both paths: pi persists a superseded auto-retry attempt ("keep in session for history") that the live
  reducer dropped on `auto_retry_start`, so hydration hides an errored assistant message immediately
  followed by another assistant message — exactly the adjacent shape `_prepareRetry` produces
  (`isRetriedAttempt`); a terminal failure — errored
  assistant followed by a user message or nothing — stays visible, its failure reported by the trailing
  settlement-derived error turn. It also
  returns `turnIdByMessageIndex` (message-position → minted turn id) — the jump anchor map a
  history-search "jump to message" deep link (`chatLocationRequest`, see `store/SPEC.md`) resolves
  against; entries are `null` for a `toolResult` or non-turn `custom` message (a `subagent-completion`
  message maps to its own completion turn's id; text-less, it is still never an anchor match) and for a
  `compactionSummary` (its own turn, but never a search hit — the host's index consumes the same slot, so
  the two stay aligned), and a message that
  ended in `stopReason: "error"` maps to its own assistant turn's id, never the synthesized error turn's.
  `custom` messages: `ask-user-answers` indexes into `askAnswers` (never a turn — the questionnaire card
  is its rendering); `subagent-completion` **becomes its own `subagentCompletion` turn** (the completion
  card is transcript-positioned, so it maps its message index too); unknown customTypes are ignored. No
  store/transport/shiki.
- **Jump-to-message** (`chatLocationRequest` — set by `useHistorySearch.ts`'s `openMessage` on Enter over
  a mapped message hit; see `store/SPEC.md` for the store-level request/clear contract and
  the workbench shell integration's open/reopen/hydrate half) — `ChatView` is the sole consumer. Once
  `rows.length > 0`,
  it resolves the request's `messageIndex` via `runtime.turnIdByMessageIndex` (present only on a
  *hydrated* runtime — a live/already-open session's runtime, built by the event reducer, never carries
  one), falling back to scanning `turns` for the newest whose own text contains `anchorText`'s prefix — the
  same fallback also covers a hydrated map entry whose turn no longer contains the anchor (e.g. the
  transcript changed underneath it). The resolved turn maps to a row via the pure **`rowIndexForTurn(rows,
  turnId)`** (`rows.ts`) — a turn's own row for `user`/`system`/`error`/`retry`, or its first `:text:` row
  for `assistant` (whose turns dissolve into `markdown`/`tool`/`activity` rows, never a row of their own)
  — then `virtuosoRef.scrollToIndex({ align: "center" })` plus a transient `flashRowId` (rendered as
  `data-flash` + a `bg-primary-subtle` transition on the row wrapper, cleared after 1600ms) draw the
  eye to it. Either resolving a row or giving up (toasted as "couldn't locate the message") clears that
  exact still-current request; an older effect may not clear a newer jump. `ChatView` is its only terminal
  consumer, so an unresolved current request must never linger.
- **Open at the latest message** — a settled chat `Virtuoso` mounts with `initialTopMostItemIndex = {
  index: last row, align: "end" }`, so every freshly shown transcript (new tab, history reopen,
  local-placement restore, reload) starts at the bottom instead of mid-scroll; jump-to-message (above) runs
  post-mount and overrides with its centered `scrollToIndex`. The restored-chat e2e asserts a long seeded
  transcript's last message is in view without scrolling.
- **Streaming reading band** — `useChatScroll` owns one imperative, cancellable follow controller for
  every kind of live row growth; renderers never scroll themselves. An immediate local send arms follow,
  aligns its user row at 10% of transcript height clamped to 48–80px, and gives the response a one-way
  60%-viewport runway. A transient list header makes that inset possible even for the first row; the tail
  spacer starts as the 60% budget plus a 42% reading-band floor, shrinks one-for-one with response growth,
  never re-inflates except to recalibrate after a viewport resize, and survives settlement in place. The
  active edge grows without movement until it crosses 82% of the viewport, then
  one 220ms ease-out advances it to 58% (immediate under reduced motion); a large layout change is still
  one move and moves never overlap. A queued continuation anchors only if follow stayed armed after it was
  queued. Upward wheel/touch/scrollbar intent, keyboard transcript navigation, selection, interactive
  focus, and message/history jumps cancel follow even within the bottom threshold. A deliberate manual
  return, **Follow response**, or a new immediate send re-arms it; geometry changes alone do not. Settlement
  neither catches up nor collapses remaining runway. An active-stream remount reconstructs band geometry
  without animating; a settled remount has no runway and keeps the latest-message rule above. The detached
  control reads **Follow response** during streaming and **Latest** after settlement.
- **Composer & chrome** — `Composer` (prompt field + send/steer/followUp/abort, `@`-mentions, `/`
  commands + template **slot sessions** (Tab-through placeholders — see the Template slots bullet
  below), image paste/drop — routed through **`imageAttachment.ts`**: `fileToAttachedImage` decodes in
  the browser and downscales anything over a **1568px long edge** (`fitWithin`; Claude's standard-tier
  edge — an oversized image in history 400s every later turn once the provider's >20-image 2000px cap
  kicks in, and pi's own resizer is deliberately off server-side). An image passes through
  byte-identical only when within pixel bounds **and** a provider-accepted type (png/jpeg/gif/webp)
  **and** under the provider's **4.5MB encoded-base64 ceiling** (`IMAGE_MAX_BASE64_BYTES`, shared via
  `contracts` — pi's own headroom under Anthropic's 5MB API limit; the wire carries base64, so the
  ceiling is measured on `data.length`, with `base64EncodedLength` sizing a raw File before encoding);
  anything else re-encodes through canvas, walking a **JPEG quality ladder** while the encoding
  exceeds the ceiling (a within-bounds multi-MB GIF or a small BMP would 400 the request just like an
  oversized side). An undecodable file falls back to raw **only when its media type is
  provider-accepted** (`ACCEPTED_IMAGE_TYPES`, shared via `contracts`); undecodable + unsupported
  (HEIC…) is **refused** (`fileToAttachedImage` → `null`) — raw pass-through would 400 every later
  turn — and surfaced as a dismissible error chip (`composer-image-error` testid) in the attachment
  strip, cleared on send. One message's batch is also bounded by the request-wide
  **`REQUEST_IMAGE_BASE64_BUDGET`** (24MB of base64, headroom under Anthropic's 32MB per-request cap):
  files that would push the batch over it are refused with the same error-chip surface. The server's
  `imageGuard` extension is the second line of defense for history. While files are still decoding, a placeholder chip renders
  (`composer-image-pending` testid) and sends are held (`canSubmit` is the one reading — `submitText`
  refuses, the send button disables) — a send mid-decode would otherwise go without the image and strand
  it on the next message. A held send keeps its text: the composer's own gestures leave the draft in
  place, and `insertAndSubmit` (the overlay's ⌘/Ctrl+Enter, whose text is not in the draft yet) parks it
  there instead of dropping it. The pending chip shows `filename · W×H` (the picked file's name; mime text appears only in the
  hydrated-turn fallback when no name survived) (`composer-image` testid +
  `data-width`/`data-height`/`data-mime` — the `e2e/composer-images.spec.ts` hooks; both chip skins
  share `FileChip.tsx`). **Chips are bounded, and the label is the only part that gives way**: a chip is
  `max-w-full` and truncates its `label`, while the icon, the `meta` suffix and the trailing action are
  shrink-free — filenames are user-controlled, and an unbounded chip would push its own Remove button
  off a phone viewport (and be clipped by the transcript scroller's `overflow-x-hidden`). So whatever
  must stay readable at any width goes in `meta`, not `label`: the `· W×H` size, and an attach error's
  reason (its filename truncates — the reason is what the user can act on, and a phone has no tooltip
  to fall back to) — and `openHistory` on its
  imperative handle → `onHistoryOpen`) plus its props-driven **slash-completion
  primitive** (filter/menu/caret + Up/Down, Enter/Tab, Escape), reused by `panels/NewWorkspaceDialog` so
  the two inputs cannot drift; `HistoryOverlay` (the history-recall/search overlay `Composer` opens —
  presentational, driven entirely by `useHistorySearch.ts`'s state + callbacks, plus **Save as template**
  and one-click **Trash chat** actions on mapped hits (`ChatView` owns `session.delete` + the idempotent
  store deletion fold; success closes the overlay, failure toasts; `session.deleted` also drives that fold
  in every connected client), and a
  **zoomed-stage preview pane** + **scope picker** — see the next bullet),
  `ModelSelector` + `ThinkingSelector` (also shared with `NewWorkspaceDialog`;
  optional `container` prop portals their popovers into a host Dialog; optional
  `defaultOption`/`onSelectDefault` render an explicit use-the-default row above the provider groups
  (checked when `current` is null) for callers whose selection is an *override* — `ReviewSettings` —
  since a plain model list can only ever narrow, never restore the unset state; `ModelSelector` takes
  `refreshing`/`onRefresh(force)` — a footer “Refresh catalog” row that passes **`force: true`** (the
  user asked, so bypass pi's freshness throttle) and spins while that awaited refresh runs, plus an
  **unforced** auto-fire on each open, which `useModelCatalog` serves from the host snapshot
  (`model.list`) rather than the network: an open is incidental, and awaiting a real refresh there would
  spin the row for as long as the slowest configured provider takes, up to the host's 15s abort, every
  time. Its trigger stays openable with an **empty** catalog — that is exactly when the Refresh row is
  the thing to reach for. `ThinkingSelector` takes
  **`levels`** — `WireModel.thinkingLevels` verbatim, the host-computed support truth, already in pi's
  escalation order — and its rows **are** that list. The web keeps no enumeration of the level
  vocabulary: pi owns it, the host projects the per-model slice, and an empty list (no model resolved
  yet) disables the trigger. It holds **no effort policy of its own**: when a held level isn't one the
  held model can run, the consumer asks the host for pi's `clampThinkingLevel` answer
  (`model.clampThinking`) — `model.default` clamps the same way, and a live session gets pi's answer
  directly via `thinking_level_changed`. Its rows follow the **live catalog** — `ChatView` resolves the
  session's model through `store`'s `selectCatalogModel` before passing it down, rather than reading the
  session's own snapshot, so a `model.refresh` that changes what a model supports changes the offered
  levels with it), `SessionStatsBar`, `ChatHeader` (the fixed, single-line **panel-header row** —
  `h-panel-header-row` (`--panel-header-row-height`, currently 32px), the shared structural geometry with
  workbench Group Headers and the Changes toolbar, not a value pinned here; it never scrolls,
  and constrained widths clip/truncate TODO + status/usage text while preserving the trailing Skills
  action. Its `left` slot carries the plan strip; its **Skills** button is the presentational **`SkillsButton`**
  primitive — a `BookOpen` pill, badged when a skill dir changed on disk — also shared with
  `NewWorkspaceDialog` so the two triggers cannot drift), `ExtUiDialog`, and **`SkillsDialog`** (the **Skills manager**: a catalog
  grouped by source with **sticky section headers** — the first-party **ThinkRail** and **Pi** groups lead
  (above the All-plugins master, which governs only the plugin groups), then Personal / **a group per
  installed Claude plugin** / the repo's Project skills last — each with its admission verdict,
  project-trust, re-confirm-new, a **per-group on/off** toggle + an **All-plugins** master, and per-skill
  toggles. It runs in **two modes** via an optional `workspace` prop: chat (`skills.state`, per-workspace
  skill overrides, + a **Reload** that applies changes to this chat's session via `session.reloadResources`,
  disabled while streaming) or project (`project.skills`, per-project-baseline toggles, no session) — the
  latter reused by `panels` pre-session). All props-driven; behavior detail lives in the components' jsdoc.
- **Adaptive composer geometry** (`Composer`) — an idle draft that fits one visual line renders as a
  shared two-tier shell: a full-width, one-visual-line message row above a stable action footer. Model and
  effort share a compact visual group on the footer's left while remaining two independently
  focusable/clickable picker triggers; History and Send remain explicit on the right. A wrap, explicit
  newline, or width change that makes the draft exceed one visual line grows the message row without moving
  the footer; fitting one line again shrinks only the message row. This is one persistent textarea, never
  conditional twins — the transition cannot lose focus, caret/selection, recall, draft, or a template-slot
  session. Streaming deliberately uses the expanded message row even with an empty draft, because Stop +
  send options join the footer. `ChatView` passes the server-synced
  `ComposerGrowthLimit` prop: `compact` caps at 6 visual lines, `roomy` at 10, and the default `half-chat`
  caps the **editor shell** (textarea + footer) at 50% of the mounted chat panel, never the browser viewport;
  overflow then scrolls inside the textarea. Attachment chips, completion menus, slot hints, and QueueStrip
  keep their existing separate chrome. The slot-highlight backdrop must follow every dynamic textarea box
  change with the exact box-model and scroll-sync invariants under Template slots below.
- **Queued messages: the pending strip** (`QueueStrip.tsx`, props-driven: `queue` + `onEdit`/`onRemove`)
  — the web mirror of pi's interactive-mode pending-messages area. A **streaming send never renders an
  optimistic transcript bubble** (see the store SPEC's echo contract): `ChatView.onSubmit` skips
  `appendUserMessage` for `steer`/`followUp`, and the queued texts render between transcript and
  composer as dim rows — one truncated `Steering:`/`Follow-up:` line per message (`queue-strip` /
  `queue-item` testids, `data-kind` + `data-index`; full text + delivery meaning in the row `title`),
  sourced from the runtime's `queue`. **Each row carries its own edit and remove actions**
  (`queue-item-edit` / `queue-item-remove`) — both call `session.removeQueued { kind, index }` (rows
  are position-addressed, matching the wire op); edit additionally restores the removed message's text
  and images to the draft and refocuses. Per-row actions exist because the original all-or-nothing dequeue
  (click strip → `clearQueue` → every message merged into one draft blob) proved undiscoverable and lossy
  in use. **Abort atomically restores the complete queue** (`onAbort` →
  `session.abort { restoreQueue: true }`): the host drains both Pi lanes and signals abort as one operation,
  waits for idle, then returns each queued message's text + image content; the web prepends the texts and
  reattaches every image. Stop therefore cannot let a queued continuation run or silently discard an
  attachment. A **rejected** streaming send likewise restores its text to the draft alongside the
  `appendErrorTurn`. The ordinary `queue_update` projection still carries only displayable text plus a
  conservative `hasImages` aggregate — no image bytes — so a queued image shows no chip in the strip; the
  canonical transcript turn later renders its image blocks with hydrated fallback labels. E2e:
  `queue.live.spec.ts` (@agent).
- **Streaming send modes: split send + interrupt** (`Composer`) — steer/queue semantics are pi's loop
  design (steer = injected at the next turn boundary, after the current assistant message + its tool
  calls; queue = runs after the agent settles; only abort halts an in-flight response) and proved
  illegible from key-name hints alone. While streaming the composer therefore self-documents: the
  placeholder states meanings ("Enter steers at the next step · Cmd/Ctrl+Enter queues for when it
  finishes") and a **send-options menu** (`send-menu` trigger beside the send button; rows
  `send-mode-steer` / `send-mode-queue` / `send-mode-interrupt`) names each mode with a one-line
  meaning + shortcut. Menu rows are **actions** (send the current draft with that mode), never a
  sticky mode switch — a persistent mode would make the next plain Enter silently obey hidden state.
  **Interrupt** (`SubmitBehavior: "interrupt"`, Cmd/Ctrl+Shift+Enter while streaming; plain send when
  idle; Shift+Enter alone stays newline) is the "take my message NOW" gesture pi lacks: `ChatView`
  awaits `session.abort` (the ack means idle) then performs an ordinary idle send — the partial reply
  stays in the transcript marked aborted, and messages still queued keep their lanes (they deliver in
  the run the interrupt starts). Rejection restores the draft like other streaming sends.
- **History overlay: zoomed preview pane + scope picker** (`HistoryOverlay.tsx`) — `Tab` grows the
  compact single-column overlay into a **two-pane** `zoomed` layout: the existing Prompts/Messages
  sections list stays on the left (~55% width, `data-testid="history-results"` — keyboard nav,
  `scrollIntoView`, counts, and the save-as-template action are all unchanged), and a preview of the
  flat-list **keyboard-selected** item renders on the right (~45%, `data-testid="history-preview"`,
  resolved via the same `resolveHistorySelection` that `Enter`/Cmd/Ctrl+S already use — the preview and
  the keyboard actions can never disagree on "the selected item"). The `compact` stage is untouched: no
  preview pane exists in the DOM at all until `Tab` (not merely hidden), so `history-preview`'s bare
  presence doubles as the zoomed/compact signal. **Preview body:** the hit's full `text` — never the
  row's truncated first line (`PromptRow`) or snippet (`MessageRow`) — is what makes the preview worth
  having: a long prompt's tail, cut off in the list, reads in full here. `whitespace-pre-wrap
  break-words`, scrollable (`overflow-y-auto`), query terms highlighted via `Highlight` reused
  **verbatim** (the same helper the rows use) so highlighting can never drift between a row and its own
  preview. **Preview footer** (muted, small): for a prompt hit, chat title (when set) / a workspace chip
  whenever `workspaceId` is present (unlike `PromptRow`'s chip, never scope-gated — a single detail pane
  has room a dense list row doesn't) / relative time, `·`-joined; for a message hit,
  `sessionTitle · role · relative time`. No selection (an empty result set) renders an empty panel —
  never a crash. **Narrow widths** (below the `md` breakpoint): the preview collapses **below** the
  list instead of beside it (list first in source order, so a column flex stack already places it
  there), each pane independently scrollable within its own height budget. The **scope badge**
  (`data-testid="history-scope"`, unchanged `<scope> ⌃R` label + `data-scope`) is now also a
  `components/ui/dropdown-menu` trigger: its content lists all four scopes in cycle order
  (`data-testid="history-scope-option"` + `data-scope`, fuller labels than the badge itself — "This
  chat" / "Workspace" / "Project" / "Everywhere" — with the current one check-marked). Picking one
  calls `useHistorySearch.ts`'s new `setScope(kind)`, which resets the results selection exactly like
  `cycleScope` — the `Ctrl+R` keyboard path (see the chord-ownership bullet below), since both just set
  the same underlying scope
  state. Radix's default on close is to return focus to the trigger; `onCloseAutoFocus` is overridden
  (`preventDefault` + focus the query input) so a mouse pick hands focus back to the query input
  instead — typing resumes immediately, no extra click needed. The menu is a **controlled** Radix menu
  (`scopeMenuOpen`) for one reason: the overlay's window-level `Escape` stands down while it is open, so
  Escape dismisses the innermost layer. The menu never
  fights the overlay's own `ArrowUp`/`ArrowDown`/`Enter` handling: that handler is bound to the query
  `<input>` element itself, and Radix's portaled dropdown content is a **sibling** subtree — never a
  descendant of the input — so a keydown while the menu holds focus cannot reach the input's handler by
  construction, not by a case-by-case guard.
- **Chord ownership: `Ctrl+R` and `Escape` are not element-local.** Both used to be single-element key
  handlers — `Ctrl+R` on the composer textarea, `Escape` on the overlay's query `<input>` — and both were
  wrong for the same reason: they only fired while that one element held focus. Outside it, `Ctrl+R`
  reached the browser and **reloaded the app**, and an overlay whose input had lost focus (a click back
  into the composer, a row's icon button) had *no* keyboard dismissal at all. Now:
  - **`Ctrl+R`** is owned by `shell/useGlobalHotkeys` — a window capture-phase listener that swallows the
    chord app-wide (`preventDefault` + `stopPropagation`, so it has exactly one handler) and routes it via
    `store.requestHistoryOpen(sessionId)` to the one mounted `ChatView` (`selectActiveChatSessionId`).
    `ChatView` translates it: overlay closed → `composerRef.openHistory()` (identical path to the history
    button — menus dismissed, draft-seeded); overlay open → `cycleScope()`. Neither `Composer` nor
    `HistoryOverlay` carries a `Ctrl+R` branch any more. Deliberate exclusions: a keydown from inside a
    terminal (`.xterm`) passes through untouched (reverse-i-search belongs to the PTY), and
    `Ctrl+Shift+R` / `Cmd+R` are left alone so a keyboard reload stays possible.
  - **`Escape`** is owned by `HistoryOverlay`'s own window capture-phase listener, registered only while
    it is open. Capture + `stopPropagation` encodes "the topmost floating panel closes first" (a composer
    slot session survives the dismissal rather than being cleared by the same keystroke). It stands down
    while the scope picker is open — see the controlled `scopeMenuOpen` note above — so Radix's own
    Escape closes just that menu. There is deliberately **no** click-outside dismissal.
  - **Dismissal returns focus to the prompt field** (`ChatView.onDismissHistory` → the composer's
    `refocus` handle): opening moved focus into the overlay's query input, and closing unmounts it, so
    without this every post-Escape keystroke would land on `<body>` and be lost. The caret goes back where
    it was (`Composer` tracks it on click/keyup/change), or onto the current slot's marker when a slot
    session is live. Dismissal is the *only* close that routes through `onClose` — insert, jump, and
    save-as-template each own where focus goes next (the composer, another chat, a dialog).
- **History overlay: assistant-only messages + jumpable prompts** (`HistoryOverlay.tsx`,
  `useHistorySearch.ts` — R3) — `MESSAGES` now only ever contains assistant-role hits (the server
  filters; see `packages/server/src/history/SPEC.md`): a user-role hit is always a textual duplicate of
  its own `PromptHit` entry, so the location it used to add moved onto the prompt row instead. Every
  prompt row now renders a go-to-chat icon (`data-testid="history-jump"`, `aria-label="Go to chat"`,
  an `IconTooltip` reading "⇧⏎ go to chat", next to the existing save-as-template icon) **when jumpable** —
  `workspaceId` present and `messageIndex != null` (absent for an unmapped-cwd hit, or a host that
  doesn't populate the prompt's anchor fields). Clicking it, or **`Shift+Enter`** while a prompt row
  is the keyboard selection, routes through the exact same `onOpenMessage` path a message hit's
  `Enter`/click already used — both now go through the shared **`jumpTarget(hit)`** helper
  (`useHistorySearch.ts`, exported pure), which resolves either hit shape to a `ChatLocationRequest` or
  `null`, so the icon's render gate, the `Shift+Enter` handler, and the message-hit gate can never
  disagree on "is this jumpable." An unmapped/legacy prompt row shows no icon and `Shift+Enter` is a
  no-op (overlay stays open) — the same belt-and-suspenders gating the message-hit path already had.
  The icon itself stays hover-revealed (`group-hover`/`isSelected` opacity, like the save-as-template
  icon beside it), but its shortcut glyph (`data-testid="history-jump-shortcut"`, literal `⇧⏎`) is a
  **selected-only**, not hover-only, persistent `<span>` — the same precedent as the scope badge's `⌃R`
  (always next to its label) — since a keyboard-only user, `Shift+Enter`'s own audience, never triggers
  `:hover`. The save-as-template icon's own shortcut (`SAVE_SHORTCUT_LABEL`, `⌘S`/`Ctrl+S`) gets the
  identical selected-only glyph (`data-testid="history-save-shortcut"`) for the same reason, symmetric
  with the jump icon.
- **Template slots** (`slotSession.ts`'s parser + `Composer`'s session state + `ChatView`'s menu/pick
  wiring — the composer's Tab-through placeholder flow, end to end). **Parsing** (`slotSession.ts`, pure,
  zero deps): `parseTemplateSlots(body, argumentHint)` expands pi's own placeholder grammar (`$1..$n`,
  `$@`/`$ARGUMENTS`, `${N:-default}`, `${@:N}`, `${@:N:L}` — pi's grammar, single owner; see
  `packages/server/src/templates/`) into visible text plus `TemplateSlot` ranges;
  `stripUntouchedSlots`/`shiftSlots` round out the session (strip-on-send, re-track-on-edit) — **parse
  only**, this module never evaluates the grammar (a typed-through `/name args` prompt already expands via
  pi's own `PromptOptions.expandPromptTemplates`, with or without this parser). **Observed** (the design's
  "to verify" #3, resolved by `e2e/templates.live.spec.ts`'s typed-through test): pi's own transcript
  records the ALREADY-EXPANDED body for a typed-through send, never the raw `/name args` —
  `AgentSession.prompt()` substitutes args into `expandedText` before persisting the `role: "user"`
  message, so a `session.getMessages` re-fetch (a reload, or reopening from history) shows the expanded
  text. The one nuance: the web client's own immediate bubble is an **optimistic echo**
  (`ChatView.onSubmit` → `appendUserMessage`, store-only, appended *before* the transport call resolves;
  attached images ride along as content blocks so the bubble shows them — `UserTurn` renders image blocks
  as compact "attached file" chips above the text (no inline preview; click opens the image in a dialog,
  the diagram-fullscreen pattern). The chip label is the picked file's name, carried on the echo turn as
  `attachmentNames` (UI-side only — pi's `ImageContent` has no filename), index-aligned with the image
  blocks; a hydrated turn has no names and falls back to mime-type labels) —
  it shows exactly what was typed (the raw command) until a re-fetch replaces it with pi's real persisted
  record. **The `/` menu merge**
  (`ChatView`): pi's `commands` snapshot (`session.getCommands`, frozen at session-create time) minus its
  `source === "prompt"` entries, plus a fresh `template.list { workspaceId }` fetch mapped to
  `SlashCommandInfo` rows (`source: "prompt"`, `sourceInfo` synthesized to match pi's own prompt-template
  convention exactly: `{ path: filePath, source: "local", scope: scope === "global" ? "user" : "project",
  origin: "top-level" }`) — one merged list. The chat prepends its one **browser-native command**,
  `/compact [instructions]`, as a display-local `builtin` row labelled `Pi/built-in`; contracts' Pi-mirrored
  command source stays unchanged. Native `compact` is reserved over an exact-name extension/template
  collision (skill commands remain namespaced), and the exact Pi parser recognizes only `/compact` or
  `/compact ` plus trimmed instructions — every near-miss remains an ordinary prompt. A compact submit
  bypasses the optimistic user echo and every streaming send mode: completed draft images **or the queue's
  host-authored `hasImages` aggregate** reject it in place with an actionable composer chip (draft + queue
  preserved; pending draft images already hold all submits). Otherwise the command clears, drains
  `session.clearQueue { requireTextOnly: true }` back into the composer in steering-then-follow-up order,
  then calls `session.compact`; the host rechecks the image precondition at the destructive operation, so a
  stale client or cross-client race still cannot drop queued bytes. The host atomically rejects a second
  manual compaction while one is already in flight for that session; Pi owns abort, summarization,
  persistence, and lifecycle. The request snapshots
  existing compaction-turn ids, and a rejected clear/compact asks the store to append a failed compaction row
  only when no new lifecycle turn appeared, so Pi's emitted failure and a pre-lifecycle wire failure share one
  surface without duplicating. Existing live/hydrated compaction rendering is unchanged. When a
  `template.list` response comes back **empty**,
  `SlashCommandMenu` renders a `footer` nudge (`data-testid="slash-templates-empty"`) that
  deep-links to Settings → Templates via `ChatView`'s `onManageTemplates` — the discoverability half of
  the starter-templates offer (`panels/SPEC.md`), since a fresh install has an empty global prompts dir
  and the manager is otherwise two clicks deep in a dialog. Gated on "no templates exist", never on "the
  current query matched none", so a query that simply misses doesn't raise it; `footer` is optional, so
  `NewWorkspaceDialog`'s reuse of the same menu is unaffected. **The gate is `ChatView`'s explicit
  `templatesEmpty` prop — a resolved, empty listing — never `commands` having no `source === "prompt"`
  row.** The merged list is equally empty *before* the first fetch resolves and *after* one fails (that
  `.catch` is silent by design — a failed listing must not break the menu), so reading emptiness off it
  would flash "you have no templates" on every chat's first `/` and strand that claim permanently after a
  failed listing — over a row whose click also clears the user's slash draft. The fetch runs on
  **every** slash-menu-open transition (**`onSlashActive`**, a boolean prop mirroring `onMentionQuery`'s
  query signal — it stays `true` while the user types the query, so no per-keystroke refires) and is
  deliberately **uncached**: prompt files change outside the app too (pi CLI, an editor, a git pull),
  which no in-app invalidation counter can see — an earlier `(workspaceId, templatesVersion)` cache here
  served exactly those externally-changed files stale for the rest of the chat, and the server re-reads
  its dirs per call precisely for this freshness (its SPEC calls the readdirs cheap) —
  this is what makes `packages/server/src/agent/SPEC.md`'s "the
  composer's `/` menu path is always fresh via `template.list`" claim true, unlike the typed-through
  `/name args` path's frozen create-time snapshot. **Picking a template** (`ChatView`'s `onPickTemplate`, a
  `Composer` prop): instead of the plain `/name ` insert, fetches `template.get`, splits
  frontmatter client-side (`templateText.ts`'s shared `stripFrontmatter` — pi's own frontmatter parser is
  server-only, never reaches the browser bundle, but the boundary rule is pinned to match it exactly; see
  the Save-as-template bullet below), runs `parseTemplateSlots(body, argumentHint)`, and hands
  the result to `Composer` via a new **`ComposerHandle.insertTemplate`** method (alongside the existing
  `insertText`) — replaces the whole draft (like `pickSlash`, not `pickMention`: a slash command occupies
  the entire input) and, if the parse produced any slots, starts a **slot session** selecting slot 0; no
  slots → a plain insert, caret at the end, no session. The async response is applied only while the pick
  is still **current** — newest pick wins AND the draft is byte-identical to pick time — so a slow
  response can never clobber a draft the user typed (or a second template they picked) in the meantime;
  the rules are `templatePick.ts`'s `shouldApplyTemplatePick` (pure, unit-tested for delayed and
  out-of-order responses). **The session** (`Composer`, local `useState`:
  `slots: TemplateSlot[] | null` + `slotIdx`, no store/transport): `Tab`/`Shift+Tab` step to the
  next/previous slot (wrap; `preventDefault`; a no-op while the mention/slash menu is open — checked at
  the top of `onKeyDown`, before the menu's own key handling, so a real
  Tab-to-pick-a-menu-item is unaffected, and symmetrically an `Escape` while the menu is also open lets the
  menu's own dismiss win first). Stepping **out** of a *user-edited* slot (one whose text the
  user actually changed — not an untouched marker, and crucially not an untouched `${N:-default}` either)
  splices its current text into every other slot sharing its `group` whose text differs (group
  mirroring — repeated `$N`/`${...}` occurrences propagate on slot exit, not per keystroke), each splice
  re-tracked via `shiftSlots` (`mirrorSlotGroup` in `slotSession.ts`). A slot carries two independent
  bits: **`filled`** (a parse-time property — has real content: a `${N:-default}`'s default, or a marker
  typed into — drives strip-on-send + the tint) and **`edited`** (session runtime state — the user
  changed it — the sole mirror-*source* gate). If the user collapses an untouched marker selection to
  its end and types there, the visible marker plus typed suffix becomes filled and is preserved on send:
  this is WYSIWYG, and stripping the grown range would delete the user's text with the marker. They are
  deliberately distinct: `${1:-foo} … ${1:-bar}` is born `filled` but not `edited`, so its two differing
  per-occurrence defaults stay independent until the
  user provides the argument by editing one — matching pi's own expansion, which never rewrites
  "foo … bar" to "foo … foo". `Escape` ends the session
  (`setSlots(null)`), leaving the text as-is. A genuine text edit (the textarea's own `onChange` — never a
  programmatic `onChange(text)` call; those end the session outright instead, since none of
  `pickMention`/`pickSlash`/arrow-recall/`insertText` participate in slot tracking) diffs the old/new value
  around the post-edit `selectionStart` (a common-prefix/suffix scan) into `(editStart, removedLen,
  insertedLen)`, re-tracks every slot via `shiftSlots`, and flags the slot the edit landed in
  `filled: true` **and** `edited: true`; an edit that consumes the **entire** prior value (a
  select-all-and-type/delete) ends the session instead of re-tracking a now-meaningless collapsed range
  set. On send, `submit()` runs the same group-mirroring pass over **every user-edited slot**, not just
  the one most recently Tab-exited (`mirrorAllGroups` — a direct Send never has to go through Tab first for
  its mirroring to take effect), propagating each into its same-group siblings; only **then** does it strip whatever markers are
  still untouched (`stripUntouchedSlots`), and always clears the session — sent **or** queued
  (steer/followUp), same rule. Switching tabs needs no
  explicit cleanup: the workbench visibility gate mounts only a group's locally selected body, so leaving a
  chat tab unmounts `Composer` (and its session) while the store's `draft` text itself persists. **Hint chip**:
  while a session is active (and the menu is not, so the two absolutely-positioned overlays never share
  the same anchor rect), a small pill above the textarea — `slot {slotIdx+1}/{n} · ⇥ next · esc done`
  (`data-testid="slot-hint"`) — clickable, tap steps to the next slot (same mirroring rule as `Tab`), the
  mobile path with no keyboard needed. **Highlight backdrop**: while a session is active, the composer's
  gaps are visually tinted in the message field itself — a native `<textarea>` can't style text ranges
  inside it, so `Composer` renders a **highlight-backdrop** (a styled mirror layer positioned behind a
  now-`bg-transparent` textarea; the input background moves up to the wrapping container instead, clipped
  to the same `rounded-[var(--radius-md)]` so nothing changes visually outside a session). That wrapper
  owns the input border and fill: `bg-clip-padding` keeps the backdrop tint inside the rounded border,
  while `focus-within:border-control-border-active` is the composer's sole focus indicator rather than a
  second accent ring on the textarea. The pure `highlightSegments(value, slots, activeIdx)`
  (`slotSession.ts`) breaks `value` into ordered
  plain/unfilled/filled/active runs — a slot range is `"active"` when its `slots` index is `activeIdx`
  (`Composer`'s own `slotIdx`), else `"unfilled"`/`"filled"` per its own `filled` flag; everything else is
  `"plain"` — pure offsets/slices, no empty segment for zero-gap-adjacent slots, and the tests pin
  `segments.map(s => s.text).join("") === value` in every case. The backdrop's inner mirror div matches the
  textarea's box model **exactly** (`px-12 py-8`, the same `tr-text-ui` typography class, a
  `border border-transparent` of the same width so the content box lines up,
  `whitespace-pre-wrap break-words` — spelled out explicitly since a `<div>`, unlike a `<textarea>`,
  doesn't soft-wrap this way by default) so each `SlotSegment`'s tint span
  (`data-testid="slot-highlight"` + `data-slot-state`, `rounded-[var(--radius-xs)]` — the text-run radius
  tier — with `bg-primary-soft`/`-muted`/`-subtle` for
  unfilled/active/filled, no tint for plain, every span `text-transparent` so only the real textarea text
  above shows through) lands exactly under its own characters. **Scroll sync**: the textarea's `onScroll`
  copies its `scrollLeft`/`scrollTop` onto the backdrop's outer `overflow-hidden` layer **imperatively**
  (a ref — no state, no inline `style`: a programmatic scroll offset needs no styling at all, so the
  repo's token-utilities-only invariant holds with zero exceptions; an earlier version tracked the
  offsets in state and applied a `translate(...)` inline style, which both violated the invariant and
  re-rendered the composer on every scrolled frame). The backdrop's **ref callback** seeds the offsets at
  mount, so a session starting in an already-scrolled composer never paints even one frame misaligned.
- **Save-as-template + template management** (`TemplateEditorDialog.tsx`; `HistoryOverlay`'s save action;
  `panels/TemplatesSettings.tsx`) — one shared create/edit surface for prompt-template files, reused by two
  entry points that never talk to each other: the Settings → Templates panel (list + New/Edit/Delete, see
  `panels/SPEC.md`) and the history overlay's save-as-template action below. **Why this lives in `chat/`,
  not `panels/`** (a deliberate boundary exception, alongside `ChatView.tsx`/`useHistorySearch.ts` above):
  `panels/` is allowed to import from `chat/` (already does, for `ModelSelector`/`ThinkingSelector`/
  `Markdown`) but never the reverse, and `HistoryOverlay` — which needs this same dialog — lives in
  `chat/`, so the one shared implementation has to live where both sides can reach it. `TemplateEditorDialog`
  is therefore promoted to a **third** sanctioned store/transport-touching integration piece (see Boundary
  below), even though it isn't `ChatView` itself.
  - **`templateText.ts`** is the single shared frontmatter splitter/assembler — `stripFrontmatter`
    (`ChatView.tsx`'s composer-pick path + this dialog's body field), `assembleTemplate` (this dialog's
    save). It does **no YAML value parsing**: the dialog's description/argument-hint fields are populated
    from the server-parsed `template.get` response (`Template` — pi's real YAML parser over the **full
    file**, full scalar-style fidelity, pinned in
    `packages/server/src/templates/templates.test.ts`), never from a browser-side reimplementation (an
    earlier `splitTemplate` here handled only bare/double-quoted scalars, so a pi-native
    `description: 'single-quoted'` loaded into the form with literal quotes and saved back corrupted).
    Its boundary
    rule mirrors pi's own `extractFrontmatter` (`@earendil-works/pi-coding-agent`'s
    `dist/utils/frontmatter.js` + `dist/utils/text.js`, pinned against pi v0.84.3 — the same pin
    `packages/server/src/templates/SPEC.md` uses server-side; re-verify both on a pi version bump): strip
    one leading UTF-8 BOM, normalize newlines, then end the frontmatter block at the FIRST later `\n---`
    line; the body is everything after that fence run through `.trim()` — not a single optional `\n`.
    A prior version had two independently hand-rolled regex splitters (one per file), each consuming only
    one *optional* `\n` after the closing fence instead of trimming — a
    leading blank line leaked into the body on every pick and every edit-reopen, and **compounded** by one
    more `\n` per edit-save cycle (the leaked line got saved back into the body field and re-wrapped the
    next save). `templateText.test.ts` pins the round-trip/stability properties this fix depends on.
  - **Fields**: name (validated client-side against the exact same rule as the server's
    `isValidTemplateName`, `packages/server/src/templates/templates.ts` — duplicated rather than shared,
    since it's a 4-line pure predicate and the server module is server-only), a scope radio (Global / This
    project; "This project" is disabled with no active workspace), description, argument-hint, and a body
    `Textarea` with a static one-line syntax hint (`$1, $ARGUMENTS, ${1:-default} — pi prompt-template
    syntax`; the real grammar is parsed by `slotSession.ts` / expanded by pi — this line is documentation
    text only, not itself parsed).
  - **Assembly**: `---\ndescription: …\nargument-hint: …\n---\n\n<body>`, omitting either key when its
    field is empty, and **no frontmatter block at all** when both are empty **and the body doesn't start
    with `---`** — a body that does gets an explicit (possibly empty, `---\n---\n\n`) block forced anyway:
    saved bare, pi's own loader (and our splitter) would go hunting for a *later* `\n---` line inside that
    body to treat as a closing fence, silently swallowing real content as YAML the moment the body
    contains one; forcing the wrapper makes our own fence the earliest possible match unconditionally, so
    the body's own `---`-looking lines are never reinterpreted (see `templateText.test.ts`'s
    ambiguous-body case). Each value is emitted `JSON.stringify`-quoted rather than bare — YAML's
    double-quoted scalar escape set is a superset of JSON's, so this is always valid YAML without pulling
    in a `yaml` package just to serialize two short strings (see the seed fixture's own `argument-hint:
    "[file] [scope]"`, quoted for the same reason: an unquoted value isn't always valid YAML).
  - **Editing an existing template locks its name + scope** (both fields disabled): `template.save` is
    create-or-overwrite keyed by `(scope, name)` with no rename/move primitive, so changing either while
    editing would silently orphan the old file on disk instead of renaming it. Creating new (including
    save-as-template) leaves both fully editable. **An edit saves under `template.name` verbatim — never
    trimmed or normalized**: whitespace-bearing names are server-legal *by design* (pi derives a
    template's name from its filename verbatim, so a hand-created `report .md` lists as `report `;
    `packages/server/src/templates/templates.ts`'s gate deliberately accepts every pi-listable name), and
    trimming on save wrote a NEW `report.md` while leaving the file being edited untouched
    (reviewer-flagged; `templates-manage.spec.ts` pins the round-trip). The Save button's emptiness gate
    is new-mode-only for the same reason — a whitespace-only hand-created name is a legal edit identity.
    Only a **new** template's typed name is trimmed before validation/save: deliberate form
    normalization, so an accidental trailing space can't mint a file that renders identically to its
    trimmed twin in every listing (the composer's `/` menu can *use* such hand-created names via click,
    but a typed `/name` token can't carry a space — the UI shouldn't manufacture second-class names).
  - **Edit-open fetches the full template** via `template.get`, pinned to the row's exact `(scope,
    name)` — `template.list` is metadata-only by design (bounded head scans + a size cap, see
    `packages/server/src/templates/SPEC.md`), so the listing row can't provide the body, and — the part
    that bit — can't be trusted for metadata either: a file whose frontmatter closing fence sits past the
    listing's scan window *legitimately* lists with **no** description/argument-hint. The `get` response
    is therefore **authoritative for every field**: body via `stripFrontmatter(content)`, and
    description/argument-hint from its full-file parse, replacing the listing-row values that only *seed*
    the form for instant paint. (Reviewer-flagged data loss otherwise: seeding from the degraded row and
    writing those fields back on Save meant a body-only edit silently deleted the file's real
    description — `templates-manage.spec.ts` pins the round-trip.) Until the fetch resolves, the
    description/argument-hint/body inputs are disabled and Save is gated (`loading`) — an early save
    would overwrite the file with the degraded seed; a failed fetch keeps Save gated for the same reason
    (error shown inline, retry by reopening).
  - **Save** calls `template.save` then the store's `bumpTemplatesVersion()`; a rejected save renders its
    message inline via `data-testid="template-error"` (never a toast — the dialog stays open so the error
    is fixable in place). **Delete has no dialog involvement at all** — `panels/TemplatesSettings.tsx`'s
    row calls `template.delete` + `bumpTemplatesVersion()` directly, behind a `ConfirmPopover` anchored to
    the row's own Delete button. A **rejected
    delete** is the one deliberate asymmetry with Save: it surfaces as an error toast, not inline (there's
    no dialog to render inline into), leaving the row in place — the same pattern `panels/SPEC.md`
    documents for `ProjectTree`'s own workspace-remove row.
  - **Save-as-template** (`HistoryOverlay`'s selected-prompt-row action, `data-testid="history-save-template"`,
    keyboard **Cmd/Ctrl+S** while a prompt row is selected — the overlay's `onKeyDown` always
    `preventDefault`s the combo, so the browser's own Save dialog never opens regardless of what's
    selected, but only fires the action when the resolved selection is a prompt hit) opens the dialog with
    the body prefilled from that prompt's text — a "new template" case (no existing name/scope identity),
    same as clicking New. **The composer-overflow entry point was dropped as YAGNI** (the plan's own word)
    — the history path already covers "reuse what I already wrote"; a second entry point for the same
    "type it, then decide to save it" gesture would be redundant surface, not a distinct use case.
  - **Edit-as-file** — project-scoped rows only get an `Open as file` action (`panels/TemplatesSettings.tsx`),
    reusing `openTabs.ts`'s exact `openFileInTab(workspaceId, ".pi/prompts/<name>.md", "keep")` (the same
    action file-tree clicks use) — at the **`keep`** intent deliberately, since an explicit "open in editor"
    must not land in the preview slot a later browse click would silently replace (see `panels/SPEC.md`'s
    Preview tabs bullet) — then `store.closeSettings()`. **Global rows are dialog-only** — a deliberate
    asymmetry, not an oversight: file layout references are worktree-scoped, but a global template lives
    under the host's agent dir, outside any worktree, so there is no
    worktree-relative path to open it at.
- **Plain `↑` recall + history button** — `Composer`'s `recentPrompts` prop (`ChatView`: this chat's own
  user-turn texts via `turnAnchorText`, newest first, deduped **keeping the newest occurrence** — the same
  recency-first ranking rule as the server history index, the atuin/fzf convention) backs a lightweight
  recall session (`recallIdxRef`) gated so it can never eat a draft: `↑` only steps in when the field is
  **empty** or a recall is already active (older → higher index), `↓` steps newer (past the newest
  restores `""`), any diverging edit or a submit exits the session, and the recalled text lands with the
  caret at its end. The session index is a **ref, never state**: nothing renders from it, and stepping
  writes the index *here* while the draft goes through `onChange` to the **parent's** store, so as state
  the two could commit in separate passes. In that window the textarea already showed the recalled text
  while still carrying the previous render's handlers and their stale index — a second `↑` re-recalled the
  same entry instead of stepping, and an edit failed to end the session, so the next `↑`/`↓` stepped from
  the live index and **overwrote what the user had just typed** (the loss `replaceDraft` guards against on
  the insert paths, arriving through the keyboard path instead). A ref reads at its last written value, so
  commit ordering cannot enter into it. Handlers take **one snapshot per event** — the ref cannot change
  inside a synchronous handler, and one read stays narrowable where repeated `.current` reads do not. A `History`-icon button (`data-testid="history-open"`, `aria-label="Search history"`,
  always rendered next to send) calls the same `openHistory` the global `Ctrl+R` reaches — the tap path
  on mobile, a discoverability affordance on desktop.
- **Chat TODO plan** — the chat's `pi-todos` list surfaced **only in the chat** (engine:
  [[module-pi-todos]]; host read/write: [[submodule-server-todos]]):
  `useChatTodos` (the `todo.*` data hook — fetch + live `pi.event` refetch + edits + the add-nudge + the
  `openMarkdown` snapshot action; tool completion refreshes immediately and `agent_settled` supplies the
  final refresh; overlapping list reads are latest-wins and connection-generation stamped, accepted adds
  fold by item id, and a failed optimistic removal re-reads authority rather than restoring a stale whole-plan
  capture over concurrent edits; plus the agent-review ops `startReview` (`todo.startReview`) and
  `reviewAll` (`todo.reviewAll`) — both re-read the plan, since the review decoration is host-derived
  and never patched locally; the manual-verdict ops were removed with the plan page's manual mode —
  `todo.review`/`todo.requestFix` remain on the wire, host-side), `planView` (pure derivations over the DTO: `groupProgress`,
  `planSummary`, `planGlance`/`sessionGlance`, `planSections`, `shouldNudgeOnAdd`, and the review-trail
  set — `itemRevisions` (the commit history, 1 TODO = N commits), `reviewableItems`/`reviewProgress`
  (host-gated by `TodoItem.review` presence — the reviewable rule has ONE home, server-side),
  `reviewChangesRequested` + `itemOpenFindings` (the changes_requested warning marking: the flag and
  the count of the reviewer's open comments — matched by the finding's `origin` provenance
  (todoId + optional sessionId) when stamped, falling back to the change-set path join only for
  provenance-less comments, so two steps touching one file don't count each other's findings; the
  Review tab is the truth), and
  `planCompletionSummary` (the plan-level note gated on "everything done", so a re-opened plan never
  shows a stale all-done note). `itemChangeSet`'s precedence: live `change` paths win (a fallback redo's
  latest delta), else the NEWEST resolvable commit. A group's *status* is
  **not** derived here — the host computes it and ships it on `TodoGroupItem.status`, so the rule has one
  home; a user edit therefore re-reads the plan rather than patching it locally, see `useChatTodos`), `TodoList` (the
  **status-ordered, group-first** rendering (`planSections`) — group = task: the **in-progress** task
  (its whole group) on top with **no section header**, then a **To do** section (the pending groups,
  then the user's pending loose items), then a **"Done" label** at the very bottom under which **each
  finished task is its own foldable row** (collapsed — title + `N done`) plus the done loose items (not
  one collapse over all of Done). Finished *steps* stay inline in their (active/pending)
  group; only whole done tasks move to Done. Each group is a header row (derived status icon + title +
  done/total badge), the `active` group emphasized; the user's loose items carry a per-row `user` badge
  (no separate "Your requests" header — they're placed by status). **The compact list is title-only**
  (status glyph + title + the change-set chip) — a row's `note`, a done item's agent-authored `summary`,
  and its `verification` are **not** shown here, so a long plan reads at a glance without overloading;
  the **full plan page** (`PlanPane`) is where those surface: the `summary` as a clamped muted line
  (`todo-summary`) and the `verification` as the shared **`VerificationBadge`** (`planKit`; the
  "Tests ✓" element — check glyph for a named check, warning glyph for an honest "not verified", the
  split derived by `planView.verificationStatus`, ONE home; the badge's title labels it self-reported —
  never a host-run gate). The plan page has no in-page review list
  — its header kebab offers **Review All** (host-side queue, `todo.reviewAll`) and a comment chip that
  focuses the right-panel Review tab (see `panels/SPEC.md`). A row whose review is **settled** (`planView.reviewSettled` — approved and
  nothing landed since) upgrades its done check to the **circled Verified glyph**
  (`StatusIcon reviewed`, hover "Verified", `data-reviewed`) — the at-a-glance "this step was
  reviewed" state, popup and plan page alike; a **changes_requested** verdict flips the glyph to the
  warning `CircleAlert` instead (`StatusIcon changesRequested`, hover "Changes requested",
  `data-changes-requested`) — the plan page adds the chip + feedback note (see `panels/SPEC.md`). **A row whose item carries a host
  change set grows a quiet "N files" chip** (`itemChangeSet` in `planView` — the one derivation shared
  with the markdown snapshot below, so the two can never disagree): a **committed** item's chip opens the
  Changes panel at its `commit:{sha}` scope via `useChatTodos.openChanges` (`setDiffScope` + a
  shell `reveal-tool` intent — the panel lists the commit's files itself; N = the DTO's host-derived
  `commit.files`); the **path-list fallback** deep-links a single path's live diff directly (pinning the
  scope back to `branch` first, so it can't inherit a commit scope a previous click left behind) or
  expands an inline path list. A commit artifact whose sha no longer resolves ships **no `files`** → no
  chip, never a broken diff tab (the degrade contract). Plus the add-row + an **"Open the plan page"**
  button (`todo-open-plan`) — `useChatTodos.openPlan` opens (or focuses) the chat's **live plan page**,
  a center `plan` tab rendered by `panels/PlanPane` (see `panels/SPEC.md`); its heading resolves the
  chat's name through the store's `selectChatTitle` (one home, shared with the pane). **Status ordering is UI-only** — the agent's `formatPlan` stays plan-order so its
  "work in order" discipline is unaffected), `planMarkdown` (a pure `plan →
  markdown` compiler, `## <group> — n/m` sections — the plan page's **export** (copy / save-as-.md),
  never an interactive surface: a done item's change set renders as its short sha + `N files · +A −R`
  and status-lettered per-file rows, **plain text, no links** — an export leaves the app, where a link
  scheme would be dead; interactive navigation is the plan page's job), and `ChatPlan` (`ChatPlanStripContent` +
  `ChatPlanContent` — a header strip that opens the plan in a `Popover` over the chat; `ChatView` composes
  the `Popover` anchored to the header, so the popup hangs flush under it at the chat's left edge). There
  is no right-panel Todo tab — the plan lives in the conversation; the plan *page* is a center tab, a
  document-scale view of the same plan, not a panel. Frontend-local workspace view state persists that page
  as a registered `todo-plan` reference (resolver kind + session identity, never plan content); another
  client may explicitly reopen the same live page from the host-owned TODO plan without inheriting placement. (An earlier design compiled the plan to a
  static markdown `doc` tab with a custom `thinkrail-diff:` link scheme — replaced: a snapshot lies the
  moment the agent flips a status, and markdown can't carry the Changes-panel affordances; the page is live
  and markdown is demoted to its export.)
  **The glance state** keeps the plan honest as the user's status window: `planGlance(isStreaming,
  askStates)` — derived from session state in `ChatView`, **never stored**, so the agent can't make it
  lie — renders the `in_progress` step as working (dot), **waiting for your answer**
  (`MessageCircleQuestion` — the same glyph as the `ask_user_question` card, when the agent stopped with
  an awaiting question), or **paused** (`CirclePause`, any other stop: turn ended, error). A stop with no
  pending question never claims the user owes an answer. **The header strip reflects the agent's state,
  not the checkboxes** (`stripStatus`, decoupled from the `in_progress` step): it shows "waiting for
  your answer" **even when every item is done** (the earlier strip hid it whenever there was no
  in-progress step, so an agent blocked on a question read as "finished"); "working" while it runs;
  "paused" only when it stopped with open steps left; and nothing extra on a clean finish (all done,
  idle). `TodoList` stays props-driven — it receives the resolved glance, never reads the transport.
  Its section label + pending/active/done status glyphs live in **`planKit.tsx`** — shared
  presentational atoms the Review panel (`panels/ReviewPanel`) reuses so both "work items in
  sections" surfaces read identically.
  **The add-nudge respects that waiting state.** A user add always stores the item (loose, at the end),
  but `nudgeAgent` **only wakes the agent when it isn't waiting on the user** (`shouldNudgeOnAdd` —
  skip iff the glance is `waiting_question`): waking an agent that stopped on an `ask_user_question`
  would send it off to work the new item and forget to return to its own question, so instead the item
  just queues and is picked up on the agent's next natural turn (when the user answers, or a later idle
  nudge). `working` rides a `followUp`, plain `waiting`/idle a `prompt`, unchanged.

## Boundary

- **Public surface:** the registry API (`toolRegistry`), the props-driven slash-completion primitive, and
  the renderers (incl. the presentational `Markdown` — GFM + shiki, no store/transport; the rendering is fixed but the **prose skin** is the
  caller's via an optional `className` — chat uses the compact bubble skin (`tr-prose-chat`),
  `panels/MarkdownPreview` the document skin (`tr-prose-doc`). A skin names exactly one generated
  `tr-prose-*` system and then carries only spacing/measure/chrome — no size, weight, leading or
  tracking (see `styles/TYPOGRAPHY.md`); a caller may
  also **extend** the render with extra `remarkPlugins` + `components`, e.g. the file view's GitHub
  alert callouts), the view types
  (`types.ts`,
  incl. `ToolResultState` + `ExtUiDialogRequest`), and `ChatView` (lazy-mounted by the shell workbench
  resource renderer;
  it wires `SkillsDialog` + the header Skills trigger, resolving the owning `projectId` from the store and
  reading the reload badge from the store selector `selectSkillsStale(state, workspaceId, sessionId)` —
  per-session and store-derived, so it survives the tab-switch remount; a successful reload calls
  `markSkillsSynced` to clear only this chat).
  **No `index.ts` barrel** — chat pulls **shiki**, so per the code-splitting exception imports stay
  **per-file**; the registry is importable from `chat/toolRegistry` **without** pulling shiki.
- **Allowed deps:** `contracts` (pi message/content-block types, **type-only**); `store` + `transport`
  (**app-integration files only** — a renderer that takes props must never reach for either. Today that
  is `ChatView.tsx` plus the hooks and dialogs it composes: `useChatTodos.ts`, `useHistorySearch.ts`,
  `useModelCatalog.ts`, **`useTranscriptSync.ts`** (successful-compaction + connection-generation canonical
  transcript reconciliation), `SkillsDialog.tsx`, `TemplateEditorDialog.tsx`,
  `SubagentTranscriptDialog.tsx`. `useModelCatalog` is the shared
  models-catalog seam `panels/NewWorkspaceDialog` also imports per-file, so the two pickers cannot
  drift; on activation it **drops catalog authority synchronously** (a flag an earlier consumer set says
  nothing about the list this one inherited) and reads `model.list` only when the shared list is **empty** —
  a read per activation would hang a full host `runtime.refresh()` off every chat-tab switch, and the picker's
  Refresh row is the currency path. It reports **`fresh`** — read straight off the store's `modelsFresh`,
  because catalog authority belongs to the **shared list**, not to a consumer: true only for the installed
  result of an awaited forced refresh **the host reported `complete`** (its wait is capped, so an unsettled
  pass still answers — with a list to render, not a verdict), and dropped by the next `model.list` install
  from *any* consumer. `model.list` answers from *before* the
  detached refresh it triggers, so it is never a basis for concluding a model is gone);
  `react-markdown` / `remark-gfm` / `shiki` (via `lib/highlighter`); `mermaid`
  (**lazy, `tools/visualize` only** — `Markdown` consumes the `MermaidView` *component*, never the
  package); `react-virtuoso`; `@remixicon/react`; `components/ui`; `lib`.
- **Forbidden:** value-importing any `pi` package; a **presentational** renderer importing
  `store`/`transport` (only the app-integration files enumerated above may — keep the renderers reusable).
- **`ChatView`** is the primary app-integration file: wires this session's runtime
  (`store.sessions[sessionId]`), the transport calls, the `ChatActions` + `AskStates` contexts, the
  divider's deep links (`onOpenChange` → `requestChangesView`, `onOpenSpec` → `requestSpecView`; each
  receives the single path the user picked) plus its view switch (`onReveal` → the tool-reveal intent), and the
  `isSpec` classifier it builds from the store's `specsByWorkspace` snapshot (subscribed as the stored array
  — a stable ref — and memoized into a matcher here, never a fresh Set inside the selector) — together with
  **`useHistorySearch.ts`** (the Ctrl+R history-recall overlay's store/transport edge),
  **`useTranscriptSync.ts`** (the guarded authoritative read that converges an existing runtime), and
  **`TemplateEditorDialog.tsx`** (the shared template save form), the other integration points. A
  **rejected** send (`prompt`/`steer`/`followUp`) lands in the chat via the store's `appendErrorTurn` —
  never swallowed and never given the settlement-only Try again affordance; *streaming* faults arrive as pi
  events instead.

## Streaming model

The `store` folds pi events into pi-canonical turns **per session**: the in-flight assistant turn **is**
the latest `assistantMessageEvent.partial` snapshot (replaced each update — not hand-accumulated). A
message's true terminal is **`message_end`**: the reducer adopts the final message (it carries
`stopReason`, how renderers spot dead tool calls) and clears that message's `streaming` flag **there**.
`agent_end` is only an attempt boundary (for a tool-calling message it arrives after its tools ran, but
it can still precede auto-compaction/retry); `agent_settled` alone closes the automatic run, clears the
session loader, and appends one success/error marker. A successful overflow `compaction_end` with
`willRetry: true` removes the superseded errored/truncated attempt, matching Pi's rebuilt context. Tool results are
indexed by `toolCallId` in `toolResults`; `ask-user-answers` custom messages index into `askAnswers`
(never the turn list — the questionnaire card is their rendering); `subagent-completion` custom messages
append a `subagentCompletion` turn (the shared contracts guard narrows both, on the live and read paths). The view re-derives rows each render
(`deriveRows` is pure; `ChatView` memoizes) — stable row/step ids keep fold state across snapshots.

**One live indicator, always.** pi splits a run into several assistant messages, so the reducer sweeps
the per-message `streaming` flag on new-message start and the final `agent_settled` (at most one turn is
ever flagged). The session remains live across attempt-level `agent_end` events. The loader
is a **single footer** (`StreamIndicator`: typing-dots + a phase label from the pure `streamStatus`
deriver — `working` → `thinking` → `running-tool` → `writing`, plus `compacting` while the transcript's
trailing turn is a running compaction) — not a per-turn cursor — so it can't
duplicate and it fills the post-send gap. Outside the streaming window (a manual compact, or the
pre-prompt compaction pi runs inside `prompt()` before `agent_start`) the footer is absent by design —
the running `CompactionNotice` row itself carries the spinner, so the beat is never dead air. The trailing Activity fold's live ticker is a *status* line (spinner,
like a running card header), not a second loader. `data-testid="stream-indicator"` + `data-phase` make
the lifecycle assertable.

## Get right

- Renderers are **theme-only via CSS-var token utilities** (no raw hex / inline `style`) — that's what
  lets the primitives wear any token theme, the key to reuse.
- Keep presentational components **props-driven** (not store-bound); only `ChatView` wires the app. This
  is the seam for extracting a standalone `packages/chat-ui` later.
- Keep this spec at **intent + boundary + invariants**; per-component behavior belongs in the
  components' jsdoc, per-tool detail in [tools/SPEC.md](tools/SPEC.md).
