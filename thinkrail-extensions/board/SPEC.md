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
a logged override. Besides its own cards it shows two **sources**: the task-specs of the project's
workspaces and, when switched on, the project's open GitHub issues through the user's own `gh`. There is no portable pi package, because every tool acts on host-owned state. The web
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
- **`settings.json`**: `{ version: 1, preset, wipLimits { needsYou, review, agents }, followSelection,
  github { enabled, filter } }`. The defaults are `agentic-kanban`, 3 / 5 / 3, off, and GitHub off with
  the `open` filter (`mine` is the issues assigned to the gh user).
- **`transitions.jsonl`**: an append-only log of `{ cardId, from, to, at, actor, reason }`.
  - `from` and `to` are `{ category, column }`, or `null` at creation or deletion.
  - `actor` is `human`, `agent`, `git` or `automation`.

Write rules:

- Writes are atomic (a temp file, then a rename).
- The host runs one board per process, so the store is the single writer. It keeps what it read in
  memory.
- A project id must be a plain folder name.
- The only other file is a PR body written for `gh pr edit --body-file` (`pr-<n>-body.md`), removed once
  gh ran.

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

- `id`, `source`, `title`, `description`, `acceptance[]`. The source is `{ kind: native, ref }` (the
  card's own id), `{ kind: task-spec, ref: <spec id>, workspaceId, path }` for an adopted task-spec, or
  `{ kind: github, ref: "#N", number, url }` for an issue's card; one missing what locates it reads as
  native;
- `type` (feature / bug / chore), `size?` (S / M / L) and `sizeSuggested?`;
- `labels[]`, `blocks[]` (the ids it blocks), `specRefs[]` and `rank`;
- `category` and `column`, `ownerHuman` (the local user) and `createdBy` (human / agent);
- `origin? { sessionId?, cardId? }`: on an agent's card the chat that filed it and the card that chat works
  on, by which Triage groups a decomposition; on a human's deferrals the card alone;
- `attempts[] { workspaceId, sessionId, workflow, startedAt, notes[], merged?, removedAt?, closesLinked? }`
  — an adopted workspace without a chat has `sessionId: ""` and follows the workspace's latest chat;
  `closesLinked` is the PR seen to carry the issue's `Closes #N`;
- `cancelPending?`, the question "cancel?" after an unmerged workspace went away.


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
- Every write publishes **`board.changed { projectId }`**, and so does a bound (or watched, § Sources)
  chat's `session.state` or workspace's review when its signature changes. The web side re-reads the
  board.
- A GitHub issue's card's open pull request gets its `Closes #N` check on that chain (§ Sources).

## Live overlay

Per request and per open attempt, `workspaceFacts` gives:

- the chat's `chatState`, unread and title;
- the plan's open / total;
- the workspace's diff and PR (number, state, url).

A removed attempt reads `open: false`. Cards also carry `blockedBy`, derived from the other cards'
`blocks`, and `taskSpecs[]` — `{ kind: "task-spec", workspaceId, id, title, status, path }` for every
task-spec of an open attempt's workspace, from the host's `taskSpecs` fact (any status), never stored.

**WIP** has three counts against the settings' limits, over the stored cards only (like the inbox):

- **Needs you**: active cards whose latest attempt is `needs_you`.
- **Review**: cards in review.
- **Agents**: active cards whose latest attempt is `working`.

The last action is **not shown yet**: the host reports no tool-level fact for it.

## Sources

A source's item the board has not stored is a **virtual** card in `board.get` (`virtual: true`, no
attempts, links or history), after the stored cards. Its id never parses as a card id, so it names no
stored card: `spec:<workspaceId>:<specId>` and `#N`.

