---
id: submodule-web-chat-resources
type: submodule-design
status: active
title: Chat Resources — trigger, dock and inspector for command and subagent work and MCP servers
parent: submodule-web-chat
depends-on: [module-contracts]
tags: [chat, resources, public-surface-checked]
---

## Responsibility

The current chat's **Resources** surfaces: a header **trigger** with its MCP **attention marker**, an
ambient **dock** above the composer, and an **inspector** over the transcript. Together they make
agent-created work — background commands and subagents — glanceable while you type, inspectable without
scrolling to old tool calls, and stoppable, without confusing it with user-owned workspace terminals; and
they show the chat's MCP servers with their per-chat actions.

All three render one host-reported snapshot through one row grammar; none is a permanent pane or a
workbench tab. The inspector lives inside the chat column and leaves the composer usable. The same
grammar also owns the transcript's **result row** (below), so a finished command or background
subagent reads the same in the chat as in Finished.

## Boundary

- **Owns:** props-driven `ResourcesButton`, `ResourcesAttention`, `ResourcesDock`, `ResourcesInspector`,
  `CommandLogView` and `ResultRow`, exported through `index.ts`, plus the private row/state vocabulary
  they share and the private MCP rows (`mcpRow.tsx`). The inspector renders the roster and a detail
  *header*; the detail *body* is a slot the parent fills, and so is the result row's expanded body.
- **Public surface:** `ResourcesButton`, `ResourcesAttention`, `ResourcesDock`, `ResourcesInspector`,
  `CommandLogView`, `ResultRow`, `ResultReceipt`, `ResultSource`, `ResourceTarget`, `newestResourceId`.
- **Allowed external deps:** contracts, React, Remix icons, shared UI primitives and theme utilities,
  `@thinkrail/locales` (UI strings), and `lib` (the shared MCP state vocabulary). Time arrives as a `now` prop so formatting stays pure.
- **Forbidden:** store/transport, server/portable extension packages, Pi value imports, process
  execution, log persistence, subagent transcript fetching, and workbench placement. Parent-chat
  integration (what fills the detail slot, where the surfaces mount) and sibling dependency edges
  belong to [[submodule-web-chat]].

## Row grammar

Every surface renders a resource as one row: kind glyph with a status dot · name (command display
name or subagent role) · activity (the command text or the task) · state · elapsed, with Inspect/Stop
appearing on hover and focus in place of the state text so rows never change height. A row's visual
state collapses the wire statuses into one in-flight presentation and four settled ones:

- *running* commands and *running* subagents → **Working** (primary, breathing dot); *queued* →
  **Queued**; *stopping* → **Stopping…** — all live, all sorted before settled rows, **oldest start
  first regardless of live state**, so a row never jumps when it starts or begins stopping;
- *completed* with exit 0 / *completed* subagents → **Done** (success); nonzero exit, *error* → **Failed**
  (error, auto-visible); *stopped* / *aborted* → **Stopped** (neutral: a user stop is not a failure);
  any run flagged `interrupted` → **Interrupted** (neutral, power glyph), whatever status it carries — the
  host or the chat's teardown cut it off, which is neither the user's stop nor the work's failure.

State is always glyph + colour + word; colour and motion are never the only signal. Elapsed time is
coarse (minutes) because the shared clock ticks every 30 s; it is a live row's duration, or a settled
row's run time — a command's finish minus start, a subagent's host-reported `durationMs` (absent from
an older host, so that row shows no duration rather than a guess). Exit codes render as a monospaced
badge.

## Presentation

**Trigger.** The header button reads **Resources** plus the count of active resources only while the
snapshot is authoritative: live rows plus MCP servers that are connected or starting, then an "N new"
pill (also in its accessible name) for finished results the parent reports the user has not seen. The icon breathes
only while background work runs (`working`), so an always-connected server never animates the header.
Before the first read, during
reconnect, or after refresh failure it shows an explicit unavailable-count mark and a matching
accessible label rather than claiming zero. A parent being idle does not hide its resources. At narrow
widths the label may collapse, but the control/count state and accessible name remain available. The
trigger toggles the inspector and carries `aria-expanded`. A separate small **attention marker**
(`ResourcesAttention`, a sibling button, never nested) appears while any of the chat's servers needs
sign-in, failed, or awaits approval, and opens Settings › MCP servers.

