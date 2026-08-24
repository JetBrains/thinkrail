---
id: submodule-web-chat-tools
type: submodule-design
status: active
title: tools — built-in tool renderers
parent: submodule-web-chat
depends-on: [module-contracts]
tags: [v1, chat]
---

## Responsibility

The **presentation half of every bundled tool**, joined to its server-side capability by tool name (the
extension model lives in the parent spec). `register.ts` wires everything via `registerToolRenderer` —
renderer + collapsed-header summary + chrome/prominence — as a side-effect import of `ChatView`, so
registration runs once when the chat module mounts. Unregistered tools fall back to
`DefaultToolRenderer` and are treated as **routine** (they fold into activity groups).

## What's here

- **Core pi tools** — `BashCard` (terminal block), `ReadCard`/`WriteCard` (project-relative path +
  highlighted file), `EditCard` (path + removed/added line diff). All **routine**.
- **`ResolveCommentCard`** — the compact receipt for the host-owned `resolve_comment` review tool
  (capability: the server's `agent` module + `reviews` seam; see [[submodule-server-reviews]]): a ✓ +
  the resolved comment id/note. **Routine** — the review sidebar is where resolution state lives; the
  card is just the in-transcript trace.
- **`AskUserQuestionCard`** — the inline questionnaire for the host-owned `ask_user_question` tool
  (capability + rationale: the server's `agent/askUserQuestion` SPEC). Registered `"bare"`: it owns its
  full-width frame, never folds, and answers through the `ChatActions` context (correlated by
  `toolCallId`). Behaviors worth their invariants:
  - **The lifecycle derives from the transcript, not the tool status** (the tool is ack + terminate; its
    own result is just the ack): `useAskState(toolCallId)` supplies the reply / superseded verdict, and
    the card resolves in order — **answered/declined** (an `ask-user-answers` reply exists → the resolved
    record; a legacy blocking-era result or a restart-repaired decline in the tool result renders the
    same way), **superseded** (a later free-form user message replaced the answer → a terminal compact
    record; the host rejects late answers, matching), **dead** (owning message aborted/errored → closed
    record), else **awaiting** — interactive now, after a reconnect, or after any number of host
    restarts.
  - **Controls never stream** — while args stream it shows a stable composing placeholder and the
    complete questionnaire reveals atomically at message end (rationale in the component's jsdoc).
  - **Multi-question completion is review-gated** — every question page advances with **Next**, including
    the final question; only the synthetic **Review & submit** page exposes **Submit**. Its review entries
    show the full original question plus every option with selected markers (and custom answer / note), so
    the submission can be checked in context. Selection status is also exposed as screen-reader text —
    never by icon/color alone. A single question keeps its direct **Submit** action.
  - **Per-call UI state survives virtualization** — a module-level cache keyed by `toolCallId` (dropped
    once no longer awaiting), since react-virtuoso unmounts off-screen rows. This is the pattern the
    activity fold's expansion state reuses.
  - **Attention without hostile focus theft** — once its arguments are complete, an awaiting card is
    revealed with an assertive visual “needs you” treatment plus a polite assistive-tech announcement. The
    spoken half is an **always-mounted live region filled a frame later by the same one-shot claim**: a
    region inserted together with its text is announced unreliably, and a virtualized remount must not
    re-announce a question the user has already been told about. **Exactly one copy is in the accessibility
    tree**: the visible line goes `aria-hidden` once the region carries the text, so a remount (region
    deliberately empty) still exposes the line.
    Per active-chat mount it focuses the selected choice (including Other) or first authored choice once;
    a virtualized remount never reclaims focus, while a fresh `ChatView` mount does (see `chat/SPEC.md` —
    that means any switch back to the chat tab, not only reopening the chat). It reveals but does **not**
    move focus away from Monaco, xterm, content-editable/form fields, a non-empty composer draft, or a
    surface that **owns focus while it is open** — a dialog, a menu, another choice list (a second
    questionnaire mid-answer): out-waiting a modal focus scope either loses the fight or yanks an untrapped
    popover out from under the user, so the card does not enter it. A **coarse pointer never gives up
    focus** at all: on a phone there is no keyboard flow to hand off to, and focusing a row (the Other input
    especially) raises the soft keyboard over someone who was reading — the reveal + scroll-into-view *are*
    the attention treatment there. A **page change** follows a tap, so it may focus — except into a text
    field on a coarse pointer (`shouldFocusPageTarget`), which would raise that same keyboard. The empty
    composer left focused after Send is safe to hand off. The retry window that out-waits a closing focus
    scope **yields to the user**: the first real `pointerdown`/`keydown` after the reveal ends the claim, so
    a later retry can never pull focus back out from under a click the user made while it was still trying.
    The mirror image holds on the way out: replying or declining unmounts the focused control, so the card
    hands focus **back to the composer**
    (`ChatActions.focusComposer`) instead of stranding it on `<body>` — but only when it still holds focus
    *and* that focus is `:focus-visible`, the platform's own "arrived by keyboard" signal (the one every
    ring in this card is drawn from). A tap/click answer leaves focus alone, so touch keeps its keyboard down.
    A **failed send undoes the hand-off with the latch**: the form comes back interactive, and since the
    one-shot claim is long spent and could neither re-focus nor re-announce, the card takes focus back itself
    rather than reappearing with the keyboard parked in the composer and nothing to say it had returned.
  - **Every focus indicator in the card is the app-wide accent focus ring** (`focus-visible:ring-2` +
    `ring-primary`; `focus-within:` on the Other row, whose ring marks the roving cursor passing through
    a text field) — per the colour system's "accent = focus" rule (`styles/COLOR.md`, Control row). The
    card originally shipped on `ring-primary-soft`, which the theme refinement's palette flattening
    composites to near-invisibility (accent @20% over the flattened surfaces), leaving keyboard users
    with no visible cursor — the one file the app-wide focus-ring sweep missed. `ring-primary-soft`
    remains only as the awaiting card's decorative active halo, which is not a focus indicator.
  - **Claude-style local keyboard selector** — one authored choice is in the Tab order; Up/Down wraps
    through every authored choice **and Other**, Home/End jumps to the first/Other target *from a choice
    row* (inside the Other field they stay caret keys, exactly as ←/→ do — a free-text field keeps the keys
    that move through text, and only ↑/↓ lift out of it), Space
    selects/toggles an authored choice, and Enter confirms (single-select chooses the focused option;
    multi-select confirms its non-empty set), advancing to the next question/review or directly submitting
    a one-question call. Reaching Other focuses its text input, ready to type — but **text, not focus, is
    what makes Other the answer** (`customTextPatch`): the cursor wraps *through* that row, so activating on
    arrival would clear a single-select pick and paint an empty row as chosen just for passing over it.
    Typing claims the answer (exclusively on single-select, additively on multi-select), emptying the field
    hands it back, multi-select keeps its explicit checkbox for excluding text it should not submit, Up/Down
    leaves or wraps, and Enter confirms non-empty text. The row is a `<label>` **explicitly bound to its
    input via `htmlFor`** — `<button>` is a labelable element too, so on multi-select the implicit control
    would be the include/exclude toggle above the input in tree order, and clicking the row's chrome would
    flip an empty checkbox instead of putting the caret in the field (on touch, the only way in).
    The **Submit button** is the review page's keyboard
    landing point — Enter/Space activate the real control natively, where a heading wearing
    `aria-keyshortcuts` announced static text; a review with nothing answered has no enabled Submit and
    lands on its “Unanswered” nudge instead. On multi-question cards Left/Right moves without wrapping
    across question pages and the final review page; text inputs retain those keys. The question chips are
    a real `tablist` over the shared question `tabpanel` (each chip `aria-controls` it, the active chip
    labels it) with **automatic activation** — an arrow/click switches the page outright and focus follows
    *into* the panel rather than staying on the chip, since the page is what the user came to act on.
    **A confirm gesture is never a silent no-op**: Enter with nothing to confirm (an empty multi-select set,
    an untouched Other row with no pick above it) says “Choose an option first” beside the action it was
    aiming at, clearing as soon as the question becomes answerable, and spoken through the same live-region
    pattern as the attention line. The complaint belongs to the **question that raised it**
    (`nudgeShowsOnPage`) — paging on inside its short life must not leave a warning on a question the user
    never tried to confirm — and each gesture is stamped, so a *second* fruitless Enter empties the region
    for a frame before refilling it: an unchanged live-region string is silence, which is the very no-op the
    nudge exists to end.
    Both Enter paths route through one reducer (`confirmStateFor`), so "confirm what this question has"
    cannot mean two things. From an Other row that *does* have a pick above it, Enter confirms that pick.
    From the Other row it commits the state **exactly as it stands** and never re-derives activation from the
    text: typing already keeps `customActive` in step keystroke by keystroke, so re-patching at confirm time
    could only contradict the row on screen — resurrecting multi-select text the user explicitly unchecked, or
    submitting text left over from an earlier edit while the card still paints the option picked after it.
    What is confirmed always matches what is drawn.
    A note remains an explicit secondary control on every **checked choice**: the selected single-select
    option, or **each checked multi-select option** — one Add/Edit note control per check, rendered
    **directly beneath its own option row**, appearing the moment the choice is made. (Multi-select notes
    were missing entirely, and the single-select note had drifted to the bottom of the list where it read
    as belonging to the last option — both reported as a regression; the contract always allowed notes.)
    The wire carries **one `notes` string per answer**, so a multi answer joins its per-option notes as
    `label: note` lines (newline-separated — notes themselves may be multiline). The visible toggle text
    stays the short Add/Edit note; the option it belongs to is carried by `aria-label`, and adjacency
    carries it visually. Tab reaches Add/Edit note and Enter opens it (the legend only promises `Tab
    note` once a choice exists to hang one on — `answerSupportsNote`). In the editor
    Enter finishes and returns focus to the choice, Shift+Enter remains the multiline escape hatch, and
    Escape also returns **without discarding typed text** — **including `Shift+Escape`**, which the open
    editor consumes rather than letting the card's skip gesture throw away the note mid-sentence.
    That holds **mid-IME-composition too**, where Escape is *consumed rather than finishing*: the IME owns
    the key (it cancels the composition, so the note stays open) but the gesture still must not reach the
    card — declining to finish while also declining to swallow would let `Shift+Escape` bubble out and take
    the questionnaire down with the text being composed. The card's skip therefore also **ignores any
    keystroke the IME is composing**, which covers the Other field, whose free text has no inner guard.
    `Shift+Escape` is otherwise the deliberate card-local skip; plain Escape outside a note never declines.
    Tab still reaches
    Other, Skip, and footer actions. A compact visible shortcut legend makes the interaction discoverable,
    and the choices are checked rows with `aria-checked` — never `aria-pressed`, which
    announced an exclusive pick as a toggle button and said nothing about the set. The container role
    carries single vs multi (`radiogroup` vs `group` of checkboxes), and
    each row is announced with its position in the choices. The note controls live **between the rows,
    each under its checked choice**, because adjacency is what tells the user which choice a note belongs
    to — the earlier notes-below-the-list layout read as the note belonging to the last option and was
    reported as a regression. That interleaving is what forced the container role: a `listbox` may own
    nothing but `option`/`group` (interactive descendants are non-conforming and some ATs flatten or skip
    them — review finding on the multi-note change; `aria-posinset` only numbers options, it cannot make
    stray children conforming), so the choices are a **`radiogroup` of `radio` rows (single-select) / a
    `group` of `checkbox` rows (multi-select)** with `aria-checked`, whose contracts place no constraint
    on sibling content — the note editor and toggle are ordinary named controls beside them. Each role's
    keyboard contract is honored, not just its markup (second review finding: a radio whose arrows only
    move focus exposes the focused row as unchecked while Enter would submit it — the semantic state
    would contradict both the cursor and the answer): **single-select arrows select as they move** (the
    APG radio contract; Space also selects, Enter stays the separate confirm), landing on the Other row
    moves focus without selecting (it is a text field, not a radio), and **multi-select arrows only move**
    with Space toggling (the checkbox contract). Selection is still never submission — Enter confirms. The **Other row
    stays a sibling below the rows**. Movement is driven by the choice refs, not DOM containment, so the
    keys are unaffected.
    Deselecting a choice whose note editor is open also clears `noteFor` in the same update
    (`toggleMultiPatch` / `selectOptionPatch`) while keeping the typed note text: a stale `noteFor` would
    remount the open editor on re-check, stealing a focus action the user never took.
    Bare-letter/number shortcuts and global chords are deliberately absent so
    browser extensions, custom text, and explicit decline stay safe.
  - **Recommended-reason affordance** — a recommended option (label suffix `(Recommended)` **or** a
    non-empty `recommendedReason` — a reason *implies* recommended, defensively) renders its rationale
    **inline** as a `Why: …` block inside the option card (below the description; `Why:` in the accent
    color). Shown up front for every recommended option, not gated on selection: more discoverable than
    a tooltip and, being ordinary visible text, it reads on touch and for AT without a popover.
    **Active card only** — the resolved record shows selections only, no rationale.
- **`visualize/`** — `VisualizationCard` dispatches on `args.type` to `DiagramCard` (mermaid → themed
  SVG via the **lazy-loaded** `mermaid`, source fallback on parse error) and `ComparisonCard` (option
  cards with pros/cons + `recommended` highlight); shared `MermaidView` re-renders on `[data-theme]`
  change, offers a full-screen pan/zoom Dialog, and takes an optional `fallback` node shown while the
  SVG is pending (default: a "Rendering…" line). It is also consumed by the **parent `Markdown`
  primitive** for fenced ```mermaid blocks — the `mermaid` *package* import stays lazy and confined to
  `visualize/mermaid.ts`. Registered **primary + `defaultExpanded`** — a
  visualization is output *for the user*, not plumbing: it escapes the activity fold and renders open on
  completion (while its args stream it stays a slim running row). Capability: the bundled
  `pi-visualize` extension.
- **`web/`** — search/fetch renderers for `pi-web-access`; own child spec
  ([web/SPEC.md](web/SPEC.md)). Routine.
- **Shared pieces** — `CodeBlock` (shiki), `Collapsible` ("Show all N lines" fold for long output),
  pure `toolHelpers` (arg readers, `resultText`, `languageFromPath`) + `lib`'s `projectRelativePath`.

## Boundary

- **Public surface:** the side-effect `register` import + the shared `CodeBlock`/`Collapsible`/
  `toolHelpers` for sibling renderers + `visualize/MermaidView` for the parent `Markdown` primitive. No barrel (chat pulls shiki — per-file imports, as in the parent).
- **Allowed deps:** parent chat primitives (`toolRegistry`, `Markdown`, `ChatActions`, `askState`);
  `contracts` (type-only + the `ASK_USER_ANSWERS_CUSTOM_TYPE` constant); `components/ui`; `lib`;
  `lucide-react`; `mermaid` (**lazy, `visualize/` only**).
- **Forbidden:** value-importing any `pi` package; `store`/`transport` (renderers stay presentational —
  extraction-ready into a future `packages/chat-ui`).

## Get right

- **Render defensively:** a tool's `details` result shape is not a stable API — read best-effort and
  fall back to its text content (`resultText`).
- Tool names must match the capability exactly — the name is the join key.
- Token-utility styling only (no raw hex / inline `style`).
