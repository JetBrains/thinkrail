---
id: module-ext-board
type: module-design
status: draft
title: Board extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api]
references: [task-board-core, task-project-board, task-openspec-board, submodule-server-extensions, submodule-server-host, module-contracts, submodule-web-shell, submodule-web-shell-layout, module-ext-session-insights, task-discovery, module-ext-web-access, submodule-server-containers, task-smart-review, submodule-server-host-plan-review, submodule-server-reviews]
---

## Responsibility

A board per project whose cards launch agent work and follow it. **The column is the work status**: a
preset names the columns over fixed categories. **The agent's state is live**, computed per request
from host facts and never stored. **Host events move cards** through pure rules, and a human's move is
a logged override. Besides its own cards it shows three **sources**: the task-specs of the project's
workspaces, when switched on the project's open GitHub issues through the user's own `gh`, and the
project's **OpenSpec changes** (§ OpenSpec) with propose, apply and archive through the user's own
`openspec` CLI and skills. Above the cards sits a **roadmap** per board (§ Roadmap): initiatives, roadmap projects
with milestones, and what is derived from the live work — rollups, a forecast, a suggested health and the
step graph's schedule — and **flow insights** from the transition log. Before Shape sits **discovery**
(§ Discovery): ideas with evidence and a value × effort score, and a competitor watchlist. An initiative
**runs** in a container with an orchestrator, and its **autopilot** (§ Autopilot) has the host decide when a
card may start while the orchestrator decides how. **Smart review** (§ Smart review) checks a card's change
against its spec through the host's independent reviewer and writes a review packet. Eight skills
(§ Skills) put the agent to work: five on the roadmap (shape, plan, report, review, close) and three on
discovery (research, analyze, competitor watch). There is no portable pi package, because every tool acts
on host-owned state. The web half is the Board side tool (with its Roadmap — Discovery included — and
Insights views and *Publish roadmap snapshot…*), the card, the initiative and the idea in Peek, the
cross-project "Needs you" inbox (above the board and as a topbar counter), the initiative's section of a
container's overview and Board mode.

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
  in the web registry.
  - It imports `extension-api/web`, `contracts` types, `locales`, `ui`, React, `@dnd-kit/core` and, in the
    Roadmap view's lazy chunk alone, `@xyflow/react` (the catalog pin, 12.12.1), never its `./server` half: the wire shapes it reads are restated in `web/api.ts` (the roadmap's in
    `web/roadmapApi.ts`) and checked on arrival (an unknown shape is a `BoardReplyError`, a version skew), and
    `workflowFor` mirrors the server's size rule for the Start form's default.
  - It reaches the host only through its `PanelHost`.

## Store

The store lives at `<dataDir>/<projectId>/`, the extension's data folder (`~/.thinkrail/extensions/board/`):

