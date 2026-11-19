---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: ThinkRail — product goal and scope
covers: [product-goal, product-audience, product-principles, product-capabilities, product-non-goals, engine-decision]
tags: [product, scope]
---

## Goal

ThinkRail is the agentic IDE that gets better every time you use it. It is a thin host that runs `pi`
and bridges it to a rich UI, isolates work into separate workspaces, and gives the agent durable
project knowledge through living specs and reusable skills — so agent work is approachable without a
terminal and stays isolated, reviewable, and grounded in specs: building with agents without losing
control.

This document describes the product as it is and why it exists, and changes with it: a capability that
lands is added here, a decision that changes is rewritten here. It holds no versions or roadmap.

## Problem

`pi` is a deliberately minimal, extensible harness. That flexibility costs time: newcomers spend long
learning to drive it, and experienced users still find the terminal clumsy for the work around the agent.

- **Parallel agents collide** in one working tree — with each other and with the user's own edits.
- **Agent changes are hard to review** from a CLI: reading diffs, commenting on exact lines, and
  handing that feedback back to the agent.
- **Intent evaporates.** Decisions made in a chat end with the session; the next one re-derives or
  contradicts them.

## Who it's for

People who build with `pi` on real git repositories — newcomers who want a visual on-ramp, experienced
users who want an IDE around the agent without giving up pi's depth, and agent-first builders who want
to move fast without losing control of what the agent did.

## Value

- **Isolation by default.** A workspace ThinkRail creates is a git worktree with its own branch and cwd:
  agents run in parallel and the main branch stays clean until the user merges. Working directly in the
  project folder (the Default workspace) is an explicit choice, never the default — except the setup chat of
  a project ThinkRail just created empty, which has nothing to isolate yet.
- **A real IDE around the agent.** Editor, diffs, terminals, and review in one workbench, so the user
  sees and steers the agent's work instead of reconstructing it from a scrollback.
- **Specs as ground truth.** The project's intent lives in a spec graph beside the code that the agent
  reads, searches, and maintains, so intent survives the session.
- **All of pi, nothing hidden.** Models, skills, extensions, and session state stay pi's; ThinkRail adds
  a surface, not a second agent.

## Principles

Durable decisions every feature follows; [[architecture]] carries the structure that enforces them.

- **pi is the only engine**, run in-process — no second runtime (no `claude-agent-sdk`). `pi` owns the
  model registry, system prompt, skills/extensions, compaction, cost, and session state.
- **Influence by feeding, never by assembling.** Features shape the agent only through what they feed
  `pi` — prompt context, files, pi's own skills/extensions — and the flags a session starts with.
- **Expose, don't recompute.** The host shows what `pi` reports rather than deriving its own copy, so
  pi's numbers stay the headline. Analysis derived from pi-recorded facts — subagent spend outside pi's
  own total, an estimate — is computed by the host, never the browser, and always labelled with its origin.
- **The user's own tools and credentials.** Git, GitHub, and model access go through the user's `git`,
  `gh`, `central` CLI, and pi's provider auth; ThinkRail keeps no accounts or tokens of its own.
- **Trust is explicit.** What a cloned repository could inject into the agent — its committed skill
  aliases, pi's own project resources (`.pi/` settings, extensions, skills, prompts, subagent definitions),
  and MCP servers it defines — loads only after a per-project trust grant; a repo-defined MCP server also
  needs a per-entry approval that lapses when the entry changes.
- **Spec-first.** ThinkRail is built spec-first and helps the projects it opens work the same way.

## Capabilities

What ThinkRail does, at product level; the linked spec owns the detail.

- **Two launchers, one app** — a native desktop app and the `thinkrail` CLI that opens the same UI in a
  browser, both embedding the same host; state lives under `~/.thinkrail` ([[module-desktop]],
  [[module-cli]]).
- **Projects → workspaces** — a git repo is a project; a workspace is a git worktree, plus the built-in
  Default workspace (the project folder itself) and existing worktrees attached in place
  ([[submodule-server-workspaces]]); a container groups workspaces, from one project or several, under
  an orchestrator chat that coordinates them, pinned beside whichever member is open, with an overview
  of the members and their pull request stack ([[submodule-server-containers]], [[submodule-web-shell]]). A Git repository URL can be cloned into a chosen new host folder and
  opened as a project, with optional shallow history and cancellation ([[submodule-server-projects]]).
