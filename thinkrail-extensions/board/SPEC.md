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
workspaces and, when switched on, the project's open GitHub issues through the user's own `gh`. Above the cards sits a **roadmap** per board (§ Roadmap): initiatives, roadmap projects
with milestones, and what is derived from the live work — rollups, a forecast, a suggested health and the
step graph's schedule. There is no portable pi package, because every tool acts on host-owned state. The web
half is the Board side tool (with its Roadmap views), the card and the initiative in Peek, the cross-project
"Needs you" inbox (above the board and as a topbar counter) and Board mode.

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
- **`./web`**: `defineWebExtension({ name: "board", title, sideTools: { board }, panels: { card, initiative },
  statusItems: { inbox }, layoutPresets: { board }, commands, shortcuts })`, in the web registry.
  - It imports `extension-api/web`, `contracts` types, `locales`, `ui`, React and `@dnd-kit/core`, never its
    `./server` half: the wire shapes it reads are restated in `web/api.ts` (the roadmap's in
    `web/roadmapApi.ts`) and checked on arrival (an unknown shape is a `BoardReplyError`, a version skew), and
    `workflowFor` mirrors the server's size rule for the Start form's default.
  - It reaches the host only through its `PanelHost`.

## Store

The store lives at `<dataDir>/<projectId>/`, the extension's data folder (`~/.thinkrail/extensions/board/`):

- **`cards.json`**: `{ version: 2, prefix, nextNumber, cards }`. Version 2 renamed a card's roadmap project
  from `projectId` to `roadmapProjectId`, so `projectId` always names a ThinkRail project: a version-1 file is
  read with the old name (**migrated on read**) and written back as version 2. The other files are version 1.
- **`settings.json`**: `{ version: 1, preset, wipLimits { needsYou, review, agents }, followSelection,
  github { enabled, filter } }`. The defaults are `agentic-kanban`, 3 / 5 / 3, off, and GitHub off with
  the `open` filter (`mine` is the issues assigned to the gh user).
- **`transitions.jsonl`**: an append-only log of `{ cardId, from, to, at, actor, reason }`.
  - `from` and `to` are `{ category, column }`, or `null` at creation or deletion.
  - `actor` is `human`, `agent`, `git` or `automation`.
- **`initiatives.json`**: `{ version: 1, nextNumber, nextUpdateNumber, initiatives }`, ids `I-n` and updates'
  `U-n`, sequential per board and never reused (§ Roadmap).
