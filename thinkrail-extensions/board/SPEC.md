---
id: module-ext-board
type: module-design
status: draft
title: Board extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api]
references: [task-board-core, task-project-board, submodule-server-extensions, submodule-server-host, module-contracts, submodule-web-shell, submodule-web-shell-layout]
---

## Responsibility

A board per project whose cards launch agent work and follow it. **The column is the work status**: a
preset names the columns over fixed categories. **The agent's state is live**, computed per request
from host facts and never stored. **Host events move cards** through pure rules, and a human's move is
a logged override. There is no portable pi package, because every tool acts on host-owned state. The web
half is the Board side tool, the card in Peek, the cross-project "Needs you" inbox (above the board and as
a topbar counter) and Board mode.

## Boundary

- **`./server`**: `defineServerExtension({ name: "board", title, description, apiVersion: 1,
  extensions: [], sessionExtensions, queries, hostService })`.
  - It imports `extension-api/server`, `typebox` and pi types only. Contracts types come through the
    SDK's re-exports.
  - The queries, the host service and the tools share **one `Board` per data folder**. The first
    `queries(host)` or `hostService(host)` builds it, without I/O. Once the services it was built on
    have their `signal` aborted (a switch-off), the next run builds a fresh one on its own services.
  - The tools reach the board most recently built. Before one exists, they answer that the board is
    not running.
  - Enabled by default. Switching it off refuses its queries and actions, stops its host service and
    withholds its tools.
- **`./web`**: `defineWebExtension({ name: "board", title, sideTools: { board }, panels: { card },
  statusItems: { inbox }, layoutPresets: { board }, commands, shortcuts })`, in the web registry.
  - It imports `extension-api/web`, `contracts` types, `locales`, `ui`, React and `@dnd-kit/core`, never its
    `./server` half: the wire shapes it reads are restated in `web/api.ts` and checked on arrival (an unknown
    shape is a `BoardReplyError`, a version skew), and `workflowFor` mirrors the server's size rule for the
    Start form's default.
  - It reaches the host only through its `PanelHost`.

## Store

The store lives at `<dataDir>/<projectId>/`, the extension's data folder (`~/.thinkrail/extensions/board/`):

- **`cards.json`**: `{ version: 1, prefix, nextNumber, cards }`.
- **`settings.json`**: `{ version: 1, preset, wipLimits { needsYou, review, agents }, followSelection }`.
  The defaults are `agentic-kanban`, 3 / 5 / 3, and off.
- **`transitions.jsonl`**: an append-only log of `{ cardId, from, to, at, actor, reason }`.
  - `from` and `to` are `{ category, column }`, or `null` at creation or deletion.
  - `actor` is `human`, `agent`, `git` or `automation`.

Write rules:

- Writes are atomic (a temp file, then a rename).
- The host runs one board per process, so the store is the single writer. It keeps what it read in
  memory.
- A project id must be a plain folder name.

Failure handling:

- **An unreadable file** (bad JSON, a missing or unknown version) is **moved aside** to
  `<file>.corrupt-<ms>`, logged, and read as empty or default. A later write therefore never destroys it.
- **A file of a newer version** makes that board refuse to read or write, rather than lose data.
- **Unreadable cards** are dropped with a warning. Missing fields take defaults.

**Card ids** are `PREFIX-n`:

- `n` is sequential per project and never reused.
- The prefix is fixed at the board's first card and is 2–4 letters. It is the initials of a
  multi-word name (camel case counts, so `ThinkRail` gives `TR`), else a word's first three letters,
  else `BD`.
- It is **collision-safe across boards**: a taken prefix is extended with the name's letters, then
  with letter pairs. A card id therefore names one card across every project, as the tools need.

**A card** has:

- `id`, `source { kind: native | task-spec | github, ref }`, `title`, `description`, `acceptance[]`;
- `type` (feature / bug / chore), `size?` (S / M / L) and `sizeSuggested?`;
- `labels[]`, `blocks[]` (the ids it blocks), `specRefs[]` and `rank`;
- `category` and `column`, `ownerHuman` (the local user) and `createdBy` (human / agent);
- `origin? { sessionId, cardId? }` on an agent's card: the chat that filed it and the card that chat works
  on, by which Triage groups a decomposition;
- `attempts[] { workspaceId, sessionId, workflow, startedAt, notes[], merged?, removedAt? }`;
- `cancelPending?`, the question "cancel?" after an unmerged workspace went away.

Only native cards exist so far.

