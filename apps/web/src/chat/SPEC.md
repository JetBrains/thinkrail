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
`error`, `retry` are web-local notices), but the list renders **derived rows, not raw turns** — folding
spans assistant-message boundaries (pi emits one assistant message per tool round), so a per-turn item
model can't group. The pure **`deriveRows(turns, toolResults, isStreaming)`** (`rows.ts`) walks blocks in
order into rows; `ChatTurnView` dispatches on row kind:

- `user` / `system` / `retry` — 1:1 renderers. **`ErrorTurn`** is a persistent tinted failure notice
  (provider/model error, or a rejected send) — **never folded**, so a failed turn can't look like
  nothing happened.
- `markdown` — a non-empty assistant text block (react-markdown + remark-gfm + shiki).
- `tool` — a **primary** tool call: the collapsible `ToolCard` frame (collapsed unless registered
  `defaultExpanded`; errors auto-expand; a manual toggle wins), or a `"bare"` renderer that owns its
  frame. A `"bare"` call on a dead message (`stopReason` aborted/error — pi never executes those calls)
  renders as errored rather than staying interactive forever.
- `activity` — a contiguous run of **routine** steps (thinking blocks + routine tool calls), merged
  across consecutive assistant messages in a round and broken by non-empty text, primary tools, and
  non-assistant turns. `ActivityGroup` renders it **collapsed by default** behind one header ("N steps ·
  bash ×2, read ×4"); expanded, steps are slim borderless rows that individually reveal the step's full
  renderer body. While the trailing run streams, the header is a **live ticker** (spinner + current
  step's summary), collapsing when answer text starts. A single-step run renders its step row directly.
  Errored *routine* steps get **no special treatment** (deliberate — agents often recover; `ErrorTurn`
  and primary error-auto-expand are the safety nets).
- `divider` — the round-end summary (`TurnDivider` + pure `turnDivider` deriver), anchored the instant a
  round ends: elapsed time, tool-call count, a clickable "files changed" chip.

Row/step ids are stable across streaming snapshots (first step's `toolCallId`, or message-anchored index —
pi appends, never reorders), so fold state survives re-derivation and virtualization: **every fold surface
(activity groups, step rows, `ToolCard`) records manual toggles in the shared `foldState` cache**
(`foldState.ts`, keyed by row/step id — the `AskUserQuestionCard` pattern, see tools/SPEC.md; deliberately
never evicted — growth is bounded by manual toggles). A manual toggle always wins — over auto-expand
defaults *and* over a virtualization remount.

## Extension point — the tool registry

`toolRegistry.tsx` is **THE extension point**; a tool has two decoupled sides joined by **tool name**:
the **capability** registers with the pi session server-side (custom tool or pi extension/skill), the
**presentation** registers here. A registration is:

- a **renderer** (the card body; `ToolRenderProps` carries `toolCallId`/`args`/`result`/`status`/
  `workspaceRoot`/`streaming` — enough to stay props-driven), plus optionally
- a **`summary`** — a pure one-liner for collapsed headers and activity-step rows,
- a **`chrome`** — `"card"` (default, the `ToolCard` frame) or `"bare"` (owns its frame; for
  interactive/primary tools like `ask_user_question`),
- **prominence metadata** — `prominence`: `"routine"` (default, incl. unregistered tools — folds into
  activity groups) or `"primary"` (escapes the fold; `"bare"` chrome implies it **unconditionally**, even
  over an explicit `prominence: "routine"` — a self-framed renderer can't live inside a fold's step
  rows, so a misregistration must not silently break the fold), and `defaultExpanded` (a
  primary card renders expanded once complete, e.g. `visualize`). Read through the single
  **`resolveProminence`** seam — where a per-user override map (settings) can plug in later.

Unregistered tools fall back to `DefaultToolRenderer`. Tools needing user input mid-run either route
through the extension-UI bridge (`pi.extensionUi` → `ExtUiDialog`) or — for a rich inline card — render
from their `toolCall` args and reply through **`ChatActions`** (see below). Worked example: the
`ask_user_question` flow in [tools/SPEC.md](tools/SPEC.md).

## Interaction seams

- **`ChatActions`** — a React context (provided by `ChatView`, `null` standalone): how a renderer talks
  **back** to the agent without importing store/transport. Today: `answerQuestion(toolCallId, result)` —
  it rejects when the host refuses (unknown/answered/superseded call), and the caller owns the failure UX.
- **`askState`** — the questionnaire lifecycle seam: the pure `deriveAskStates(turns, askAnswers)` +
  `AskStatesContext`/`useAskState` (provided by `ChatView`, `null` standalone). The ask tool is **ack +
  terminate** (its tool result is just an ack; the reply arrives later as an `ask-user-answers` message),
  so "answered / superseded / awaiting" is a fact about the transcript, not a tool status — derived once
  per runtime snapshot and consumed by the card via context, keeping it props-driven everywhere else.
- **Hydration** (`hydrate.ts`) — the pure `messagesToRuntime(TranscriptMessage[])` converter (read-side
  counterpart of the event reducer): rebuilds `{ turns, toolResults, askAnswers, turnIdByMessageIndex }`
  (a `HydratedRuntime`) from a persisted transcript so a reconnecting/second client renders identically to
  the live path (same `raw` result shape, same error-turn surfacing for `stopReason: "error"`). It also
  returns `turnIdByMessageIndex` (message-position → minted turn id) — the jump anchor map a
  history-search "jump to message" deep link (`chatLocationRequest`, see `store/SPEC.md`) resolves
  against; entries are `null` for a `toolResult`/`custom` message (never its own turn), and a message that
  ended in `stopReason: "error"` maps to its own assistant turn's id, never the synthesized error turn's.
  `custom` messages never become turns: known ones (`ask-user-answers`) index into `askAnswers`; unknown
  customTypes are ignored. No store/transport/shiki.
- **Jump-to-message** (`chatLocationRequest` — set by `useHistorySearch.ts`'s `openMessage` on Enter over
  a mapped message hit; see `store/SPEC.md` for the store-level request/clear contract and
  `CenterTabs.tsx`'s open/reopen/hydrate half) — `ChatView` is the sole consumer. Once `rows.length > 0`,
  it resolves the request's `messageIndex` via `runtime.turnIdByMessageIndex` (present only on a
  *hydrated* runtime — a live/already-open session's runtime, built by the event reducer, never carries
  one), falling back to scanning `turns` for the first whose own text contains `anchorText`'s prefix — the
  same fallback also covers a hydrated map entry whose turn no longer contains the anchor (e.g. the
  transcript changed underneath it). The resolved turn maps to a row via the pure **`rowIndexForTurn(rows,
  turnId)`** (`rows.ts`) — a turn's own row for `user`/`system`/`error`/`retry`, or its first `:text:` row
  for `assistant` (whose turns dissolve into `markdown`/`tool`/`activity` rows, never a row of their own)
  — then `virtuosoRef.scrollToIndex({ align: "center" })` plus a transient `flashRowId` (rendered as
  `data-flash` + a `bg-[var(--primary-10)]` transition on the row wrapper, cleared after 1600ms) draw the
  eye to it. Either resolving a row or giving up (toasted as "couldn't locate the message") always clears
  the request — `ChatView` is its only consumer, so an unresolved request must never linger.
- **Composer & chrome** — `Composer` (prompt field + send/steer/followUp/abort, `@`-mentions, `/`
  commands + template **slot sessions** (Tab-through placeholders — see the Template slots bullet
  below), image paste/drop, `Ctrl+R` → `onHistoryOpen`), `HistoryOverlay` (the history-recall/search
  overlay `Composer` opens — presentational, driven entirely by `useHistorySearch.ts`'s state +
  callbacks, plus a **Save as template** action on the selected prompt row — see the Save-as-template
  bullet below, and a **zoomed-stage preview pane** + **scope picker** — see the next bullet),
  `ModelSelector` + `ThinkingSelector` (shared with `NewWorkspaceDialog`; optional `container` prop
  portals their popovers into a host Dialog), `SessionStatsBar`, `ChatHeader` (its `left` slot carries the plan strip), `ExtUiDialog`. All
  props-driven; behavior detail lives in the components' jsdoc.
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
  `cycleScope` — the unchanged `Ctrl+R` keyboard path, since both just set the same underlying scope
  state. Radix's default on close is to return focus to the trigger; `onCloseAutoFocus` is overridden
  (`preventDefault` + focus the query input) so a mouse pick hands focus back to the query input
  instead — typing (and `Ctrl+R` cycling) resumes immediately, no extra click needed. The menu never
  fights the overlay's own `ArrowUp`/`ArrowDown`/`Enter` handling: that handler is bound to the query
  `<input>` element itself, and Radix's portaled dropdown content is a **sibling** subtree — never a
  descendant of the input — so a keydown while the menu holds focus cannot reach the input's handler by
  construction, not by a case-by-case guard.
- **History overlay: assistant-only messages + jumpable prompts** (`HistoryOverlay.tsx`,
  `useHistorySearch.ts` — R3) — `MESSAGES` now only ever contains assistant-role hits (the server
  filters; see `packages/server/src/history/SPEC.md`): a user-role hit is always a textual duplicate of
  its own `PromptHit` entry, so the location it used to add moved onto the prompt row instead. Every
  prompt row now renders a go-to-chat icon (`data-testid="history-jump"`, `aria-label="Go to chat"`,
  `title="⇧⏎ go to chat"`, next to the existing save-as-template icon) **when jumpable** —
  `workspaceId` present and `messageIndex != null` (absent for an unmapped-cwd hit, or a pre-v11 host
  that never populated the prompt's anchor fields). Clicking it, or **`Shift+Enter`** while a prompt row
  is the keyboard selection, routes through the exact same `onOpenMessage` path a message hit's
  `Enter`/click already used — both now go through the shared **`jumpTarget(hit)`** helper
  (`useHistorySearch.ts`, exported pure), which resolves either hit shape to a `ChatLocationRequest` or
  `null`, so the icon's render gate, the `Shift+Enter` handler, and the message-hit gate can never
  disagree on "is this jumpable." An unmapped/legacy prompt row shows no icon and `Shift+Enter` is a
  no-op (overlay stays open) — the same belt-and-suspenders gating the message-hit path already had.
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
  (`ChatView.onSubmit` → `appendUserMessage`, store-only, appended *before* the transport call resolves) —
  it shows exactly what was typed (the raw command) until a re-fetch replaces it with pi's real persisted
  record. **The `/` menu merge**
  (`ChatView`): pi's `commands` snapshot (`session.getCommands`, frozen at session-create time) minus its
  `source === "prompt"` entries, plus a fresh `template.list { workspaceId }` fetch mapped to
  `SlashCommandInfo` rows (`source: "prompt"`, `sourceInfo` synthesized to match pi's own prompt-template
  convention exactly: `{ path: filePath, source: "local", scope: scope === "global" ? "user" : "project",
  origin: "top-level" }`) — one merged list, `Composer`'s rendering is unchanged. The fetch runs when the
  slash menu opens (**`onSlashActive`**, a boolean prop mirroring `onMentionQuery`'s query signal), cached
  per workspace (one `ChatView` instance never changes workspace) and invalidated by the store's
  **`templatesVersion`** counter (see `store/SPEC.md`; bumped by `panels/TemplatesSettings.tsx` and
  `TemplateEditorDialog.tsx` after a `template.save`/`delete` — see the Save-as-template bullet below) —
  this is what makes `packages/server/src/agent/SPEC.md`'s "the
  composer's `/` menu path is always fresh via `template.list`" claim true, unlike the typed-through
  `/name args` path's frozen create-time snapshot. **Picking a template** (`ChatView`'s `onPickTemplate`, a
  `Composer` prop): instead of `pickSlash`'s plain `/name ` insert, fetches `template.get`, splits
  frontmatter client-side (`templateText.ts`'s shared `stripFrontmatter` — pi's own frontmatter parser is
  server-only, never reaches the browser bundle, but the boundary rule is pinned to match it exactly; see
  the Save-as-template bullet below), runs `parseTemplateSlots(body, argumentHint)`, and hands
  the result to `Composer` via a new **`ComposerHandle.insertTemplate`** method (alongside the existing
  `insertText`) — replaces the whole draft (like `pickSlash`, not `pickMention`: a slash command occupies
  the entire input) and, if the parse produced any slots, starts a **slot session** selecting slot 0; no
  slots → a plain insert, caret at the end, no session. **The session** (`Composer`, local `useState`:
  `slots: TemplateSlot[] | null` + `slotIdx`, no store/transport): `Tab`/`Shift+Tab` step to the
  next/previous slot (wrap; `preventDefault`; a no-op while the mention/slash menu is open — checked at
  the top of `onKeyDown`, right after the `Ctrl+R` guard and before the menu's own key handling, so a real
  Tab-to-pick-a-menu-item is unaffected, and symmetrically an `Escape` while the menu is also open lets the
  menu's own dismiss win first). Stepping **out** of a *filled* slot (real content, not an untouched
  marker) splices its current text into every other slot sharing its `group` whose text differs (group
  mirroring — repeated `$N`/`${...}` occurrences propagate on slot exit, not per keystroke), each splice
  re-tracked via `shiftSlots` (`mirrorSlotGroup` in `slotSession.ts`). `Escape` ends the session
  (`setSlots(null)`), leaving the text as-is. A genuine text edit (the textarea's own `onChange` — never a
  programmatic `onChange(text)` call; those end the session outright instead, since none of
  `pickMention`/`pickSlash`/arrow-recall/`insertText` participate in slot tracking) diffs the old/new value
  around the post-edit `selectionStart` (a common-prefix/suffix scan) into `(editStart, removedLen,
  insertedLen)`, re-tracks every slot via `shiftSlots`, and flags the slot the edit landed in
  `filled: true`; an edit that consumes the **entire** prior value (a select-all-and-type/delete) ends the
  session instead of re-tracking a now-meaningless collapsed range set. On send, `submit()` runs the same
  group-mirroring pass over **every already-filled slot**, not just the one most recently Tab-exited
  (`mirrorAllGroups` — a direct Send never has to go through Tab first for its mirroring to take effect),
  propagating each into its unfilled same-group siblings; only **then** does it strip whatever markers are
  still untouched (`stripUntouchedSlots`), and always clears the session — sent **or** queued
  (steer/followUp), same rule. Switching tabs needs no
  explicit cleanup: `panels/CenterTabs.tsx` mounts only the active tab's component, so leaving a chat tab
  unmounts `Composer` (and its session) while the store's `draft` text itself persists. **Hint chip**:
  while a session is active (and the menu is not, so the two absolutely-positioned overlays never share
  the same anchor rect), a small pill above the textarea — `slot {slotIdx+1}/{n} · ⇥ next · esc done`
  (`data-testid="slot-hint"`) — clickable, tap steps to the next slot (same mirroring rule as `Tab`), the
  mobile path with no keyboard needed.
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
    (`ChatView.tsx`'s composer-pick path), `splitTemplate`/`assembleTemplate` (this dialog). Its boundary
    rule is ported byte-for-byte from pi's own `extractFrontmatter` (`@earendil-works/pi-coding-agent`'s
    `dist/utils/frontmatter.js`, pinned against pi v0.80.6 — the same pin `packages/server/src/templates/
    SPEC.md` uses server-side; re-verify both on a pi version bump): the frontmatter block ends at the
    FIRST later `\n---` line, and the body is everything after that fence run through `.trim()` — not a
    single optional `\n`. A prior version had two independently hand-rolled regex splitters (one per
    file), each consuming only one *optional* `\n` after the closing fence instead of trimming — a
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
    save-as-template) leaves both fully editable.
  - **Save** calls `template.save` then the store's `bumpTemplatesVersion()`; a rejected save renders its
    message inline via `data-testid="template-error"` (never a toast — the dialog stays open so the error
    is fixable in place). **Delete has no dialog involvement at all** — `panels/TemplatesSettings.tsx`'s
    row calls `template.delete` + `bumpTemplatesVersion()` directly, behind a `ConfirmPopover` (the same
    confirm-before-destructive-action pattern `ProjectTree.tsx`'s workspace-remove row uses). A **rejected
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
    reusing `openFile.ts`'s exact `openFileInTab(workspaceId, ".pi/prompts/<name>.md")` (the same action
    file-tree clicks use), then `store.closeSettings()`. **Global rows are dialog-only** — a deliberate
    asymmetry, not an oversight: file tabs are worktree-scoped (`tabsByWorkspace` is keyed by workspace
    id), but a global template lives under the host's agent dir, outside any worktree, so there's no
    worktree-relative path to open it at.
- **Plain `↑` recall + history button** — `Composer`'s `recentPrompts` prop (`ChatView`: this chat's own
  user-turn texts via `turnAnchorText`, newest first, deduped **keeping the newest occurrence** — the same
  recency-first ranking rule as the server history index, the atuin/fzf convention) backs a lightweight
  recall session (`recallIdx`) gated so it can never eat a draft: `↑` only steps in when the field is
  **empty** or a recall is already active (older → higher index), `↓` steps newer (past the newest
  restores `""`), any diverging edit or a submit exits the session, and the recalled text lands with the
  caret at its end. A `History`-icon button (`data-testid="history-open"`, `aria-label="Search history"`,
  always rendered next to send) calls the same `onHistoryOpen` as `Ctrl+R` — the tap path on mobile, a
  discoverability affordance on desktop.
- **Chat TODO plan** ([[design-todos]]) — the chat's `pi-todos` list surfaced **only in the chat**:
  `useChatTodos` (the `todo.*` data hook — fetch + live `pi.event` refetch + edits + the add-nudge + the
  `openMarkdown` snapshot action), `TodoList` (loose items + named groups, add-row + an "open as markdown"
  button), `planMarkdown` (a pure `plan → markdown` compiler), and `ChatPlan` (`ChatPlanStripContent` +
  `ChatPlanContent` — a header strip that opens the plan in a `Popover` over the chat; `ChatView` composes
  the `Popover` anchored to the header, so the popup hangs flush under it at the chat's left edge). There
  is no right-panel Todo tab — the plan lives in the conversation. The "open as markdown" action compiles
  the current plan and opens it as an ephemeral `doc` tab (`store.openDoc`), rendered by the panels'
  `MarkdownPreview` — no file is written to disk.

## Boundary

- **Public surface:** the registry API (`toolRegistry`), the renderers (incl. the presentational
  `Markdown` — GFM + shiki, no store/transport; the rendering is fixed but the **prose skin** is the
  caller's via an optional `className` — chat uses a compact bubble skin, `panels/MarkdownPreview` a
  reading-optimized document skin; code blocks size in `em` so they scale with the skin; a caller may
  also **extend** the render with extra `remarkPlugins` + `components`, e.g. the file view's GitHub
  alert callouts), the view types
  (`types.ts`,
  incl. `ToolResultState` + `ExtUiDialogRequest`), and `ChatView` (lazy-mounted by `panels/CenterTabs`).
  **No `index.ts` barrel** — chat pulls **shiki**, so per the code-splitting exception imports stay
  **per-file**; the registry is importable from `chat/toolRegistry` **without** pulling shiki.
- **Allowed deps:** `contracts` (pi message/content-block types, **type-only**); `store` + `transport`
  (**`ChatView` + its integration hooks (`useHistorySearch.ts`) + `TemplateEditorDialog.tsx` only** — the
  app-integration edge); `react-markdown` / `remark-gfm` / `shiki` (via `lib/highlighter`); `mermaid`
  (**lazy, `tools/visualize` only**); `react-virtuoso`; `lucide-react`; `components/ui`; `lib`.
- **Forbidden:** value-importing any `pi` package; a **presentational** renderer importing
  `store`/`transport` (only `ChatView`, its integration hooks, and `TemplateEditorDialog` may — keep the
  renderers reusable).
- **`ChatView`** is the primary app-integration file: wires this session's runtime
  (`store.sessions[sessionId]`), the transport calls, the `ChatActions` + `AskStates` contexts, and the
  divider's "files changed" → `requestChangesView` deep link — together with **`useHistorySearch.ts`**
  (the Ctrl+R history-recall overlay's store/transport edge) and **`TemplateEditorDialog.tsx`** (the
  shared template save form), the other two integration points. A
  **rejected** send (`prompt`/`steer`/`followUp`) lands in the chat via the store's `appendErrorTurn` —
  never swallowed; *streaming* faults arrive as pi events instead.

## Streaming model

The `store` folds pi events into pi-canonical turns **per session**: the in-flight assistant turn **is**
the latest `assistantMessageEvent.partial` snapshot (replaced each update — not hand-accumulated). A
message's true terminal is **`message_end`**: the reducer adopts the final message (it carries
`stopReason`, how renderers spot dead tool calls) and clears the turn's `streaming` flag **there** — not
at `agent_end`, which for a tool-calling message arrives only after its tools ran. Tool results are
indexed by `toolCallId` in `toolResults`; `ask-user-answers` custom messages index into `askAnswers`
(never the turn list — the questionnaire card is their rendering). The view re-derives rows each render
(`deriveRows` is pure; `ChatView` memoizes) — stable row/step ids keep fold state across snapshots.

**One live indicator, always.** pi splits a run into several assistant messages, so the reducer sweeps
the `streaming` flag on new-message start and `agent_end` (at most one turn is ever flagged). The loader
is a **single footer** (`StreamIndicator`: typing-dots + a phase label from the pure `streamStatus`
deriver — `working` → `thinking` → `running-tool` → `writing`) — not a per-turn cursor — so it can't
duplicate and it fills the post-send gap. The activity fold's live ticker is a *status* line (spinner,
like a running card header), not a second loader. `data-testid="stream-indicator"` + `data-phase` make
the lifecycle assertable.

## Get right

- Renderers are **theme-only via CSS-var token utilities** (no raw hex / inline `style`) — that's what
  lets the primitives wear any token theme, the key to reuse.
- Keep presentational components **props-driven** (not store-bound); only `ChatView` wires the app. This
  is the seam for extracting a standalone `packages/chat-ui` later.
- Keep this spec at **intent + boundary + invariants**; per-component behavior belongs in the
  components' jsdoc, per-tool detail in [tools/SPEC.md](tools/SPEC.md).