- **Voice input** — local dictation into every text field, extensions' included and with no work on
  their part (the code editor and the terminal excepted), through a mic on the focused field or ⌘⇧Space /
  Ctrl+Shift+Space. Text lands at the cursor and is never auto-sent. NVIDIA's Nemotron streaming model runs on the host after
  a one-time, user-started download ([[submodule-server-speech]], [[submodule-web-speech]]).
- **Chats without a project** — a chat that belongs to no repository works in its own scratch folder
  under the built-in Chats container: files, terminal and plan, no git, review or pull request;
  started from the Welcome screen, the Create dialog, the palette or the Chats section, deleted to the
  Trash as a whole, and continued in a real workspace when it turns into work — the agent's summary
  becomes the new chat's first message ([[submodule-server-workspaces]]).
- **Artifacts** — what the agent produces for the user (task-specs, mockups, diagrams, screenshots,
  reports) lives in the workspace's git-ignored artifacts folder and is shown in the Artifacts tool,
  newest first, as a folder tree, or as what the agent made for the user (Smart: the results it showed,
  linked or the user picked, their working files folded under them), with the chat that wrote it, beside
  the ignored outputs its runs leave; each chat round lists the artifacts it made; nothing there
  disappears unless the user removes it — a file deleted behind their back stays
  restorable from a kept copy, and the agent is steered away from temporary folders ([[submodule-server-artifacts]], [[submodule-web-panels]]).
- **Workbench** — a splittable layout of files, diffs, documents, chats, and terminals with movable side
  and bottom tool panels, kept local to each window ([[submodule-web-shell-layout]]); the right tool side is
  optional (a Left tools preset keeps every tool on the left). A contextual Peek pane on the right shows
  the files, diffs, artifacts and previews opened from chat and from question and visualize cards, with
  history, pin and open-in-tab, and hides itself on Esc or a new turn ([[submodule-web-shell]]). The region that holds
  the keyboard carries an accent line, a keyboard move briefly frames the region it lands in, and
  VS Code-style chords move between regions, into the chat input, Projects, Files and the terminal, from
  one keybinding table that the palette also shows ([[submodule-web-keybindings]]). The user rebinds those
  chords and extensions' commands in Settings → Keyboard, stored on the host for every window, and exports
  or imports them as a JSON file. Hint mode, a
  switchable extension, labels everything clickable so a typed label presses it
  ([[module-ext-hint-mode]]); sidebar trees search their rows on `S`.
- **Chats** — concurrent `pi` sessions per workspace, each with its own model, pi-reported token/cost,
  steering and follow-ups mid-run, skill and prompt-template autocomplete, and history search
  ([[submodule-web-chat]], [[submodule-server-agent]]).
- **Session insights** — a local, on-demand breakdown of past sessions per project: a list with
  pi-recorded tokens/cost, tool calls, errors, subagents and outcomes, every number with its origin, and
  per session a trace of its turns, model and tool calls on a shared timeline with redacted call details
  and a jump into the chat, each call's context and cache with a read-only diff of adjacent requests, why
  it was expensive, and the files it touched; across sessions, rule-based "what to do" findings with their
  evidence, usage and cost by day, model, project, tool and skill, file hotspots with one action each,
  action sequences (a transition matrix, a process map, what follows a failed call), two slices compared
  with bootstrap intervals, two sessions' calls aligned step by step, and faceted search of events
  across sessions that opens the analysis at a hit; the user's labels and notes on sessions (kept by
  ThinkRail, never in pi's files) to filter and compare by; and exports into the workspace's Artifacts —
  a self-contained HTML page with best-effort secret masking, a Chrome-trace file and an e2e fixture cut;
  nothing is applied and nothing leaves the machine. Vanilla `pi` gets the findings, the usage summary and
  a one-session summary as an `/insights` command from the same core, a pi package not yet on npm
  ([[module-ext-session-insights]], [[module-pi-session-insights]]).