## Presets

Presets are pure (`presets.ts`). Triage and Canceled are hidden lanes in both. The first category a
column lists is the one a card moved into it takes.

| Preset | Columns (categories) |
| --- | --- |
| Agentic kanban | Backlog (backlog) · Ready (unstarted) · Designing (started, `brainstorm`) · Building (started, `implement`) · Review (review) · Done (completed) |
| Solo | Todo (backlog + unstarted) · Doing (started + review) · Done (completed) |

- **A move keeps the card's category when the target column shows it**, so Doing keeps a card in
  review.
- **A started card's column follows its latest attempt's workflow.**
- **Changing the preset remaps** every card's column from its category, with no transition logged.

## Rules

Rules are pure (`rules.ts`: `applyEvent(card, event, preset, at)`). An event concerns one attempt's
workspace, and `null` means nothing changed, so **re-applying an event is a no-op**.

- **Start → started**, in its workflow's column, from any category. The actor is `automation`.
- **`agent.settled` → review**, only from started and only for an attempt still open, when that
  chat's plan is done (`total > 0`, `open = 0`) or the workspace's diff is non-empty.
- **A merged PR → completed** (actor `git`). It marks the attempt `merged`. A card already completed
  only gets that mark. Once the attempt is marked, a merged event for it is a no-op, even across
  restarts, so a later move by hand stands.
- **A workspace removed** marks its attempt `removedAt`. When no attempt is open, nothing was merged
  and the card is not completed or canceled, it sets `cancelPending`. It **never cancels**.
- **A move by hand** is an override with actor `human`. It clears `cancelPending`, and a move within the
  same column only re-ranks.

The host service (`Board.listen`) subscribes to `agent.settled`, `workspace.updated` (a review in state
`merged`) and `workspace.removed`:

- **It ignores workspaces no attempt holds.** A workspace → card index is built lazily from the stored
  boards and refreshed on every write.
- **It applies events one at a time on one chain**, which preserves their order. A failing rule is
  logged, and later events still apply.
- Every write publishes **`board.changed { projectId }`**, and so does a bound chat's `session.state` or
  a bound workspace's review when its signature changes. The web side re-reads the board.

## Live overlay

Per request and per open attempt, `workspaceFacts` gives:

- the chat's `chatState`, unread and title;
- the plan's open / total;
- the workspace's diff and PR (number, state, url).

A removed attempt reads `open: false`. Cards also carry `blockedBy`, derived from the other cards'
`blocks`.

**WIP** has three counts against the settings' limits:

- **Needs you**: active cards whose latest attempt is `needs_you`.
- **Review**: cards in review.
- **Agents**: active cards whose latest attempt is `working`.

The last action is **not shown yet**: the host reports no tool-level fact for it.

## Queries

Every query validates its params (lengths, enums, lists of at most 100) and answers JSON.

- **`board.get { projectId }`** → `{ projectId, projectName, prefix, settings, columns, cards, wip }`,
  each card with its `live[]`. It refuses a project that is not an open repository.
- **`inbox {}`** → the active cards across the open projects whose latest attempt is `needs_you` or
  `failed`, with project and reason; an `interrupted` run (a stop, a host restart) reads as `failed`, as the
  card's badge does, since the card is stalled either way.
- **`card.get { cardId }`** → the card with its live overlay, its project and its transitions, for the
  Peek card.
- **`card.create { projectId, title, description?, acceptance?, type?, size?, labels?, specRefs?,
  column? }`**: a human's card, in Backlog by default.
- **`card.update { cardId, …, size: null clears, blocks, cancelPending: false dismisses }`**. An edited
  size is no longer a suggestion. `blocks` must name other cards of the same board.
- **`card.move { cardId, column, rank? }`**: an override, logged.
- **`card.delete { cardId }`**: the card leaves the other cards' `blocks` too.
- **`triage.accept { cardIds }`** moves the cards to Backlog as a whole. It moves nothing unless every
  card is in Triage on one board.
- **`card.start { cardId, workflow?, model?, thinkingLevel?, baseRef? }`**:
  - It refuses a Triage card and a card already starting.
  - The workflow is the size's (S, a bug or no size → `implement`; M / L → `brainstorm`) unless one is
    named.
  - The kickoff is `Card <id>: <title>`, then the description, the acceptance criteria and the specs.
  - A brainstorm kickoff is prefixed `/skill:brainstorming `, exactly as the composer sends a picked
    skill, so pi expands it.
  - It calls `actions.createWorkspace` and then records the attempt and applies Start. It answers the
    card, the attempt and any `kickoffError`.