**Dock.** The dock is for work in flight: it lists live rows directly above the composer and never a
finished one (user-settled, 2026-10: finished work lives only in Resources). Under the rows, one quiet
summary line — `✓ N finished · M new · Open Resources` — sums every finished record of the chat (the
parent's `finishedCount`) and the results the parent marks **new** (`freshCount`); the whole line is one
control that asks the parent to open the inspector (`onOpenFinished`; the parent lands it on the newest new
result, else the newest finished one, both picked by the pure `newestResourceId` in the contracts' history
order). It stays while the chat has any finished record, including when nothing
runs, and the dock renders nothing when there is neither live nor finished work. Past four live rows they
collapse behind an `N active` toggle (with per-kind live counts) on that same line; the collapsed/expanded
choice is local to the dock. While reconnecting, the line says so beside the active count. A dock row has
exactly two controls: its name and activity together are one Inspect control that opens the inspector at
that row, and Stop requests cancellation for that row. The dock is **hidden while the inspector is open** so
the live roster is never rendered twice. It reserves its rows rather than animating height on every change,
so the composer does not jitter.

**Inspector.** A non-modal in-place dialog over the transcript region with the chat header and
composer still visible and usable: a roster column and a detail column for the selected row. The roster
groups work by kind — **Commands**, then **Subagents**, each headed with its live and finished counts and
omitted while it has neither; one empty line stands in when the chat never ran any — then MCP servers.
Inside a kind come its live rows, then **Finished · N** (N is the chat's whole history from the parent's
`history` tallies, not just the rows it holds). The newest five finished rows sit above one **fold row**,
`› K more finished` with the hidden part's outcome tally (✓ done · ✕ failed · ◦ stopped or interrupted, in
its accessible name too). Collapsed, the fold also keeps every **new** result (`newIds`, highlighted with a
visible `new` mark and `, new` in its accessible name) and the selected row above it, so a new result is
never hidden and a row opened from elsewhere is in view. Expanding reveals the rest below the fold row in
history order and keeps only the newest five above it, so moving through the list never reorders it; the
expanded tail ends with **Show 20 more · L left** while the host holds more than the parent does
(`remaining`, `onLoadMore`; absent for an older host) and **Collapse**. Expansion is the parent's per-kind
state (`expanded` / `onExpandedChange`); a page load's pending and error state arrive as the
`history:<kind>` action. Rows past the fold that are not shown are not options, so `↑`/`↓` walk only what is
visible. The footer says where history lives: kept until the workspace is archived (`retained`) or, from
an older host, only for this host session. The detail header repeats the row's name and state and offers
Stop for live rows, a reason line for an interrupted run, plus — for a subagent whose snapshot carries `model` — a **Model** item rendered by the
parent's `renderSubagentModel(summary)` (nothing when the host sent no model). Roster and dock rows
deliberately omit the model: it would
crowd out the task, which is what tells two runs apart. The detail body is the parent's slot — bounded
plain-text command output for a command (this module's `CommandLogView`), the read-only subagent transcript pane for a subagent. The
roster is a listbox: clicking selects, `↑`/`↓` move the selection, `Esc` or the close control dismisses,
and clicking the composer or header does **not** dismiss. Each option keeps its activity on a second
line and in its accessible name (`name: activity, state`), so two same-role subagents stay
distinguishable; the option contains no control — its Stop is a sibling inside a presentational row
wrapper, which carries the row's test ids and `data-selected`. **Stop all subagents** sits in the roster
header, guarded by the parent's confirmation that names the current active count; it never stops the
main chat or disables future delegation. Stale/unavailable snapshots show a banner and disable
controls; read failures stay visible with Retry.

**MCP servers.** When the snapshot carries `mcpServers` (a host at `MCP_PROTOCOL_VERSION`; `null` hides
the list) the roster adds a third section after Finished. Rows are not listbox options and never in the
dock — a server is not work: plug glyph with a state dot · name · the shared state label (with the tool
count when connected) · transport (stdio "runs on host"), attention rows first. Actions follow the state:
**Disable in this chat** / **Enable in this chat** (applied at the chat's next idle reload, which restarts
its other servers — a helper line under the list says so; never offered on a `registered` row, a server an
extension registered, which the host refuses to disable per chat), **Reconnect** for failed or
disconnected, and Sign in / Review / Edit for needs-sign-in, pending approval or invalid config, which open
Settings (`resource-mcp-settings`), like the section header's **Settings** button (`resources-mcp-settings`, `Button soft-primary s`).
There is no PID and no immediate stop: pi offers neither. Controls are disabled without
authority, one request per server is in flight, and errors stay on the row.

**Receipts.** The transcript's turn divider may carry a "N still running" chip supplied by the parent;
it opens the inspector and is the only chat-body roster hint — there is no inline list.

**Result row.** `ResultRow` renders one historical completion notice (the details of a
`background-command-completion` or `subagent-completion` message, or of a finished result the agent
pulled) for the transcript: chevron · kind glyph with status dot · an optional `receipt` lead ("Agent
received" / "Agent replies after your next message") · `Background` / `Subagent` · name · state · run time (the same coarse
`formatElapsed` the Finished row shows) · exit badge (commands) · optional parent-supplied `metaLead`
node (the subagent's model label) and `meta` text ·
a one-line teaser · an optional open action ("Open log" / "Transcript"). The command teaser is the
excerpt's last non-empty line with ANSI CSI sequences removed; a subagent teaser comes from the parent,
which owns the report text. The teaser hides while expanded, gives way first at narrow widths, and keeps
the code face for command output. The row is **controlled**: `expanded`, `onToggle` and `toggleRef` come
from the parent's transcript fold state, and without `onToggle` there is nothing to expand. It never
claims current authority — whether the open action exists is the parent's call from its own snapshot.
Its status-dot ring is drawn against the transcript canvas, not the elevated roster surface.

Command output is plain monospaced text, not an interactive terminal or interpreted markup. Show when
only a bounded tail remains, and distinguish empty output, loading, transient read failure and
permanently unavailable output — and why it is unavailable: an interrupted command whose host died before
it could keep the log says so; from a host that keeps logs (`retained`) anything else is simply missing;
from an older host it was evicted with the host's runtime history.

Successful Stop means cancellation was requested, not that a terminal state may be fabricated. While a
control request is pending, avoid duplicate submission; subsequent state comes from the host. A
finished resource racing a click is harmless. A stale/disconnected view cannot offer active controls
until it has current authority, and an old-host connection hides the trigger, dock and inspector rather
than displaying an empty list as proof nothing is running.

Closing the inspector, the dock, or the chat placement never stops work. Keyboard focus returns to the
header trigger when the inspector closes; if a known older host removes that trigger, focus returns to
the composer instead. A supported-to-known-unsupported welcome retires the inspector and the Stop-all
confirmation. A transient reconnect with unknown protocol support preserves the open inspector as stale
instead of misclassifying the host. Use existing Radix primitives (the in-place `DialogPanel`), token-only
styling and visible text alongside status icons.

The subagent list includes this chat's direct foreground and background children. A summary says
`detached` for a background run (the child's `info`, never guessed from queued/running), and only those
— plus finished commands — can be new results: a foreground child's report already reached the agent
in its own card. This version has no
recursive tree, workspace/global scope, restart/steer actions, artifacts, needs-you state (children run
headless), or arbitrary shell-process discovery. Ordinary workspace terminal tabs do not appear.

## Verification obligations

Cover empty/active/finished/stale/unavailable states, exact live counts, the dock's live-only rows, its
finished line (totals, new count, landing) and its collapse and hidden-while-inspecting rules, the
inspector's grouping by kind, its fold (newest five, pinned new and selected rows, hidden tally, expanded
order, paging with what is left, older-host absence), the Interrupted state and its log message, the trigger's breathing-only-while-working and unknown-count marks, the MCP
section's per-state actions, absence for older hosts and the attention marker, keyboard navigation and
focus return, safe plain-text logs, row-specific stop failures and stop-all confirmation, the subagent
detail's model item (absent without a model), and the result row's state mapping, teaser derivation, controlled expansion and optional open action.
Browser coverage must prove current-chat isolation, reload/reconnect rehydration, late completion while
the inspector is closed, and no cancellation from view closure.
