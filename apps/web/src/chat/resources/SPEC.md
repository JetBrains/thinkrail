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

The current chat's **Resources** surfaces: a header **trigger**, an ambient **dock** above the composer,
and an **inspector** over the transcript. Together they make agent-created work — background commands
and subagents — glanceable while you type, inspectable without scrolling to old tool calls, and
stoppable, without confusing it with user-owned workspace terminals; and they show the chat's MCP
servers with their per-chat actions.

All three render one host-reported snapshot through one row grammar; none is a permanent pane or a
workbench tab. The inspector lives inside the chat column and leaves the composer usable.

## Boundary

- **Owns:** props-driven `ResourcesButton`, `ResourcesDock`, `ResourcesInspector`, and `CommandLogView`,
  exported through `index.ts`, plus the private row/state vocabulary they share and the private MCP rows
  (`mcpRow.tsx`). The inspector renders the roster and a detail *header*; the detail *body* is a slot the
  parent fills.
- **Public surface:** `ResourcesButton`, `ResourcesDock`, `ResourcesInspector`, `CommandLogView`.
- **Allowed external deps:** contracts, React, Remix icons, shared UI primitives and theme utilities, and
  `lib` (the shared MCP state vocabulary). Time arrives as a `now` prop so formatting stays pure.
- **Forbidden:** store/transport, server/portable extension packages, Pi value imports, process
  execution, log persistence, subagent transcript fetching, and workbench placement. Parent-chat
  integration (what fills the detail slot, where the surfaces mount) and sibling dependency edges
  belong to [[submodule-web-chat]].

## Row grammar

Every surface renders a resource as one row: kind glyph with a status dot · name (command display
name or subagent role) · activity (the command text or the task) · state · elapsed, with Inspect/Stop
appearing on hover and focus in place of the state text so rows never change height. A row's visual
state collapses the wire statuses into one in-flight presentation and three settled ones:

- *running* commands and *running* subagents → **Working** (primary, breathing dot); *queued* →
  **Queued**; *stopping* → **Stopping…** — all live, all sorted before settled rows, **oldest start
  first regardless of live state**, so a row never jumps when it starts or begins stopping;
- *completed* with exit 0 / *completed* subagents → **Done** (success); nonzero exit, *error* → **Failed**
  (error, auto-visible); *stopped* / *aborted* → **Stopped** (neutral: a user stop is not a failure).

State is always glyph + colour + word; colour and motion are never the only signal. Elapsed time is
coarse (minutes) because the shared clock ticks every 30 s; it is a live row's duration, or a settled
row's run time — a command's finish minus start, a subagent's host-reported `durationMs` (absent from
an older host, so that row shows no duration rather than a guess). Exit codes render as a monospaced
badge.

## Presentation

**Trigger.** The header button reads **Resources** plus the count of active resources only while the
snapshot is authoritative: live rows plus MCP servers that are connected or starting. The icon breathes
only while background work runs (`working`), so an always-connected server never animates the header.
Before the first read, during
reconnect, or after refresh failure it shows an explicit unavailable-count mark and a matching
accessible label rather than claiming zero. A parent being idle does not hide its resources. At narrow
widths the label may collapse, but the control/count state and accessible name remain available. The
trigger toggles the inspector and carries `aria-expanded`.

**Dock.** The dock lists live rows only — never finished work — directly above the composer, and
renders nothing when there is none. Past four rows it collapses to one summary line (live count,
per-kind counts) that the user can expand; the collapsed/expanded choice is local to the dock. A dock
row has exactly two controls: its name and activity together are one Inspect control that opens the
inspector at that row, and Stop requests cancellation for that row. The dock is **hidden while the inspector is open** so the live roster is never rendered twice.
It reserves its rows rather than animating height on every change, so the composer does not jitter.

**Inspector.** A non-modal in-place dialog over the transcript region with the chat header and
composer still visible and usable: a roster column (**Active**, then **Finished**, each with counts) and
a detail column for the selected row. The detail header repeats the row's name and state and offers
Stop for live rows; the detail body is the parent's slot — bounded plain-text command output for a
command (this module's `CommandLogView`), the read-only subagent transcript pane for a subagent. The
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
extension registered, which the host refuses to disable per chat), and **Reconnect** for failed or
disconnected. There is no PID and no immediate stop: pi offers neither. Controls are disabled without
authority, one request per server is in flight, and errors stay on the row.

**Receipts.** The transcript's turn divider may carry a "N still running" chip supplied by the parent;
it opens the inspector and is the only chat-body roster hint — there is no inline list.

Command output is plain monospaced text, not an interactive terminal or interpreted markup. Show when
only a bounded tail remains, and distinguish empty output, loading, transient read failure and
permanently unavailable/evicted output. The history limit is runtime history, not a promise of retained
logs after host restart.

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

The subagent list includes this chat's direct foreground and background children. Their registry does
not distinguish detachment, and queued/running must never be used to guess it. This version has no
recursive tree, workspace/global scope, restart/steer actions, artifacts, needs-you state (children run
headless), or arbitrary shell-process discovery. Ordinary workspace terminal tabs do not appear.

## Verification obligations

Cover empty/active/finished/stale/unavailable states, exact live counts, the dock's collapse and
hidden-while-inspecting rule, the trigger's breathing-only-while-working and unknown-count marks, the MCP
section's per-state actions and absence for older hosts, keyboard navigation and
focus return, safe plain-text logs, row-specific stop failures and stop-all confirmation.
Browser coverage must prove current-chat isolation, reload/reconnect rehydration, late completion while
the inspector is closed, and no cancellation from view closure.
