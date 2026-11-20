---
id: submodule-ext-board-web
type: submodule-design
status: active
title: Board web half
parent: module-ext-board
depends-on: [module-extension-api]
references: [module-contracts, submodule-web-shell, submodule-web-shell-layout, module-ext-session-insights]
---

## Responsibility

The board's UI: **Board view** — the whole workbench given to the board, its navigation on the left, its
Board, List, Roadmap, Graph, Timeline, Insights and Discovery views in the center, what is happening below
—, the card (with its attempt's live chat), initiative and idea panels in Peek, the cross-project "Needs
you" status item and an initiative's section of a container's overview. It owns presentation and the pure view math only: every
fact, rule and write is the server half's, reached through its queries ([[module-ext-board]] § Queries).

## Boundary

- `web/index.ts` is the `defineWebExtension` descriptor ([[module-ext-board]] § Boundary). The half imports
  `extension-api/web`, `contracts` types, `locales`, `ui`, React, `@dnd-kit/core` and, in the Roadmap view's
  lazy chunk alone, `@xyflow/react` (the catalog's pin) — never its `./server` half.
- **Restated, checked wire shapes.** The answers it reads are restated in `web/api.ts` (the roadmap's in
  `web/roadmapApi.ts`) and checked on arrival: an unknown shape is a `BoardReplyError`, a version skew, not
  a crash. `workflowFor` mirrors the server's size rule for the Start form's default.
- **The host only through `PanelHost`** (or the status item's host): `query`, `onEvent`, `openChat`,
  `openFile`, `openWorkspace`, `peek`, `openView` and `renderChat` ([[module-extension-api]]).
- Its UI text is `board.*` keys, the roadmap's `board.roadmap.*`, discovery's `board.discovery.*`, smart
  review's `board.review.*`.

## Cross-cutting rules

- **Reads follow events, never a pushed state.** Each surface reads its query and re-reads on its own
  writes and on `board.changed` for its project (`PanelHost.onEvent`); `board.activity` re-reads only the
  surfaces that show an agent's last action (Board view's center, its agents list, the card panel, the
  initiative panel's `board.get`), never the inbox. The last answer stays shown while a re-read is in flight.
- **Peek belongs to a workspace.** Its entries are workspace-relative, so a file in the panel's workspace
  opens in Peek (`PanelHost.peek({ kind: "file" })`), and another workspace's either in a tab there
  (`openFile`, which enters it: task-spec files, OpenSpec artifacts, review evidence) or in that
  workspace's Peek (`openWorkspace` with the entry as its `peek`, `peekWorkspaceFile`: reports and the
  published snapshot). Following a card into its workspace likewise shows it in *that* Peek.
- **Attention warns, never blocks.** While Review or Needs you is past its limit (`attentionOverLimit`,
  Review first; the same `count > limit` autopilot pauses on), Start asks inline — *Review is over its limit
  (6/5) — finish before starting?* with *Start anyway* / *Not now* — on a tile and in the card panel alike.
- **A started chat opens; a prompt not taken says so.** A control that starts a roadmap, discovery or
  Propose chat opens it with `PanelHost.openChat` (`openStartedChat`); a returned `kickoffError` shows as
  the prompt not sent there, on *Run initiative* and on the card panel's Start, while a tile's Start leaves a
  failed kickoff to the host's toast. A refusal shows where it was asked.
- **Adaptive by its own width**, never the window's: the roadmap, Insights and Discovery switch side-by-side
  layouts to stacked below 720 px of the center (`boardLayout`), and charts are drawn at their frame's
  measured width. The board's columns always sit side by side, scrolling.
- **A center open leaves Board view**: following a card into its workspace, an attempt's *Open chat* or
  *Open workspace*, a task-spec in another workspace and a started roadmap, discovery or Propose chat go
  where they go and the shell leaves the view to show them; the rail icon brings it back as it was (the
  selection below is kept). Peek entries and the card's Chat tab keep it.

## Board view

`views.board` (*Board view*, `RiKanbanView2`) is the board's one surface ([[submodule-web-shell]] § Extension
views): the `main` panel in the center, the `nav` side tool leading the left (0.16 of the workbench), the
`activity` side tool leading the bottom (0.26), Peek on the right saying *Select a card* while empty. It is
entered from its rail toggle, the palette and the counter's *Open board*, and left by the same toggle, the
palette and *Back to workbench*. The three surfaces share one **selection per window** (`boardState.ts`, a
module store, never persisted): the project shown (`shownProject`: the picked one while it is open, else
the active workspace's), the center view, and the cards' narrowing — an initiative, a queue, the saved
filters. Picking another project clears the initiative and the queue; picking an initiative or a queue
shows the Board (or List) view.

### Navigation (left)

`BoardNav` (`board-nav`): **Projects** — the open projects (`projects.list`, re-read on any board's change)
with their active card counts and an attention dot while the inbox holds one of their cards, one shown at a
time; **Initiatives** — *All cards*, then the roadmap's initiatives in tree order (proposals left out),
indented by depth, with their member counts and an attention dot while a member's agent waits or failed;
**Queues** — *Needs you*, *Triage*, *Review* (`count/limit`, marked past it) and *Failed*; **Filters** —
*Mine* (created by a human), each type and each size, toggles that combine. Each narrows the center's cards
(`filterCards`: an initiative's members, its nested initiatives' and roadmap projects' included); the
center names what it shows (*Showing …*) with *Clear filters*, and says *No cards match the filters* when
none does.

### Center

`BoardMain` (`board-main`) reads the shown project's `board.get` and, while an initiative narrows it,
`roadmap.get`. Loading, empty (*No cards yet — create one or ask the agent to break work down*) and error
(with *Retry*) states replace the body; a failed write shows a dismissible notice.

- **Header**: the project's name; the view switch (Board / List / Roadmap / Graph / Timeline / Insights /
  Discovery); the preset switch (`presetsFor`, [[module-ext-board]] § Presets), with *＋ Propose change*
  while Default has `openspec/` (an inline description → `openspec.propose`, its chat opened) and, in the
  Spec-driven preset without the CLI, the install hint (`npm install -g @fission-ai/openspec`); the WIP
  figures (*Needs you*, *Review*, *Agents* as `count/limit`, marked past the limit; a limit of 0 is none and
  shows the count alone); the GitHub menu (show / hide → `github.set` — a `missing` or `unauthenticated` gh
  answers with the notice to install gh or run `gh auth login` —, and while on the filter and *Refresh
  issues*); the board settings (*Follow selection* and the three WIP limits, 0–99); the overflow menu
  (*Publish roadmap snapshot…*); *New card* (an inline title → `card.create`, then the card in Peek).
- **GitHub banner**: a failed fetch shows *Couldn't fetch GitHub issues: <gh's line>* with *Refresh issues*
  and *Dismiss* (until the error changes); the board and the last good issues stay.
- **Inbox** ("Needs you · N · All projects"): the `inbox` query's cards of every open project, re-read on
  any project's `board.changed`, as chips that wrap. A row names the project, the card (a click peeks it),
  the reason (*Question pending* / *Failed*), **Answer** or **Retry** — the card in Peek on its Chat tab,
  where the human answers or retries; with no workspace active, the attempt's chat (`answerInbox`) — and
  *Open workspace* (the attempt's chat in its workspace); absent while nobody waits.
- **Columns** side by side (`board-column`); Canceled shows only while it holds cards. A column of Review
  cards only shows *WIP* `count/limit` against the Review limit, marked past it (Solo's Doing mixes started
  cards in and shows its count alone).
- **Triage** is a lane of its own at the board's start, not a column, present while it holds cards and
  collapsed to *Triage · N* by default. Expanded, it groups the cards by `origin.sessionId` (`triageGroups`:
  *Filed from TR-4's chat*, *Filed from a chat*, *Filed by an agent*; a card's sent deferrals as *Deferred
  from TR-4*), each group with *Accept all* → `triage.accept` — **a decomposition is accepted as a whole** —
  and *Dismiss* behind an inline confirm (`card.delete` each); a card shows its suggested size (`M?`), peeks
  on a click and has its own *Accept*.
- **A card tile** shows its id (a task-spec's card its spec's id, an issue's `#N`), its source badge, type,
  size (`M?` when suggested), title, initiative chip, task-specs with their status, the agent badge of its
  latest open attempt (`agentBadge`: working, waiting for you, failed — interrupted included —, finished,
  finished · unread) with, while the agent works (`workingAction`), its last action on one line (cut with an
  ellipsis, whole in its tooltip), the plan's progress, the diff, the PR chip, the blockers and, once
  reviewed, the conformance chip (`7/8 met`, `ConformanceChip`, toned by its worst verdict). An unbound
  workspace's task-spec card shows *Adopt* (`card.adopt`) and never drags. *Start* shows on a backlog or
  unstarted card with no open attempt — an unstored issue's card included, which Start stores — with the
  size's workflow and the host's defaults; the host's toast reports a kickoff that failed.
- **An OpenSpec change's tile** (`OpenspecTileLines`) shows the artifact chain (each artifact's initial,
  P · S · D · T for spec-driven, done / ready / blocked / skipped), its delta chips per capability (`auth +2
  ~1`, `−n` removed, `→n` renamed), *x/y tasks*, the validation badge from the CLI's last `validate --all`,
  *Next: <artifact>* while planning and *Unknown schema* with its reason; an unstored change's tile shows
  the change's name. It offers **Apply** (`canApply`:
  tasks written, not archived, no attempt running) instead of Start.
- **Moving**: cards drag between columns with `@dnd-kit/core` → `card.move`, the logged override. A card is
  a focusable button: Enter or a click peeks it (`selectCard`), a double click enters its open attempt's
  workspace (`enterCard` → `openWorkspace`, on its chat). **Follow selection** (off by default, applied at
  once from the settings) makes a click on a card with an open attempt also enter that workspace, the card
  shown in *its* Peek; a card without one only peeks. The local commands `board.moveLeft` /
  `board.moveRight` (Alt+← / Alt+→ in scope `board.cards`, rebindable) move it one shown column, focus
  following the card.
- **List** view: one table (id, title, column, size, agent, plan, PR) sorted by column then rank, or by
  rank; a title peeks its card.
- **Roadmap**, **Graph**, **Timeline**, **Insights** and **Discovery** are the views below, at the center's
  full width.

### Bottom: what is happening

`BoardActivity` (`board-activity-tool`) is two columns across the open projects, re-read on any board's
`board.changed` (the agents also on any `board.activity`): the **activity feed** (`activity.get { limit: 50
}`, newest first: the time, the card's id peeking it, the actor chip, *Created in …* / *From → To* /
*Deleted* and the project) and the **agents** (`agents.get`, *Agents · N*, ordered waiting, failed, then
working, oldest first — `sortAgents`): the badge, id, title, plan progress, the time on the attempt
(`elapsedText`, in days past two) and, while working, its last action; a click peeks the card (on its Chat
tab while its agent waits or failed), a double click enters its workspace on that chat.

## Card panel

The `card` panel (scope `session`: opened only from the board, params `{ projectId, cardId }`, the crumb
`<id> · <title>`) reads `card.get`. **Its writes go to the id `card.get` answered**, so an issue's card
stored by the first edit takes the next ones. A stored card is in **tabs — Details / Chat / Review /
Activity** —, opened on **Chat while its agent waits or failed** (`defaultCardTab`, decided once as the
card loads, so a state change never moves the reader), else on Details; an unbound workspace's task-spec
card has no tabs.

- **Chat** (`CardChat`): the latest attempt with an open workspace's live chat through `PanelHost.renderChat`
  — transcript, questions, composer —, so the human answers the agent here without leaving Board view;
  with several open attempts a picker (workflow · start); the agent badge and *Open workspace* above it;
  *No chat yet* before a Start and *Its attempts' workspaces are closed* after.
- **Review**: Smart review below (*Smart review needs a started card* before a Start). **Activity**: the
  transitions, newest first, with the host's reason.

**Details**:

- The fields: title (saved on Enter or blur), an issue's link (saying an unstored one is kept by an edit or
  Start), type, size — *Confirm size* re-saves a suggested one so it is no longer a suggestion —,
  description, acceptance criteria, spec refs, the cards it blocks (picked from the board) and those
  blocking it.
- **Roadmap** (`CardRoadmap`, over its board's `roadmap.get`): its initiative (opening it in Peek) and the
  *Initiative*, *Project* and *Milestone* selectors — an initiative moves it off those listing it directly
  onto the picked one (`setCardInitiative`: `initiative.removeCards` / `addCards`) and is fixed by a roadmap
  project that has one; project and milestone → `card.assignProject` —, and its pinned start with *Unpin*.
- **Task-specs**: each with its status and path, *Open* per the Peek rule above. A stored card's *Send
  deferrals to Triage* (`card.deferrals`) reports *Filed N deferrals into Triage* or *No new deferrals*. An
  unbound workspace's task-spec card shows instead its title, column, live line, task-spec and *Adopt*, then
  the stored card, and *Open workspace*.
- **Attempts**: each with its workflow, start time, live badge, chat title and last action (while the chat's
  session is live), plan, PR and notes, and *Open workspace* / *Open chat* while its workspace is open.
- **Start**: workflow (the size's by default, re-derived when the size or type changes), model and effort
  (*Default* = the host's new-chat choice; `models.list`, the effort list narrowed to the model's levels),
  base (empty = the project's default) → `card.start`. The attention warning reads the panel's one
  `board.get` (which the blocks picker shares); Start waits while it loads and does not ask when it failed.
- *Delete card* behind a confirm.
- **An OpenSpec change's card** (`OpenspecSection`, in place of Start): stage, chain, tasks and validation,
  its folder, a tab per artifact (*Proposal*, *Spec deltas* by capability and operation, *Design*, *Tasks*)
  whose files open per the Peek rule, rendered as markdown, and **Apply** (`card.start`), **Validate**
  (`openspec.validate`, its issues listed) and **Archive in workspace** (`openspec.archive`, while an
  attempt's chat is open); without the CLI Validate and Archive are disabled beside the install hint, and
  the archive-timing decision ([[module-ext-board]] § OpenSpec) is stated under them.
- **Smart review** (`SmartReviewSection`, `web/SmartReview.tsx`, the Review tab of a stored card with an
  attempt): the advisory hint, *Smart review* / *Review again* (`card.review`; disabled without an open latest
  attempt and while `reviewing`), a failure, then the **conformance table** — each requirement's source,
  verdict chip (success met, error unmet, warning untested), evidence (`path:line` opening the file at its
  line per the Peek rule, `openEvidence`) and tests —, the tally and the summary; *Open review comments*
  while an item has a comment and the workspace is open (`openWorkspace { reveal: "review" }`); and the
  **packet** (`card.packet`, re-read per review) with *Add to PR* (`card.packetToPr`, disabled without the
  attempt's pull request) reporting *Added…* or *already carries…*.

## Roadmap views

`RoadmapPane` reads `roadmap.get` for the shown project; it does not depend on the board having cards. It
is three of the center's views — **Roadmap** (*Now / Next / Later*, or *Goals* by its toggle), **Graph**
(the step graph) and **Timeline** —, each beside *Roadmap review* (a `review` roadmap chat). Its derivations are pure (`web/roadmapApi.ts`, `web/roadmapGraph.ts`,
the graph's edits in `web/graphEdits.ts`).

- **Now / Next / Later** (`horizonColumns`): three horizon columns holding every initiative, top-level and
  nested, by rank. A card shows its goal chip (the top-level ancestor; *Goal* on a top-level one), the
  parent as a crumb when it is not the goal, the title, the health chip (*suggested* unless a human
  overrode it), the **stack bar** (`rollupBar`: done, review, started, ready, backlog in SVG — Triage and
  Canceled left out) with *x/y cards · n %* and *Triage N*, agent dots (working, waiting, failed with
  counts), *N blocked*, the appetite used (warning past 80 %) and the dependency hint
  (`initiativeDependencies`: *After “X”* when a card of X blocks one of its cards; a card counts for the
  deepest initiative holding it, and relatives never wait for each other). It drags between horizons
  (`horizonMove` → `initiative.move`); each column's *Initiative* creates one there (`initiative.create {
  horizon }`, then it in Peek); an agent's proposal is dashed, *Proposed*, with *Accept* (`proposed:
  false`) and *Discard* (`initiative.delete`). A click opens it in Peek.
- **Goals** (`goalGroups`): each top-level initiative as a group — its spec refs as chips (a
  goal-and-requirements capability, say), figures and health — listing its descendants in tree order, each
  with its horizon, stack bar and health.
- **Step graph** (`stepGraphLayout` over `schedule` and the center's own `board.get` for titles and agent
  states): the whole board or one initiative (its member cards, its roadmap projects' milestones and
  its own `critical` path). x is time — today at 0, *Days* or *Weeks*, a week line per Monday, the today line
  —, in SVG in a `ViewportPortal` with labels held at the visible edges. Lanes are the roadmap projects in
  order, then *No project*, their nodes packed first-fit into rows (`packRows`, a milestone's label
  counted). A card is as wide as its span and looks its status (`nodeStatus`, `NODE_LOOKS`: waiting hatched
  from today to its end); critical, conflict, pin and slack are marked; a milestone is a diamond (critical,
  late). Links are `blocks` (and a card's edge to its milestone, not deletable). The header gives the
  finish, each milestone's forecast date and the critical path.
  **Editing**: a card not started with no agent working or waiting drags along time, its row held, snapped
  to days (`dragCommit`): the drop → `card.pin` at its day, with Shift → `card.shiftChain` by the days moved
  (from the start the host counts from); the same day is no edit, and an arrow key pins a selected card a
  day over. A right handle dragged to a card's left handle → `card.link`; one closing a cycle (`linkRefusal`,
  over the board's `blocks`) is refused in place with an error notice and no query. Delete / Backspace on a
  selected or focused link → `card.unlink`; a pinned card's context menu (right click, or the context-menu
  key on a focused node) has *Unpin*, beside *Open in Peek* and *Open workspace*. A click peeks the card (a
  milestone its project's initiative), a double click enters its open attempt's workspace. A dragged node
  and a deleted link hold their place until the next answer replaces the view; each edit reports in a
  status line for 5 s.
- **Timeline** (`timelineLayout`, the same scale): a row per initiative, depth-first, its bar from its
  member cards' earliest scheduled start (else its creation) to its target, else its 50 % forecast, else
  its cards' latest end, filled as done, the 50–85 % forecast band hatched, the target a diamond;
  *insufficient data* leaves plain bars and says so. Roadmap projects unfold under their initiative (their
  cards' span and milestones); dashed arrows join the initiatives `initiativeDependencies` links; a click
  opens the initiative (a project's) in Peek.
- **The graph and the timeline are one lazy chunk** (`RoadmapFlow`, `React.lazy` from `Roadmap.tsx`), so
  neither the entry chunk nor the center's carries `@xyflow/react`; the app's build shares xyflow with
  the session-insights process map. They follow [[module-ext-session-insights]]'s process-map rules:
  `base.css` imported only `layer(xyflow)` (`web/roadmapFlow.css`), a layer `apps/web`'s `index.css` orders
  below `components` and `utilities` so token utilities win, every `--xy-*` variable mapped to a semantic
  token there, `colorMode` from `<html data-theme-appearance>` (`data-theme` is a theme id) followed through
  `onThemeSwap`, xyflow's screen-reader texts from locale keys (`ariaLabelConfig`), and the attribution
  kept, restyled on the frame. Nodes carry their width, height and handles, so xyflow never waits on a
  measure; looks are token utilities, SVG attributes or classes, never style objects.

## Initiative panel

The `initiative` panel (scope `session`, params `{ projectId, initiativeId }`, the crumb `<id> · <title>`)
reads `roadmap.get` and `board.get` for that board:

- the id, horizon, health and *Proposed* (*Accept* / *Discard*), then the editable fields — title, horizon,
  target, appetite (empty clears), parent (any initiative outside its subtree), outcome, criteria, spec
  refs → `initiative.update`;
- **Progress** (the stack bar by category) and **Health**: the suggestion when overridden, the reasons
  worded from their kinds, the human's override (*Use the suggestion* clears it) and note;
- **Agents now**: the member cards whose agent works, waits or failed, the last action while working, and
  *Answer* / *Open chat*;
- **Forecast and appetite**: the 50 % / 85 % dates — or *Not enough data — needs ≥3 weeks of history* with
  its reason —, *Nothing left to do*, the appetite bar;
- **Projects and milestones**: each roadmap project (rename, delete behind a confirm, its stack bar), its
  milestones (rename, target, delete, add), a picker putting a board card into it (`card.assignProject`)
  and *Add a project* (`project.create { initiativeId }`); **Cards**: the member cards with column and badge,
  other boards' labelled *From <project>*, the directly listed ones removable and a picker adding one
  (`initiative.addCards` / `removeCards`);
- **Run and autopilot** (`autopilot.get`): without a container *Run initiative* (not for a proposal or a
  closed one); with one *Open container* (the orchestrator's chat; without an orchestrator, Run again),
  *Container “…” · N workspaces* and the *Autopilot* switch; then the state line (`board-autopilot-state`:
  *Autopilot on*, *Paused: Review is over its limit (6/5)* — Needs you, no orchestrator —, *Autopilot
  off*), *Agents n/cap* and the next ready cards, each marked *Offered to the orchestrator* or
  *Orchestrator didn't start it*, a click peeking the card;
- **Agent**: *Plan with agent*, *Shape with agent*, *Draft update*, *Roadmap review* and *Close initiative*,
  each a roadmap chat; a closed initiative (*Closed*, also on its horizon card) keeps only *Draft update* and
  *Roadmap review*. The draft update, when there is one, has *Publish* (`initiative.updateDraft.publish`)
  and *Edit* (`initiative.updateDraft.save`) — the human publishes, never the agent;
- *Delete initiative* behind a confirm.

## Discovery view

`DiscoveryPane` (`web/Discovery.tsx`, its math pure in `web/discoveryApi.ts`) reads `discovery.get` on its
own, whatever `roadmap.get` answered.

- **Ideas**: *Idea* creates one (`idea.create`, then it in Peek). Beside the list sits the **value ×
  effort matrix**, plain SVG (`matrixLayout`): effort left to right, value bottom to top, each score 1–5 a
  cell's centre; the quadrants split between 2 and 3 (`quadrantOf`: a 3 counts as high on either axis;
  unconfirmed with the user) — *Quick wins*, *Big bets*, *Fill-ins*, *Time sinks* —; a dot per idea with both
  scores (the dismissed left out), dashed while either score is suggested, marked once promoted, a
  transparent `<button>` in a `foreignObject` peeking it; ideas sharing a cell sit side by side, a lone dot
  labelled with its id, and *N ideas need a value and an effort*. The **list** (`rankIdeas`): open ideas by
  value (high first) then effort (low first), then promoted, then dismissed (dimmed), each with `V4? · E2`
  (`?` a suggestion); a click peeks it.
- **Competitor watchlist** (*Checked only when you ask*): entries created and edited in place (name, URLs,
  notes), removed behind a confirm, each with **What changed?** (`discovery.chat { kind: watch, watchId }`).
  It shows the last snapshot's date, *Open report* (in the workspace the report was written in), its text
  folded and — once there is a `previous` — the **line diff** of the last two (`lineDiff`, a
  longest-common-subsequence diff; `diffHunks` folds unchanged runs past two lines of context), or *Nothing
  changed*.

## Idea panel

The `idea` panel (scope `session`, params `{ projectId, ideaId }`, the crumb `<id> · <title>`) reads
`discovery.get`: the id, status and, once promoted, *Promoted to I-n · <title>* opening the initiative; the
title and pitch; **Value and effort**, each a 1–5 select (*Not scored* clears) → `idea.update`, *Suggested*
with **Confirm** while the agent's, and its reasons; the **suggested horizon** with its reason; the
**evidence** — a link opens in the browser (http(s) only), a report per the Peek rule, a note as text —,
each with its quote and who added it, removable, and a form adding one (a report path in the panel's
workspace); **Research**, **Analyze** (`discovery.chat`) and **Promote** (`idea.promote`), each opening
its chat — a
promoted or dismissed idea keeps only Research —; *Dismiss* / *Bring back* and *Delete idea* behind a
confirm.

## Insights view

`InsightsPane` (`web/Insights.tsx`, its math pure in `web/insightsApi.ts`) reads `insights.get` with a
window switch (*4 / 12 / 26 weeks*, 12 by default). Six plain-SVG chart cards — **no chart library** —,
each with a `<title>` and a `<desc>` summing it up (`role="img"`), a legend, token series colours and *Not
enough data yet* instead of an empty plot: work in progress, throughput per week (the partial week
dashed), cycle time (the 50 % and 85 % percentiles as lines), work item age (by column, those past the SLE
marked, the SLE a line), the cumulative flow and where time goes (agent working, waiting for you, in
review, with hours and shares, and the note that only open waits count).

## Publish

*Publish roadmap snapshot…* opens a dialog (mounted while open) with the board's `snapshotPath`, editable,
and *Publish* → `roadmap.publish`; it then says *Wrote ROADMAP.md in the Default workspace. Commit it and
open a PR…* and offers *Open in Peek* (`peekWorkspaceFile`). A refusal shows in the dialog.

## Status item and container section

- **The Needs-you status item** (`statusItems.inbox`) is the inbox in the topbar: a warning chip *Needs you
  · N* over the same query and refreshes, absent at zero, whose popover lists the same rows (an action
  closes it) and, with a workspace active, **Open board** (`openView`, Board view); a row peeks its card
  only with a workspace active.
- **The container's section** (`containerSections.initiative`, `ContainerAutopilot`) in a container's
  overview in Peek: `autopilot.ofContainer`, re-read on any project's `board.changed`; nothing for a
  container no initiative runs, else *Initiative I-n · title* (peeking it) and the panel's state line,
  agents and ready cards.

## Verification

`web/*.test.ts(x)`: the pure math of every view (badges, WIP and Start's warning, Triage groups, the
navigation's narrowing and queue counts, the agents' order and elapsed time, the card's default tab and its
chats, Answer's target, horizon and goal grouping, the stack bar, the step graph's layout and edits, the timeline, the chart scales, the matrix
and the line diff, the conformance tally), each reply check, the query every control sends, and each view
rendered (xyflow's server render for the graph and the timeline). The no-agent e2e drives the UI end to end
([[module-ext-board]] § Verification).