- **Existing skills reused** — portable Agent Skills kept for other coding agents are read in place;
  `pi` stays the parser and runtime ([[submodule-server-agent]]).
- **Plans with per-step review** — a shared TODO plan the agent works and the user edits; a completed step
  is committed on its own when its changes are provably its own, and can be reviewed by an independent
  reviewer ([[module-pi-todos]], [[submodule-server-todos]],
  [[submodule-server-host-plan-review]]).
- **Subagents and background commands** — delegation to isolated child sessions, in the foreground, in
  parallel, or in the background ([[module-pi-subagents]]), and commands the agent runs without holding its
  turn ([[module-pi-background-commands]]); each chat's Resources view watches, inspects and stops them, and
  keeps their finished history — outcomes and command log tails — for the workspace's lifetime, across host
  restarts ([[submodule-web-chat-resources]], [[submodule-server-resource-history]]). Settings → Subagents
  lists the built-in, personal and trusted current-workspace roles with their model policies; global
  per-role switches block new launches without interrupting work already running, beside delegation
  defaults and workspace concurrency controls ([[submodule-web-panels]]).
- **Board** — a project board extension: cards start agent work in new workspaces, host events
  (start, settle, merge) move them across preset columns while a human's move is a logged override, each
  card badges its agent's live state, and a card opens in Peek with its details, attempts and Start.
  A cross-project "Needs you" inbox (above the board and as a topbar counter) lists the cards waiting
  for an answer or failed, WIP limits watch human attention, agent-filed cards wait in Triage to be
  accepted as a whole, and Board mode widens the board and restores the previous layout on exit. The
  workspaces' task-specs show on their cards (an unbound one's as a card to adopt, its deferrals sent
  into Triage), the open GitHub issues show through the user's own `gh` (Start asks for `Closes #N`; the
  board never edits an issue), OpenSpec changes show as cards with propose / apply / archive through the
  user's own `openspec` CLI and skills (a Spec-driven preset, read-only parsing without the CLI), the
  host's model suggests a card's size until the human sets one, and above
  the cards sits a roadmap of initiatives (Now / Next / Later, Goals) with suggested health and a forecast
  from the live work, a step graph with the critical path and a timeline with the forecast, flow insights
  (WIP, throughput, cycle time, work item age, cumulative flow, agent vs human-wait time), agent skills
  that shape, plan, report on, review and close initiatives, and a published roadmap snapshot file for a
  PR. Before Shape sits discovery: ideas with evidence (cited research reports in the artifacts, links,
  notes) that the agent researches and scores for value × effort against the goal spec and the signals it
  can reach, on a matrix where the human confirms the scores and promotes an idea through Shape, and a
  competitor watchlist whose "What changed?" diffs each snapshot against the last, on demand only
  ([[module-ext-board]]).
- **Workspaces from chat** — on request ("in a side workspace"), the agent starts ordinary workspaces
  with their own chats in any open project and checks their chats', PRs', and diffs' status; the agent,
  not the host, decides what to do with them ([[submodule-server-agent]], [[submodule-server-host]]).
- **Review** — anchored comments on files and diffs, collected without starting the agent and sent as
  structured context to chats that can resolve them; local review, not a forge integration
  ([[submodule-server-reviews]]).
- **Open PR** — push the workspace branch and open or update its GitHub PR through the user's `gh`,
  falling back to a prefilled compare URL (GitLab: the prefilled new-MR page), from the plan or straight
  from the topbar, whose Remote and Pull request segments always show the branch's next step — publish,
  push, sync, open a PR described from the plan, commits, a template, or an agent draft — and, for an open
  GitHub PR, its checks and review decision with mark ready, merge, fix failing checks or integrate a
  diverged branch with the agent, reopen, and delete the remote branch
  ([[submodule-server-pr]], [[submodule-web-shell-location-bar]]).
