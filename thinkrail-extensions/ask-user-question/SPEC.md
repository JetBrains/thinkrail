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
- `./web` is the questionnaire card: the docked form, its transcript stub and the answered receipt.

The host keeps the interactive-tool lifecycle — mailbox phases, restart repair, late responses, composer
supersede, Stop/Submit ordering and needs-input ([[submodule-server-agent]]) — and knows nothing about
this tool beyond what the descriptor and the renderer registration declare. The extension is the first
client of that contract ([[module-extension-api]]) and is deletable without a core change.

## Boundary

- `@thinkrail/ext-ask-user-question/server` default-exports a session-only descriptor:
  - `extensions: []`;
  - `settings: { richPreviews: { type: "boolean", default: true } }` — Settings → Extensions & skills shows it as the
    nested "Rich previews in questions" switch ([[module-thinkrail-extensions]]);
  - `sessionExtensions: (session) => [factory]`, a factory that reads `session.setting("richPreviews")`
    **inside its body** and composes `createAskUserQuestionExtension({ ask, announce, guidance, filePreviews,
    checkFile })`, so every pi (re)load after a Settings change registers the tool with or without the file
    fields;
  - `interactiveTools: { ask_user_question: { describeResponse } }` — `describeResponse(args, response)`
    renders a late answer (one delivered after a host restart) through the package's
    `buildQuestionnaireResponse` when both have our shape, so the model reads the same wording as for a
    live answer; any other shape returns `undefined` and the host's generic JSON preface applies;
  - `artifactTools: { ask_user_question: { presented, picked } }` — `presented` lists every
    `previewFile`/`previewBefore` the call showed (`previewFileSources`), `picked` the `previewFile` of
    each answer in the result's `details.answers` — for a multi-select answer, of each selected label's
    option in the call's args — so the host's artifact index knows which mockups the
    person saw and which they chose ([[submodule-server-artifacts]]). A deferred call's `{ kind: "ack" }`
    names no pick, and a late answer after a restart is not read (deferred).

  `announce` forwards each executable call to `session.expectToolResponse(toolCallId)`, so the host's
  question lifecycle starts only for calls this extension runs. The asker awaits `session.awaitToolResponse(toolCallId, signal)`. A `response` must be a questionnaire
  result (checked with the package's `isAskUserQuestionResult`, else the call fails); `deferred` and
  `abandoned` pass through as outcomes, so the package returns the canonical ack or the stop and ends the
  turn. `guidance` is ThinkRail's description and prompt guidelines: the card docked above the message box, a composer reply that
  supersedes it, Discuss, question versus option previews, and — only with rich previews on — mockup files
  under `session.workspaceFiles.scratchDir` (`.thinkrail/context/mockups/`) referenced by `previewFile`; it
  says mockups may use inline scripts and form controls, which run sandboxed without network where the UI
  renders that directory's HTML interactive (a browser, not the desktop window), so a mockup must still read
  without them, and to attach behaviour with `addEventListener`, since scripts or inline handlers inserted at
  runtime do not run ([[module-resource-renderers]]).
  Off, the model is offered neither the fields nor that guidance: the saving is the agent's mockup writing
  (output tokens and a tool call each), not rendering, which is lazy. Markdown previews, mermaid included,
  stay either way (unconfirmed with the user: mermaid is text, so the switch leaves it on). `checkFile` is the host's
  `session.workspaceFiles.check`. The server half has no named exports; it imports only
  `extension-api/server` and its pi package. The package's deferral ack `{ kind: "ack" }` is the host's pending marker — a test pins it.
- `@thinkrail/ext-ask-user-question/web` default-exports a `defineWebExtension` descriptor that registers
  `AskUserQuestionCard` for `ask_user_question` with `{ chrome: "bare", interactive: true, dock: true }`, titles
  itself (the Settings → Keyboard section) and declares its keys (`keys.ts`): `commands` local to the scope
  `ask-user-question.card` — discuss `D`, interact `I`, compare `C`, submit `Mod+Enter` (plus the numpad Enter),
  skip `Shift+Escape`, rebindable and matched by physical key through `useLocalKeys` — and `shortcuts` for the
  locked keys (arrows, Enter, Space, Home/End, PgUp/PgDn, Esc, the field and compare keys). Nothing is exported by
  name: the plan page reaches the card through the tool registry, as the chat does.
- The card imports `extension-api/web`, the package's argument/result **types** (type-only, from
  `@thinkrail/pi-ask-user-question/core`; a value import of the pi package stays forbidden in browser code,
  so the result guard `readAskUserQuestionResult` and the answer model in `web/state.ts` are the card's own),
  `@thinkrail/ui` (`attention-line`, `button`, `dialog`, `dropdown-menu`, `focus`, `keyboard`, `keycaps`,
  `local-keys`, `textarea`, `utils`),
  `@thinkrail/resource-renderers` (`useOptionalResourceHost` for the host's Markdown — mermaid included —,
  `FramedResourcePreview` + `useResourceScope` for file previews, and `ResourcePreview` + `HtmlViewportSwitch`
  for the compare overlay), `@thinkrail/locales` (types) and `/react`, React and Remix Icon. It never imports
  the visualize extension: previews keep working with visualize switched off.
- It never reaches app or host internals. Everything it needs from the chat arrives in
  `ToolRenderProps.interaction` ([[module-extension-api]]):
  - the response delivered after a restart, the superseded and ended verdicts, and `accepting` (Submit and
    Skip are enabled, and the attention line, active styling and focus claim appear, only while it holds,
    so a call the host is not waiting on never asks for attention);
  - `respond`;
  - the focus scope and `mayClaimFocus()` (false only for the question a served composer-focus request, such as
    Mod+L, won over; [[submodule-web-chat]]);
  - the layout callback and its `placement` (docked, transcript stub, or neither);
  - composer and transcript hand-off (`focusComposer`, `focusTranscript`), and `landingChord`, the label of the
    key that lands on the question (F6 by default).

  Without `interaction` the card is read-only.
- Its strings keep their historical `tools.ask.*` keys instead of an extension prefix. Users' local
  catalogs overlay by exact key, so renaming would silently turn their translations back into English.

## Rendering contract (web)

Registered `"bare"`: the card owns its full-width frame and never folds. Behaviors worth their invariants:

- **Docked in the chat, a card elsewhere.** While the chat's host awaits the call, the chat renders it
  twice ([[submodule-web-chat]]): the live form in the interaction dock above the Resources strip and the
  composer (`placement: "dock"`), and a one-line **stub** at the call's place in the transcript
  (`placement: "stub"`: "Question from agent · N questions · Answer below ↓"). The docked form is a
  **sheet**: full column width, accent top rule, no radius; one header row holds the attention line, the
  question tabs (a single question shows its short header) and a collapse toggle; the page stack sits in
  a body that scrolls; the footer (legend, nudge, Skip, Next/Submit) is pinned. The chat caps the dock at
  its *Question panel height* setting (40–100% of the chat, default 70), so only the content between
  header and footer scrolls. This overturns the earlier "no nested vertical scroller" rule for the dock:
  with a fixed bottom edge the alternative is a form that swallows the transcript. **Collapse** is manual
  and keeps only the header row; a tab click expands on that page, the stub expands and focuses the form,
  every new question arrives expanded, and a page change scrolls the body back to its top. Collapse and the
  stub's focus request live in a per-call `useSyncExternalStore` store (`dockState.ts`), dropped with the
  answer cache; the stub never writes the answer cache, so it cannot overwrite the dock's answers. Without
  a placement (the plan page, a call the host is not awaiting) the card renders as before, inline. After the
  answer the stub becomes the receipt; the docked form shows "Answer sent" until the host accepts it.
  Rejected: a separate floating card with margins (the user chose the sheet, which reads as part of the
  input area) and collapsing on its own when the composer is used (the form would resize without a
  gesture).

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
- **Per-call UI state survives remounts** — a module-level cache keyed by `toolCallId` (dropped
  once no longer awaiting), since react-virtuoso unmounts off-screen rows and a chat switch remounts the
  dock; it holds every page's answers,
  cursor, open note, discuss mark and Show all state. This is the pattern the
  activity fold's expansion state reuses.
- **The card never jumps.** Every page is rendered in one grid cell, so the card takes the tallest page's
  height from the first frame and paging moves neither the tabs, the question nor the footer; shorter pages
  leave room above the footer. Inactive pages are `invisible`, `inert`, `aria-hidden` and carry **no test
  ids** (`ghost.ts`), so queries, focus and assistive tech see only the active page; DOM helpers scope
  themselves to `[data-ask-active]`. Only the user's own input may grow it (a note, Other, the discuss panel,
  Show all), and a **height ratchet** then keeps the largest height for the rest of the questionnaire: a
  ResizeObserver on the grid writes it as `--ask-stack-height` on a holder, cached per call and keyed by
  width, so a remount keeps it and a width change resets it; a zero-width measurement (the collapsed
  sheet) is ignored. Rejected: a ratchet alone (the first
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
  only. On a question with option previews every full-screen button of the page opens the **compare
  overlay** below instead of the one-file dialog: the frame's own button on a file preview, a button in the
  label row on a markdown preview or an option without one, and the question preview's (on Current).
  Without option previews the question preview keeps the one-file dialog, with width presets and
  Split/Inline. An option without a preview says "No preview for this
  option", never another option's preview; rows that have one carry a type glyph. PgUp/PgDn on an option
  row scroll the pane's first scrollable element (markdown, an image, a markdown file): WebKit does not make a
  scroll container a tab stop, and the lint rules reject a `tabindex` on a non-interactive region. An HTML pane
  takes neither the keys nor their hint: an opaque-origin frame cannot be scrolled from the card. **HTML frames
  are out of the Tab order** (`frameFocus: "manual"`, [[module-resource-renderers]]): a sandboxed frame traps Tab
  and swallows every key, so `i` on the row (or the pane's **Interact** button) focuses it, the pane draws the
  focus ring and says "Tab out to return", and a return stop after the frame sends the Tab that leaves it back to
  the row. Esc cannot be caught inside the frame, hence Tab. The ring follows the pane's own focus tracking:
  Chromium never matches `iframe:focus` for a focused frame. Unverified on the macOS WKWebView: the WebKit lane
  covers `i`; should the desktop refuse to focus a sandboxed frame, `i` is hidden there. `c` on a row with a preview opens the compare
  overlay on it. Each file gets its own frame (keyed by its path), so one
  option's scroll offset or renderer never carries over to the next. Keys from inside a preview region or
  its portaled dialog never page or skip the questionnaire. Without a resource host a
  file preview degrades to its path and an Open file link; the plan page provides the session's resource
  scope and `onOpenFile` so previews render there as in chat. A picked file preview is echoed as its path.
  The 240 px fold, the 380 px pane and the 8-line field cap are unconfirmed starting values.
- **Compare overlay** (`compareModel.ts`, `CompareOverlay.tsx`). A near-full-window dialog for comparing a
  single-select question's alternatives, HTML mockups above all, where the 380 px pane shows one at a time
  and comparison was from memory. Its items are **Current** (the question's own preview, never choosable)
  then every option, an option without a preview saying so as in the card. It opens in **One at a time** on
  the item whose button opened it; **Side by side** puts Current (else the recommended, else the first
  option) on the left and that item on the right — strip clicks and ←/→ change the right side, the left has
  its own menu and a swap, and choosing a side already shown swaps rather than showing one item twice;
  **All** shows every item (at most five), a pane title opening it alone. Two files of one visual kind (HTML,
  raster image, SVG; neither itself a diff) pair through the type's comparison renderer with its option
  labels as side names, so HTML gets 2-up, swipe, onion and difference with both documents scrolling
  together ([[module-resource-renderers]]); any other pair is two independent panes. One width control in
  the header drives every HTML pane (`ResourcePreview.htmlViewport`) and is remembered for the session; the
  panes drop review surfaces (`reviewable={false}`), since commenting belongs to the file's own tab. The
  view switch is hidden on narrow screens, so a phone gets one at a time only.
  **Choose closes** (the user, 2026-11-17, overturning #1393's "Choose and stay"): in every view, Choose on a
  shown option, or Enter while the overlay body itself has focus (so it never fights a focused button), picks
  it through the card's own `onSelect` — the note follows the selection as in the card — and closes the
  overlay; notes and Submit stay in the card. Closing, by Choose or Esc, returns focus to the chosen row,
  else to the row it was opened from (Radix's trigger-less dialog would leave it on `<body>`), revealed in
  the dock like any focus the card moves. An All pane title only opens that item alone. The body's
  `aria-keyshortcuts` lists every key it takes, each jump digit included. Keys live on the overlay body, so
  an All pane title — which removes the control it was pressed on — moves focus to the body, and the dialog hands focus it
  receives itself to the body too: Radix's own recovery parks it on the first tab stop or the dialog, where
  Enter would press the wrong control or the keys would stop. Keys: ←/→ flip (wrapping), 1–9 jump, Esc closes; keys owned by a
  slider, a field or a menu, and anything typed inside a frame, stay there. The dialog is portaled, so its
  keys never reach the card's handler (`contains` fails), exactly like the one-file dialog. Its open state is
  the page's own: a dock remount closes it. From the **receipt**, a pair whose question had option previews
  offers **Compare**, which opens the same overlay read-only on the chosen option. Rejected: turning the
  options into one generated interactive HTML page with the switcher and the pick inside it — it needs
  scripts in the frame, lets a mockup pick an answer for the user, works only for HTML, and loses the card's
  keys, theme and locales. Mockups the agent writes under `scratchDir` do run their own scripts in a browser — in their
  own frames, sandboxed without network ([[module-resource-renderers]]) — so a prototype's tabs and toggles work
  in every pane while choosing stays the overlay's.
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
  colour alone; a question with option previews also offers **Compare** (the overlay, read-only). Only manual toggles are stored (a module map keyed by call and pair, like the chat's fold
  state), and each toggle routes through `interaction.prepareLayoutChange`. A skipped round, a superseded
  question, a stopped call and an error are one muted line each. No answer time: the renderer has no
  timestamp and a contract field for it was not worth it.
- **Attention without hostile focus theft** — once its arguments are complete, an awaiting form shows an
  assertive visual “needs you” treatment plus a polite assistive-tech announcement. The spoken half is an
  **always-mounted live region filled a frame later by the same one-shot claim**: a region inserted
  together with its text is announced unreliably, and a remount must not re-announce a question the user
  has already been told about. **Exactly one copy is in the accessibility tree**: the visible line goes
  `aria-hidden` once the region carries the text, so a remount (region deliberately empty) still exposes
  the line. The stub never claims.
  Per active-chat mount the form focuses the selected choice (including Other) or first authored choice
  once; a fresh `ChatView` mount claims again (see [[submodule-web-chat]] — any switch back to the chat
  tab). **It takes focus from anywhere except while the user types**: from `<body>`, an empty composer and
  any non-text element (the feed, a transcript item, a tree row, a tab, a rail or panel root, a button),
  however focus got there, and only while `mayClaimFocus()` holds (false for the one question a served
  composer-focus request won over, so Mod+L opening a chat whose question already waits keeps the
  composer, across remounts too, until that question is answered). It never claims from a composer with a
  draft, other text entry (input, textarea, select, contenteditable, an iframe), Monaco or xterm, or
  anything inside a modal surface (dialog, alertdialog, menu, listbox): there it stays put and the
  announcement says "Agent asks a question — {landingChord} to answer". `focusTargetKind` stays pure; the
  docked sheet shows "waiting · {landingChord} to answer" whenever focus is outside it. **Reversed
  2026-11-17 (user):** #1416 claimed only from `<body>`, an empty composer or a control the *mouse* focused,
  judged by a document-level input-modality watch, and never from keyboard navigation; it also let one
  served Mod+L silence every later question of the mount. A waiting question is where focus belongs (the
  focus home the Esc ladder climbs to, [[submodule-web-shell]]), so the provenance watch is gone and the
  Mod+L exemption is per question. The ways in are the shell's and the chat's: F6 or Mod+1…9 into the chat
  land on `[data-focus-claim]` — the current option (the cursor row, or Other's field when its text is the
  answer), the expand toggle while collapsed —, and so do Esc in the composer, Esc on the transcript, the
  Esc ladder from another panel and Shift+Tab from the composer, never Skip ([[submodule-web-chat]],
  [[submodule-web-shell]]). A **coarse pointer never gives up focus** at all: focusing a row (the Other input
  especially) raises the soft keyboard over someone who was reading. A **page change** follows a tap, so
  it may focus — except into a text field on a coarse pointer (`shouldFocusPageTarget`). The transcript is
  never scrolled for attention: the dock is always visible. The card used to reveal itself in the
  virtualized transcript through a bounded settling window that yielded to the user's first input; docking
  removed the reveal, the settling window and the `revealElement` / `cancelAutomaticReveal` members of the
  tool contract. The empty composer left focused after Send is safe to hand off.
  The mirror image holds on the way out: replying or declining unmounts the focused control, so the card
  hands focus on instead of stranding it on `<body>`. A **keyboard** answer (a chord, or Enter/Space on
  Skip/Submit — a click with `detail === 0`) goes to the composer (`interaction.focusComposer`), ready to
  type; a **click or tap** parks it on this call's transcript row, the receipt-to-be
  (`interaction.focusTranscript`, before the form unmounts), with no ring and no soft keyboard. `:focus-visible`
  no longer decides: WebKit and Chromium disagree about it after a click. **Esc** outside a field also goes
  to the composer and leaves the sheet expanded. On the plan page both land on the page's live slot.
  A **failed send undoes the hand-off with the latch**: the form comes back interactive, and since the
  one-shot claim is long spent and could neither re-focus nor re-announce, the card takes focus back itself
  rather than reappearing with the keyboard parked in the composer and nothing to say it had returned.
- **Every control is an explicit tab stop.** The macOS desktop is the system WKWebView, where Tab skips a
  `<button>` without a `tabindex` and a click does not focus it: Add note, Skip and Next/Submit were
  unreachable and arrows after a click went to the page, while Chromium hid both (post-mortem: no
  browser-level keyboard coverage existed). So every control of the card and receipt carries `tabIndex`
  (option rows keep their roving 0/−1), a press on an option row focuses it, a markup test asserts the rule
  platform-independently, and the keyboard specs run in a WebKit lane ([[module-browser-e2e]]).
- **Every focus indicator in the card is the shared focus ring** (`styles/COLOR.md`, *Focus ring*): the
  shared buttons' own, the inset `focus-ring-inset` on the page tabs, and the outset `focus-ring` on option
  rows, chips and the Other row, so a focused row stays distinct from a checked one that draws an accent
  border. The Other row shows one ring: through `has-[textarea:focus-visible]` while its text field has
  focus (the field drops its own ring), and on its own `focus-visible` when focus parks on the label after
  Enter or Escape. `ring-primary-soft` is only the awaiting card's
  decorative active halo, not a focus indicator.
- **Explicit-selection keyboard model** (chosen by the user over the earlier Claude-style "Enter confirms
  and moves on"). One authored choice is in the Tab order. **↑/↓ only move**, wrapping through the
  options, **Other**, **Skip** and the **primary button** (Next on earlier pages, Submit on the last — skipped
  while Submit is disabled); Home/End jump to the first option / Other. On an option **Enter picks it**
  (single-select) or **checks / unchecks it** (multi-select) and stays — no row key moves on or submits;
  **Space opens that option's note** (picking / checking it first); **`d` marks the question for
  discussion** and focuses its text. Enter on the primary button goes on or sends; **the platform
  modifier + Enter** (`hasPlatformModifier`: Cmd on Apple, Ctrl elsewhere) **submits from anywhere in the
  card**, fields included; **←/→ switch questions** without wrapping outside text fields, except on Skip and
  the primary button, where they move between the two; **→ past the last question goes to Submit** — on an
  option, the last question's tab or the card itself, on a single-question card too (one rule, user
  2026-11-20; `pageKeyTarget`): it focuses Submit, or, while Submit is disabled, says "Choose an option
  first" as the submit chord does and keeps focus (until then → on the last page was swallowed and Submit
  was reachable only by ↓ or Tab); Home/End on the question tabs jump to the first or
  last question; Tab keeps moving
  focus (taking it for paging would trap keyboard users in the card — the terminal, which has no focus
  order, pages with Tab too). A legend states all of it (hidden on a coarse pointer, where there is no keyboard
  to discover). Inside the Other field ←/→/Home/End stay caret
  keys and ↑/↓ lift out only where the browser could not move the caret, so a wrapped long answer is
  never left by accident. Reaching Other focuses its field — but **text, not focus, makes Other the
  answer** (`customTextPatch`): typing claims it (exclusively on single-select, additively on
  multi-select), emptying hands it back, and multi-select keeps its explicit include checkbox. The row is
  a `<label>` **explicitly bound to its field via `htmlFor`** — `<button>` is labelable too, so on
  multi-select the implicit control would be the include toggle and clicking the row's chrome would flip an
  empty checkbox instead of putting the caret in the field.
  **The card reveals the focus it moves.** Every focus it moves itself — ↑/↓, Home/End, ←/→ on Skip and
  the primary button, a field parking on its row, `i` into a frame, the compare overlay closing onto a row,
  the stub's focus request — goes through `focusAndReveal` (`@thinkrail/ui/focus`, which the chat and shell
  use for the same target): focus with `preventScroll`, then
  move only the nearest ancestor that actually scrolls (the dock body; inline, the plan page's scroller) just
  enough (block "nearest", the focus ring included) for the control to be fully visible. Not
  `scrollIntoView`, which scrolls every ancestor, the transcript and overflow-hidden boxes included. The
  first focus claim and a page change focus in place: the body is at its top then. **The selected tab
  stays in view:** a page change (←/→, Home/End, a chip click, Next), in the frame that focuses the page,
  and the strip's mount (a remount restoring a cached page) move only the horizontally scrolling tab strip
  just enough to show the selected chip (`revealActiveTab` over `@thinkrail/ui/focus`'s
  `revealHorizontally`), never the transcript or the page; before 2026-11-20 a narrow dock left the open
  question's chip past the strip's edge. Until 2026-11-17 every
  such focus used `preventScroll` alone, so ↓ walked below the edge of a capped dock.
  **Fields park focus on their own row.** Enter (no modifier) or plain Escape closes the note, Other or
  discuss text and moves focus to that field's row — the saved-note button, the Other row, the discuss
  panel (`tabIndex=-1` targets). From a parked row Enter reopens the field (on the Other row it also
  re-picks Other when it has text) and ↑/↓ continue the choice order. **The card itself is a focus target**
  (`tabIndex=-1`, the accent ring like every other indicator): a press on its own background parks focus on
  it, where ←/→ still page and ↑/↓ re-enter the choices at the cursor (issue #1304). **A note closes,
  keeping its text, when focus leaves the card** (not when the window loses focus — the field is still open
  on return) **or on a press on the card's background**; presses on controls are left to their own
  handlers, because closing on the field's blur shrinks the slot between mousedown and mouseup and the row
  below an open note would miss its click. Parking was chosen over returning
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
  **The card's letters and chords are local commands** (`d`, `i`, `c`, the submit and skip chords): the card
  root carries `data-key-scope="ask-user-question.card"`, so the global binder yields to them inside it, the
  user rebinds them in Settings → Keyboard, and they match the physical key, so `d` works on a Russian
  layout. An option row matches them before its own keys, so a Discuss, Interact or Compare rebound to a
  Ctrl/Alt/⌘ chord acts there; a matched card chord (submit, skip) is left to the card, and the row's own
  keys act only without Ctrl/Alt/⌘. Legends and `aria-keyshortcuts` show the resolved keys for this platform only (one Mod+Enter). While
  the sheet is collapsed, submit, skip and Esc still act; submit with nothing answered expands it and shows
  the nudge. Other letters and digits stay free so browser extensions, custom text and explicit decline stay
  safe.
- **Recommended-reason affordance** — a recommended option (label suffix `(Recommended)` **or** a
  non-empty `recommendedReason` — a reason *implies* recommended, defensively) renders its rationale
  **inline** as a `Why: …` block inside the option card (below the description; `Why:` in the accent
  color). Shown up front for every recommended option, not gated on selection: more discoverable than
  a tooltip and, being ordinary visible text, it reads on touch and for AT without a popover.
  **Active card only** — the receipt shows selections only, no rationale.