- **`settings.get` / `settings.update { projectId, preset?, wipLimits?, followSelection? }`**.
- **`models.list {}`** → `{ models }`, the host's `models()` — the models a new chat can use, as host facts
  — for the Start form's picker.

## Web half

**The Board side tool** is `ext:board:board` (title *Board*, `RiKanbanView2`, default side left): it waits
as a dimmed left-rail entry until opened, then lives in its own pane like Files. Its scope is the active
workspace's project; it re-reads `board.get` when that workspace changes, after each of its own writes and
on every `board.changed` for that project (`PanelHost.onEvent`), keeping the last board shown while a
re-read is in flight. Loading, empty (*No cards yet — create one or ask the agent to break work down*) and
error (with *Retry*) states replace the body; a failed write shows a dismissible notice.

- **Header**: the project's name, the preset switch (Agentic kanban / Solo → `settings.update`), the WIP
  figures (*Needs you*, *Review*, *Agents* as `count/limit`, `feedback-error` and `data-over` past the limit;
  a limit of 0 is none and shows the count alone), the view switch (Board / List), the Board mode toggle
  (*Board mode* / *Exit Board mode*, `PanelHost.layoutPreset`, absent on a host without modes), the board
  settings (a popover editing the three WIP limits, 0–99 → `settings.update { wipLimits }`) and *New card*,
  an inline title field → `card.create`, then the new card in Peek.
