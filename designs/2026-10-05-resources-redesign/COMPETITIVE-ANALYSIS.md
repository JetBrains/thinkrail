# Resources UI — competitive analysis

How coding-agent products surface **work the agent started that outlives a tool call**: background
shell commands, subagents/forks, monitors, and (in the fleet products) whole child sessions. This is
the exact scope of ThinkRail's Chat **Resources** popover (`apps/web/src/chat/resources`), so the
survey is organised around the questions a redesign has to answer:

1. **Where** does the roster live (header popover · footer strip · side pane · dialog · inline chat row)?
2. **What is a row** (name/task · state · activity · elapsed · usage · outcome)?
3. **How are states expressed** (vocabulary, colour, motion, grouping)?
4. **What can you do from a row** (inspect · stop · stop all · resume/retry · approve)?
5. **What happens when work finishes** (eviction vs. retention, how long, where the receipt goes)?

Sources are primary where possible: official docs, changelogs, merged PRs, and bug reports with
screenshots (the bug reports are the most honest description of what a UI actually does).

---

## 1. Product-by-product

### Claude Code (CLI) — the most complete reference

- **Footer subagent panel.** Running background subagents/forks render as a panel **below the prompt
  input** — one row for `main` and one per child; nested children show as a tree with a `(+N)`
  descendant count. Keys: `↑/↓` move, `Enter` opens the child's transcript *and lets you type follow‑ups
  to it*, `x` stops a running row or dismisses a finished one, `Esc` returns focus to the prompt.
  Each row carries the model (and effort when pinned). ([sub-agents docs](https://code.claude.com/docs/en/sub-agents),
  "Observe and steer running forks")
- **Eviction rule is asymmetric.** A subagent that *succeeds* leaves the panel immediately and a footer hint
  "`/tasks` to see subagents" shows for 30 s; one that *fails or is stopped* keeps its row for 30 s (press
  `x` to clear sooner). Success is quiet; failure lingers.
- **`/tasks` (alias `/bashes`) dialog.** The shared dashboard for *everything* parallel: `Ctrl+B`'d
  shells, background subagents, MCP calls past 2 min, bash that ran out its timeout, cloud sessions,
  `/ultrareview`. Sectioned by type (local bash · remote agents · MCP tasks), **running sorted first**,
  then by start time. `Enter` opens a detail with live output and a **Stop** option. Finished subagents
  stay ~30 s "marked done, sorted below running work". ([wmedia](https://wmedia.es/en/tips/claude-code-tasks-panel),
  [fenbs](https://fenbs.ai/blog/claude-code-background-tasks), Open-ClaudeCode `BackgroundTasksDialog.tsx`)
- **Background bash.** `Ctrl+B` moves a running Bash/agent to the background; output goes to a file;
  completion arrives as a system message in a *later turn*. ([interactive-mode docs](https://code.claude.com/docs/en/interactive-mode))
- **Stop-all** = `Ctrl+X Ctrl+K`, pressed twice within 3 s (keyboard double-press as confirmation).
- **Status line** shows an "N background tasks" count; stale-count bugs ([#19894](https://github.com/anthropics/claude-code/issues/19894),
  [#66955](https://github.com/anthropics/claude-code/issues/66955)) and "collapsed `Done (10 tool uses · 45.6k tokens · 2m 2s)` can't be
  expanded" ([#66646](https://github.com/anthropics/claude-code/issues/66646)) are the recurring complaints — users want **visibility
  of count + what each one is doing** ([#27916](https://github.com/anthropics/claude-code/issues/27916),
  [#25680](https://github.com/anthropics/claude-code/issues/25680)).
- **Agent view** (`claude agents`) is the level above: full-screen list of background *sessions*, grouped
  by state **Working · Needs input · Idle · Completed · Failed · Stopped**, pinned + needs-you first; row =
  name · current activity · age; `Space` peeks at latest output/the pending question, `Enter` attaches,
  `Ctrl+X` stops (press again to delete). ([agent-view docs](https://code.claude.com/docs/en/agent-view))

### Claude Code Desktop app

- A dockable **tasks pane**: "shows the background work running inside the current session: subagents,
  background shell commands, and dynamic workflows… Click any entry to see its output in the **subagent
  pane** or stop it." The sidebar of sessions is **filterable by status**, project, environment.
  ([desktop docs](https://code.claude.com/docs/en/desktop), [redesign post](https://claude.com/blog/claude-code-desktop-redesign))
- Users compare the first-party UI unfavourably with wrappers: "Running agent … 2m 34s · ↓ 2.2k tokens.
  That's it — no task list, no subagent breakdown, no status per agent." ([#48246](https://github.com/anthropics/claude-code/issues/48246))

### Codex CLI / Codex app (OpenAI)

- **Background Terminal (`unified_exec`).** `/ps` lists each background terminal's **command plus up to
  three recent non-empty output lines**; `/stop` (alias `/clean`) kills *all* — users asked for
  `stop <id>` ([#17821](https://github.com/openai/codex/issues/17821)). Interrupting a turn no longer tears
  background terminals down ([#14602](https://github.com/openai/codex/pull/14602)).
- **Footer summary without layout shift.** The bottom pane exposes *one* canonical "N background
  terminals" string, rendered inline after the status indicator while streaming and as a dedicated footer
  row otherwise — never both, because the row insertion made the composer jump
  ([#10962](https://github.com/openai/codex/pull/10962)).
- **Subagents in the app** appear as **child threads nested under the parent** in the sidebar, plus an
  **Active** list with a **Working** status and elapsed timers; stale-state bugs show the shape:
  "completed subagents remain in Active/Working", "timers keep increasing until opened"
  ([#35209](https://github.com/openai/codex/issues/35209), [#39668](https://github.com/openai/codex/issues/39668)),
  and a regression made child threads leak into the top-level Recent list ([#38780](https://github.com/openai/codex/issues/38780)).
  Users want "a configurable high-visibility colour" for the tiny active spinner ([#34870](https://github.com/openai/codex/issues/34870)).
- TUI: `/agents` full-screen dashboard of root sessions with subagent status, searchable and groupable
  by project/status ([#39094](https://github.com/openai/codex/pull/39094)); parent-owned child threads are
  **read-only** ([#33841](https://github.com/openai/codex/pull/33841)).

### Cursor (Agents Window / Multitask)

- **"N Working" panel** floats directly **above the composer** (screenshot in the forum report linked below):
  header `9 Working · Stop All · ×`; rows = status glyph (orange dot = finished/needs attention, braille
  spinner = starting/running) + **task title** + muted inline summary ("Edited mods_findings.md, …",
  "Starting up", "Full Ko3kr refresh is done."); children are indented under their parent.
- Known failure modes are instructive: rows stuck on "Starting up" for hours, "Stop All does nothing",
  "orange done entries linger" ([forum 166041](https://forum.cursor.com/t/subagent-panel-stuck-on-starting-up-stop-all-does-nothing/166041)).
  Users explicitly ask for **auto-dismiss on success** and **per-task cancel that always works**.
- Cloud/Background Agents panel: per row name · prompt · status · elapsed · step count · cost.

### T3 Code (open-source control plane; PR #5219 "native subagent & workflow observability")

The closest peer — same problem, same constraints, with live-test learnings written down:

- **"The Agents panel is the only roster."** They shipped a composer strip + inline card + panel, saw the
  roster three times at once, and deleted two of them. The chat gets **one anchored CTA row per spawn
  batch**: `Kicked off N subagents · <workflow> — <phase> · N active · Σ tok — Open Agents`; it freezes to
  past tense on settle, is exempt from turn folding, and is pinned outside the "+N tool calls" overflow so a
  live run is always visible at its spawn point.
- **Shells never masquerade as agents.** `taskType` rides every payload; shells/monitors stay in the
  ordinary work log.
- **One steady in-flight presentation.** `pending/running/waiting` all render as **Working** (sky, no
  amber); only settled states differentiate (completed / failed / stopped). Idle-resumable agents render
  muted and sort with settled. Footer shows one working count.
- **Flat status lines**, no per-agent unfold; settled runs collapse to one summary line under **Earlier**.
- **Two sidebar states only:** *Working* vs *Monitoring* (watch loops / turn-outliving shells).
- Static status dots; elapsed timers written straight to the DOM (perf).
  ([PR #5219](https://github.com/pingdotgg/t3code/pull/5219); feature asks [#4456](https://github.com/pingdotgg/t3code/issues/4456),
  [#5479](https://github.com/pingdotgg/t3code/issues/5479))

### Zed

- Threads sidebar: rows = title · **status indicator** · which agent runs it; grouped by project; running
  threads can't be archived. Terminal threads sit alongside. ([parallel-agents](https://zed.dev/docs/ai/parallel-agents))
- The terminal **tool card has a Stop button**; whether Stop also cancels the thread became a *setting*
  after users disagreed ([#46663](https://github.com/zed-industries/zed/pull/46663),
  [#47521](https://github.com/zed-industries/zed/pull/47521)). Interrupting captures the terminal output into
  the tool result so the model can see it ([#46306](https://github.com/zed-industries/zed/pull/46306)).

### Conductor

- Workspace sidebar rows carry **running indicators**, distinct icons for *plan approval* vs *user input*
  states, **counts next to collapsed status groups**, and a ⌘⌥L "next workspace needing attention" jump.
  Experimental "chats inbox". ([changelog 0.39](https://www.conductor.build/changelog/0.39.0-insta-summarize-command-palette-opus-4-6))

### JetBrains Air

- Task-centric: every task runs in its own isolated workspace; the IDE plugin tracks **unread updates,
  changed files, outgoing commits** per project. ([air.dev](https://air.dev/), [JetBrains Air in IDEs](https://www.jetbrains.com/air/ides/))

### Zencoder (Zenflow)

- "Blast" parallel tasks in worktrees; three-panel layout with a collapsible tools panel for **Steps,
  Changes, Files**. ([docs](https://docs.zencoder.ai/zenflow/blast-agents), [March 2026 changelog](https://docs.zencoder.ai/zenflow-changelog/march-2026))

### Warp

- **Orchestration pill bar** above the agent view header: parent pill on the left, **one pill per child
  with a live status badge**; click a pill to swap the pane to that child's conversation in place.
  States: `INPROGRESS · SUCCEEDED · FAILED · BLOCKED · ERROR · CANCELLED`. Vertical tabs show agent, branch,
  cwd, and active/waiting/idle. ([orchestration](https://docs.warp.dev/platform/orchestration/))

### Amp (Sourcegraph)

- Subagents render as **inline collapsible rows in the transcript**: `Subagent` label · task title ·
  **`N files changed +a −d ~m`** · chevron (screenshot in the linked post). Outcome-first, not
  status-first. ([Agents for the Agent](https://ampcode.com/notes/agents-for-the-agent))

### Google Antigravity (CLI + 2.0)

- `/agents` panel: **Subagents grouped by triggering prompt**, header `▸ Subagents (1 running, 2 done)`;
  row states `running · done · error · killed`; `Enter` opens a full-screen detail (thoughts, tool calls,
  stdout); **`K` kills the row and its children**; **inline approvals** (`A`/`D`) for a subagent's blocked
  tool call. `Alt+J` jumps to the subagent panel. ([/agents](https://www.antigravity.google/docs/cli/commands/agents),
  [subagents](https://www.antigravity.google/docs/cli/subagents/))

### Gemini CLI

- `/shells` dashboard; `Ctrl+B` toggles the **current background shell's live output pane**, `Ctrl+L`
  toggles the list, `Ctrl+K` kills. ([shortcuts](https://geminicli.com/docs/reference/keyboard-shortcuts/),
  [shell tutorial](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/shell-commands.md))

### OpenCode

- Sidebar lists **only in-flight subagents** plus a separate **"Recent subagents" (last 10)** — "real
  sessions accumulate hundreds of dispatched subagents, and a complete list is unusable." Active rows show
  **what the subagent is doing now** (running/queued tool, retry count); the active list auto-collapses
  past one row, recent past two, remembering state. ([#46109](https://github.com/anomalyco/opencode/pull/46109))
- Descendant permissions/questions are surfaced and attributed in the parent; a compact **session
  dock**; fixture-driven story for concurrent/blocked/nested/background states ([#44976](https://github.com/anomalyco/opencode/pull/44976)).
  Community plugins converge on the same card: role · model · effort, task, **right-aligned elapsed**.

### Kiro (Crew)

- **Activity panel**: task · elapsed · status `running / done / failed / stalled`; per-row **Stop**, header
  **Stop all**, **Retry** on failed rows; "stopping is neutral — partial output is preserved and marked
  *stopped by user*, not as a failure"; **stall detection** marks silent rows; parked spawn approvals are
  shown in the running-work view; results retained ~1 h. ([docs](https://kiro.dev/docs/crew/features/subagents/))

### VS Code / GitHub Copilot

- **Agent Sessions sidebar**: name · last-active timestamp · **unreviewed file-change count** (clears on
  accept/undo); archive vs delete; a Session Target picker (Local / Copilot background / Cloud).
  ([learn](https://code.visualstudio.com/learn/foundations/agent-sessions-and-where-agents-run))

### Devin

- Sidebar "Group by status": **Working / Ready / Blocked / Inactive**; hover preview card with the last
  lines of output updating live; the sidebar names the exact approval a session waits on.
  ([release notes](https://releases.sh/cognition/release-notes))

### Factory Droid · Cline · Roo

- Factory: subagents via Task tool, Missions for orchestration; CLI-first, no dedicated roster UI found.
- Cline: parallel research subagents (experimental); subagent commands moved to a hidden background terminal
  to reduce clutter ([#7017](https://github.com/cline/cline/pull/7017)); background-terminal plugin steers a completion
  summary back into the session.
- Roo: "background commands" = don't steal terminal focus ([#6587](https://github.com/RooCodeInc/Roo-Code/pull/6587)).

### Qwen Code (reimplements Claude Code's panels, documents the rationale)

- `LiveAgentPanel`: "always-on bottom-of-screen roster… **borderless rows of `status · name · activity ·
  elapsed`** so the panel sits lightly above the composer rather than competing with it; the heavier
  bordered look stays with `BackgroundTasksDialog`." `BackgroundTasksPill`: label prefers live running
  counts and carries a **"needs approval" marker**.

---

## 2. Pattern catalogue

| Pattern | Who | Strengths | Weaknesses |
| --- | --- | --- | --- |
| **A. Header trigger + popover** (count badge → list) | ThinkRail today; Claude Code status-line count → `/tasks` | Zero footprint when idle; discoverable count | Blind while closed; actions require a modal hop; stale-count trust issues |
| **B. Composer-anchored strip/panel** | Claude Code footer panel, Cursor "N Working", Qwen `LiveAgentPanel`, OpenCode dock | Always visible where you type; keyboard-reachable; feels "live" | Steals vertical space; must not jitter (Codex #10962); needs auto-collapse |
| **C. Dedicated side pane / tool** | Claude Desktop tasks pane, T3 Agents panel, Kiro Activity, Antigravity `/agents` | Room for detail + output; one roster for everything | Another tab to manage; empty most of the time |
| **D. Inline chat rows** (spawn CTA / subagent cards) | T3 CTA row, Amp rows, ThinkRail `AgentCard` + completion cards | Context at the spawn point; outcome-oriented | Scrolls away; duplicates the roster if also listed elsewhere |
| **E. Pill bar / tabs** | Warp pill bar, Codex nested child threads | Switch *into* a child in place | Breaks down past ~6 children; implies children are peers of the parent |
| **F. Full-screen dashboard** | Claude agent view, Codex `/agents` | Fleet-level triage; grouping by state | Wrong altitude for per-chat resources |

**Row anatomy convergence.** Across B/C/D the row is: `glyph · name/role · (activity or outcome) · elapsed`,
with secondary metadata (model/effort, tokens/cost, exit code, files changed) in a muted sub-line or
right-aligned.

**State vocabulary convergence.**

- In-flight: *Working* (T3 collapses pending/running/waiting into it), *Running*, *Starting up* (Cursor).
- Needs-you: *Needs input* / *Blocked* / *Needs approval* — always sorted or coloured first.
- Settled: *Done/Completed* (quiet, green check), *Failed/Error* (red, auto-expanded), *Stopped/Killed/
  Cancelled* (neutral — Kiro insists it is not a failure), *Stalled* (Kiro's silence detector).
- Idle-resumable children render muted and sort with settled (T3).

**Finished-work retention.**

- Claude Code: success evicts immediately (+30 s hint); failure/stop lingers 30 s.
- OpenCode: active list + last 10 recent.
- T3: settled runs collapse to one line under *Earlier*.
- Kiro: results retained ~1 h.
- Cursor's bug reports show the cost of getting this wrong: a roster that never empties loses all trust.

**Controls.**

- Per-row Stop everywhere; Stop-all with confirmation (double-press in Claude Code, confirm dialog in Kiro/
  Cursor); OpenAI users explicitly asked for *per-id* stop because `/stop` killed everything.
- Inspect = open transcript/logs (Claude Code lets you *type into* the child's transcript; Codex children are
  read-only).
- Retry on failed (Kiro); resume idle (Antigravity auto-wakes on message; Claude Code `SendMessage`).
- Approvals bubble to the roster (Antigravity inline A/D; Qwen pill "needs approval"; OpenCode attribution).

---

## 3. Where ThinkRail stands today

Baseline (see `baseline/`):

- Pattern **A** only: `Resources 4` header button → 360 px popover with `Commands · N`, `Subagents · N`,
  collapsed `Finished · N`.
- Rows are three-line stacks: icon + name + raw status word (`running`, `stopping`, `queued`); monospace
  command / two-line task; a row of ghost buttons (`Logs`/`Transcript`, `Stop`), plus `Exit N`.
- Status is a lowercase word with **no colour or glyph**, no elapsed time, no "what is it doing now", no
  model/usage, no exit-code tone. `Stop all subagents` is a text button in the section header.
- Honest about authority: unknown count renders as `—`; stale snapshot disables controls; stop means
  "cancellation requested". (Keep this — several competitors' worst bugs are exactly here.)

What the contracts already give us and the UI does not use: `startedAt`/`finishedAt` (elapsed, duration),
`exitCode` (tone), `errorMessage`, `abortReason`, `roleName`, `createdAt`. What they do *not* give us (and
would need a contract change): live activity line for subagents, token/cost usage in the roster, output
tail for commands outside the open detail (`backgroundCommand.output` exists but the spec limits refresh to
an open detail), nested children.

---

## 4. Design principles for the redesign (derived)

1. **One roster, one truth.** Whatever surface we choose, don't render the same list twice (T3's hard-won
   rule). Inline cards keep their role as *receipts at the spawn point*; the roster is the *live* view.
2. **A row is a sentence:** `[state glyph] name — activity/outcome · elapsed`. Secondary metadata goes
   muted, right-aligned or on a sub-line; raw command text is a detail, not a headline.
3. **State is colour + glyph + word**, never a lowercase word alone (and never colour alone — accessibility
   stays a hard rule in `resources/SPEC.md`). One in-flight colour (*Working*); differentiate only settled
   states; failure is loud, success is quiet, stopped is neutral.
4. **Needs-you sorts first.** When a child is blocked on a question/approval, that beats "running".
5. **Time is a first-class column.** Elapsed for live rows, duration + exit for finished rows; a stall hint
   when a live row has been silent (even if the first version derives it client-side from `startedAt`).
6. **Finished work decays, deliberately.** Keep terminal rows available (contracts retain 20) but fold
   them under *Earlier/Finished* with a count; a success never pins the roster open.
7. **Stop is cheap and honest.** Per-row Stop on hover/focus, `Stopping…` while pending, Stop-all behind one
   confirmation; stopped ≠ failed.
8. **The badge must be trustworthy.** Count only authoritative snapshots (already true); consider the Qwen/
   Codex idea of a *needs-attention* marker on the trigger itself.
9. **Don't jitter the composer.** Any composer-anchored variant must reserve height or animate once (Codex
   #10962), auto-collapse (OpenCode), and vanish when empty.
10. **Keep shells and agents distinguishable but co-listed.** Both are "things that run while you work";
    glyph + section do the distinguishing (Claude `/tasks`, Claude Desktop tasks pane), never a shell
    pretending to be an agent (T3).

These principles drive the mockup directions in `index.html`. After review, the recommended shape is
**G**: the trigger (A) as the always-present control, the composer dock (B) as the ambient live view,
and the inspector sheet (F) as the detail view — one live roster at a time, one row grammar, Claude
Code's footer panel + `/tasks` detail in spirit, T3's single-roster discipline in practice.
