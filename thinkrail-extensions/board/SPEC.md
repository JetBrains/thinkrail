---
id: module-ext-board
type: module-design
status: draft
title: Board extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api]
references: [task-board-core, task-project-board, submodule-server-extensions, submodule-server-host, module-contracts]
---

## Responsibility

A board per project whose cards launch agent work and follow it. **The column is the work status**: a
preset names the columns over fixed categories. **The agent's state is live**, computed per request
from host facts and never stored. **Host events move cards** through pure rules, and a human's move is
a logged override. There is no portable pi package, because every tool acts on host-owned state. This
slice is the server half; the panel, the inbox status item and Board mode are the web half's.

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
- **`./web`**: a bare `defineWebExtension({ name: "board" })` stub. It stays out of the web registry
  until the panel lands, so it renders nothing.

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
  `failed`, with project and reason.
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

## Agent tools

The tools come from `sessionExtensions`. A chat's own card is the one whose attempt holds its session
id, else the attempt of its workspace (located from its cwd).

- **`board_card_get { cardId? }`**: a card's text, by default the chat's own.
- **`board_cards_list { status? }`**: the chat's project's cards, by category.
- **`board_card_create { title, description?, acceptance?, type?, size? }`**: always into Triage, with
  `createdBy: agent`. A size given is marked suggested.
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

## Deferrals

These land later:

- the web half (panel, Peek card, inbox counter, Board mode);
- task-spec and GitHub sources;
- a last-action fact;
- removing a "blocks" link from the tools;
- an initiative's `into` (D / G).
