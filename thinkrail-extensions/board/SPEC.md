---
id: module-ext-board
type: module-design
status: draft
title: Board extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api]
references: [submodule-server-extensions, submodule-server-host, module-contracts, module-ext-session-insights, module-ext-web-access, submodule-server-containers, submodule-server-host-plan-review, submodule-server-reviews, submodule-server-workspaces]
---

## Responsibility

A board per project whose cards launch agent work and follow it. **The column is the work status**: a
preset names the columns over fixed categories. **The agent's state is live**, computed per request
from host facts and never stored. **Host events move cards** through pure rules, and a human's move is
a logged override. Besides its own cards the board shows the project's **sources** (§ Sources): its
workspaces' task-specs, its open GitHub issues through the user's own `gh` when switched on, and its
OpenSpec changes, proposed, applied and archived through the user's own `openspec` CLI and skills. Above
the cards sits the board's **roadmap** (§ Roadmap) — initiatives, roadmap projects with milestones, and
what is derived from the live work: rollups, a forecast, a suggested health, the step graph's schedule
and flow insights — and, before shaping, **discovery** (§ Discovery): ideas with evidence and a value ×
effort score, and a competitor watchlist. An initiative **runs** in a container whose orchestrator starts
its cards; its **autopilot** (§ Autopilot) is host policy that decides *when* a card may start and wakes
the orchestrator, never a model loop of its own. **Smart review** (§ Smart review) checks a card's change
against its spec through the host's independent reviewer and writes a review packet. Eight skills
(§ Skills) put the agent to work on the roadmap and discovery. There is no portable pi package, because
every tool acts on host-owned state. The web half ([[submodule-ext-board-web]]) is the Board side tool
with its views, the card, initiative and idea panels in Peek, the cross-project "Needs you" counter, an
initiative's section of a container's overview and Board mode.

The roadmap is board data: the board writes no spec itself, and the published snapshot (`ROADMAP.md`) is a
file the user commits. What lands as a capability reaches `goal-and-requirements` through the
initiative-close skill's edit, made on the human's approval and shipped as a normal PR the user opens.

## Terms

