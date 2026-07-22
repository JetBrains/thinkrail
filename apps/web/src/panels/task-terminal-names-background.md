---
id: task-terminal-names-background
type: task-spec
status: done
title: Numbered terminal names + backgrounded (detached) terminals under the "+"
parent: submodule-web-panels
---

# Numbered terminal names + backgrounded terminals under the "+"

## Request

Stable numbered terminal names ("Terminal 1/2/3…", assigned in creation order, never renumbered on
close), and a "+" that becomes a dropdown surfacing backgrounded (tab-closed but process-running)
terminals for reattach — with a mocked green/muted status dot. Reuse existing typography only. Closing a
terminal tab stays a **view action** (must not become a process kill). Frontend-only, minimal, own
commit, tokens untouched.

## Audit / reconciliation

- Store `addTerminal` names by `list.length + 1` → **renumbers/collides** after a close. Needs a
  monotonic per-workspace counter.
- `closeTerminalTab` **removes** the terminal from `terminalsByWorkspace` → its `TerminalInstance`
  unmounts → the **PTY closes** (a kill). To honor "close is a view action, process keeps running", a
  closed terminal must **move to a backgrounded list AND stay mounted (hidden)** so its PTY survives —
  the same "keep instances mounted" pattern `TerminalsPanel` already uses for inactive open terminals.
- **No "hide tab strip when one terminal" rule exists** — `terminals.spec` asserts `terminal-tab`
  count is **1** with one terminal open. So "keep the progressive-disclosure rule" = keep current
  behavior (single tab is shown); adding a hide-when-one rule would break e2e. Noted; not added.
- `terminal-add` is clicked by the `openTerminal` fixture, so it must stay a **direct-add** button when
  nothing is backgrounded; it becomes the dropdown trigger only when the background list is non-empty.
- `DropdownMenuLabel` already renders `text-xs uppercase tracking-wider text-muted` — identical to the
  "TERMINAL" section label — so the "RUNNING IN BACKGROUND" label reuses it (no new typography).

## Design

- **Store:** add `backgroundedTerminalsByWorkspace: Record<string, TerminalTab[]>` (most-recent-first)
  and `terminalCounterByWorkspace: Record<string, number>` (monotonic; never decremented).
  - `addTerminal`: `n = (counter ?? 0) + 1`; `title = "Terminal " + n`; set `counter = n`; append + activate.
    Numbers are stable and never reused (survives closes).
  - `closeTerminalTab`: **move** the tab from `terminalsByWorkspace` → `backgroundedTerminalsByWorkspace`
    (keeps `clientId` + `title`); reassign active to the last remaining open tab (or null). No PTY kill.
  - `reattachTerminal(workspaceId, clientId)`: move back from backgrounded → tabs (append) + activate;
    the tab returns with its original number.
  - `clearWorkspaceTabs` (workspace removed): also drop the workspace's backgrounded list + counter
    (worktree gone → those PTYs go with it, as today).
- **`TerminalsPanel`:** the mounted set (`allTerminals`) now includes **backgrounded** terminals too
  (open + backgrounded, all workspaces), each hidden unless active — so a backgrounded terminal's
  `TerminalInstance` stays mounted and its PTY keeps running. The "+" (`terminal-add`): when the active
  workspace has **no** backgrounded terminals → the current plain add button (unchanged); when it has
  some → a `DropdownMenu` with **"New terminal"** (adds), a separator, a **`DropdownMenuLabel`** "Running
  in background", and one row per backgrounded terminal (a mocked status dot + its `title`; `onSelect` =
  reattach). Tab labels + the "TERMINAL" label + the tab strip (shown even for one terminal) are unchanged.
- **Mock:** `mockTerminalActive(clientId)` — deterministic green(active)/muted(idle) dot; no
  process-state polling, no wire.

## Constraints honored

Close stays a view action (PTY survives via kept-mounted instance; no kill); numbers stable/no reuse;
terminals scoped to the active worktree; open-vs-backgrounded + active are client-only view state
(in-memory as today — not sent to the server); chat/session tabs untouched; typography reused; tokens
untouched.