- **`cards.json`**: `{ version: 2, prefix, nextNumber, cards }`. Version 2 renamed a card's roadmap project
  from `projectId` to `roadmapProjectId`, so `projectId` always names a ThinkRail project: a version-1 file is
  read with the old name (**migrated on read**) and written back as version 2. The other files are version 1.
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
- **Unreadable cards** (and initiatives, projects, ideas, watchlist entries, evidence) are dropped with a
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
- the roadmap's `roadmapProjectId?` (a roadmap project `P-n` of its board; `projectId` is always a ThinkRail
  project, on a card, in `card.assignProject` and in the tools alike), `milestoneId?` (one of that project's),
  `pinnedStart?` (an ISO date) and `estimateDays?` (absent: S 1, M 3, L 6; unsized counts as M).


## Roadmap

The model of `TASK-roadmap` (Linear's hierarchy), stored per board; everything derived is computed per
`roadmap.get` and never stored.

- **An initiative** is `{ id, parentId?, title, outcome, criteria[], horizon (now / next / later), rank,
  target? (ISO date), appetiteDays? (time only), specRefs[], health? { override?, note? }, updates[],
  cardIds[], externalCards[], proposed?, proposedBy?, closedAt?, containerId?, autopilot? { on, pausedReason? },
  createdAt, updatedAt }` (§ Autopilot for the last two). `closedAt` is set
  once, by the agent's `board_initiative_close` after the human confirmed it done in an initiative-close
  chat (a proposal can't close); a closed initiative stays on the roadmap, marked *Closed*. It nests (a top-level one is
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

## Discovery

The idea stage before Shape (`TASK-discovery`, `roadmap-options.md` §5a), stored per board in `discovery.ts`;
nothing about it is derived from the live work. The human decides; the agent suggests.

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
- **Discovery chats** (`discovery.chat`), like the roadmap's, start in the project's **Default** workspace
  with their skill first and stand-alone instructions: `research` (an idea: search and fetch with
  web-access, a cited report into the workspace's artifacts folder `.thinkrail/context/`
  `research-<id>-<day>.md`, attached as artifact evidence with its key sources as url evidence),
  `analyze` (an idea: the goal spec through `spec_search`, competitors from its evidence, session insights
  only if a tool for them is available — the session-insights extension ships none — and the user's
  analytics MCP tools if configured; then one `board_idea_score`) and `watch` (the watchlist, or one entry:
  a dated report `competitor-watch-<day>.md`, a snapshot per entry, what changed). The chat runs in the
  Default workspace, so its report lands in that workspace's artifacts (a container's chat in the
  container's shared ones).

## Autopilot

`TASK-autopilot` (workstream G): **the host decides *when*, the container's orchestrator decides *how***.
The rules are pure (`autopilot.ts`); the host service (`autopilotService.ts`) applies them.

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
  `wipLimits.agents` (the concurrency cap; 0 is none) — at most the free slots — and **pause** them all while
  Review, then Needs you, is past its limit (`count > limit`, 0 is none; Start's warning reads the same) or
  the container has no orchestrator: `pausedReason { kind: review | needs_you, count, limit }` or `{ kind:
  orchestrator }`.
- **Re-evaluation.** While the host service runs and some initiative has autopilot on with a container,
  every `board.changed` (writes, bound chats' state and review signatures, tool starts) and every
  `container.updated` / `removed` asks for one evaluation after `AUTOPILOT_DEBOUNCE_MS` (2 s), one at a time.
  It records a changed `pausedReason` (a write, so `board.changed`); a container that went away clears
  `containerId` and switches autopilot off.
- **Offers, no flood** (`planOffers`): a selected card is offered once in a **`board-ready`** wake-up listing
  the cards offered now (id, title, size → workflow, whether its design waits for the human) and the room
  left under the cap; offered and not started within `OFFER_RETRY_MS` (10 min) it is offered again once (a
  timer arms the next due offer), then **flagged** *Orchestrator didn't start it* and never offered again
  while it stays ready; a card that is no longer ready is forgotten. Offers live in memory (a restart offers
  again). A failed wake-up keeps no offer, so the next evaluation tries again.
- **Wake-ups go through the host's coalescing** (`wakeOrchestrator`, [[submodule-server-containers]] §
  Wake-ups), one card per kind in flight; the board never sends a raw chat message to the orchestrator.
- **`board_card_start`** (§ Agent tools) is how the orchestrator starts a card; M and L cards still start on
  brainstorming, so their design waits for the human, and merging still needs the human's approval in chat.
- **Human gates:** off by default, paused with its reason while a human-attention limit is past, the
  brainstorm workflow, the merge approval, and the switch the human turns off at any time (offers
  forgotten); every start is logged with actor `automation`.
- **`AutopilotView`** (`autopilot.get`, `autopilot.ofContainer`): `{ projectId, initiativeId, title, on,
  pausedReason` (computed now, `null` while off)`, container { id, name, members, orchestrator { projectId,
  workspaceId, sessionId } | null } | null, running, cap, ready[{ id, title, size?, offered, stale }] }`.

## Smart review

`TASK-smart-review` (workstream H): spec conformance and a review packet. The verdict is **advisory**: it
approves nothing, moves no card, and the human still merges.

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
  markdown (`renderPacket`: deterministic, the same inputs write the same bytes). It works once the workspace is
  gone, without its plan and diff.
- **`card.packetToPr { cardId }`** upserts the markdown as the `## Review packet` section of the latest attempt's
  pull request through the user's `gh` (`gh pr view <n> --json body`, then `gh pr edit <n> --body-file`), the
  `Closes #N` pattern: only the text between `<!-- thinkrail:review-packet -->` and
  `<!-- /thinkrail:review-packet -->` changes (`upsertPacket`, the last complete pair; appended once otherwise),
  and an unchanged body is not edited (`updated: false`). Refused without a pull request.
- Deferred: the spec-drift check, risk-tier routing and the whole-mission review.

## Presets

Presets are pure (`presets.ts`). Triage and Canceled are hidden lanes in both. The first category a
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

## Rules

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

## OpenSpec

The board reads and writes OpenSpec changes (`TASK-openspec-board`, integration depth O2; the unified spec
graph, O3, is not this). Everything about a change is **derived from its files**, never stored.

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
  to change. Without the CLI the board is read-only: it parses the files.
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
- **Validate** runs `openspec validate <name> --strict --json` where the card reads its change and answers
  its issues; **Propose** (`＋ Propose change`) starts a chat in Default on `/skill:openspec-propose
  <description>`; both, and Archive, are queries below.
- **Archive timing — decided by the agent, unconfirmed, reported to the user:** a change is archived **in
  its apply workspace, before the PR merges**, so the PR carries the code and the merged spec deltas
  together — ThinkRail's "a change updates its specs in the same change" rule. *Archive in workspace* asks
  that attempt's chat (`actions.sendToChat`, a follow-up): "Run openspec-archive-change <name>, then update
  the PR." The card then reads the archived copy there (stage Archived); the merge completes it.
- **Without the CLI**, Validate and Archive (a mechanical merge the CLI does) are disabled with the install
  command; Propose and Apply only need the skills in the agent's workspace — without them the kickoff's
  text alone instructs.

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

- **`board.get { projectId }`** → `{ projectId, projectName, prefix, settings, columns, cards, wip, github,
  openspec }`, each card with its `live[]`; `openspec` is `{ present, cli, checking }` (Default has
  `openspec/`, the CLI's version or `null`). It refuses a project that is not an open repository.
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
  - It calls `actions.createWorkspace` — `into` the container of the initiative the card serves while
    that container exists, so every start of a running initiative's card joins its container — and then
    records the attempt and applies Start. It answers the card, the attempt and any `kickoffError`.
- **`openspec.validate { cardId, projectId? }`** → `{ change, workspaceId, valid, errors, warnings, issues }`
  (refused without the CLI or for an archived change), **`openspec.archive { cardId, projectId? }`** →
  `{ cardId, workspaceId, sessionId, text }` (a stored card with an open attempt and a chat; refused without
  the CLI) and **`openspec.propose { projectId, description }`** → `{ projectId, workspaceId, sessionId,
  kickoff, kickoffError? }`: see § OpenSpec. An `openspec:<change>` id needs the `projectId`, as `#N` does;
  `card.get`, `card.update`, `card.move` and `card.start` take it, `card.delete` refuses it.
- **`card.review { cardId }`** → `{ cardId, requirements }`, **`card.packet { cardId }`** → the packet and
  **`card.packetToPr { cardId }`** → `{ cardId, pr, url?, updated }`: see § Smart review.
- **`card.adopt { cardId }`**, **`card.deferrals { cardId, specId }`** → `{ created, skipped }`,
  **`github.set`** → `{ settings, problem }` and **`github.refresh`**: see § Sources.
- **`settings.get` / `settings.update { projectId, preset?, wipLimits?, followSelection? }`**.
- **`models.list {}`** → `{ models }`, the host's `models()` — the models a new chat can use, as host facts
  — for the Start form's picker.

The roadmap's queries (§ Roadmap) take the board's `projectId`; every write publishes `board.changed`:

- **`roadmap.chat { projectId, kind, initiativeId? }`** (`kind`: `plan`, `shape`, `report`, `review` or
  `close`; all but `review` need the initiative, and `close` refuses one already closed) starts a **roadmap
  chat**: a new chat in the project's **Default** workspace through the host's `actions.startChat`, and
  answers `{ projectId, workspaceId, sessionId, kickoff, kickoffError? }` for the web half to open it. The
  kickoff (`roadmapKickoff`) starts with its skill (§ Skills) — `/skill:roadmap-plan` (`-shape`, `-report`,
  `-review`) or `/skill:initiative-close` —, exactly as the composer sends a picked skill, then the task in one
  line, the initiative's id, title, outcome, success criteria, horizon, target and appetite (a review lists
  every open initiative instead), and instructions that stand on their own — which `board_*` tools to read
  and write with, what to propose rather than change, what waits for the human's confirmation —, so the
  prompt still works on a host that left the skills out.
- **`roadmap.publish { projectId, path? }`** writes the roadmap snapshot (`snapshot.ts`, dated today UTC) into
  the project's **Default** workspace through the host's `actions.writeWorkspaceFile` at `path` (up to 400
  characters) or the settings' `snapshotPath`, and remembers a new path there; the host refuses an unsafe
  path and the board passes its refusal on. It answers `{ projectId, workspaceId, path, bytes }`. Storage
  stays local: the file is the user's to commit and open a PR with; the board never commits.
- **`insights.get { projectId, weeks? }`** (1–52, default 12) → `insights.ts`'s answer for that board.
- **`roadmap.get { projectId }`** → `{ projectId, projectName, initiatives` (depth-first, each with `depth`,
  `childIds`, `memberCardIds`, `memberExternalCards`)`, projects, externalCards` (title, category, size,
  project name, or `missing`)`, rollups { initiatives, projects, milestones }, health, forecast` (by
  initiative id)`, schedule, critical` (each initiative's critical node ids)`, throughput, cycleTimes,
  insufficientData { throughput, initiatives } }`.
- **`initiative.create { projectId, title, outcome?, criteria?, horizon? (later), parentId?, target?,
  appetiteDays?, specRefs? }`**, **`initiative.update { projectId, initiativeId, …, parentId / target /
  appetiteDays: null clears, health { override?, note? } (null clears each), proposed: false accepts }`**,
  **`initiative.delete`**, **`initiative.move { projectId, initiativeId, horizon, rank? }`**.
- **`initiative.run { projectId, initiativeId }`**, **`initiative.autopilot { projectId, initiativeId, on }`**,
  **`autopilot.get { projectId, initiativeId }`** → `AutopilotView` and **`autopilot.ofContainer { containerId }`**
  → the `AutopilotView` of the initiative the container runs, or `null`: § Autopilot.
- **`initiative.addCards` / `initiative.removeCards { projectId, initiativeId, cardIds }`**: card ids name
  one card across boards, so another board's card becomes an external card.
- **`initiative.updateDraft.save { projectId, initiativeId, text, health }`** and
  **`initiative.updateDraft.publish { projectId, initiativeId, text?, health? }`** (without a draft, `text`
  makes one).
- **`project.create { projectId, title, initiativeId?, milestones? }`**, **`project.update { projectId,
  roadmapProjectId, title?, initiativeId? (null frees), proposed: false }`**, **`project.delete`**;
  **`milestone.create { projectId, roadmapProjectId, title, target? }`**, **`milestone.update { projectId,
  milestoneId, title?, target? (null clears) }`**, **`milestone.delete`**.
- Discovery's (§ Discovery): **`discovery.get { projectId }`** → `{ projectId, projectName, ideas` (each with
  `initiative? { id, title }`)`, watchlist }`; **`idea.create { projectId, title, pitch? }`**, **`idea.update
  { projectId, ideaId, title?, pitch?, value? / effort? { score, reasons? } (null clears), dismissed? }`**,
  **`idea.delete`**, **`idea.addEvidence { projectId, ideaId, kind, ref, quote?, workspaceId? }`** (a human's),
  **`idea.removeEvidence { projectId, ideaId, evidenceId }`**, **`idea.promote { projectId, ideaId }`** and
  **`discovery.chat { projectId, kind (research / analyze / watch), ideaId?, watchId? }`** (research and
  analyze need the idea; watch refuses an empty watchlist) → the started chat as `roadmap.chat` answers it;
  **`watchlist.create { projectId, name, urls?, notes? }`**, **`watchlist.update { projectId, watchId, name?,
  urls?, notes? }`**, **`watchlist.delete`**. Ids are case-insensitive.
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

- **Header**: the project's name, the preset switch (Agentic kanban / Solo, and Spec-driven while Default has `openspec/` → `settings.update`), the WIP
  figures (*Needs you*, *Review*, *Agents* as `count/limit`, `feedback-error` and `data-over` past the limit;
  a limit of 0 is none and shows the count alone), the view switch (Board / List / Roadmap / Insights), the Board mode toggle
  (*Board mode* / *Exit Board mode*, `PanelHost.layoutPreset`, absent on a host without modes), the board
  settings (a popover with the *Follow selection* switch and the three WIP limits, 0–99 →
  `settings.update { wipLimits }` on *Save*), the overflow menu (`RiMore2Line`, *More*) with *Publish roadmap
  snapshot…* and *New card*,
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
- **An OpenSpec change's tile** (`OpenspecTileLines`) shows the artifact chain chip — each artifact's
  initial, P · S · D · T for spec-driven, looking done / ready / blocked / skipped —, its delta chips per
  capability (`auth +2 ~1`, `−n` removed, `→n` renamed), the tasks bar *x/y tasks*, the validation badge
  (*Valid* / *Invalid: n errors, n warnings*, from the CLI's last `validate --all`), *Next: <artifact>* while
  planning and *Unknown schema* with its reason; an unstored change's tile shows the change's name. It offers
  **Apply** (`canApply`: tasks written, not archived, no attempt running) instead of Start.
- **The header** offers *＋ Propose change* while Default has `openspec/` (an inline description →
  `openspec.propose`, then its chat opened), the preset switch the Spec-driven preset only then
  (`presetsFor`), and, in that preset without the CLI, the install hint (`npm install -g
  @fission-ai/openspec`).

**The Roadmap view** (`RoadmapPane`) reads `roadmap.get` for the same project and re-reads it on its own
writes and every `board.changed`; it does not depend on the board having cards. Its sub-switch is *Now /
Next / Later*, *Timeline*, *Goals*, *Step graph* and *Discovery* (below), beside *Roadmap review* (a `review`
roadmap chat). The derivations it draws are pure (`web/roadmapApi.ts`,
`web/roadmapGraph.ts`, the graph's edits in `web/graphEdits.ts`):

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
- **Step graph** (`stepGraphLayout` over `roadmap.get`'s `schedule` and the Board tool's own `board.get` for
  titles and agent states): the whole board or one initiative (a picker; an initiative shows its member cards
  and its projects' milestones with its own `critical` path). x is time — today at 0, a day 40 px (*Days*) or
  16 px (*Weeks*), a week line per Monday, the today line, lane bands — all SVG in a `ViewportPortal`, their
  labels held at the visible edges. Lanes are the roadmap projects in order, then *No project*, each lane's
  nodes packed first-fit into rows (`packRows`, a 12 px clearance, a milestone's label counted). A card is
  as wide as its span (at least 72 px) and looks its status (`nodeStatus`, `NODE_LOOKS`): done dimmed,
  working `primary` with a spinner, waiting `feedback-warning` with the hatched wait from today to its end,
  failed `feedback-error`, started `primary-muted`, Triage dashed `series-3`, Ready / Backlog neutral;
  critical rings `feedback-warning`, a conflict borders `feedback-error`, a pin shows `RiPushpinFill` and a
  non-critical card its slack *+Nd*. A milestone is a diamond with its date (`feedback-warning` critical,
  `feedback-error` late). Links are `blocks` (and a card's edge to its milestone, not deletable): critical
  `feedback-warning` animated, conflict `feedback-error` dashed, each with its arrow. The header gives the
  finish, each milestone's forecast date and the critical path; a legend sits under the canvas; MiniMap and
  zoom controls. **Editing**: a card not started and with no agent working or waiting drags along time, y
  held to its row, snapped to days (`dragCommit`): the drop → `card.pin` at its day, with Shift →
  `card.shiftChain` by the days moved (from the start the host counts from); the same day is no edit, and an
  arrow key on a selected card pins it a day over. A right handle dragged to a card's left handle →
  `card.link`; one closing a cycle (`linkRefusal`, over the board's `blocks`) is refused in place with an
  error notice and no query. A selected or focused link and Delete / Backspace → `card.unlink`. A pinned
  card's context menu (right click, or the context-menu key on a focused node) has *Unpin* → `card.unpin`,
  beside *Open in Peek* and *Open workspace*. A click peeks the card (a milestone its project's initiative),
  a double click enters its open attempt's workspace. A dragged node and a deleted link hold their place
  until the next answer replaces the view; each edit reports in a status line over the canvas for 5 s.
- **Timeline** (`timelineLayout`, the same scale): a row per initiative, depth-first, its bar from its
  member cards' earliest scheduled start (else its creation) to its target, else its 50 % forecast, else its
  cards' latest end, filled as done (`rollupBar`), the 50–85 % forecast band hatched in `feedback-info`
  when there is one, the target a diamond; *insufficient data* leaves plain bars and says so in the toolbar.
  An initiative with roadmap projects unfolds them under it (their cards' span and milestones). Dashed arrows
  join the initiatives `initiativeDependencies` links; a click opens the initiative (a project's) in Peek.
- **The graph and the timeline are one lazy chunk** (`RoadmapFlow`, `React.lazy` from `Roadmap.tsx`), so
  neither the entry chunk nor the Board tool's carries `@xyflow/react`; the app's build shares xyflow with
  the session-insights process map. They follow [[module-ext-session-insights]]'s process-map rules:
  `base.css` imported only `layer(xyflow)` (`web/roadmapFlow.css`), a layer `apps/web`'s `index.css` orders
  below `components` and `utilities` so token utilities win, every `--xy-*` variable mapped to a semantic
  token there, `colorMode` from `<html data-theme-appearance>` (`data-theme` is a theme id) followed through
  `onThemeSwap`, xyflow's screen-reader texts from locale keys (`ariaLabelConfig`), and the attribution kept,
  restyled with token utilities on the frame. Nodes carry their width, height and handles, so xyflow never
  waits on a measure; node and edge looks are token utilities, SVG attributes or classes, never style objects.

**Discovery** (`DiscoveryPane`, `web/Discovery.tsx`; its math pure in `web/discoveryApi.ts`) reads
`discovery.get` on its own — whatever `roadmap.get` answered — and re-reads on its writes and `board.changed`:

- **Ideas**: *Idea* opens an inline title field → `idea.create`, then the new idea in Peek. Beside the list
  (side by side from 720 px, else stacked) sits the **value × effort matrix**, plain SVG at its frame's
  measured width (`matrixLayout`): effort left to right, value bottom to top, each score 1–5 a cell's centre;
  the quadrants split between 2 and 3 (`quadrantOf`: a 3 counts as high on either axis) — *Quick wins*
  `feedback-success-subtle`, *Big bets* `feedback-info-subtle`, *Fill-ins* `control-bg`, *Time sinks*
  `feedback-warning-subtle` —; a dot per idea with both scores (the dismissed left out) — a circle, `primary`
  confirmed, dashed `primary-subtle` while either score is suggested, `feedback-success` promoted, under a
  transparent `<button>` in a `foreignObject` that peeks the idea —, ideas sharing a cell side by side within
  it, a lone dot labelled with its id, and *N ideas need a value and an effort*. The **list** (`rankIdeas`): open ideas by value
  (high first) then effort (low first), then promoted, then dismissed (dimmed), each row its id, title,
  `V4? · E2` (a `?` marks a suggestion) and status; a click peeks it.
- **Competitor watchlist** (*Checked only when you ask*): *Competitor* opens a form (name, URLs, notes) →
  `watchlist.create`; each entry edits its name, URLs (links, add / remove) and notes in place
  (`watchlist.update`), is removed behind a confirm, and offers **What changed?** (`discovery.chat { kind:
  watch, watchId }`, the chat opened). It shows the last snapshot's date, *Open report* (Peek, in the
  workspace the report was written in) and its text folded, and — once there is a `previous` — the **line
  diff** of the last two snapshots (`lineDiff`, a longest-common-subsequence diff; `diffHunks` folds unchanged
  runs past two lines of context), added lines `feedback-success`, removed `feedback-error`, or *Nothing
  changed*.

**The idea in Peek** is the `idea` panel (scope `session`, params `{ projectId, ideaId }`, the crumb `<id> ·
<title>`), reading `discovery.get` and re-reading on its writes and `board.changed`: the id, status and, once
promoted, *Promoted to I-n · <title>* opening the initiative in Peek; the title and pitch; **Value and effort**,
each a 1–5 select (*Not scored* clears) → `idea.update`, *Suggested* with **Confirm** while the agent's,
and its reasons (add / remove); the **suggested horizon** with its reason; the **evidence** — a link opens
in the browser (http(s) only), a report opens in Peek (`peekWorkspaceFile`: here when Peek belongs to its
workspace, else entering it), a note reads as text —, each with its quote and who added it, removable, and a
form adding a link, a report path (in the panel's workspace) or a note with a quote; **Research**,
**Analyze** (`discovery.chat`) and **Promote** (`idea.promote`), each opening its chat (`openStartedChat`), a
returned `kickoffError` shown as the prompt not sent — a promoted or dismissed idea keeps only Research —;
*Dismiss* / *Bring back* and *Delete idea* behind a confirm.

**Publish roadmap snapshot…** opens a dialog (mounted while open) with the file path — the board's
`snapshotPath`, editable — and *Publish* → `roadmap.publish`; it then says *Wrote ROADMAP.md in the Default
workspace. Commit it and open a PR…* and offers *Open in Peek* (`peekWorkspaceFile`: `PanelHost.peek` when the
panel's workspace is the Default one, else `openWorkspace` with the file as its `peek`). A refusal shows in
the dialog.

**The Insights view** (`InsightsPane`, `web/Insights.tsx`; its math pure in `web/insightsApi.ts`) reads
`insights.get` for the board's project with a window switch (*4 / 12 / 26 weeks*, 12 by default) and re-reads
on `board.changed`. Six plain-SVG chart cards (two columns from 720 px, else one), each drawn at its card's
measured width (a `ResizeObserver`) with a `<title>` and a `<desc>` summing it up (`role="img"`), a legend,
and *Not enough data yet* instead of an empty plot: **work in progress** (a `series-1` line), **throughput per
week** (`series-7` bars, the partial week dashed), **cycle time** (a dot per completed card in `series-7`, the
50 % and 85 % percentiles as dashed `series-3` / `series-4` lines), **work item age** (dots per in-progress
column, started `series-3` and review `series-1`, those past the SLE `feedback-warning`, the SLE a dashed
`series-4` line), the **cumulative flow** (stacked bands, done `series-7`, review `series-1`, started
`series-3`, ready `ramp-2`, backlog `series-8`) and **where time goes** (one bar: agent working `series-3`,
waiting for you `primary`, in review `series-1`, with hours and shares, and the note that only open waits
count). No chart library.

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
- **Run and autopilot** (`autopilot.get`, re-read with the panel): without a container *Run initiative*
  (`initiative.run`, not for a proposal or a closed one, a returned `kickoffError` shown as the prompt not
  sent) with its hint; with one *Open container* (the orchestrator's chat, `PanelHost.openChat`; without an
  orchestrator Run again), *Container “…” · N workspaces* and the *Autopilot* switch (`initiative.autopilot`);
  then the state line (`board-autopilot-state`: *Autopilot on*, *Paused: Review is over its limit (6/5)* —
  Needs you, no orchestrator —, *Autopilot off*), *Agents n/cap* and the next ready cards, each marked
  *Offered to the orchestrator* or *Orchestrator didn't start it*, a click peeking the card;
- **Agent**: *Plan with agent*, *Shape with agent*, *Draft update*, *Roadmap review* and *Close initiative* —
  each a roadmap chat (`roadmap.chat`) opened with `PanelHost.openChat`; a returned `kickoffError` is shown as
  the prompt not sent; a closed initiative (*Closed*, also on its horizon card) keeps only *Draft update* and
  *Roadmap review* — and the draft update when there is one, with *Publish*
  (`initiative.updateDraft.publish`, stamping `publishedAt`) and *Edit* (its text and health →
  `initiative.updateDraft.save`);
- *Delete initiative* behind a confirm.

**The container's section** (`containerSections.initiative`, `ContainerAutopilot`) in the container overview
in Peek: `autopilot.ofContainer`, re-read on any project's `board.changed`; nothing for a container no
initiative runs, else *Initiative I-n · title* (peeking the initiative) and the same state line, agents and
ready cards.

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
  milestone → `card.assignProject` —, its planned start when the step graph pinned one, with *Unpin*
  (`card.unpin`), the description, the acceptance criteria and spec refs (add / remove), the
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
  host's reason), and *Delete card* behind a confirm;
- **an OpenSpec change's card** (`OpenspecSection`, in place of Start): its stage, chain, tasks and
  validation, its folder, a tab per artifact (*Proposal*, *Spec deltas*, *Design*, *Tasks*) whose files open
  in Peek (`PanelHost.peek({ kind: "file" })`, rendered as markdown there; another workspace's through
  `openFile`) — the deltas tab lists each capability's requirements by operation, the tasks tab the task
  lines —, and **Apply** (`card.start`), **Validate** (`openspec.validate`, its issues listed) and **Archive in
  workspace** (`openspec.archive`, while an attempt's chat is open); without the CLI Validate and Archive are
  disabled beside the install hint, and the archive-timing decision is stated under them.

- **Smart review** (`SmartReviewSection`, `web/SmartReview.tsx`, below the attempts of a stored card with one):
  the advisory hint, *Smart review* / *Review again* (`card.review`; disabled without an open latest attempt and
  while `reviewing`, which shows *Reviewing…*), a failure (`reviewError` or the refusal), then the **conformance
  table** — each requirement with its source, its verdict chip (`feedback-success` met, `feedback-error` unmet,
  `feedback-warning` untested), its evidence (`path:line` opening the file at its line: Peek when the attempt's
  workspace is the panel's, else `openFile` in its own; `openEvidence`) with notes, and its tests —, the tally and
  the summary; *Open review comments* while an item has a comment and the workspace is open
  (`openWorkspace { reveal: "review" }`, that workspace's Review); and the **packet** (`card.packet`, re-read per
  review): why, what, how it was verified and time, with *Add to PR* (`card.packetToPr`, disabled without the
  attempt's pull request) reporting *Added…* or *already carries…*. A reviewed tile shows its chip (`7/8 met`,
  `ConformanceChip`), toned by its worst verdict.

Its UI text is `board.*` keys, the roadmap's `board.roadmap.*`, discovery's `board.discovery.*`, smart review's
`board.review.*`.

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
- **`board_initiative_create_draft { title, outcome, criteria?, horizon?, ideaId? }`** and
  **`board_project_create { initiativeId, title, milestones? }`**: proposals (`proposed: true, proposedBy:
  agent`) a human accepts; an `ideaId` promotes that idea to the initiative (§ Discovery).
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
  attempt — in words; a size is not required. It starts the card through `startCard` with `into` the
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
initiative, that `board-run` / `board-ready` updates are host automation, how `board_card_start` starts a
card, that M and L cards wait for the human's design approval, and to file follow-ups into Triage. Core's
orchestrator rule names no board tool; `board_card_start` carries no guideline of its own, so other chats'
prompts stay as they were.

Their guidelines say two things:

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
| `roadmap-plan` | initiative → project with milestones and sized, linked cards grounded in the specs (`spec_search`, `spec_get`) and code; never starts work | `board_project_create`, then one `board_cards_create_batch` into Triage |
| `roadmap-report` | a draft update from `board_initiative_get` and `board_initiative_activity`: done, stuck, forecast, next, a suggested health | `board_update_draft`; never publishes |
| `roadmap-review` | every open initiative: forecast vs target, blocked chains, waits for the human, WIP, appetite → a list of moves, trims, deferrals | `board_initiative_move`, each only after the human confirmed it (`ask_user_question`) |
| `discovery-research` | an idea researched on the web (competitors, pricing, reviews, user signals) into a report citing every claim, in the workspace's `.thinkrail/context/`; never scores | `board_idea_add_evidence` (the report as artifact, key sources as url) |
| `discovery-analyze` | an idea against the goal spec (capability moved, non-goals), competitors from its evidence and the signals it can reach, the effort from the code | one `board_idea_score` (value, effort with reasons citing evidence, horizon); a human's score stays |
| `competitor-watch` | the watchlist (or one entry) refreshed, a dated cited report, stable plain-text snapshots, what changed per entry | `board_watchlist_snapshot` per entry; an idea for a gap only once the user agrees (`board_idea_create`) |
| `initiative-close` | criteria checked against the cards; the goal-and-requirements Capabilities edit (or the owning spec's) shown as a diff, made in the Default workspace on approval with a PR suggested; its task-specs' deferrals filed | `board_cards_create_batch`; `board_initiative_close` only after the human confirmed |

A capability's closing edit is a normal PR the user opens; the board writes no spec itself.

## Verification

- **Unit** (`server/*.test.ts`):
  - store round-trip, the move-aside, the newer-version refusal, the defaults and the version-1 cards file
    migrated on read (`projectId` → `roadmapProjectId`);
  - prefixes and ids, the presets, the rule table (idempotence included) and the kickoff text;
  - query validation, create / update / move / delete / accept / start, overlays, WIP and inbox;
  - the rules wired to a fake host's events and Triage-only creation by the tools;
  - autopilot: the pure rules as tables (`autopilot.test.ts`: readiness by category, blocker category,
    activity and size; the pause order and the limits at, past and without a limit; the free slots; the
    selection; offers once, again once, then flagged, forgotten when no longer ready, no due time in the
    past) and, through the queries and tools over the fake host's containers (`autopilotService.test.ts`),
    Run making a container of the first ready card with its orchestrator and `board-run` brief (logged
    `automation`), Run reusing a container and its refusals, the switch needing a container, `board-ready`
    offers capped by the agents' room and deduplicated over the retry, the pause recorded and lifted, a gone
    container switching autopilot off, a human's Start joining the container, `board_card_start`'s start
    into the container with its note and its refusals (no container, no initiative, another initiative's
    card, not ready, blocked, unknown), a member chat's start, and the orchestrator's prompt section;
  - the roadmap: the derivations each on their own (`rollups`, `throughput` with the day helpers, `forecast`'s
    determinism and not-enough-data, `health`'s rule table, `schedule` with pins, conflicts, milestones,
    cycles and per-initiative critical paths) and, through the queries (`roadmap.test.ts`), validation,
    initiative / project / milestone CRUD, assignment, links refusing cycles, pins and `shiftChain`, external
    cards, draft updates, `roadmap.get`'s rollups, schedule, forecast and health, the kickoff's initiative
    context, the cards' `initiative` overlay, `roadmap.chat` (the Default workspace, each kind's skill and
    text, `close` and its refusal once closed, a `kickoffError` passed on), the roadmap tools (proposals, a
    Triage batch with its links, the draft update, activity, move, close, the deferrals listed),
    `roadmap.publish` (the Default workspace, the remembered path, a host refusal passed on) and
    `insights.get`'s validation;
  - `insights.test.ts` (WIP and the flow replayed per day, throughput, cycle-time percentiles and the SLE,
    work item age, the time split with open waits, the empty window) with `activity.ts`'s window, and
    `snapshot.test.ts` (the markdown and its determinism);
  - smart review (`review.test.ts`): the requirement assembly (criteria, Product bullets, deltas with their
    scenarios, a recorded change's), comments for unmet items with a line only, the verdict join, the time split,
    the packet's markdown and its determinism, the PR body upsert's idempotency (an unclosed marker left alone),
    and through the queries over the fake host `card.review` (running, refused twice, the verdicts stored, one
    comment for the unmet line under *Smart review*, not again on a re-run, its refusals, a failure kept on the
    card), `card.packet` from the plan fact and `card.packetToPr` through a fake `gh` (one edit, then none; refused
    without a PR; a gh failure passed on);
  - `index.test.ts`: `skillPackages` resolves to the eight skills (names matching their folders, *Use when*
    descriptions), every roadmap and discovery chat names one, and each names only registered `board_*` tools
    and web-access's (as its SPEC names them), the spec graph's and `ask_user_question`;
  - discovery: the store (`ideas.json`, `watchlist.json`: round-trip, defaults, malformed scores and evidence
    dropped, the move-aside, the newer-version refusal) and, through the queries and tools
    (`discovery.test.ts`), validation, idea / evidence / watchlist CRUD with board.changed, human scores and
    dismissal, the three kickoffs (skill, idea or watchlist, report path, the Default workspace,
    `kickoffError`), the agent's ideas and workspace-relative evidence, `board_idea_score` never overwriting a
    human's score, `board_watchlist_snapshot` keeping and answering the previous snapshot, and Promote: the
    Shape kickoff with the idea, the drafted initiative linked back, a second promotion refused;
  - the sources (`sources.test.ts`): task-specs bound vs unbound, placement by live facts, Adopt once,
    refused writes, watched chats, deferrals sent once and their parsing; GitHub through a fake `gh`
    (argv, the Default workspace, the TTL, Refresh, the filter, the error kept beside the last issues,
    storing on edit / move / start, the kickoff, `Closes #N` appended only when missing, the PR body only,
    the retry); size suggestions (strict parsing, a human's size never overwritten, skipped without a
    model or switched off or for an agent's card, the debounce, issues' cards).
- **Host-level, smart review**: `extensionActions.test.ts` covers `reviewConformance` (under the latest chat or
  the named one, with the services' signal; refused while switched off, for a chat workspace, bad requirements or
  no chat; one at a time per workspace, freed on failure; refused once the signal aborted) and
  `addReviewComments` (the author, the extension's title by default, validated remarks);
  `conformanceReview.test.ts` the verdict parse (strict, ordered, unknown ids dropped), the task, the run on plan
  review's reviewer child with the conformance role and the reviewer model, and labelled comments falling back to
  review-level when a line does not resolve; `extensionHost.test.ts` the `planSummary` fact.
- **Host-level**: `packages/server/src/host/extensionActions.test.ts` covers `createContainer`,
  `startOrchestrator` and `wakeOrchestrator` (validated, refused while switched off or for an unknown
  container, the wake handed to the host's coalescing under the extension's title) and
  `orchestratorWakeups.test.ts` the extension wake-ups' coalescing; `extensionActions.test.ts` also covers `startChat` (a repository
  workspace only, the kickoff validated, refused while switched off, `kickoffError` passed on) and
  `writeWorkspaceFile` (written atomically with folders, refused: absolute, `..`, `.`, empty segments,
  `.git`, NUL, symlinks on the way, a folder target, past 1 MiB); `agent/extensions.test.ts` loads the board's
  skills and drops them while it is off, and `buildSupport.test.ts` stages them under `extensions/board`;
  `packages/server/src/host/extensionEventsWire.test.ts` covers the gated
  `extension.event` push and the host service following the Settings switch.
- **Host-level** also: `packages/server/src/host/openspecTree.test.ts` covers the `openspec/` read (only
  its markdown and YAML, sorted; `null` without it; no symlink followed, the folder itself included; the
  size and file caps with `truncated`) and `extensionHost.test.ts` the fact per workspace (none for a chat or
  a workspace not open); `packages/server/src/host/lastActions.test.ts` covers the last-action target (a
  workspace-relative path, nothing outside the worktree, a bash command's cut start, the folders shortened,
  nothing for other tools) and the tracker (latest start only, dropped once disposed or deleted);
  `extensionEventsWire.test.ts` a project's close and reopen republishing its board, a rename not.
- **Web, smart review** (`web/smartReview.test.tsx`): the tally, Smart review's and Add to PR's availability,
  the evidence's Peek and tab targets, the three queries and the packet's reply check, the tile's chip by worst
  verdict, the section (table, chips, evidence, tests, comments link, disabled Add to PR), running, failed and
  unavailable.
- **Web** (`web/*.test.ts(x)`): autopilot (`autopilot.test.tsx`: the state line on, paused by each reason and
  off, the agents figure with and without a cap, offered and flagged ready cards, Run without a container
  and Open container with the switch with one, none for a closed initiative, the queries Run, the switch and
  the container read send, and the reply checks); the agent badge by overlay state, the working last action and its tile line,
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
  initiative panel; the step graph and timeline (`roadmapGraph.test.tsx`): x mapping, ISO days and Mondays,
  row packing, lanes and their bands, statuses, slack, pins, waits, links' critical and conflict, an
  initiative's scope and critical path, the timeline's bars, bands, done fill, unfolded projects and links,
  the status look mapping, the drop's pin / shift / none, the writes each edit sends (`card.pin`,
  `card.shiftChain`, `card.link` with its cycle refusal, `card.unlink` only for `blocks` links, `card.unpin`)
  and both views rendered (xyflow's server render); Insights (`insights.test.tsx`): the chart math (scales,
  nice maxima and ticks, flow bands, the time split, the spread), each chart's data check, the six charts
  rendered with titles, descriptions, percentile and SLE lines or their not-enough-data states, and Publish's
  query and Peek target; the panel's *Close initiative* and a closed initiative's chip; discovery
  (`discovery.test.tsx`): the quadrant split, the matrix placement (cell centres, shared cells spread, the
  dismissed left out, the unscored counted), the ranking, the line diff and its folding, the rendered matrix,
  diff and watchlist (the diff only with a previous snapshot), every panel write's query, the chats' queries
  and `openChat`, `discovery.get`'s check, the idea and report Peek targets, and the rendered idea panel
  (suggested and confirmed scores, evidence links — http(s) only —, actions by status).
- **OpenSpec** (`server/openspec/*.test.ts`, `server/openspecSource.test.ts`, `web/openspec.test.tsx`):
  conformance of the parse against every recorded fixture (`list`'s counts and archived flag, the stage,
  `status`'s schema, chain, `missingDeps` and next artifact, an unknown schema's error, `show
  --deltas-only`'s deltas per capability), the checkbox edge cases (fences and comments count, as the
  recorded CLI does), globs, delta sections, schemas and `skip_specs`, the YAML subset and the
  `x-thinkrail` upsert (byte-equal to the recorded file `validate --strict` passed; kept through the
  recorded archive); the source over a fake host: nothing without `openspec/`, the parse without the CLI
  (one probe per project, retried after its TTL), the CLI's three runs once per tree and authoritative, the
  preset's columns, materializing on a move, Apply's kickoff, carry-over and `x-thinkrail`, live progress
  and archive from the attempt's workspace, Validate, Archive and Propose; the web: the preset offered by
  `openspec.present`, Apply by stage, the tile by stage, the panel's tabs, the disabled Validate with the
  install hint, and the actions' queries and Peek targets. `scripts/record-openspec-fixtures.ts` re-records
  the fixtures (`server/openspec/fixtures/<case>/`) for a given CLI version; it is not run in CI.
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
  carries the outcome; the step graph: three cards (two linked, two in a roadmap project with a milestone)
  as nodes with the link, a node dragged three days right pinned (the card in Peek shows that date), a link
  drawn handle to handle (a conflict, the dragged card being pinned earlier), a cycle refused in place, a
  link clicked and deleted; the timeline: the initiative's bar and target with not enough data, the link to
  the initiative it blocks, its project unfolded and a click opening it in Peek; Insights: six empty states
  on an empty board, then a seeded flow history drawing every chart (dots per completed card, the window
  switch, percentile and SLE lines, one card past the SLE, five flow bands); Publish writing `ROADMAP.md` in the
  fixture repository (the Default workspace) with its headings, *Open in Peek* showing it, and *Close
  initiative* starting a chat whose kickoff starts `/skill:initiative-close`; OpenSpec: the recorded
  in-progress fixture copied into the fixture repository's `openspec/` (no CLI on the e2e PATH) offers
  *Propose change* and the Spec-driven preset, its change a virtual card in *In progress* with *3/7 tasks*,
  its delta chips and four done artifacts, the install hint over the board, in Peek Validate disabled beside
  the hint, the tasks and deltas tabs, then Apply: a stored card whose workspace's kickoff (no model) starts
  `/skill:openspec-apply-change add-2fa-login`, the change carried into that worktree with its
  `.openspec.yaml`'s `x-thinkrail { card, workspace }`, and the tile reading its tasks from there;
  Discovery: an idea created, a URL evidence added in Peek (a link), value 5 and effort 1 set, its dot in
  *Quick wins* and its row in the list, *Promote* starting a chat whose kickoff (the `idea.promote` reply)
  starts `/skill:roadmap-shape` and carries the pitch; a competitor added to the watchlist and *What
  changed?* starting `/skill:competitor-watch` on it.
- **No-agent e2e, smart review** (`e2e/board.spec.ts`, the deterministic reviewer seam of e2e/SPEC.md): a card
  with two criteria started, a committed file and a pushed branch with the fake `gh`'s PR, *Smart review* → the
  table met / unmet with its evidence, the tile's *1/2 met*, the packet; *Add to PR* writing one marked section
  after the PR's description (one `gh pr edit`, then *already carries*); *Open review comments* entering
  `workspace-1` with the unmet line's comment under *Smart review* in its Review.
- **No-agent e2e, autopilot** (`e2e/board.spec.ts`): an initiative of two Ready S cards in Peek, *Run
  initiative* → its container in Projects with one member and the orchestrator, the first card in Building,
  the second the next ready card; the switch on, a Review limit of 1 pausing it (*Paused: Review is over its
  limit (2/1)*, recorded on the initiative over the wire), the switch on after a reload, and the container's
  overview in Peek showing the initiative and the paused state.
- **Live e2e, autopilot** (`e2e/board-autopilot.live.spec.ts`, `@agent`): an initiative of two linked S cards
  set up over the wire, Run starting the first (logged *started by Run initiative I-1*), autopilot on, the
  first card into Review by its agent, then moved to Done (the human's merge) → the second ready, the
  orchestrator woken with `board-ready` and starting it with `board_card_start` into the container (logged
  *started by the orchestrator of the container …*).
- **Live e2e** (`e2e/board.live.spec.ts`, `@agent`, through `bun run e2e:full e2e/board.live.spec.ts`): an S
  card asking for a one-line README example, started from Peek; the tile's last-action line seen while
  the agent works (recorded by a `MutationObserver`, since it is transient); the card in Review with its
  diff, the badge finished and the line gone. `e2e/board-roadmap.live.spec.ts` (`@agent`): *Plan with
  agent* on an initiative with an outcome and two criteria → at least two cards in Triage from one chat
  (one group), at least one `blocks` link among them, read from `board.get` over the wire.
  `e2e/board-review.live.spec.ts` (`@agent`): a small S card with two criteria finished by its agent into Review,
  then *Smart review* with the real reviewer → a verdict per criterion, the tile's chip and the packet.
  `e2e/board-discovery.live.spec.ts` (`@agent`): *Analyze* on an idea with a pitch and a quoted evidence →
  the idea suggested a value and an effort, each with reasons, read from `discovery.get`.

## Deferrals

These land later:

- cost / time per card;
- live re-reads when a task-spec file changes (the host pushes no file events to extensions; the board
  re-reads on its own writes, chat and review changes and workspace switches);
- a task-spec committed to the branch shows in every unbound workspace that has it;
- removing a "blocks" link from the tools;
- autopilot's scheduling windows, budgets beyond time, and priority across initiatives;
- the prototype's "What if you answered now?" toggle on the step graph (the schedule has no wait estimate);
- a history of waits for the human (Insights counts only the open ones) and reopening a closed initiative
  (a new idea is shaped from the board through Discovery's Promote);
- another board's write does not publish the boards whose initiatives list its cards as external;
- discovery: a scheduled watch, automatic signal ingestion (issues, analytics, session insights), and a
  session-insights tool for the agent (the analyze skill uses one only if it exists);
- smart review: the spec-drift check, risk tiers and routing, the whole-mission review across a container, and
  screenshots in the packet's verification (the plan fact carries none);
- OpenSpec: the unified spec graph (O3), multi-repo "stores", carrying a change's non-text files on Apply,
  a CLI installed meanwhile noticed before the probe's TTL, and file events (the board re-reads on chats'
  activity and its own writes, not on a file changing).