**Task-specs** (`taskSpecs.ts`, pure, over the host's `taskSpecs(workspaceId)` fact):

- A workspace an attempt holds attaches its task-specs to that card (the overlay above).
- Every other open workspace of the project shows each of its open task-specs (neither `done` nor
  `deprecated`) as a card `source { kind: task-spec }`, placed by the board's own rules over its live
  facts (`liveCategory`): a merged PR → completed; no chat working, with a plan done or a non-empty diff
  → review; else started (the default workflow's column). Its live overlay follows the workspace's
  latest chat, so it badges like a card. The board remembers these workspaces (`watched`), so their
  chats' state and review changes publish `board.changed` too.
- **Adopt** (`card.adopt`) stores it as a human's card bound to that workspace: the spec's title, the
  source, `specRefs: [id]`, an attempt `{ workspaceId, sessionId: the latest chat's or "", workflow:
  implement }`, placed where it showed and logged *adopted from the task-spec <id>*. The workspace is
  then bound, so its other task-specs attach to that card, and adopting again (or another task-spec of
  the same workspace) answers the same card: no duplicate. A task-spec's card refuses every other write.
- **Deferrals → Triage** (`card.deferrals { cardId, specId }`): the spec must be one of the card's
  `taskSpecs`. The host's `specSection(workspaceId, specId, "Deferrals")` fact gives the section text —
  never a general file read —, and `parseDeferrals` takes its top-level bullets (`-`, `*`, `+`, `1.`),
  their indented or continued lines as the description; a checked item, `none`/`n/a`, a heading or a
  repeated title is no deferral, and a title past 300 characters keeps its whole text in the
  description. They land in Triage as the human's cards with `origin { cardId }`, one write; a bullet
  whose title a card already filed from that card carries is skipped, so sending again only adds the
  new ones.

**GitHub issues** (`github.ts`), off by default, only ever through the user's `gh`:

- **`github.set { projectId, enabled?, filter? }`** switches the source. Switching it on first asks the
  host's `githubProblem()` (the github module's `gh auth status` probe); `missing` or `unauthenticated`
  answers `{ problem }` and changes nothing, for the web half to explain.
- The issues are `gh issue list --state open --limit 100 --json
  number,title,body,labels,url,assignees,updatedAt` (`--assignee @me` for `mine`) through
  `actions.runInWorkspace` in the project's **Default** workspace, argv only. `IssueCache` keeps each
  project's list for a **5-minute TTL from the last attempt**: a read never waits (a stale or missing
  list refreshes behind it, one fetch in flight per project, `board.changed` when it landed), and
  **`github.refresh { projectId }`** fetches now and answers the status. A failed fetch keeps the last
  good issues beside its `error` (gh's first line, a timeout, a non-list answer); `board.get` carries
  `github { enabled, filter, loading, fetchedAt, error }`.
- Each open issue no stored card links is a virtual Backlog card `#N` (`source { kind: github }`, the
  issue's title, body and label names; a `bug` label makes it a bug). **Starting, editing or moving it
  stores it first** (`card.update`, `card.move`, `card.start` take the `projectId` of an unstored
  issue's board) as a human's card linked to the issue, logged *created from GitHub issue #N*, so its
  board state persists; it can't be deleted while the issue is open. An issue that closed leaves the
  list; a stored card follows the normal PR-merged rule.
- Start's kickoff adds `GitHub issue #N: <url>` and that the PR's description must contain `Closes #N`.
  When a bound workspace's open pull request appears (`workspace.updated`), the host service reads its
  body (`gh pr view <n> --json body`) and, when no closing keyword (`close[sd]`, `fix(e[sd])`,
  `resolve[sd]`, `owner/repo#N` included) names the issue, appends `Closes #N` with `gh pr edit <n>
  --body-file <tmp>`. It edits the PR's body only — never an issue's labels, state or project fields.
  A PR seen to carry it is recorded on the attempt (`closesLinked`), so it runs once per PR; a failure is
  logged and retried after five minutes, not on every review refresh.

## Size suggestions

`sizing.ts`: a human's card with no size, or still the board's own suggestion, gets one from the
host's `actions.assist` (the host's one-shot model through pi; `SIZE_MAX_TOKENS` 16), asked with the
S / M / L scale and the card's type, title, description and criteria.

- It is asked when a human creates a card without a size, when a GitHub issue's card is stored without
  one, for adopted and deferred cards, and when the title, description, criteria or type of a card that
  still wants one changes. An agent's card (`board_card_create`) keeps the agent's suggested size and is
  never asked about.
- `parseSize` takes only a whole answer of one letter S, M or L (case, quotes, emphasis and a period
  aside); anything else is no answer. The size is stored with `sizeSuggested: true` and no transition.
- **A human's size is never overwritten**: the card is re-read before the write and skipped once a
  human set its size (an edited size is no longer a suggestion), and a completed or canceled card is
  never asked about.
- `SizeQueue` rate-limits per card: a request waits 1.5 s and a later one restarts the wait, one ask runs
  at a time and a request during it runs once more after it. Nothing starts once the services' `signal`
  aborted. No model (`null`), a switched-off extension or a failed ask is skipped silently; another
  error is logged.

## Queries

Every query validates its params (lengths, enums, lists of at most 100) and answers JSON.

- **`board.get { projectId }`** → `{ projectId, projectName, prefix, settings, columns, cards, wip }`,
  each card with its `live[]`. It refuses a project that is not an open repository.
- **`inbox {}`** → the active cards across the open projects whose latest attempt is `needs_you` or
  `failed`, with project and reason; an `interrupted` run (a stop, a host restart) reads as `failed`, as the
  card's badge does, since the card is stalled either way.
- **`card.get { cardId, projectId? }`** → the card with its live overlay, its project and its transitions,
  for the Peek card; a virtual card answers itself with no transitions, and one stored meanwhile (adopted,
  an issue started or edited) answers as the stored card. `#N` needs the `projectId`.
- **`card.create { projectId, title, description?, acceptance?, type?, size?, labels?, specRefs?,
  column? }`**: a human's card, in Backlog by default.
- **`card.update { cardId, projectId?, …, size: null clears, blocks, cancelPending: false dismisses }`**.
  An edited size is no longer a suggestion. `blocks` must name other cards of the same board.
- **`card.move { cardId, projectId?, column, rank? }`**: an override, logged.
- **`card.delete { cardId }`**: the card leaves the other cards' `blocks` too.
- **`triage.accept { cardIds }`** moves the cards to Backlog as a whole. It moves nothing unless every
  card is in Triage on one board.
- **`card.start { cardId, projectId?, workflow?, model?, thinkingLevel?, baseRef? }`**:
  - It refuses a Triage card and a card already starting.
  - The workflow is the size's (S, a bug or no size → `implement`; M / L → `brainstorm`) unless one is
    named.
  - The kickoff is `Card <id>: <title>`, then the description, the acceptance criteria and the specs.
  - A brainstorm kickoff is prefixed `/skill:brainstorming `, exactly as the composer sends a picked
    skill, so pi expands it.
  - It calls `actions.createWorkspace` and then records the attempt and applies Start. It answers the
    card, the attempt and any `kickoffError`.
- **`card.adopt { cardId }`**, **`card.deferrals { cardId, specId }`** → `{ created, skipped }`,
  **`github.set`** → `{ settings, problem }` and **`github.refresh`**: see § Sources.
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
  an inline title field → `card.create`, then the new card in Peek. The GitHub menu (`RiGithubLine`,
  *GitHub issues*) offers *Show GitHub issues* / *Hide GitHub issues* (`github.set`; a `missing` or
  `unauthenticated` gh answers with the notice saying to install gh or run `gh auth login`), and while on
  the filter (*All open issues* / *Assigned to me*) and *Refresh issues* (`github.refresh`).
- **GitHub banner**: a failed fetch shows *Couldn't fetch GitHub issues: <gh's line>* under the inbox with
  *Refresh issues* and *Dismiss* (until the error changes); the board and the last good issues stay.
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
  `triage.accept` with all its ids (a decomposition is accepted as a whole; a card's sent deferrals group
  as *Deferred from TR-4*) and *Dismiss* (behind an inline
  confirm, `card.delete` each); a card shows its suggested size (`M?`), peeks on a click and has its own
  *Accept*.
- **A card** shows its id (a task-spec's card its spec's id, an issue's `#N`), its source badge (*Task-spec* /
  *GitHub*, `data-source`), type, size (a suggested one marked `M?`), title, its task-specs with their
  status (`draft`, `active`, `stale`, `done`), the agent badge of its latest
  open attempt (`agentBadge`: working, waiting for you, failed — interrupted included —, finished, finished ·
  unread; `feedback-*` / `primary` tokens), the plan's progress, the diff, the PR chip and the cards
  blocking it. An unbound workspace's task-spec card shows its status and *Adopt* (`card.adopt`) and never
  drags. *Start* shows on a backlog or unstarted card with no open attempt — an unstored issue's card
  included, which Start stores — and starts it with the size's workflow and the host's defaults; the host's toast reports a kickoff that failed. While Review or
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

- the title (saved on Enter or blur), an issue's card's link (*Issue #N on GitHub*, saying an unstored one
  is kept by an edit or Start), type, size — a suggested size gets *Confirm size*, which re-saves it so it
  is no longer a suggestion —, the description, the acceptance criteria and spec refs (add / remove), the
  cards it blocks (picked from the board) and those blocking it. Its writes go to the id `card.get`
  answered, so an issue's card stored by the first edit takes the next ones;
- **Task-specs**: each of the card's task-specs with its status and path. *Open* shows the file in Peek
  (`PanelHost.peek({ kind: "file" })`) when it is in the panel's workspace; Peek entries are
  workspace-relative and belong to one workspace, so another workspace's is *Open in its workspace*
  (`PanelHost.openFile`, which enters that workspace and opens the file in a tab). A stored card's
  *Send deferrals to Triage* (`card.deferrals`) reports *Filed N deferrals into Triage* or *No new
  deferrals*;
- an unbound workspace's task-spec card instead shows its title, column and live line, its task-spec and
  *Adopt*, after which the panel shows the stored card, and *Open workspace*;
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

- **`board_card_get { cardId? }`**: a card's text, by default the chat's own, with its GitHub issue (and
  that its PR must say `Closes #N`) or its task-spec.
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
  - the rules wired to a fake host's events and Triage-only creation by the tools;
  - the sources (`sources.test.ts`): task-specs bound vs unbound, placement by live facts, Adopt once,
    refused writes, watched chats, deferrals sent once and their parsing; GitHub through a fake `gh`
    (argv, the Default workspace, the TTL, Refresh, the filter, the error kept beside the last issues,
    storing on edit / move / start, the kickoff, `Closes #N` appended only when missing, the PR body only,
    the retry); size suggestions (strict parsing, a human's size never overwritten, skipped without a
    model or switched off or for an agent's card, the debounce, issues' cards).
- **Host-level**: `packages/server/src/host/extensionEventsWire.test.ts` covers the gated
  `extension.event` push and the host service following the Settings switch.
- **Web** (`web/*.test.ts(x)`): the agent badge by overlay state, Start's offer and its defaults by size,
  the drop → `card.move` call, Alt+arrow steps, the list sort, the adaptive layout and the rendered tile,
  columns, list and empty board; the source badges, Adopt and Start by source, the task-spec panel's Open
  targets and Send deferrals, the GitHub menu and banner, and deferral groups in Triage; the WIP math (over a limit, 0 as none, the Review column's limit, Start's
  warning order), Triage grouping by origin and the collapsed lane, the inbox's reply check and its rows'
  chat target, and the rendered inbox strip and Start warning.
- **No-agent e2e** (`e2e/board.spec.ts`): open the Board tool, create a card into Backlog, edit it in Peek,
  Start it (a worktree and a chat; the kickoff text captured from `workspace.creationChanged`, no model
  needed), the card in Building; a drag and Alt+→ logged as overrides; List view; the Solo preset; the
  extension switched off → the disabled placeholder in the same pane, through a reload; an unbound
  workspace's `.thinkrail/context/TASK-x.md` as a task-spec card in Building, Adopt making it one stored
  card, its deferrals sent into Triage once; Show GitHub issues through the lane's fake `gh` (the failure
  banner before the scenario exists, Refresh, the open issues in Backlog, the logged argv, an edit storing
  the card, Hide); the inbox across two
  projects (cards seeded on attempts whose seeded chats hold a pending question or failed), the topbar
  counter and its popover, Answer entering the chat; Board mode entered from the header and left from the
  palette with the layout snapshot unchanged; a WIP limit edited to 1 and Review marked over it, with
  Start's warning; Triage's Accept all moving a seeded decomposition into Backlog.

## Deferrals

These land later:

- follow selection, and Start's WIP warning in the Peek card's Start form (only the tile warns);
- cost / time per card;
- live re-reads when a task-spec file changes (the host pushes no file events to extensions; the board
  re-reads on its own writes, chat and review changes and workspace switches);
- a task-spec committed to the branch shows in every unbound workspace that has it;
- a last-action fact, and the last action on a card;
- removing a "blocks" link from the tools;
- an initiative's `into` (D / G).
