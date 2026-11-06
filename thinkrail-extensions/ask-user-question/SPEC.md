---
id: module-ext-ask-user-question
type: module-design
status: active
title: Ask user question extension
parent: module-thinkrail-extensions
depends-on: [module-ui, module-extension-api, module-resource-renderers, module-locales, module-contracts]
references: [module-pi-ask-user-question, submodule-web-chat, submodule-server-agent]
---

## Responsibility

The ThinkRail halves of the `ask_user_question` capability.
- `./server` composes the portable tool ([[module-pi-ask-user-question]]) for every parent session, with
  ThinkRail's own wording and an asker that waits on the host's interactive-tool mailbox.
- `./web` is the inline questionnaire card.

The host keeps the interactive-tool lifecycle — mailbox phases, restart repair, late responses, composer
supersede, Stop/Submit ordering and needs-input ([[submodule-server-agent]]) — and knows nothing about
this tool beyond what the descriptor and the renderer registration declare. The extension is the first
client of that contract ([[module-extension-api]]) and is deletable without a core change.

## Boundary

- `@thinkrail/ext-ask-user-question/server` default-exports a session-only descriptor:
  - `extensions: []`;
  - `settings: { richPreviews: { type: "boolean", default: true } }` — Settings → Extensions shows it as the
    nested "Rich previews in questions" switch ([[module-thinkrail-extensions]]);
  - `sessionExtensions: (session) => [factory]`, a factory that reads `session.setting("richPreviews")`
    **inside its body** and composes `createAskUserQuestionExtension({ ask, announce, guidance, filePreviews,
    checkFile })`, so every pi (re)load after a Settings change registers the tool with or without the file
    fields;
  - `interactiveTools: { ask_user_question: { describeResponse } }` — `describeResponse(args, response)`
    renders a late answer (one delivered after a host restart) through the package's
    `buildQuestionnaireResponse` when both have our shape, so the model reads the same wording as for a
    live answer; any other shape returns `undefined` and the host's generic JSON preface applies.

  `announce` forwards each executable call to `session.expectToolResponse(toolCallId)`, so the host's
  question lifecycle starts only for calls this extension runs. The asker awaits `session.awaitToolResponse(toolCallId, signal)`. A `response` must be a questionnaire
  result (checked with the package's `isAskUserQuestionResult`, else the call fails); `deferred` and
  `abandoned` pass through as outcomes, so the package returns the canonical ack or the stop and ends the
  turn. `guidance` is ThinkRail's description and prompt guidelines: the inline card, a composer reply that
  supersedes it, Discuss, question versus option previews, and — only with rich previews on — mockup files
  under `session.workspaceFiles.scratchDir` (`.thinkrail/context/mockups/`) referenced by `previewFile`.
  Off, the model is offered neither the fields nor that guidance: the saving is the agent's mockup writing
  (output tokens and a tool call each), not rendering, which is lazy. Markdown previews, mermaid included,
  stay either way (unconfirmed with the user: mermaid is text, so the switch leaves it on). `checkFile` is the host's
  `session.workspaceFiles.check`. The server half has no named exports; it imports only
  `extension-api/server` and its pi package. The package's deferral ack `{ kind: "ack" }` is the host's pending marker — a test pins it.
- `@thinkrail/ext-ask-user-question/web` default-exports a `defineWebExtension` descriptor that registers
  `AskUserQuestionCard` for `ask_user_question` with `{ chrome: "bare", interactive: true }`. Nothing is
  exported by name: the plan page reaches the card through the tool registry, as the chat does.
- The card imports `extension-api/web`, the package's argument/result **types** (type-only, from
  `@thinkrail/pi-ask-user-question/core`; a value import of the pi package stays forbidden in browser code,
  so the result guard `readAskUserQuestionResult` and the answer model in `web/state.ts` are the card's own),
  `@thinkrail/ui` (`attention-line`, `button`, `keyboard`, `textarea`, `utils`), `@thinkrail/resource-renderers`
  (`useOptionalResourceHost` for the host's Markdown — mermaid included — and `FramedResourcePreview` +
  `useResourceScope` for file previews), `@thinkrail/locales` (types) and `/react`, React and Remix Icon. It
  never imports the visualize extension: previews keep working with visualize switched off.
- It never reaches app or host internals. Everything it needs from the chat arrives in
  `ToolRenderProps.interaction` ([[module-extension-api]]):
  - the response delivered after a restart, the superseded and ended verdicts, and `accepting` (Submit and
    Skip are enabled, and the attention line, active styling and focus claim appear, only while it holds,
    so a call the host is not waiting on never asks for attention);
  - `respond`;
  - the focus scope;
  - layout and reveal callbacks;
  - composer hand-off.

  Without `interaction` the card is read-only.
- Its strings keep their historical `tools.ask.*` keys instead of an extension prefix. Users' local
  catalogs overlay by exact key, so renaming would silently turn their translations back into English.

## Rendering contract (web)

Registered `"bare"`: the card owns its full-width frame and never folds. Behaviors worth their invariants:

- **The lifecycle derives from the transcript across two host paths:** a live blocking call resolves with
  the real tool result; a restarted dangling call is repaired to the pending marker and later paired with a
  `tool-response` custom message (older transcripts carry the same pairing as `ask-user-answers`).
  `interaction.state` (the host derives it from its interaction state) supplies the restart reply /
  superseded / ended verdict, and the card resolves in order — **answered/declined** (either real result form),
  **superseded** (a later free-form user message replaced a repaired idle question),
  **stopped/error/length** (explicit Stop or a non-executable assistant result finalized the tool), else
  **awaiting** — interactive while Pi is blocked, after reconnect, or after any number of host restarts.
- **Controls never stream** — while args stream it shows a stable composing placeholder and the
  complete questionnaire reveals atomically at message end, so nothing is clickable while it can still
  change.
- **Multi-question completion submits from the last question** — earlier pages advance with **Next**;
  the last question shows **Submit**, enabled once any question is answered, and confirming it submits.
  Unanswered questions are sent as not answered without a warning: the chips' answered marks already show
  the gaps. A synthetic **Review & submit** page once gated submission; it was removed as an extra step
  that re-showed what the chips and pages already showed. A single question keeps its direct **Submit**.
- **Per-call UI state survives virtualization** — a module-level cache keyed by `toolCallId` (dropped
  once no longer awaiting), since react-virtuoso unmounts off-screen rows; it holds every page's answers,
  cursor, open note, discuss mark and Show all state. This is the pattern the
  activity fold's expansion state reuses.
- **The card never jumps.** Every page is rendered in one grid cell, so the card takes the tallest page's
  height from the first frame and paging moves neither the tabs, the question nor the footer; shorter pages
  leave room above the footer. Inactive pages are `invisible`, `inert`, `aria-hidden` and carry **no test
  ids** (`ghost.ts`), so queries, focus and assistive tech see only the active page; DOM helpers scope
  themselves to `[data-ask-active]`. Only the user's own input may grow it (a note, Other, the discuss panel,
  Show all), and a **height ratchet** then keeps the largest height for the rest of the questionnaire: a
  ResizeObserver on the grid writes it as `--ask-stack-height` on a holder, cached per call and keyed by
  width, so a Virtuoso remount keeps it and a width change resets it. Rejected: a ratchet alone (the first
  visit to a taller page still jumps), animating the height (still moves; no `interpolate-size` in stable
  WebKit), a fixed height with an inner scroller, and a list of every question (screens long). Heavy preview
  content mounts only on the active page, always inside a frame of fixed height, so a ghost page measures
  the same before and after it loads.