- **`projects.json`**: `{ version: 1, nextNumber, nextMilestoneNumber, projects }`, ids `P-n` and milestones'
  `M-n`, likewise.

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
- **Unreadable cards** (and initiatives, projects) are dropped with a warning. Missing fields take defaults;
  a malformed roadmap field (a date that is not `YYYY-MM-DD`, a non-positive number, a milestone without a
  project) is dropped.

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
- `cancelPending?`, the question "cancel?" after an unmerged workspace went away;
- the roadmap's `roadmapProjectId?` (a roadmap project `P-n` of its board; `projectId` is always a ThinkRail
  project, on a card, in `card.assignProject` and in the tools alike), `milestoneId?` (one of that project's),
  `pinnedStart?` (an ISO date) and `estimateDays?` (absent: S 1, M 3, L 6; unsized counts as M).


## Roadmap

The model of `TASK-roadmap` (Linear's hierarchy), stored per board; everything derived is computed per
`roadmap.get` and never stored.

- **An initiative** is `{ id, parentId?, title, outcome, criteria[], horizon (now / next / later), rank,
  target? (ISO date), appetiteDays? (time only), specRefs[], health? { override?, note? }, updates[],
  cardIds[], externalCards[], proposed?, proposedBy?, createdAt, updatedAt }`. It nests (a top-level one is
  a goal; a parent can't move under its own subtree). It holds this board's cards listed in `cardIds`, the
  cards of the roadmap projects whose `initiativeId` is it, other boards' cards as `externalCards
  { projectId, cardId }` and, for every derivation, its nested initiatives' cards.
- **An update** is `{ id, at, text, health, publishedAt? }`: one draft (no `publishedAt`) at a time, which a
  save replaces and a human's publish stamps. An agent only ever saves.
- **A roadmap project** is `{ id, initiativeId?, title, milestones[{ id, title, target? }], proposed?,
  proposedBy?, … }`; a card belongs to at most one.
- **An agent's proposal** (`proposed: true, proposedBy: "agent"`) is accepted by `proposed: false`, which
  keeps `proposedBy`.
- Deleting an initiative moves its nested ones to its parent and frees its projects; deleting a project or a
  milestone frees its cards; deleting a card drops it from every board's initiatives.

**Derivations** are pure modules, each with its own tests:

- **`rollups.ts`**: per initiative, project and milestone — cards by category, size points (S 1, M 2, L 4;
  canceled left out) total and completed, the active cards' agents (`working`, `waiting` = `needs_you`,
  `failed` = failed or interrupted, from the latest attempt's chat), blocked cards (active, with a blocker
  neither completed nor canceled) and time spent (every span in started, until now when still open).
- **`throughput.ts`**: a card's completion is its last move into completed unless it left again (a deletion
  keeps it); weekly throughput counts and weighs completions per whole ISO week (Monday UTC) from the log's
  first week to the week before now's; cycle time runs from the first start to the completion. Fewer than
  `MIN_HISTORY_WEEKS` (3) weeks or no completion in them is **not enough data**.
- **`forecast.ts`**: Monte Carlo over the board's weekly points, `FORECAST_TRIALS` (2000) trials, each drawing
  weeks until the remaining points are covered (capped at 520 weeks); the 50 % and 85 % trials' week counts
  from today are the dates. The RNG (mulberry32) is seeded with FNV-1a of `projectId:initiativeId` and the
  data, so a forecast is stable until the data changes. Statuses: `ok`, `done` (nothing remains) and
  `insufficient` (`no-scope`, `history`, `no-completions`); every answer carries its `inputs`.
- **`health.ts`**: reasons `{ kind, level, … }` the web words through locale keys — `forecast_late` (85 %
  past the target: at risk, off track past a quarter of the span from the initiative's creation to the
  target), `blocked` (a critical card blocked while Ready, started or in review), `waiting` (a wait for the
  human older than 24 h on the critical path, aged from the chat's last update), `review_wip` (Review over
  its limit with this initiative's card in it), `failed`, `appetite` (time spent past 80 %). The worst level
  wins; a human's `override` is the `effective` health, the suggestion and its reasons stay visible.
- **`schedule.ts`**, the step graph (the prototype's pass): nodes are the board's cards (canceled left out)
  and every roadmap project's milestones, zero-length after their cards; edges are `blocks`. A card not
  started starts at its pin, else when its blockers end, not before today; a started (or review) card at
  its latest start and ends after its estimate, not before today; a completed card keeps its actual span.
  The backward pass from the latest end gives `slack` and `critical`; a pin before its blockers' end is a
  `conflict` (node and link); a milestone past its target day is `late`. Days are days since 1970-01-01 UTC,
  fractional; nodes come in topological order. A cycle in stored data is cut at one link and reported in
  `cycles`; `criticalWithin` gives an initiative's own critical path over its cards and milestones.
- **Links never close a cycle**: `card.link`, `card.update { blocks }`, `board_link` and a batch's
  `blocksIndex` refuse one (`wouldCycle`).

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
- A bound (or watched) chat's tool start (`agent.tool`) publishes it too, **throttled per project**: at
  once, then at most once per `ACTION_REFRESH_MS` (2 s) while starts keep coming, the last one included, so
  a card's last action follows the agent without a re-read per tool. Stopping the service drops the timers.
- A project opening or closing (`project.opened` / `project.closed`) publishes it for that project, so the
  inbox, which lists the open projects' cards, re-reads.
- A GitHub issue's card's open pull request gets its `Closes #N` check on that chain (§ Sources).

## Live overlay

Per request and per open attempt, `workspaceFacts` gives:

- the chat's `chatState`, unread and title, and its `lastAction` (`{ tool, target?, at }`, the host's
  record of its latest tool start — never read from the transcript), carried as `chat.lastAction`;
- the plan's open / total;
- the workspace's diff and PR (number, state, url).

A removed attempt reads `open: false`. Cards also carry `blockedBy`, derived from the other cards'
`blocks`, `initiative? { projectId, id, title, outcome }` — the initiative it serves, the one its kickoff
names (`Roadmap.initiativesOf`, once per board read: its roadmap project's, else its board's first by rank
listing it, else another board's listing it as an external card) — and `taskSpecs[]` — `{ kind: "task-spec", workspaceId, id, title, status, path }` for every
task-spec of an open attempt's workspace, from the host's `taskSpecs` fact (any status), never stored.

**WIP** has three counts against the settings' limits, over the stored cards only (like the inbox):

- **Needs you**: active cards whose latest attempt is `needs_you`.
- **Review**: cards in review.
- **Agents**: active cards whose latest attempt is `working`.


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
- **`card.update { cardId, projectId?, …, size: null clears, blocks, cancelPending: false dismisses,
  estimateDays: null clears }`**. An edited size is no longer a suggestion. `blocks` must name other cards of
  the same board and close no cycle.
- **`card.move { cardId, projectId?, column, rank? }`**: an override, logged.
- **`card.delete { cardId }`**: the card leaves the other cards' `blocks` too.
- **`triage.accept { cardIds }`** moves the cards to Backlog as a whole. It moves nothing unless every
  card is in Triage on one board.
- **`card.start { cardId, projectId?, workflow?, model?, thinkingLevel?, baseRef? }`**:
  - It refuses a Triage card and a card already starting.
  - The workflow is the size's (S, a bug or no size → `implement`; M / L → `brainstorm`) unless one is
    named.
  - The kickoff is `Card <id>: <title>`, then the description, the acceptance criteria and the specs, then
    the card's initiative (`Initiative <id>: <title>`, its outcome and success criteria) and its project and
    milestone. The initiative is the card's project's, else one of its board's listing it, else one on
    another board listing it as an external card.
  - A brainstorm kickoff is prefixed `/skill:brainstorming `, exactly as the composer sends a picked
    skill, so pi expands it.
  - It calls `actions.createWorkspace` and then records the attempt and applies Start. It answers the
    card, the attempt and any `kickoffError`.
- **`card.adopt { cardId }`**, **`card.deferrals { cardId, specId }`** → `{ created, skipped }`,
  **`github.set`** → `{ settings, problem }` and **`github.refresh`**: see § Sources.
- **`settings.get` / `settings.update { projectId, preset?, wipLimits?, followSelection? }`**.
- **`models.list {}`** → `{ models }`, the host's `models()` — the models a new chat can use, as host facts
  — for the Start form's picker.

The roadmap's queries (§ Roadmap) take the board's `projectId`; every write publishes `board.changed`:

- **`roadmap.chat { projectId, kind, initiativeId? }`** (`kind`: `plan`, `shape`, `report` or `review`; the
  first three need the initiative) starts a **roadmap chat**: a new chat in the project's **Default** workspace
  through the host's `actions.startChat`, and answers `{ projectId, workspaceId, sessionId, kickoff,
  kickoffError? }` for the web half to open it. The kickoff (`roadmapKickoff`) starts with the skill's
  `/skill:roadmap-plan` (`-shape`, `-report`, `-review`), exactly as the composer sends a picked skill, then the
  task in one line, the initiative's id, title, outcome, success criteria, horizon, target and appetite (a
  review lists every initiative instead), and instructions that stand on their own — which `board_*` tools to
  read and write with, what to propose rather than change —, since pi passes an unknown skill through: the
  prompt works before the skills ship and after.
- **`roadmap.get { projectId }`** → `{ projectId, projectName, initiatives` (depth-first, each with `depth`,
  `childIds`, `memberCardIds`, `memberExternalCards`)`, projects, externalCards` (title, category, size,
  project name, or `missing`)`, rollups { initiatives, projects, milestones }, health, forecast` (by
  initiative id)`, schedule, critical` (each initiative's critical node ids)`, throughput, cycleTimes,
  insufficientData { throughput, initiatives } }`.
- **`initiative.create { projectId, title, outcome?, criteria?, horizon? (later), parentId?, target?,
  appetiteDays?, specRefs? }`**, **`initiative.update { projectId, initiativeId, …, parentId / target /
  appetiteDays: null clears, health { override?, note? } (null clears each), proposed: false accepts }`**,
  **`initiative.delete`**, **`initiative.move { projectId, initiativeId, horizon, rank? }`**.
- **`initiative.addCards` / `initiative.removeCards { projectId, initiativeId, cardIds }`**: card ids name
  one card across boards, so another board's card becomes an external card.
- **`initiative.updateDraft.save { projectId, initiativeId, text, health }`** and
  **`initiative.updateDraft.publish { projectId, initiativeId, text?, health? }`** (without a draft, `text`
  makes one).
- **`project.create { projectId, title, initiativeId?, milestones? }`**, **`project.update { projectId,
  roadmapProjectId, title?, initiativeId? (null frees), proposed: false }`**, **`project.delete`**;
  **`milestone.create { projectId, roadmapProjectId, title, target? }`**, **`milestone.update { projectId,
  milestoneId, title?, target? (null clears) }`**, **`milestone.delete`**.
- **`card.assignProject { cardId, roadmapProjectId?, milestoneId? }`** (a milestone alone names its project,
  `null` takes the card out), **`card.link` / `card.unlink { from, to }`** ("from blocks
  to"), **`card.pin { cardId, start }`** / **`card.unpin`** (only a card not started yet: Triage, Backlog,
  Ready) and **`card.shiftChain { cardId, days }`**: pins the card at its planned start + `days` and moves
  every pinned card it blocks, transitively, by the same; unpinned dependents follow by themselves and
  started ones keep their actual start.

## Web half

**The Board side tool** is `ext:board:board` (title *Board*, `RiKanbanView2`, default side left): it waits
as a dimmed left-rail entry until opened, then lives in its own pane like Files. Its scope is the active
workspace's project; it re-reads `board.get` when that workspace changes, after each of its own writes and
on every `board.changed` for that project (`PanelHost.onEvent`), keeping the last board shown while a
re-read is in flight. Loading, empty (*No cards yet — create one or ask the agent to break work down*) and
error (with *Retry*) states replace the body; a failed write shows a dismissible notice.

- **Header**: the project's name, the preset switch (Agentic kanban / Solo → `settings.update`), the WIP
  figures (*Needs you*, *Review*, *Agents* as `count/limit`, `feedback-error` and `data-over` past the limit;
  a limit of 0 is none and shows the count alone), the view switch (Board / List / Roadmap), the Board mode toggle
  (*Board mode* / *Exit Board mode*, `PanelHost.layoutPreset`, absent on a host without modes), the board
  settings (a popover with the *Follow selection* switch and the three WIP limits, 0–99 →
  `settings.update { wipLimits }` on *Save*) and *New card*,
  an inline title field → `card.create`, then the new card in Peek. The GitHub menu (`RiGithubLine`,
  *GitHub issues*) offers *Show GitHub issues* / *Hide GitHub issues* (`github.set`; a `missing` or
  `unauthenticated` gh answers with the notice saying to install gh or run `gh auth login`), and while on
  the filter (*All open issues* / *Assigned to me*) and *Refresh issues* (`github.refresh`).
- **GitHub banner**: a failed fetch shows *Couldn't fetch GitHub issues: <gh's line>* under the inbox with
  *Refresh issues* and *Dismiss* (until the error changes); the board and the last good issues stay.
- **Inbox** ("Needs you · N · All projects"): under the header, the `inbox` query's cards of every open
  project, re-read on any project's `board.changed` (which the host service also publishes when a bound
  chat's state flips and when a project opens or closes). A row names the project, the card id and title (a click peeks the card), the reason
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
  unread; `feedback-*` / `primary` tokens) with, under it while the agent works (`workingAction`), its last
  action — the tool and its target on one line, `tr-code-text-small`, cut with an ellipsis, the whole in its
  tooltip —, the plan's progress, the diff, the PR chip and the cards
  blocking it. An unbound workspace's task-spec card shows its status and *Adopt* (`card.adopt`) and never
  drags. *Start* shows on a backlog or unstarted card with no open attempt — an unstored issue's card
  included, which Start stores — and starts it with the size's workflow and the host's defaults; the host's toast reports a kickoff that failed. While Review or
  Needs you is past its limit (`attentionOverLimit`, Review first), Start asks inline instead — *Review is
  over its limit (6/5) — finish before starting?* with *Start anyway* / *Not now* — a warning, never a block.
- **Moving**: cards drag between columns with `@dnd-kit/core` (pointer within a column; a drag overlay) →
  `card.move`, the logged override. A card is a focusable button: Enter or a click peeks it (`selectCard`),
  a double click enters its open attempt's workspace (`enterCard` → `PanelHost.openWorkspace`, on its chat
  when it has one). With **follow selection** on, a click on a card with an open attempt also enters that
  workspace, the card shown in *its* Peek (`openWorkspace`'s `peek`, since Peek belongs to a workspace); a
  card without one only peeks. It is off by default and switched in the board settings popover
  (*Follow selection*, applied at once → `settings.update { followSelection }`). The local commands
  `board.moveLeft` / `board.moveRight` (Alt+← / Alt+→ in scope `board.cards`, rebindable) move it one
  shown column, focus following the card.
- **List** view: one table (id, title, column, size, agent, plan, PR) sorted by column then rank, or by
  rank; a title peeks its card.
- **A tile's initiative chip** (`RiFlag2Line` and the title, from the card's `initiative` overlay) says which
  initiative the card serves.

**The Roadmap view** (`RoadmapPane`) reads `roadmap.get` for the same project and re-reads it on its own
writes and every `board.changed`; it does not depend on the board having cards. Its sub-switch is *Now /
Next / Later* and *Goals* (the Timeline and the step graph come with D3, Insights with D4; no disabled tabs),
beside *Roadmap review* (a `review` roadmap chat). The derivations it draws are pure (`web/roadmapApi.ts`):

- **Now / Next / Later** (`horizonColumns`): three horizon columns (side by side from 720 px, else stacked)
  holding every initiative, top-level and nested, by rank. A card shows its goal chip (the top-level
  ancestor's title; *Goal* on a top-level one), the parent as a crumb when it is not the goal, the title, the
  health chip (the effective health, marked *suggested* unless a human overrode it), the **stack bar**
  (`rollupBar`: done, review, started, ready, backlog — `feedback-success`, `feedback-info`, `series-3`,
  `text-muted`, `text-subtle` fills in an SVG — Triage and Canceled left out) with *x/y cards · n %* (done
  of those, rounded) and *Triage N*, agent dots (a spinner per working agent, `feedback-warning` waiting,
  `feedback-error` failed, with their counts), *N blocked*, the appetite used (*1.5 of 10 days*, warning past
  80 %) and the dependency hint (`initiativeDependencies`: *After “X”* when a card of X blocks one of its
  cards; a card counts for the deepest initiative holding it, and relatives never wait for each other).
  An initiative drags between horizons with `@dnd-kit/core` (`horizonMove` → `initiative.move`); each column's
  *Initiative* opens an inline title field → `initiative.create { horizon }`, then the new one in Peek. An
  agent's proposal is dashed and marked *Proposed*, with *Accept* (`initiative.update { proposed: false }`)
  and *Discard* (`initiative.delete`). A click opens the initiative in Peek.
- **Goals** (`goalGroups`): each top-level initiative as a group — its title, its spec refs as chips (a
  goal-and-requirements capability, say), its figures and health — listing its descendants in tree order,
  each with its horizon chip, stack bar, percent and health.

**The initiative in Peek** is the `initiative` panel (scope `session`, params `{ projectId, initiativeId }`,
the crumb `<id> · <title>`). It reads `roadmap.get` and `board.get` for that board and re-reads both on its
writes and `board.changed`:

- the id, horizon, health and *Proposed* (with *Accept* / *Discard*), the title, then the horizon, target
  date and appetite days (empty clears) and the parent (any initiative outside its subtree, or none), the
  outcome, the success criteria and the spec refs (add / remove; the Goals view's chips) →
  `initiative.update`;
- **Progress**: the stack bar and its legend by category (Triage aside);
- **Health**: the chip, the suggestion when overridden, the reasons worded from their kinds (*Waiting for you
  over a day on the critical path: TR-1*, the late 85 % forecast against the target, …), the human's override
  (*Use the suggestion* clears it) and note → `initiative.update { health }`;
- **Agents now**: the member cards whose agent works, waits or failed, with the last action while working
  and *Answer* / *Open chat* (`PanelHost.openChat`);
- **Forecast and appetite**: the target, the 50 % / 85 % dates — or *Not enough data — needs ≥3 weeks of
  history* with its reason (`no-scope`, `history`, `no-completions`) —, *Nothing left to do*, and the appetite
  bar;
- **Projects and milestones**: each of its roadmap projects (rename, delete behind a confirm, its stack bar),
  their milestones (rename, target, delete, add) and a picker putting a board card into the project
  (`card.assignProject`); *Add a project* → `project.create { initiativeId }`;
- **Cards**: its member cards with column and live badge, other boards' labelled *From <project>*; the
  directly listed ones can be removed, and a picker adds a board card (`initiative.addCards` /
  `removeCards`);
- **Agent**: *Plan with agent*, *Shape with agent*, *Draft update* and *Roadmap review* — each a roadmap chat
  (`roadmap.chat`) opened with `PanelHost.openChat`; a returned `kickoffError` is shown as the prompt not sent —
  and the draft update when there is one, with *Publish* (`initiative.updateDraft.publish`) and *Edit* (its
  text and health → `initiative.updateDraft.save`);
- *Delete initiative* behind a confirm.

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
  is no longer a suggestion —, a stored card's **Roadmap** (`CardRoadmap`, over its board's `roadmap.get`):
  its initiative's id, title (opening it in Peek) and outcome, and the *Initiative*, *Project* and *Milestone*
  selectors — an initiative moves it off those listing it directly onto the picked one (`setCardInitiative`:
  `initiative.removeCards` / `addCards`) and is fixed by a roadmap project that has one, the project and the
  milestone → `card.assignProject` —, the description, the acceptance criteria and spec refs (add / remove), the
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
- the attempts, each with its workflow, start time, live badge, chat title and last action (while the chat's
  session is live, working or not), plan, PR and notes, and *Open workspace* / *Open chat* while its
  workspace is open;
- **Start**: workflow (the size's by default: S, bugs and unsized → Implement; M / L → Brainstorm → build;
  re-derived when the size or type changes), model and effort (*Default* = the host's new-chat choice;
  `models.list`, the effort list narrowed to the model's levels), base (empty = the project's default) →
  `card.start`, showing a refusal or a returned `kickoffError`. Past a human-attention limit it asks the
  tile's question in place of its button (`attentionWarning` over the panel's one `board.get`, which the
  blocks picker shares; Start waits while that read loads and does not ask when it failed);
- the activity from the transitions, newest first (*Created in Backlog*, *Backlog → Ready by you* with the
  host's reason), and *Delete card* behind a confirm.

Its UI text is `board.*` keys, the roadmap's `board.roadmap.*`.

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
- **`board_initiative_get { initiativeId? }`**: an initiative's text, health with its reasons, forecast,
  progress, projects and cards; by default the initiative of the chat's card.
- **`board_initiative_create_draft { title, outcome, criteria?, horizon? }`** and **`board_project_create
  { initiativeId, title, milestones? }`**: proposals (`proposed: true, proposedBy: agent`) a human accepts.
- **`board_cards_create_batch { roadmapProjectId?, cards: [{ title, description?, acceptance?, type?, size?,
  blocksIndex? }] }`**: a decomposition in one write, into Triage with one `origin` (so one group accepted as
  a whole), suggested sizes, the `blocks` links `blocksIndex` names among the batch (no cycle) and, given a
  roadmap project, in it.
- **`board_update_draft { initiativeId, text, health }`**: saves the draft update; it never publishes.

Their guidelines say two things:

- Read your card and treat its criteria as done.
- File deferred work into Triage, never steps of the current task.

## Verification

- **Unit** (`server/*.test.ts`):
  - store round-trip, the move-aside, the newer-version refusal, the defaults and the version-1 cards file
    migrated on read (`projectId` → `roadmapProjectId`);
  - prefixes and ids, the presets, the rule table (idempotence included) and the kickoff text;
  - query validation, create / update / move / delete / accept / start, overlays, WIP and inbox;
  - the rules wired to a fake host's events and Triage-only creation by the tools;
  - the roadmap: the derivations each on their own (`rollups`, `throughput` with the day helpers, `forecast`'s
    determinism and not-enough-data, `health`'s rule table, `schedule` with pins, conflicts, milestones,
    cycles and per-initiative critical paths) and, through the queries (`roadmap.test.ts`), validation,
    initiative / project / milestone CRUD, assignment, links refusing cycles, pins and `shiftChain`, external
    cards, draft updates, `roadmap.get`'s rollups, schedule, forecast and health, the kickoff's initiative
    context, the cards' `initiative` overlay, `roadmap.chat` (the Default workspace, each kind's skill and
    text, the refusals, a `kickoffError` passed on) and the roadmap tools (proposals, a Triage batch with its
    links, the draft update);
  - the sources (`sources.test.ts`): task-specs bound vs unbound, placement by live facts, Adopt once,
    refused writes, watched chats, deferrals sent once and their parsing; GitHub through a fake `gh`
    (argv, the Default workspace, the TTL, Refresh, the filter, the error kept beside the last issues,
    storing on edit / move / start, the kickoff, `Closes #N` appended only when missing, the PR body only,
    the retry); size suggestions (strict parsing, a human's size never overwritten, skipped without a
    model or switched off or for an agent's card, the debounce, issues' cards).
- **Host-level**: `packages/server/src/host/extensionActions.test.ts` covers `startChat` (a repository
  workspace only, the kickoff validated, refused while switched off, `kickoffError` passed on);
  `packages/server/src/host/extensionEventsWire.test.ts` covers the gated
  `extension.event` push and the host service following the Settings switch.
- **Host-level** also: `packages/server/src/host/lastActions.test.ts` covers the last-action target (a
  workspace-relative path, nothing outside the worktree, a bash command's cut start, the folders shortened,
  nothing for other tools) and the tracker (latest start only, dropped once disposed or deleted);
  `extensionEventsWire.test.ts` a project's close and reopen republishing its board, a rename not.
- **Web** (`web/*.test.ts(x)`): the agent badge by overlay state, the working last action and its tile line,
  `selectCard` with follow selection off and on and `enterCard`, Start's offer and its defaults by size,
  the drop → `card.move` call, Alt+arrow steps, the list sort, the adaptive layout and the rendered tile,
  columns, list and empty board; the source badges, Adopt and Start by source, the task-spec panel's Open
  targets and Send deferrals, the GitHub menu and banner, and deferral groups in Triage; the WIP math (over a limit, 0 as none, the Review column's limit, Start's
  warning order), Triage grouping by origin and the collapsed lane, the inbox's reply check and its rows'
  chat target, and the rendered inbox strip and Start warning; the roadmap (`roadmap.test.tsx`): horizon
  grouping with goal and crumb, Goals grouping, the stack bar's math, appetite, dependency hints, the
  horizon drop and parent options, the writes each sends (accept / discard / move, the panel's
  `initiative.update` patches, `card.assignProject`, moving a card between initiatives, `roadmap.chat` then
  `openChat`), and the rendered initiative card (proposed or not), horizons, goals, the tile's chip and the
  initiative panel.
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
  Start's warning on the tile and in Peek's Start form; Triage's Accept all moving a seeded decomposition
  into Backlog; follow selection off (a click only peeks a started card) and on (the click enters
  `workspace-1` with the card in its Peek); the inbox counter dropping a closed project's card and taking
  it back on reopen; the roadmap: an initiative created in Next, dragged to Now, opened in Peek, given
  criteria and a target and a card (the rollup *0/1*), shown under its goal in Goals, and *Plan with agent*
  starting a chat in the Default workspace whose kickoff (from the `roadmap.chat` reply, no model needed)
  carries the outcome.
- **Live e2e** (`e2e/board.live.spec.ts`, `@agent`, through `bun run e2e:full e2e/board.live.spec.ts`): an S
  card asking for a one-line README example, started from Peek; the tile's last-action line seen while
  the agent works (recorded by a `MutationObserver`, since it is transient); the card in Review with its
  diff, the badge finished and the line gone.

## Deferrals

These land later:

- cost / time per card;
- live re-reads when a task-spec file changes (the host pushes no file events to extensions; the board
  re-reads on its own writes, chat and review changes and workspace switches);
- a task-spec committed to the branch shows in every unbound workspace that has it;
- removing a "blocks" link from the tools;
- an initiative's `into` (D / G);
- the Timeline and the step graph (D3), `insights.get` and Insights (D4), the roadmap skills (D4; until then
  a roadmap chat's kickoff carries its instructions) and Publish — the next steps of `TASK-roadmap`;
- another board's write does not publish the boards whose initiatives list its cards as external.