- **Inbox** ("Needs you · N · All projects"): under the header, the `inbox` query's cards of every open
  project, re-read on any project's `board.changed` (which the host service also publishes when a bound
  chat's state flips). A row names the project, the card id and title (a click peeks the card), the reason
  (*Question pending* / *Failed*, from the latest attempt's chat state) and *Answer* or *Retry*, both opening
  that attempt's chat (`PanelHost.openChat`) — Retry sends nothing. Chips that wrap when wide, a list when
  stacked; absent while nobody waits.
- **Adaptive by its own pane's width** (a `ResizeObserver`, `boardLayout`): from 720 px the columns sit side
  by side (`data-layout="columns"`), below that they stack into one list grouped by column (`stacked`).
  Canceled shows only while it holds cards. A column of Review cards only shows *WIP* `count/limit` against
  the Review limit, marked past it (Solo's Doing mixes started cards in and shows its count alone).
- **Triage** is a lane of its own at the board's start, not a column, present while it holds cards and
  collapsed to *Triage · N* by default. Expanded, it groups the cards by `origin.sessionId` (`triageGroups`:
  *Filed from TR-4's chat*, *Filed from a chat*, *Filed by an agent*), each group with *Accept all* →
  `triage.accept` with all its ids (a decomposition is accepted as a whole) and *Dismiss* (behind an inline
  confirm, `card.delete` each); a card shows its suggested size (`M?`), peeks on a click and has its own
  *Accept*.
- **A card** shows its id, type, size (a suggested one marked `M?`), title, the agent badge of its latest
  open attempt (`agentBadge`: working, waiting for you, failed — interrupted included —, finished, finished ·
  unread; `feedback-*` / `primary` tokens), the plan's progress, the diff, the PR chip and the cards
  blocking it. *Start* shows on a backlog or unstarted card with no open attempt and starts it with the
  size's workflow and the host's defaults; the host's toast reports a kickoff that failed. While Review or
  Needs you is past its limit (`attentionOverLimit`, Review first), Start asks inline instead — *Review is
  over its limit (6/5) — finish before starting?* with *Start anyway* / *Not now* — a warning, never a block.
- **Moving**: cards drag between columns with `@dnd-kit/core` (pointer within a column; a drag overlay) →
  `card.move`, the logged override. A card is a focusable button: Enter or a click peeks it, a double click
  enters its open attempt's workspace (`PanelHost.openWorkspace`), and the local commands
  `board.moveLeft` / `board.moveRight` (Alt+← / Alt+→ in scope `board.cards`, rebindable) move it one
  shown column, focus following the card.
- **List** view: one table (id, title, column, size, agent, plan, PR) sorted by column then rank, or by
  rank; a title peeks its card.

**The Needs-you status item** (`statusItems.inbox`) is the inbox in the topbar: a `feedback-warning` chip
*Needs you · N* over the same query and refreshes, absent at zero, whose popover lists the same rows (an
action closes it); a row peeks its card only with a workspace active.

**Board mode** (`layoutPresets.board`, *Board mode*) arranges the sides as one wide left side (0.6 of the
workbench): Projects in a folded pane, then the Board tool; the right side empty, so Peek shows the cards
there. The center and the bottom keep the chat and the terminals, and leaving restores the previous frame
([[submodule-web-shell]] § Layout modes). It is entered from the Board tool's header and the palette's
*Enter Board mode*, and left from the same button (*Exit Board mode*) or the palette.

**The card in Peek** is the `card` panel (scope `session`: it opens only from the board, with params
`{ projectId, cardId }`, the crumb named `<id> · <title>`). It reads `card.get` and re-reads on
`board.changed`:

- the title (saved on Enter or blur), type, size — a suggested size gets *Confirm size*, which re-saves it
  so it is no longer a suggestion —, the description, the acceptance criteria and spec refs (add / remove),
  the cards it blocks (picked from the board) and those blocking it;
- the attempts, each with its workflow, start time, live badge, plan, PR and notes, and *Open workspace* /
  *Open chat* while its workspace is open;
- **Start**: workflow (the size's by default: S, bugs and unsized → Implement; M / L → Brainstorm → build;
  re-derived when the size or type changes), model and effort (*Default* = the host's new-chat choice;
  `models.list`, the effort list narrowed to the model's levels), base (empty = the project's default) →
  `card.start`, showing a refusal or a returned `kickoffError`;
- the activity from the transitions, newest first (*Created in Backlog*, *Backlog → Ready by you* with the
  host's reason), and *Delete card* behind a confirm.

Its UI text is `board.*` keys.

## Agent tools

The tools come from `sessionExtensions`. A chat's own card is the one whose attempt holds its session
id, else the attempt of its workspace (located from its cwd).

- **`board_card_get { cardId? }`**: a card's text, by default the chat's own.
- **`board_cards_list { status? }`**: the chat's project's cards, by category.
- **`board_card_create { title, description?, acceptance?, type?, size? }`**: always into Triage, with
  `createdBy: agent` and the filing chat as its `origin` (with that chat's own card). A size given is marked
  suggested.
- **`board_link { cardId, blocks[] }`**: adds "blocks" links on one board.
- **`board_card_note { text }`**: appends a progress note to the chat's attempt.

Their guidelines say two things:

- Read your card and treat its criteria as done.
- File deferred work into Triage, never steps of the current task.

## Verification

- **Unit** (`server/*.test.ts`):
  - store round-trip, the move-aside, the newer-version refusal and the defaults;
  - prefixes and ids, the presets, the rule table (idempotence included) and the kickoff text;
  - query validation, create / update / move / delete / accept / start, overlays, WIP and inbox;
  - the rules wired to a fake host's events and Triage-only creation by the tools.
- **Host-level**: `packages/server/src/host/extensionEventsWire.test.ts` covers the gated
  `extension.event` push and the host service following the Settings switch.
- **Web** (`web/*.test.ts(x)`): the agent badge by overlay state, Start's offer and its defaults by size,
  the drop → `card.move` call, Alt+arrow steps, the list sort, the adaptive layout and the rendered tile,
  columns, list and empty board; the WIP math (over a limit, 0 as none, the Review column's limit, Start's
  warning order), Triage grouping by origin and the collapsed lane, the inbox's reply check and its rows'
  chat target, and the rendered inbox strip and Start warning.
- **No-agent e2e** (`e2e/board.spec.ts`): open the Board tool, create a card into Backlog, edit it in Peek,
  Start it (a worktree and a chat; the kickoff text captured from `workspace.creationChanged`, no model
  needed), the card in Building; a drag and Alt+→ logged as overrides; List view; the Solo preset; the
  extension switched off → the disabled placeholder in the same pane, through a reload; the inbox across two
  projects (cards seeded on attempts whose seeded chats hold a pending question or failed), the topbar
  counter and its popover, Answer entering the chat; Board mode entered from the header and left from the
  palette with the layout snapshot unchanged; a WIP limit edited to 1 and Review marked over it, with
  Start's warning; Triage's Accept all moving a seeded decomposition into Backlog.

## Deferrals

These land later:

- follow selection, and Start's WIP warning in the Peek card's Start form (only the tile warns);
- cost / time per card;
- task-spec and GitHub sources;
- a last-action fact, and the last action on a card;
- removing a "blocks" link from the tools;
- an initiative's `into` (D / G).