- **Notes live in a reserved slot.** A 24 px slot sits under every option row, so choosing an option only
  fills it ("Add note") and never moves the rows below. The editor opens in the slot and grows; a saved
  note stays fully visible there as text with a pencil and is edited by click or Enter. A single-select
  question keeps **one note that follows the selection** (`selectOptionPatch`), including a note left
  behind by an Other answer — before, a note written on A was silently not sent once B was chosen.
- **Other is a real field in its own row.** The row keeps its radio or checkbox and its place in the ↑↓
  order, is titled "Other — your own answer", and holds a two-line field. Other was always rendered; it
  read as one more option ("Other" plus a grey placeholder, last row) and lost to agent-authored look-alikes.
  Note, Other and discuss text share `AutosizeField`: measured growth from 2 to 8 lines, then an inner
  scroll (the system WKWebView of older macOS lacks `field-sizing`); Enter closes the field, Shift+Enter adds
  a line (see the keyboard model below).
- **Previews.** A question's own preview — its subject — spans the width above the options: markdown at
  natural height folded at 240 px under an overlaid **Show all** (overlaid so a late measurement never
  shifts the layout), a mermaid fence or a file/diff in a fixed 240 px frame. Option previews (single-select
  only) sit beside the options in one fixed 380 px pane (options 2/5, pane 3/5 when the card is at least
  `@2xl` wide — a container query, since the chat column decides; stacked below that) showing the preview
  of the option under the cursor (on Other or the button, the picked option's): markdown (mermaid renders), or a workspace file or
  before → after diff through `FramedResourcePreview` in its compact chrome — Open in tab and Full screen
  only, with width presets and Split/Inline in full screen. An option without one says "No preview for this
  option", never another option's preview; rows that have one carry a type glyph. PgUp/PgDn on an option
  row scroll the pane's markdown: WebKit does not make a scroll container a tab stop, and the lint rules
  reject a `tabindex` on a non-interactive region. Each file gets its own frame (keyed by its path), so one
  option's scroll offset or renderer never carries over to the next. Keys from inside a preview region or
  its portaled dialog never page or skip the questionnaire. Without a resource host a
  file preview degrades to its path and an Open file link; the plan page provides the session's resource
  scope and `onOpenFile` so previews render there as in chat. A picked file preview is echoed as its path.
  The 240 px fold, the 380 px pane and the 8-line field cap are unconfirmed starting values.
- **Discuss first.** A ghost **Discuss** toggle beside each question (or `d` on an option) marks it; a
  panel under the question offers optional reason chips (Unclear / Not relevant / Need more context) and
  optional text. The options stay visible, muted; choosing one, checking one, opening a
  note or typing Other cancels the mark while keeping the typed reason and text for a re-mark. The chip
  shows an info chat glyph (plus screen-reader text). The answer is `kind: "discuss"`. The toggle appears
  only for a host at `ASK_DISCUSS_PROTOCOL_VERSION` (v105) or later (`interaction.hostProtocol`), the
  version whose server half renders discuss answers; an older host keeps the card without it, since its
  formatter would report an empty discuss as `(no answer)` and let the agent continue. The last known version is latched per
  call (and cached with its state), because the version is unknown between a disconnect and the next
  welcome, and dropping the toggle then would reflow the page and unmount a panel being typed in.
- **The answered record is a receipt.** A header ("Answered N questions", "Answered N of M questions" or
  "N questions to discuss", plus "· K to discuss") folds a left-ruled list of question → answer pairs;
  expanded by default, collapsed it is one line of `·`-joined answers. Each pair shows the muted question,
  the answer (Other with a pencil, multi-select picks comma-joined with "+" before own text, "Let’s discuss
  first · <reason>", or "Skipped") and the quoted note, and its own **Options** toggle lists every option
  with its description and the own-answer row — selection status as screen-reader text, never by icon or
  colour alone. Only manual toggles are stored (a module map keyed by call and pair, like the chat's fold
  state), and each toggle routes through `interaction.prepareLayoutChange`. A skipped round, a superseded
  question, a stopped call and an error are one muted line each. No answer time: the renderer has no
  timestamp and a contract field for it was not worth it.
- **Attention without hostile focus theft** — once its arguments are complete, an awaiting card is
  revealed with an assertive visual “needs you” treatment plus a polite assistive-tech announcement. The
  spoken half is an **always-mounted live region filled a frame later by the same one-shot claim**: a
  region inserted together with its text is announced unreliably, and a virtualized remount must not
  re-announce a question the user has already been told about. **Exactly one copy is in the accessibility
  tree**: the visible line goes `aria-hidden` once the region carries the text, so a remount (region
  deliberately empty) still exposes the line.
  Per active-chat mount it focuses the selected choice (including Other) or first authored choice once;
  a virtualized remount never reclaims focus, while a fresh `ChatView` mount does (see [[submodule-web-chat]] —
  that means any switch back to the chat tab, not only reopening the chat). It reveals but does **not**
  move focus away from Monaco, xterm, content-editable/form fields, a non-empty composer draft, or a
  surface that **owns focus while it is open** — a dialog, a menu, another choice list (a second
  questionnaire mid-answer): out-waiting a modal focus scope either loses the fight or yanks an untrapped
  popover out from under the user, so the card does not enter it. A **coarse pointer never gives up
  focus** at all: on a phone there is no keyboard flow to hand off to, and focusing a row (the Other input
  especially) raises the soft keyboard over someone who was reading — the reveal + scroll-into-view *are*
  the attention treatment there. A **page change** follows a tap, so it may focus — except into a text
  field on a coarse pointer (`shouldFocusPageTarget`), which would raise that same keyboard. Each page
  change first asks the parent chat scroll owner to clear and suppress any temporary streaming runway, then
  reveals the new page's start with `block: "nearest"` — no scroll at all while it is visible, since paging
  no longer moves anything; it applies the focus rule afterward with browser auto-scroll suppressed. A fresh `ChatView` attention claim repeats
  that current-page reveal through one bounded settling window so Virtuoso's later initial-edge placement cannot
  undo it; focus eligibility remains independent from reveal. The card stays in ordinary transcript flow — no
  nested vertical scroller — so long pages use the same chat scrollbar to reach later answers and Next/Submit.
  The only inner scrollers are bounded by design: a text field past its 8-line cap, the option pane's
  markdown, and the file frames.
  Reveal still occurs when coarse-pointer focus is withheld and never re-arms follow mode. The empty composer
  left focused after Send is safe to hand off. The settling window **yields to the user**: the first real
  `pointerdown`/`keydown`/`wheel` after the reveal ends the claim, so a later frame can never pull focus or the
  transcript back out from under an interaction the user made while it was still trying.
  The mirror image holds on the way out: replying or declining unmounts the focused control, so the card
  hands focus **back to the composer**
  (`interaction.focusComposer`) instead of stranding it on `<body>` — but only when it still holds focus
  *and* that focus is `:focus-visible`, the platform's own "arrived by keyboard" signal (the one every
  ring in this card is drawn from). A tap/click answer leaves focus alone, so touch keeps its keyboard down.
  A **failed send undoes the hand-off with the latch**: the form comes back interactive, and since the
  one-shot claim is long spent and could neither re-focus nor re-announce, the card takes focus back itself
  rather than reappearing with the keyboard parked in the composer and nothing to say it had returned.
- **Every control is an explicit tab stop.** The macOS desktop is the system WKWebView, where Tab skips a
  `<button>` without a `tabindex` and a click does not focus it: Add note, Skip and Next/Submit were
  unreachable and arrows after a click went to the page, while Chromium hid both (post-mortem: no
  browser-level keyboard coverage existed). So every control of the card and receipt carries `tabIndex`
  (option rows keep their roving 0/−1), a press on an option row focuses it, a markup test asserts the rule
  platform-independently, and the keyboard specs run in a WebKit lane ([[module-browser-e2e]]).
- **Every focus indicator in the card is the app-wide accent focus indicator** — the shared buttons'
  offset `primary` outline (Skip, Next/Submit, Add note, Discuss), and `focus-visible:ring-2` + `ring-primary`
  on the card's own controls (`focus-within:` on the Other row, whose ring marks the roving cursor passing
  through a text field) — per the colour system's "accent = focus" rule (`styles/COLOR.md`, Control row). The
  card originally shipped on `ring-primary-soft`, which the theme refinement's palette flattening
  composites to near-invisibility (accent @20% over the flattened surfaces), leaving keyboard users
  with no visible cursor — the one file the app-wide focus-ring sweep missed. `ring-primary-soft`
  remains only as the awaiting card's decorative active halo, which is not a focus indicator.
