---
id: submodule-web-chat-resources
type: submodule-design
status: draft
title: Chat Resources — command and subagent inspection and controls
parent: submodule-web-chat
depends-on: [module-contracts]
tags: [chat, resources]
---

## Responsibility

The current chat's **Resources** header affordance, compact resource list and read-only command-log
presentation. It makes agent-created work inspectable and stoppable without scrolling to old tool
calls or confusing that work with user-owned workspace terminals.

The user selected a header popover, not a permanent pane or workbench tab. This is a draft design;
the module is not implemented yet.

## Boundary

- **Owns:** props-driven `ResourcesButton`, `ResourcesContent`, and `CommandLogView`, exported through
  `index.ts`. The content has concrete Commands/Subagents sections, not a resource renderer registry.
- **Allowed external deps:** contracts, React, Remix icons, shared UI primitives and theme utilities.
- **Forbidden:** store/transport, server/portable extension packages, Pi value imports, process
  execution, log persistence, subagent transcript fetching, and workbench placement. Parent-chat
  integration and sibling dependency edges belong to [[submodule-web-chat]].

## Presentation

The header button reads **Resources** plus the count of active commands and queued/running
subagents. Stopping commands remain active until confirmed terminal. A parent being idle does not
hide its resources. At narrow widths the label may collapse, but the control/count and accessible
name remain available; header status text gives way before the action is clipped.

The popover puts active **Commands** and **Subagents** first, followed by a collapsed **Finished**
section containing recent terminal entries. Each row shows its name/task and source-reported state.
Command rows offer **Logs** and **Stop**; subagent rows offer **Transcript** and **Stop**. Terminal
rows keep inspection but no Stop. The Subagents section offers **Stop all subagents** with confirmation
showing the current active count; it does not stop the main chat or disable future delegation.

The Subagents list includes this chat's direct foreground and background children. Their registry
does not distinguish detachment, and queued/running must never be used to guess it. This first
version has no recursive tree, workspace/global scope, restart/steer actions, artifacts, or arbitrary
shell-process discovery. Ordinary workspace terminal tabs do not appear.

Logs open a read-only dialog over this chat; transcripts reuse the existing subagent transcript
viewer. Opening a detail closes the popover rather than stacking two active popovers. Command
output is plain monospaced text, not an interactive terminal or interpreted markup. Show when only
a bounded tail remains, and distinguish empty output, loading, transient read failure and permanently
unavailable/evicted output. The history limit is runtime history, not a promise of retained logs after
host restart. Control errors stay visible beside the relevant action.

Successful Stop means cancellation was requested, not that a terminal state may be fabricated.
While a control request is pending, avoid duplicate submission; subsequent state comes from the
host. A finished resource racing a click is harmless. A stale/disconnected view cannot offer active
controls until it has current authority, and an old-host connection hides the unsupported capability
rather than displaying an empty list as proof nothing is running.

Closing the popover, log dialog or chat placement never stops work. Keyboard focus returns to the
invoking resource row or header control as appropriate. Use existing Radix primitives, token-only
styling and visible text alongside status icons; color and animation are not the sole status signals.

## Verification obligations

Cover empty/active/finished/stale/unavailable states, exact queued/running counts, narrow header
layout, keyboard navigation and focus return, safe plain-text logs, row-specific stop failures and
stop-all confirmation. Browser coverage must prove current-chat isolation, reload/reconnect
rehydration, late completion while the popover is closed, and no cancellation from view closure.