- **Specs** — the agent searches, navigates, and maintains the spec graph through `spec_*` tools; the
  read-only Specs tool renders it as a tree. The agent and the search palette's `#` scope find the
  sections that answer a question by words with one engine, and the palette hands a question that shares
  no words with the specs to the agent ([[module-spec-graph]], [[submodule-server-spec]],
  [[submodule-web-search]]).
- **Workflows** — bundled workflow skills for project setup, design brainstorming, and shipping a PR
  ([[module-thinkrail-workflow]]).
- **Providers** — in-app sign-in and API keys through pi's auth, JetBrains AI through the user's
  `central` CLI, and the user's own OpenAI-compatible servers (a company gateway or a local model server)
  added from Settings into pi's `models.json` ([[submodule-server-auth]], [[central-integration]],
  [[submodule-server-agent]]).
- **Pi configuration** — the user's own pi config folder, or another one (a personal vs a work setup), plus
  extra environment variables, chosen in Settings and applied to the whole host at the next start; one setup
  per host, not per project ([[submodule-server-environment]]).
- **Agent tools** — web research, structured multiple-choice questions the agent asks in chat instead of
  guessing (with alternatives' previews comparable full screen — one at a time, side by side, or all), and
  inline diagrams, comparisons and file previews in chat; a proposed UI change is shown as
  a rendered before/after mockup through the same renderers and review comments as diff review, and the
  agent's mockups are clickable prototypes in a browser, their scripts sandboxed without network; a
  finished turn can end with one-click next messages offered above the composer
  ([[submodule-web-chat-tools-web]], [[module-ext-ask-user-question]], [[module-ext-visualize]],
  [[module-ext-next-steps]]).
- **Pi packages** — install a pi package by source (npm, git or a local folder) from Settings, for the
  user or for a repository, and see everything pi loads: each package's extensions, skills and prompts
  with their tools, hand-dropped extension files, and pi's built-ins — switching any of them off in pi's
  own settings format, a whole package through a ThinkRail setting. Changes reach open chats when their
  turn ends ([[submodule-server-agent-packages]], [[submodule-web-panels]]).
- **MCP servers** — pi's built-in MCP, read from the user's `mcp.json`, managed from Settings and
  inspectable per chat next to background commands and subagents (each server's state, last status and
  that chat's calls to it); a confirm in the chat, on the call, before calls
  that may change data, with a per-project "Always allow" for tools the user trusts
  ([[submodule-server-agent]], [[submodule-web-panels]]).
- **Around the workspace** — open a worktree in an installed editor or IDE, and keep the app itself up
  to date ([[submodule-server-editors]], [[submodule-web-updates]]).
- **Interface language** — the UI follows the system language or the user's choice; English and
  a set of translations ship built-in (an untranslated string shows in English), and a user adds or
  overrides a language with a flat JSON file in `~/.thinkrail/locales`, live on save. Agent and tool
  output is never translated ([[module-locales]], [[submodule-web-i18n]]).
- **Themes** — light, dark, minimal and high-contrast themes ship built-in, following the system
  appearance or a fixed choice; a user adds a theme by saving a copy of a bundled theme file with new
  colours in `~/.thinkrail/themes`, live on save ([[submodule-web-themes]]).
- **Fonts** — the interface and code fonts are the user's choice among the bundled faces, the fonts
  installed on the host machine, and font files added in Settings (kept in `~/.thinkrail/fonts`), with
  fallback fonts, a code size, code ligatures and one text-weight knob; one choice per host, applied at
  once in every window, and a font missing on a device falls back to the bundled face with a warning
  ([[submodule-web-fonts]], [[submodule-server-fonts]]).
- **Brand** — ThinkRail green accent (bright on dark themes, deepened on light ones so it clears AA on
  both), a Darcula-family dark background, Orbitron for the brand display role, Geist and JetBrains Mono
  as the default UI and code faces ([[submodule-web-themes]], [[web-typography]]).

## Non-goals

Only these are excluded by decision. Anything neither listed above nor excluded here is open, not
forbidden.

- **A second agent runtime**, or any host-side agent loop or prompt assembly (see Principles).
- **ThinkRail accounts or a login UI.** Who may reach a host is decided by the network — Tailscale ACLs
  and device identity ([[architecture]]).