- **Project** always means a ThinkRail project — a repository the host has open: `projectId` on a card,
  in every query and every tool. A **roadmap project** (`P-n`, a card's `roadmapProjectId`) is the
  roadmap's group of cards under an initiative, with milestones (`M-n`); the `project.*` and `milestone.*`
  queries and `board_project_create` act on roadmap projects of the board their `projectId` names.
- **Board**: one per project. A **card** is `PREFIX-n`, one id across every board. An **attempt** is one
  start of a card — a workspace and the chat its kickoff opened; the **latest attempt**'s chat gives the
  card its live state.
- A **category** (triage, backlog, unstarted, started, review, completed, canceled) is the work status the
  rules move; a **column** is a preset's name for one or more categories. **Triage** holds what an agent
  filed until a human accepts it.
- A **source** is where a card comes from: native (the board's own), a task-spec, a GitHub issue or an
  OpenSpec change. A **virtual card** is a source's item the board has not stored; a write stores it.
- **The Default workspace** is the project folder itself ([[submodule-server-workspaces]]): roadmap,
  discovery and Propose chats start there, the GitHub issues and the OpenSpec CLI probe run there, and
  Publish writes there.
- **Human attention** is what waits for the human: **Needs you** (a card whose agent waits for an answer)
  and **Review** (a card in review). **Agents** are the running agents. Each has a WIP limit
  (`wipLimits`); the agents limit is also the autopilot's concurrency cap. The **"Needs you" inbox** is
  wider than the count: it also lists the cards whose agent failed, since those are stalled too.
- An **initiative** (`I-n`) is an outcome with success criteria on a horizon (now / next / later); a
  top-level one is a **goal**. An **idea** (`D-n`) is discovery's candidate for an initiative.
- The **roadmap snapshot** is the published `ROADMAP.md`; a watchlist entry's **snapshot** is the text of
  a competitor's pages at one check.

## Boundary

- **`./server`**: `defineServerExtension({ name: "board", title, description, apiVersion: 1,
  extensions: [], skillPackages: ["@thinkrail/ext-board"], sessionExtensions, queries, hostService })`.
  - `skillPackages` names this package itself: its manifest exports `./package.json` and declares
    `pi.skills: ["./skills"]`, so the host's owner-scoped resolver stages `skills/` under
    `skills/extensions/board/` and the switch drops the skills with the tools (§ Skills).
  - It imports `extension-api/server`, `typebox` and pi types only. Contracts types come through the
    SDK's re-exports.
  - **`server/openspec/`** ([[submodule-ext-board-openspec]]) is the pure OpenSpec sub-module the board
    reads changes through (its `index.ts` barrel); the board's glue — card ids, overlays, stage → category,
    Apply, Validate, Archive, Propose — lives in `openspecCards.ts`, `kickoff.ts` and `board.ts`.
  - The queries, the host service and the tools share **one `Board` per data folder**. The first
    `queries(host)` or `hostService(host)` builds it, without I/O. Once the services it was built on
    have their `signal` aborted (a switch-off), the next run builds a fresh one on its own services.
  - The tools reach the board most recently built. Before one exists, they answer that the board is
    not running.
  - Enabled by default. Switching it off refuses its queries and actions, stops its host service and
    withholds its tools.
- **`./web`**: `defineWebExtension({ name: "board", title, sideTools: { board }, panels: { card, initiative, idea },
  statusItems: { inbox }, containerSections: { initiative }, layoutPresets: { board }, commands, shortcuts })`,
  in the web registry. It never imports its `./server` half: it restates and checks the answers it reads,
  and reaches the host only through its `PanelHost` ([[submodule-ext-board-web]] § Boundary).

## Data

The store lives at `<dataDir>/<projectId>/`, the extension's data folder (`~/.thinkrail/extensions/board/`):

- **`cards.json`**: `{ version: 2, prefix, nextNumber, cards }`. Version 2 renamed a card's roadmap project
  field from `projectId` to `roadmapProjectId` (§ Terms): a version-1 file is read with the old name
  (**migrated on read**) and written back as version 2. The other files are version 1.
- **`settings.json`**: `{ version: 1, preset, wipLimits { needsYou, review, agents }, followSelection,
  github { enabled, filter }, snapshotPath }`. The defaults are `agentic-kanban`, 3 / 5 / 3, off, GitHub off
  with the `open` filter (`mine` is the issues assigned to the gh user) and `ROADMAP.md` (where Publish
  writes, § Roadmap).
- **`transitions.jsonl`**: an append-only log of `{ cardId, from, to, at, actor, reason }`.
  - `from` and `to` are `{ category, column }`, or `null` at creation or deletion.
  - `actor` is `human`, `agent`, `git` or `automation`.
- **`initiatives.json`**: `{ version: 1, nextNumber, nextUpdateNumber, initiatives }`, ids `I-n` and updates'
  `U-n`, sequential per board and never reused (§ Roadmap).
- **`projects.json`**: `{ version: 1, nextNumber, nextMilestoneNumber, projects }`, ids `P-n` and milestones'
  `M-n`, likewise.
- **`ideas.json`**: `{ version: 1, nextNumber, nextEvidenceNumber, ideas }`, ids `D-n` and evidence's `E-n`, and
  **`watchlist.json`**: `{ version: 1, nextNumber, entries }`, ids `W-n` — likewise (§ Discovery).

Write rules:

- Writes are atomic (a temp file, then a rename).
- The host runs one board per process, so the store is the single writer. It keeps what it read in
  memory.
- A project id must be a plain folder name.
- The only other files are PR bodies written for `gh pr edit --body-file` (`pr-<n>-body.md` for `Closes #N`,
  `pr-<n>-packet.md` for the review packet), removed once gh ran.

Failure handling:

- **An unreadable file** (bad JSON, a missing or unknown version) is **moved aside** to
  `<file>.corrupt-<ms>`, logged, and read as empty or default. A later write therefore never destroys it.
- **A file of a newer version** makes that board refuse to read or write, rather than lose data.
- **Unreadable cards** (and initiatives, roadmap projects, ideas, watchlist entries, evidence) are dropped with a
  warning. Missing fields take defaults;
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
  `{ kind: github, ref: "#N", number, url }` for an issue's card, or `{ kind: openspec, ref, change }` for
  an OpenSpec change's card (`change` its folder's name); one missing what locates it reads as native;
- `type` (feature / bug / chore), `size?` (S / M / L) and `sizeSuggested?`;
- `labels[]`, `blocks[]` (the ids it blocks), `specRefs[]` and `rank`;
- `category` and `column`, `ownerHuman` (the local user) and `createdBy` (human / agent);
- `origin? { sessionId?, cardId? }`: on an agent's card the chat that filed it and the card that chat works
  on, by which Triage groups a decomposition; on a human's deferrals the card alone;
- `attempts[] { workspaceId, sessionId, workflow, startedAt, notes[], merged?, removedAt?, closesLinked?, review? }`
  — an adopted workspace without a chat has `sessionId: ""` and follows the workspace's latest chat;
  `closesLinked` is the PR seen to carry the issue's `Closes #N`; `review` is the latest smart review
  (§ Smart review), `{ at, summary, items[{ id, source, text, scenarios?, verdict, evidence[{ path, line?, note }],
  tests[], commentId? }] }`, an unreadable item dropped;
- `cancelPending?`, the question "cancel?" after an unmerged workspace went away;
- the roadmap's `roadmapProjectId?` (a roadmap project of its board, § Terms), `milestoneId?` (one of that
  roadmap project's),
  `pinnedStart?` (an ISO date) and `estimateDays?` (absent: S 1, M 3, L 6; unsized counts as M).

## Rules

### Presets

Presets are pure (`presets.ts`). Triage and Canceled are hidden lanes in every preset. The first category a
column lists is the one a card moved into it takes.

| Preset | Columns (categories) |
| --- | --- |
| Agentic kanban | Backlog (backlog) · Ready (unstarted) · Designing (started, `brainstorm`) · Building (started, `implement`) · Review (review) · Done (completed) |
| Solo | Todo (backlog + unstarted) · Doing (started + review) · Done (completed) |
| Spec-driven (OpenSpec) | Planning (backlog) · Ready to apply (unstarted) · In progress (started) · Complete (review) · Archived (completed) |

The Spec-driven preset is offered by the switch only while the project's Default workspace has `openspec/`
(or it is the board's preset already); any preset shows the changes, by their stage's category.

- **A move keeps the card's category when the target column shows it**, so Doing keeps a card in
  review.
- **A started card's column follows its latest attempt's workflow.**
- **Changing the preset remaps** every card's column from its category, with no transition logged.

### Events

Rules are pure (`rules.ts`: `applyEvent(card, event, preset, at)`). An event concerns one attempt's
workspace, and `null` means nothing changed, so **re-applying an event is a no-op**.

- **Start → started**, in its workflow's column, from any category. The actor is `automation`; the reason
  says who started it (*an attempt started*, *started by Run initiative I-n*, *started by the orchestrator of
  the container "…"*).
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
- A bound (or watched) chat's tool start (`agent.tool`) publishes **`board.activity { projectId }`** instead,
  **throttled per project**: at once, then at most once per `ACTION_REFRESH_MS` (2 s) while starts keep
  coming, the last one included, so a card's last action follows the agent without a re-read per tool. It
  changes no state: the inbox does not re-read on it and autopilot does not evaluate. Stopping the service
  drops the timers.
- A project opening or closing (`project.opened` / `project.closed`) publishes it for that project, so the
  inbox, which lists the open projects' cards, re-reads.
- A GitHub issue's card's open pull request gets its `Closes #N` check on that chain (§ Sources), its body
  edit queued per workspace with *Add to PR*'s (§ Smart review).

### Live overlay and WIP

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
stored card: `spec:<workspaceId>:<specId>`, `#N` and `openspec:<change>`.

### Task-specs

`taskSpecs.ts`, pure, over the host's `taskSpecs(workspaceId)` fact:

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

### GitHub issues

`github.ts`; off by default, and only ever through the user's `gh`:

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

### OpenSpec

The board shows OpenSpec changes as cards and drives them through the user's own CLI and skills; it does
not merge OpenSpec's specs into ThinkRail's spec graph (§ Deferrals). Everything about a change is
**derived from its files**, never stored.

- **Reading.** The host's `openspecTree(workspaceId)` fact (markdown and YAML of one workspace's
  `openspec/`, size-capped) is parsed by [[submodule-ext-board-openspec]]: artifacts by file presence and
  the schema's dependencies (`spec-driven` built in, a project schema from `openspec/schemas/<name>/`, an
  unresolvable one reported as the change's `error` with no chain), the tasks by OpenSpec's own checkbox
  regex, deltas per capability, archived by location. **The stage** is openspec-ui's: archived → Archived;
  no tasks → Planning; none checked → Ready to apply; some → In progress; all → Complete. Its category is
  backlog, unstarted, started, review, completed.
- **The CLI path.** `openspec --version` is probed once per project in its Default workspace once that has
  `openspec/` (a missing CLI is probed again after 5 minutes). With a version, `openspec list --all --json
  --sort name`, `status --all --json` and `validate --all --strict --json` run through
  `actions.runInWorkspace` (argv only) **behind the read**, keyed by the tree's content: they are
  authoritative for task counts and the artifact chain once in, `board.changed` says when, and the parse
  fills in until then (and always supplies paths, deltas and titles). A failed reading waits for the tree
  to change. Without the CLI the parse is the whole reading.
- **Cards.** Each change of the Default workspace that no stored card names is a **virtual** card
  `openspec:<change>` (`source { kind: openspec, change }`, the proposal's `# ` heading as title, the goal or
  Why as description), placed by its stage. A write stores it first, like an issue's card — **it is
  materialized into a stored card** (`created from the OpenSpec change <name>`), placed where it showed. A
  stored card keeps its own category (the board's rules and overrides apply) and carries the change as
  its live `openspec` overlay: `{ change, workspaceId, dir, archived, stage, schema, error?, artifacts
  [{ id, status, files }], nextArtifact, tasks, deltas, validation, source }`, `requirements` and
  `taskLines` added for Peek. It is read in **its open attempt's workspace** (the apply branch, live, an
  archived copy there included), else in Default. Default is watched while it has `openspec/`, so a chat
  proposing there re-reads the board.
- **Apply** is Start on a change's card (refused without tasks or once archived): a new workspace whose
  kickoff is `/skill:openspec-apply-change <name>`, the card, and instructions that stand alone without
  the skill — tick each task as it is done, archive nothing. Then the change in that workspace gets
  `x-thinkrail: { card, workspace }` in its `.openspec.yaml` through `actions.writeWorkspaceFile`, every
  other key and line kept (`upsertTopLevelKey`; OpenSpec has no metadata command, and `x-` keys pass
  `validate --strict` and survive archive — both recorded with the real CLI). When the new branch lacks
  the change (proposed in Default, not committed), Apply first **carries its files over** from Default,
  with `openspec/config.yaml` and the living specs when the branch has no `openspec/` at all; a failure
  there is answered as `openspecError` beside the started attempt.
- **Validate** (`openspec.validate`) runs `openspec validate <name> --strict --json` where the card reads its
  change and answers its issues (refused for an archived change); **Propose** (`openspec.propose`, `＋
  Propose change`) starts a chat in Default on `/skill:openspec-propose <description>`, answered like a
  roadmap chat (§ Roadmap); **Archive** (`openspec.archive`, below) needs a stored card with an open
  attempt's chat.
- **Archive timing (unconfirmed with the user; the agent's choice):** a change is archived **in its apply
  workspace, before the PR merges**, so the PR carries the code and the merged spec deltas
  together — ThinkRail's "a change updates its specs in the same change" rule. *Archive in workspace* asks
  that attempt's chat (`actions.sendToChat`, a follow-up): "Run openspec-archive-change <name>, then update
  the PR." The card then reads the archived copy there (stage Archived); the merge completes it.
- **Without the CLI**, Validate and Archive (a mechanical merge the CLI does) are disabled with the install
  command; Propose and Apply only need the skills in the agent's workspace — without them the kickoff's
  text alone instructs.

### Size suggestions

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

## Roadmap

Initiatives, roadmap projects and milestones (Linear's hierarchy), stored per board; everything derived is
computed per `roadmap.get` and never stored.

- **An initiative** is `{ id, parentId?, title, outcome, criteria[], horizon (now / next / later), rank,
  target? (ISO date), appetiteDays? (time only), specRefs[], health? { override?, note? }, updates[],
  cardIds[], externalCards[], proposed?, proposedBy?, closedAt?, containerId?, autopilot? { on, pausedReason? },
  createdAt, updatedAt }` (§ Autopilot for the last two), created on the `later` horizon unless one is
  named. `closedAt` is set
  once, by the agent's `board_initiative_close` after the human confirmed it done in an initiative-close
  chat (a proposal can't close); a closed initiative stays on the roadmap, marked *Closed*. It nests (a top-level one is
  a goal; a parent can't move under its own subtree). It holds this board's cards listed in `cardIds`, the
  cards of the roadmap projects whose `initiativeId` is it, other boards' cards as `externalCards
  { projectId, cardId }` and, for every derivation, its nested initiatives' cards.
- **An update** is `{ id, at, text, health, publishedAt? }`: one draft (no `publishedAt`) at a time, which a
  save replaces and a human's publish stamps (a publish without a draft makes one from its `text`). An agent
  only ever saves.
- **A roadmap project** is `{ id, initiativeId?, title, milestones[{ id, title, target? }], proposed?,
  proposedBy?, … }`; a card belongs to at most one.
- **An agent's proposal** (`proposed: true, proposedBy: "agent"`) is accepted by `proposed: false`, which
  keeps `proposedBy`.
- **Cards join across boards**: a card id names one card on every board, so `initiative.addCards` with
  another board's card stores it as an external card; `roadmap.get` reads an external card that went away
  as `missing`.
- Deleting an initiative moves its nested ones to its parent and frees its roadmap projects; deleting a
  roadmap project or a milestone frees its cards; deleting a card drops it from every board's initiatives.

**Derivations** are pure modules, each with its own tests:

- **`rollups.ts`**: per initiative, roadmap project and milestone — cards by category, size points (S 1, M 2, L 4;
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
- **`schedule.ts`**, the step graph (a forward and a backward pass): nodes are the board's cards (canceled left out)
  and every roadmap project's milestones, zero-length after their cards; edges are `blocks`. A card not
  started starts at its pin, else when its blockers end, not before today; a started (or review) card at
  its latest start and ends after its estimate, not before today; a completed card keeps its actual span.
  The backward pass from the latest end gives `slack` and `critical`; a pin before its blockers' end is a
  `conflict` (node and link); a milestone past its target day is `late`. Days are days since 1970-01-01 UTC,
  fractional; nodes come in topological order. A cycle in stored data is cut at one link and reported in
  `cycles`; `criticalWithin` gives an initiative's own critical path over its cards and milestones.
- **`insights.ts`**, the Insights view over the last `weeks` weeks (Monday UTC `weeks - 1` weeks before this
  week's, to now; 1–52): the log replayed day by day gives each day's end WIP (started + review) and the
  cumulative flow (completed, review, started, unstarted, backlog); throughput counts completions per week
  (the current one partial); each card completed in the window has its cycle time (first start → done, in
  days) and, from `MIN_CYCLE_SAMPLES` (3) of them, nearest-rank 50 / 85 % percentiles — the 85th is the
  **SLE**; work item age is now minus the first start of each card started or in review. **Where time
  goes** sums the window's started time (agent working) and review time (in review) and moves the waits
  for the human open now — a started card whose latest attempt's chat is `needs_you`, since that chat's
  update — from agent working to waiting for you. The host keeps no chat-state history, so an earlier,
  answered wait counts as agent time; that is the stated approximation, not a recomputation of pi state.
- **`activity.ts`**, an initiative's window for the report skill: its cards' category changes inside it
  (oldest first, with actor and reason; a move within a category is none), which reached completed,
  started, review, canceled or were filed, their attempts' notes, and the active cards that did not move
  (with their last move).
- **`snapshot.ts`**, the published roadmap: the accepted open initiatives by horizon (Now, Next, Later), each
  by rank then id, with its parent, outcome, health (and reasons, *suggested* unless overridden), progress
  (done of the cards neither in Triage nor canceled), target, forecast, criteria and latest published
  update quoted; then *Closed*. Deterministic: the same roadmap on the same day writes the same bytes, and
  its only date of its own is the generation line (forecast dates move with the day, as they do in the UI).
- **Links never close a cycle**: `card.link`, `card.update { blocks }`, `board_link` and a batch's
  `blocksIndex` refuse one (`wouldCycle`).

**Planning edits.** `card.link` / `card.unlink { from, to }` read "from blocks to"; `card.assignProject`
takes a milestone alone as naming its project, `null` taking the card out. `card.pin` / `card.unpin` apply
only to a card not started yet (Triage, Backlog, Ready). `card.shiftChain { cardId, days }` pins the card at
its planned start + `days` and moves every pinned card it blocks, transitively, by the same; unpinned
dependents follow by themselves and started ones keep their actual start.

**Roadmap chats** (`roadmap.chat`, kinds `plan`, `shape`, `report`, `review`, `close`; all but `review` need
the initiative, and `close` refuses one already closed) start a new chat in the project's **Default**
workspace through `actions.startChat`, answered with its ids, the kickoff and any `kickoffError` for the web
half to open. The kickoff (`roadmapKickoff`) starts with its skill (§ Skills) — `/skill:roadmap-plan`
(`-shape`, `-report`, `-review`) or `/skill:initiative-close` —, exactly as the composer sends a picked
skill, then the task in one line, the initiative's id, title, outcome, success criteria, horizon, target and
appetite (a review lists every open initiative instead), and **instructions that stand on their own** —
which `board_*` tools to read and write with, what to propose rather than change, what waits for the
human's confirmation —, so the prompt still works on a host that left the skills out.

**Publish** (`roadmap.publish`) writes the snapshot (`snapshot.ts`, dated today UTC) into the project's
**Default** workspace through `actions.writeWorkspaceFile`, at the given path (up to 400 characters) or the
settings' `snapshotPath`, remembering a new path there; the host refuses an unsafe path and the board passes
its refusal on. Storage stays local: the file is the user's to commit and open a PR with; **the board never
commits**.

## Discovery

The idea stage before Shape, stored per board in `discovery.ts`; nothing about it is derived from the live
work. The human decides; the agent suggests.

- **An idea** is `{ id, title, pitch, evidence[], value?, effort?, horizonSuggestion? { horizon, reason },
  status (new / analyzed / promoted / dismissed), initiativeId?, createdAt, updatedAt }`.
  - **Evidence** is `{ id, kind (artifact / url / note), ref, quote?, workspaceId?, addedBy (human / agent), at }`:
    an artifact's `ref` is a workspace-relative path (no `..`, not absolute; the tool makes an absolute
    path inside its cwd relative) in `workspaceId`, a url's an http(s) URL, a note's its text.
  - **A score** (value or effort) is `{ score 1–5, reasons[], suggested }`. The agent's (`board_idea_score`,
    reasons required) is `suggested`; a human's pick, a confirm (the same score re-saved, reasons kept) or
    an edit of its reasons is not, and **the agent never overwrites a score that is not suggested** — the
    tool keeps it and says so.
  - **Status**: a score makes a new idea analyzed (clearing both makes it new again); Dismiss and its
    reversal flip dismissed; a promoted idea can't be dismissed.
- **Promote** (`idea.promote`) starts a `shape` roadmap chat whose kickoff carries the idea — pitch, evidence
  with quotes, scores with reasons, the suggested horizon — and asks for `board_initiative_create_draft {
  …, ideaId }`. That call validates the idea first (neither promoted nor dismissed), proposes the initiative,
  then marks the idea promoted with its `initiativeId`; `discovery.get` names the initiative while it exists.
- **A watchlist entry** is `{ id, name, urls[] (http(s), at most 20), notes, snapshot?, previous?, createdAt,
  updatedAt }`, a snapshot `{ at, text (at most 50 000 characters), artifactPath?, workspaceId? }`.
  `board_watchlist_snapshot` moves `snapshot` to `previous`, stores the new one and answers the previous
  for the agent to diff; the web half diffs the two. There is no scheduler: a watch runs on *What changed?*.
- **Discovery chats** (`discovery.chat`; research and analyze need the idea, watch refuses an empty
  watchlist), like the roadmap's, start in the project's **Default** workspace with their skill first and
  stand-alone instructions, answered as `roadmap.chat` answers: `research` (an idea: search and fetch with
  web-access, a cited report into the workspace's artifacts folder `.thinkrail/context/`
  `research-<id>-<day>.md`, attached as artifact evidence with its key sources as url evidence),
  `analyze` (an idea: the goal spec through `spec_search`, competitors from its evidence, session insights
  only if a tool for them is available — the session-insights extension ships none — and the user's
  analytics MCP tools if configured; then one `board_idea_score`) and `watch` (the watchlist, or one entry:
  a dated report `competitor-watch-<day>.md`, a snapshot per entry, what changed). The chat runs in the
  Default workspace, so its report lands in that workspace's artifacts (a container's chat in the
  container's shared ones).
- Evidence added through `idea.addEvidence` is the human's; the tool's is the agent's. Discovery's ids are
  case-insensitive.

## Autopilot

**The host decides *when*, the container's orchestrator decides *how***: autopilot never runs a model; it
selects cards and wakes the orchestrator, which starts them with `board_card_start`. The rules are pure
(`autopilot.ts`); the host service (`autopilotService.ts`) applies them.

- **Run initiative** (`initiative.run`, refused for a proposal or a closed initiative) gives the initiative a
  **container**: its first ready card (the selection below, whatever the switch) starts through
  `startCard` (logged `automation`, *started by Run initiative I-n*), then `actions.createContainer { name:
  the initiative's title, workspaceIds: [that workspace] }`, stored as `containerId`, then
  `actions.startOrchestrator` at once, even with one member, then a **`board-run`** wake-up
  (`actions.wakeOrchestrator`) briefing it: the initiative's outcome and criteria, what started, the agents
  running against the cap, whether autopilot is on, and how `board_card_start` works. An initiative that
  has a container that still exists reuses it: no card starts, the orchestrator is started if missing and
  briefed again. Nothing ready, the cap reached or a human-attention limit past refuses Run in words.
- **Autopilot** (`initiative.autopilot { on }`) is per initiative and **off by default**; on needs the
  container. `autopilot { on, pausedReason? }` is stored on the initiative.
- **Selection** (`select`): the initiative's member cards (its board's and other boards') that are **ready**
  (unstarted), **unblocked** (every `blocks` predecessor completed — or canceled, as the board's blocked
  count reads it), **free** (no attempt with an open workspace, no start in flight) and **sized** (a
  suggested size counts), by rank; the **limits** allow them while the board's running agents are under
  `wipLimits.agents` (the concurrency cap; 0 is none) — at most the free slots, which a flagged card (below)
  does not take, so the next ready card gets it — and **pause** them all while
  Review, then Needs you, is past its limit (`count > limit`, 0 is none; Start's warning reads the same) or
  the container has no orchestrator: `pausedReason { kind: review | needs_you, count, limit }` or `{ kind:
  orchestrator }`.
- **Re-evaluation.** While the host service runs and some initiative has autopilot on with a container,
  every `board.changed` (writes, bound chats' state and review signatures — not tool starts, which are
  `board.activity`, § Rules) and every `container.updated` / `removed` asks for an evaluation after
  `AUTOPILOT_DEBOUNCE_MS` (2 s), one at a time: the first request arms the timer and later ones join it, so
  changes that keep coming evaluate at most every 2 s. An initiative is acted on as stored once its inputs
  arrived: switched off (or onto another container) meanwhile, it records, offers and wakes nothing. It
  records a changed `pausedReason` keeping the stored switch (`setAutopilotPause`, never switching it on; a
  write, so `board.changed`); a container that went away clears `containerId` and switches autopilot off.
- **Offers, no flood** (`planOffers`): a selected card is offered once in a **`board-ready`** wake-up; offered
  and not started within `OFFER_RETRY_MS` (10 min) it is offered again once (a timer arms the next due
  offer), then **flagged** *Orchestrator didn't start it* and never offered again while it stays ready; a
  card that is no longer ready is forgotten. Since the host keeps only the latest text of a kind, each
  `board-ready` lists **every outstanding offer** (offered, still selected, not flagged), each marked *new* or
  *offered before, not started yet* (id, title, size → workflow, whether its design waits for the human),
  with the room left under the cap, and says it replaces the earlier ones. Offers live in memory (a restart
  offers again). A failed wake-up keeps no offer, so the next evaluation tries again.
- **Withdrawal.** A pause (as an evaluation finds it) or the switch turned off withdraws the outstanding
  offers with a superseding `board-ready` (`withdrawText`): autopilot is paused (with its reason) or off, the
  cards withdrawn, start nothing unless the human asks. A pause forgets the offers but the flagged ones, so
  resuming offers them anew; with nothing outstanding (or no orchestrator) nobody is woken.
- **Wake-ups go through the host's coalescing** (`wakeOrchestrator`, [[submodule-server-containers]] §
  Wake-ups), one card per kind in flight; the board never sends a raw chat message to the orchestrator.
- **`board_card_start`** (§ Agent tools) is how the orchestrator starts a card; acting on its own (no human
  message since its last reply), it is refused while autopilot is off, paused or at the agents' cap.
- **Human gates** (the agent's choice, unconfirmed with the user): off by default; paused, with its reason,
  while a human-attention limit is past; M and L cards start on brainstorming, so their design waits for
  the human; merging still needs the human's approval in chat; the human turns the switch off at any time
  (offers forgotten and withdrawn); every start is logged with actor `automation`.
- **`AutopilotView`** (`autopilot.get`, and `autopilot.ofContainer` for the initiative a container runs,
  else `null`): `{ projectId, initiativeId, title, on,
  pausedReason` (computed now, `null` while off)`, container { id, name, members, orchestrator { projectId,
  workspaceId, sessionId } | null } | null, running, cap, ready[{ id, title, size?, offered, stale }] }`.

## Smart review

Spec conformance and a review packet. The verdict is **advisory**: it approves nothing, moves no card, and
the human still merges.

- **Requirements** (`review.ts`, pure, `assembleRequirements`), in order and with ids stable for the same card,
  spec and change: the card's acceptance criteria (`ac-1`…); the top-level bullets of the `## Product` section of
  each task-spec of the latest attempt's workspace (the host's `specSection` fact, read with `parseDeferrals`'
  rules; a deprecated spec left out; `spec-<id>-1`…); for an OpenSpec card every requirement of its change's deltas
  where the card reads the change, with its statement and scenarios (`os-<capability>-<name>`; a removed one asks
  that nothing still relies on it). At most 200 go to one review; none refuses (*add acceptance criteria*).
- **`card.review { cardId }`** (a stored card whose latest attempt's workspace is open, one at a time per card)
  answers `{ cardId, requirements }` at once and runs behind it, since a review outlasts a query: the host's
  `actions.reviewConformance` (plan review's hidden reviewer, [[submodule-server-host-plan-review]]) under the
  attempt's chat with the requirements and the card's context (id, title, description, initiative); the verdicts
  joined to the requirements (one the reviewer skipped reads `untested`) are stored as the attempt's `review`; each
  **unmet** item whose evidence names a line becomes one Review comment on that line through
  `actions.addReviewComments` (author *Smart review*), its id kept as `commentId` — an unmet item without a line
  stays a note in the packet, and an item still unmet with a comment from the last review is not commented again.
  The card reads `reviewing` meanwhile and `reviewError` (in memory) after a failure; each start and end publishes
  `board.changed`.
- **`card.packet { cardId }`** → the **packet** (`packetOf`): why (the initiative's id, title and outcome; the
  card's description, else its title), what (the latest attempt's chat's plan summary and steps through the host's
  `planSummary` fact), how it was verified (the steps' verifications), conformance (the stored review with its
  tally), time (from the log: in started is the agent, in review is waiting for review) and the diff, with its
  markdown (`renderPacket`: deterministic, the same inputs write the same bytes; `<!--` and `-->` in the
  agents' free text become `&lt;!--` and `--&gt;`, `neutralizeComments`, so no summary reads as a marker). It
  works once the workspace is gone, without its plan and diff.
- **`card.packetToPr { cardId }`** upserts the markdown as the `## Review packet` section of the latest attempt's
  pull request through the user's `gh` (`gh pr view <n> --json body`, then `gh pr edit <n> --body-file`), the
  `Closes #N` pattern: only the text between `<!-- thinkrail:review-packet -->` and
  `<!-- /thinkrail:review-packet -->` changes (`upsertPacket`, the last complete pair; appended once otherwise),
  and an unchanged body is not edited (`updated: false`). Refused without a pull request. Every read-modify-write
  of a workspace's PR body — this and the `Closes #N` check (§ Sources) — runs through one queue per workspace
  (`editPrBody`), so neither edit drops the other's.

## Queries

`queries.ts` is the one table of names and params; each family's behavior lives in the section it names.
The contract they share:

- **Validated JSON.** Every query takes an object of params and validates it before it reads or writes
  (non-empty, bounded text; enums; `YYYY-MM-DD` dates; bounded day counts; lists of at most 100), and answers
  JSON-serializable data. The web half restates the answers' shapes and checks them on arrival
  ([[submodule-ext-board-web]]).
- **Families**: the board's (`board.get`, `inbox`, `card.*`, `triage.accept`, `settings.*`, `models.list`);
  the sources' (`card.adopt`, `card.deferrals`, `github.*`, `openspec.*`, § Sources); smart review's
  (`card.review`, `card.packet`, `card.packetToPr`, § Smart review); the roadmap's (`roadmap.*`,
  `insights.get` with 1–52 weeks, 12 by default, `initiative.*`, `project.*`, `milestone.*` and the planning
  edits, § Roadmap); discovery's (`discovery.*`, `idea.*`, `watchlist.*`, § Discovery); and autopilot's
  (`initiative.run`, `initiative.autopilot`, `autopilot.*`, § Autopilot).
- **Addressing.** A query names its board by `projectId` (a ThinkRail project, § Terms) or by a card id,
  which names one card across every board; `board.get` refuses a project that is not an open repository.
  A virtual card's `#N` or `openspec:<change>` also needs the `projectId` — `card.get`, `card.update`,
  `card.move` and `card.start` take it, and a write stores the card first (§ Sources) —, while `card.delete`
  refuses an `openspec:<change>` id.
- **Writes** publish `board.changed` (§ Events). In a patch `null` clears an optional field (a size, an
  estimate, a parent, a target, an appetite, a health override or note, a roadmap project's initiative, a
  score) and `proposed: false` accepts an agent's proposal.

The board's own reads and card writes:

- **`board.get`** answers the board with every card's live overlay (§ Live overlay and WIP), the WIP, the
  GitHub status and `openspec { present, cli, checking }` (Default has `openspec/`, the CLI's version or
  `null`). **`inbox`** lists the active cards across the open projects whose latest attempt is `needs_you`
  or `failed`; an `interrupted` run (a stop, a host restart) reads as `failed`, as the card's badge does,
  since the card is stalled either way. **`card.get`** answers the card with its project and transitions; a
  virtual card answers itself with none, and one stored meanwhile (adopted, an issue started or edited)
  answers as the stored card. **`models.list`** is the host's `models()`, the models a new chat can use, for
  the Start form's picker.
- **`card.create`** is a human's card, in Backlog by default. In **`card.update`** an edited size is no
  longer a suggestion and `blocks` must name other cards of the same board and close no cycle;
  `cancelPending: false` dismisses the question. **`card.move`** is the logged override. **`card.delete`**
  takes the card out of the other cards' `blocks` too (and out of every board's initiatives, § Roadmap).
  **`triage.accept`** moves its cards to Backlog as a whole, and moves nothing unless every card is in Triage
  on one board.
- **Start** (`card.start`, optionally naming the workflow, model, thinking level and base):
  - It refuses a Triage card and a card already starting.
  - The workflow is the size's (S, a bug or no size → `implement`; M / L → `brainstorm`) unless one is
    named.
  - The kickoff is `Card <id>: <title>`, then the description, the acceptance criteria and the specs, then
    the card's initiative (`Initiative <id>: <title>`, its outcome and success criteria — the one its
    `initiative` overlay names, § Live overlay and WIP) and its roadmap project and milestone.
  - A brainstorm kickoff is prefixed `/skill:brainstorming `, exactly as the composer sends a picked
    skill, so pi expands it.
  - It calls `actions.createWorkspace` — `into` the container of the initiative the card serves while
    that container exists, so every start of a running initiative's card joins its container — and then
    records the attempt and applies Start. It answers the card, the attempt and any `kickoffError`.

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
  progress, roadmap projects and cards; by default the initiative of the chat's card.
- **`board_initiative_create_draft { title, outcome, criteria?, horizon?, ideaId? }`** and
  **`board_project_create { initiativeId, title, milestones? }`** (a roadmap project): proposals
  (`proposed: true, proposedBy: agent`) a human accepts; an `ideaId` promotes that idea to the initiative (§ Discovery).
- **`board_cards_create_batch { roadmapProjectId?, cards: [{ title, description?, acceptance?, type?, size?,
  blocksIndex? }] }`**: a decomposition in one write, into Triage with one `origin` (so one group accepted as
  a whole), suggested sizes, the `blocks` links `blocksIndex` names among the batch (no cycle) and, given a
  roadmap project, in it.
- **`board_update_draft { initiativeId, text, health }`**: saves the draft update; it never publishes.
- **`board_initiative_activity { initiativeId, sinceDays? (7) }`**: `activity.ts` over the initiative's cards
  (nested initiatives' and other boards' included) as text — completed, started, into review, filed,
  canceled, every move with its day, actor and reason, progress notes, the cards that did not move.
- **`board_initiative_move { initiativeId, horizon }`**: `initiative.move`; its description says only after
  the human confirmed the move.
- **`board_initiative_close { initiativeId }`**: sets `closedAt`; only after the human confirmed it done.
- Discovery's (§ Discovery), on the chat's project's board: **`board_ideas_list { ideaId?, status? }`** (one line
  per idea, or one idea whole: pitch, evidence with quotes, scores with reasons, horizon),
  **`board_idea_create { title, pitch }`**, **`board_idea_add_evidence { ideaId, kind, ref, quote? }`** (an
  artifact's path relative to the chat's workspace, which it records), **`board_idea_score { ideaId, value?,
  effort? { score, reasons }, horizon? { horizon, reason } }`** (suggestions; a human's score stays),
  **`board_watchlist_get { watchId? }`** (entries with the last snapshot's text) and
  **`board_watchlist_snapshot { watchId, text, artifactPath? }`** (answers the previous snapshot).
- **`board_card_start { cardId, workflow?, note? }`**: in the orchestrator of a container that runs an
  initiative (the caller's session is the container's orchestrator) or a chat of one of its member
  workspaces. It refuses a chat in no container, a container that runs no initiative, a card of no initiative
  that container runs, and a card that is not ready, blocked (naming its open blockers) or has an open
  attempt — in words; a size is not required. The orchestrator on its own — its turn answers no message of
  the human (`answersHuman`: only host updates such as a `board-ready` since its last reply) — is refused
  too while the initiative's autopilot is off, paused (as now) or the board runs `wipLimits.agents` agents.
  It starts the card through `startCard` with `into` the
  container, the workflow given or the size's, `Note from the orchestrator of the container "…":` and the
  note appended to the kickoff, logged `automation` *started by the orchestrator of the container "…"*.
- The tools that read a chat's board (`board_card_create`, `board_cards_list`, the roadmap's and discovery's)
  take a container's orchestrator — whose home is no project — to the board of the initiative it runs, so it
  files follow-ups into Triage.
- `board_initiative_get` also lists the **deferrals** of its member cards' task-specs (`Deferrals` sections of
  their open workspaces' task-specs through `specSection`, parsed like `card.deferrals`), minus those whose
  title a card of the board already has, for the close skill to file.

While the session is the orchestrator of a container that runs an initiative, the board's session extension
adds the `thinkrail-board-autopilot` system-prompt section in `before_agent_start` (`autopilotRule`): the
initiative, that `board-run` / `board-ready` updates are host automation (the latest `board-ready`
replacing the earlier, one withdrawing them while paused or off), how `board_card_start` starts a card,
that M and L cards wait for the human's design approval, and to file follow-ups into Triage. Core's
orchestrator rule names no board tool; `board_card_start` carries no guideline of its own, so other chats'
prompts stay as they were.

The tools' guidelines say two things:

- Read your card and treat its criteria as done.
- File deferred work into Triage, never steps of the current task.

## Skills

The package's own `skills/` (`pi.skills`), each a short `SKILL.md` — frontmatter `name` + a *Use when…*
description, numbered steps, red flags — that acts through the `board_*` tools; they are board skills, not
the workflow family's. Each roadmap and discovery chat's kickoff names one, and a user can pick one in any
chat. Besides the board's tools they name only web-access's (`web_search`, `fetch_content`,
`get_search_content`), the spec graph's and `ask_user_question`; analytics come through the user's MCP
tools when configured, session insights only if a tool for them exists:

| Skill | Does | Writes |
| --- | --- | --- |
| `roadmap-shape` | raw idea (or a promoted discovery idea, read with `board_ideas_list`) → initiative: outcome tied to a goal capability, checkable criteria, rabbit holes, no-gos, horizon; asks (`ask_user_question`) when a product decision is missing | `board_initiative_create_draft` (rabbit holes and no-gos in the outcome, so card kickoffs carry them; a promoted idea's `ideaId` links it); an existing initiative is only proposed in the chat |
| `roadmap-plan` | initiative → roadmap project with milestones and sized, linked cards grounded in the specs (`spec_search`, `spec_get`) and code; never starts work | `board_project_create`, then one `board_cards_create_batch` into Triage |
| `roadmap-report` | a draft update from `board_initiative_get` and `board_initiative_activity`: done, stuck, forecast, next, a suggested health | `board_update_draft`; never publishes |
| `roadmap-review` | every open initiative: forecast vs target, blocked chains, waits for the human, WIP, appetite → a list of moves, trims, deferrals | `board_initiative_move`, each only after the human confirmed it (`ask_user_question`) |
| `discovery-research` | an idea researched on the web (competitors, pricing, reviews, user signals) into a report citing every claim, in the workspace's `.thinkrail/context/`; never scores | `board_idea_add_evidence` (the report as artifact, key sources as url) |
| `discovery-analyze` | an idea against the goal spec (capability moved, non-goals), competitors from its evidence and the signals it can reach, the effort from the code | one `board_idea_score` (value, effort with reasons citing evidence, horizon); a human's score stays |
| `competitor-watch` | the watchlist (or one entry) refreshed, a dated cited report, stable plain-text snapshots, what changed per entry | `board_watchlist_snapshot` per entry; an idea for a gap only once the user agrees (`board_idea_create`) |
| `initiative-close` | criteria checked against the cards; the goal-and-requirements Capabilities edit (or the owning spec's) shown as a diff, made in the Default workspace on approval with a PR suggested; its task-specs' deferrals filed | `board_cards_create_batch`; `board_initiative_close` only after the human confirmed |

## Web half

The web half ([[submodule-ext-board-web]]) is presentation over these queries and nothing more: the Board
side tool (Board, List, Roadmap with Discovery, Insights), the card, initiative and idea panels in Peek, the
"Needs you" status item, the container section and Board mode. It holds no board state of its own — every
surface re-reads on `board.changed` (and, where a last action shows, `board.activity`) —, so the rules,
refusals and limits above are the server's alone; where the UI shares a rule (Start's size workflow, the
attention limits' warning) it mirrors the server's rather than deciding.

## SDK consumption

The board reaches the host only through the SDK ([[module-extension-api]]), and was the first consumer of
most of its host seams; each arrived in the slice that used it.

- **Facts** (`ExtensionHostServices`): `sessionScope` (the open projects and their workspaces),
  `workspaceFacts` (the live overlay, § Rules), `taskSpecs` and `specSection` (§ Task-specs, the Product
  bullets of § Smart review, `board_initiative_get`'s deferrals), `openspecTree` (§ OpenSpec), `planSummary`
  (the review packet), `models` (the Start form), `githubProblem` (§ GitHub issues) and `containers`
  (§ Autopilot), beside `dataDir` and `log`.
- **Actions**: `createWorkspace` (Start and Apply, `into` a running initiative's container), `startChat`
  (roadmap, discovery and Propose chats), `sendToChat` (*Archive in workspace*), `runInWorkspace` (`gh` and
  `openspec`, argv only), `writeWorkspaceFile` (Publish; Apply's carry-over and `x-thinkrail`), `assist`
  (§ Size suggestions), `createContainer` / `startOrchestrator` / `wakeOrchestrator` (§ Autopilot) and
  `reviewConformance` / `addReviewComments` (§ Smart review).
- **Lifetime and events**: `hostService` runs `Board.listen` over `host.events` (§ Events) and
  `host.publish`es `board.changed` and `board.activity`; `sessionExtensions` adds the `board_*` tools and the
  orchestrator's prompt section; `skillPackages` stages the skills.
- **Web**: one `sideTools` entry (the Board tool), three `panels` shown in Peek through `PanelHost.peek`, one
  `statusItems` entry, one `containerSections` entry and one `layoutPresets` entry, all over `PanelHost`'s
  (or the status item's) `query`, `onEvent`, `openChat`, `openFile`, `openWorkspace` and `peek`, plus the
  layout-mode members for Board mode ([[submodule-ext-board-web]]).

## Verification

Each section's behavior is covered where it lives; the lists below say where, not every case.

- **Server units** (`server/*.test.ts`, over the fake host `testHost.ts`):
  - the store (`store.test.ts`: round-trip, defaults, the move-aside, the newer-version refusal, the version-1
    cards file migrated on read), ids and prefixes, the presets, the rule table with its idempotence and
    the kickoffs (`pure.test.ts`, `rules.test.ts`); the queries' validation, every card write, overlays, WIP
    and the inbox, and the rules wired to the fake host's events (`board.test.ts`);
  - the sources (`sources.test.ts`): task-specs bound and unbound, Adopt, deferrals and their parsing,
    GitHub through a fake `gh` (argv, the TTL, the filter, the kept error, storing on a write, `Closes #N`
    only when missing, its retry, queued with *Add to PR*) and size suggestions (strict parsing, a human's
    size never overwritten, the debounce);
  - each roadmap derivation on its own (`rollups`, `throughput`, `forecast`'s determinism and
    not-enough-data, `health`'s rule table, `schedule` with pins, conflicts, milestones and cycles,
    `insights` with `activity`'s window, `snapshot`'s determinism) and, through the queries and tools (`roadmap.test.ts`), the CRUD,
    links refusing cycles, pins and `shiftChain`, external cards, draft updates, `roadmap.chat` per kind,
    the roadmap tools and `roadmap.publish`;
  - discovery (`discovery.test.ts`): its store, the CRUD, human vs suggested scores (`board_idea_score`
    never overwriting a human's), the watchlist snapshot, the three kickoffs and Promote;
  - autopilot: the pure rules as tables (`autopilot.test.ts`: readiness, the pause order and the limits,
    free slots, offers once, again once, then flagged) and the service through queries and tools
    (`autopilotService.test.ts`: Run and its refusals, offers capped and listing every outstanding one, the
    pause and the withdrawal, a switch-off racing an evaluation, the debounce, a gone container,
    `board_card_start` and its refusals, `answersHuman`, the orchestrator's prompt section);
  - smart review (`review.test.ts`): the requirement assembly, the verdict join, comments only for unmet
    lines and not twice, the packet's determinism and neutralized markers, the PR body upsert, and
    `card.review` / `card.packet` / `card.packetToPr` over the fake host and a fake `gh`;
  - `index.test.ts`: `skillPackages` resolves to the eight skills, every roadmap and discovery chat names
    one, and each skill names only registered tools.
- **OpenSpec** (`server/openspec/*.test.ts`, `server/openspecSource.test.ts`, `web/openspec.test.tsx`): the
  parse held to every recorded fixture (`list`, `status`, `show --deltas-only`), the checkbox edge cases,
  schemas, the YAML subset and the `x-thinkrail` upsert (byte-equal to what `validate --strict` passed and
  archive kept); the source over a fake host (the probe and its TTL, the CLI's runs once per tree and
  authoritative, materializing, Apply's kickoff, carry-over and metadata, live progress from the attempt's
  workspace, Validate, Archive, Propose); the web tile, panel and actions.
  `scripts/record-openspec-fixtures.ts` re-records the fixtures for a CLI version; it is not run in CI.
- **Host** (`packages/server/src/host/`): `extensionActions.test.ts` validates every action the board uses
  and its refusal while switched off; `conformanceReview.test.ts` the reviewer's parse, task and comments;
  `orchestratorWakeups.test.ts` the extension wake-ups' coalescing; `openspecTree.test.ts`,
  `lastActions.test.ts` and `extensionHost.test.ts` the facts; `extensionEventsWire.test.ts` the gated
  `extension.event` push, the host service following the switch and a project's close and reopen;
  `agent/extensions.test.ts` and `buildSupport.test.ts` the skills loaded, dropped while off and staged under
  `extensions/board`.
- **Web** (`web/*.test.ts(x)`): [[submodule-ext-board-web]] § Verification.
- **No-agent e2e** (`e2e/board.spec.ts`, the fake `gh`, no CLI on its PATH and the deterministic reviewer seam
  of e2e/SPEC.md): create, edit and Start a card (the kickoff captured without a model), drag and Alt+→ as
  overrides, List and Solo, the switch-off placeholder through a reload; a task-spec card adopted and its
  deferrals sent once; GitHub issues shown, stored by an edit and hidden; the inbox across two projects and
  its topbar counter; Board mode entered and left with the layout unchanged; a WIP limit and Start's
  warning; Triage's Accept all; follow selection off and on; the roadmap (an initiative created, moved,
  given criteria, a card and *Plan with agent*), the step graph's pin, link, cycle refusal and unlink, the
  timeline, Insights' empty and seeded charts, Publish and *Close initiative*; OpenSpec's recorded fixture
  as cards, Apply carrying the change with `x-thinkrail`; Discovery's idea, evidence, matrix and Promote, and
  *What changed?*; smart review's table, chip, packet, *Add to PR* once and its Review comment; Run
  initiative's container, the autopilot switch and its pause shown in the container's overview.
- **Live e2e** (`@agent`, `bun run e2e:full <spec>`): `board.live.spec.ts` (an S card's last action seen while
  its agent works, then the card in Review), `board-roadmap.live.spec.ts` (*Plan with agent* filing a linked
  group into Triage), `board-review.live.spec.ts` (smart review with the real reviewer),
  `board-discovery.live.spec.ts` (*Analyze* suggesting both scores with reasons) and
  `board-autopilot.live.spec.ts` (the orchestrator woken with `board-ready` starting the next card with
  `board_card_start`).

## Deferrals

Not built — known limitations, not a plan:

- cost / time per card;
- live re-reads when a task-spec file changes (the host pushes no file events to extensions; the board
  re-reads on its own writes, chat and review changes and workspace switches);
- a task-spec committed to the branch shows in every unbound workspace that has it;
- removing a "blocks" link from the tools;
- autopilot's scheduling windows, budgets beyond time, and priority across initiatives;
- a "What if you answered now?" toggle on the step graph (the schedule has no wait estimate);
- a history of waits for the human (Insights counts only the open ones) and reopening a closed initiative
  (a new idea is shaped from the board through Discovery's Promote);
- another board's write does not publish the boards whose initiatives list its cards as external;
- discovery: a scheduled watch, automatic signal ingestion (issues, analytics, session insights), and a
  session-insights tool for the agent (the analyze skill uses one only if it exists);
- smart review: the spec-drift check, risk tiers and routing, the whole-mission review across a container, and
  screenshots in the packet's verification (the plan fact carries none);
- OpenSpec: its specs merged into ThinkRail's spec graph, multi-repo "stores", carrying a change's non-text files on Apply,
  a CLI installed meanwhile noticed before the probe's TTL, and file events (the board re-reads on chats'
  activity and its own writes, not on a file changing).