- **Explicit-selection keyboard model** (chosen by the user over the earlier Claude-style "Enter confirms
  and moves on"). One authored choice is in the Tab order. **↑/↓ only move**, wrapping through the
  options, **Other** and the **primary button** (Next on earlier pages, Submit on the last — skipped while
  Submit is disabled); Home/End jump to the first option / Other. On an option **Enter picks it**
  (single-select) or **checks / unchecks it** (multi-select) and stays — no row key moves on or submits;
  **Space opens that option's note** (picking / checking it first); **`d` marks the question for
  discussion** and focuses its text. Enter on the primary button goes on or sends; **the platform
  modifier + Enter** (`hasPlatformModifier`: Cmd on Apple, Ctrl elsewhere) **submits from anywhere in the
  card**, fields included; **←/→ switch questions** without wrapping outside text fields; Tab keeps moving
  focus (taking it for paging would trap keyboard users in the card — the terminal, which has no focus
  order, pages with Tab too). A legend states all of it. Inside the Other field ←/→/Home/End stay caret
  keys and ↑/↓ lift out only where the browser could not move the caret, so a wrapped long answer is
  never left by accident. Reaching Other focuses its field — but **text, not focus, makes Other the
  answer** (`customTextPatch`): typing claims it (exclusively on single-select, additively on
  multi-select), emptying hands it back, and multi-select keeps its explicit include checkbox. The row is
  a `<label>` **explicitly bound to its field via `htmlFor`** — `<button>` is labelable too, so on
  multi-select the implicit control would be the include toggle and clicking the row's chrome would flip an
  empty checkbox instead of putting the caret in the field.
  **Fields park focus on their own row.** Enter (no modifier) or plain Escape closes the note, Other or
  discuss text and moves focus to that field's row — the saved-note button, the Other row, the discuss
  panel (`tabIndex=-1` targets). From a parked row Enter reopens the field (on the Other row it also
  re-picks Other when it has text) and ↑/↓ continue the choice order. Parking was chosen over returning
  to the options because, with Enter picking, a habitual second Enter there would replace a typed Other
  answer or uncheck the option a note was written for. `Shift+Escape` in a note is **consumed** (it closes
  the note rather than letting the card's skip throw it away mid-sentence), also mid-IME-composition,
  where Escape is consumed rather than finishing; in Other and the discuss text it stays the card's skip.
  The card's skip and every field ignore keystrokes the IME owns ([[module-web]]'s text-field rule).
  Plain Escape outside a field never declines.
  On multi-question cards the chips are a real `tablist` over the shared `tabpanel` with **automatic
  activation** — an arrow/click switches the page and focus follows into it.
  **A submit gesture is never a silent no-op**: the chord with nothing answered says “Choose an option
  first” beside the actions, clearing once the question becomes answerable and spoken through the
  attention line's live-region pattern; the complaint belongs to the question it was raised on
  (`nudgeShowsOnPage`) and each gesture is stamped so a repeat is announced again.
  A note is a secondary control on every **checked choice**, in the slot **directly beneath its own
  option row**; the wire carries **one `notes` string per answer**, so a multi answer joins per-option
  notes as `label: note` lines. The control reads "Add note" or shows the saved note (named "Add/Edit note
  for …", with the note as its description). The choices are checked rows with `aria-checked` — never
  `aria-pressed` — in a **`radiogroup` of `radio` rows / `group` of `checkbox` rows** (a `listbox` cannot
  hold the interleaved note controls). Single-select focus **no longer checks** a radio: a deliberate
  departure from APG's radio keys, safe because Enter now checks the focused row instead of submitting it,
  so the announced state never contradicts the answer. Deselecting a choice whose note editor is open
  clears `noteFor` in the same update (`toggleMultiPatch` / `selectOptionPatch`) while keeping the text.
  The only letter is `d` on an option row and the only chord the platform modifier + Enter, both
  card-local; other letters and digits stay free so browser extensions, custom text and explicit decline
  stay safe.
- **Recommended-reason affordance** — a recommended option (label suffix `(Recommended)` **or** a
  non-empty `recommendedReason` — a reason *implies* recommended, defensively) renders its rationale
  **inline** as a `Why: …` block inside the option card (below the description; `Why:` in the accent
  color). Shown up front for every recommended option, not gated on selection: more discoverable than
  a tooltip and, being ordinary visible text, it reads on touch and for AT without a popover.
  **Active card only** — the receipt shows selections only, no rationale.
