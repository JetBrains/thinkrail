---
id: task-terminal-number-labels
type: task-spec
status: done
title: Terminal tab labels show the number only (background list keeps the full name)
parent: submodule-web-panels
---

# Terminal tab labels show the number only

## Request

Numbered terminal tabs + a "+" dropdown surfacing backgrounded (detached) terminals. Tab labels show
**just the number** ("1", "2", "3"…, stable per terminal, never renumbered on close); the background
list rows show the **full name** ("Terminal N") with a mocked green/idle status dot; clicking reattaches
with the original number. Keep the "TERMINAL" label. English UI text, existing styles only, no wire
change, mock the background/status.

## Already in place (commit 596bdbf, `task-terminal-names-background`)

Stable monotonic per-workspace numbering, `backgroundedTerminalsByWorkspace`, close-detaches-not-kills
(instance stays mounted so the PTY survives), `reattachTerminal`, and the `+` dropdown ("New terminal"
+ a `DropdownMenuLabel` "Running in background" listing detached terminals with a **mocked**
`mockTerminalActive` dot). The **only gap** vs this request: tab labels currently show the full
`title` ("Terminal N") instead of the number.

## Delta (minimal)

- `store`: add **`n: number`** to `TerminalTab`; `addTerminal` sets `n` from the existing counter and
  keeps `title = "Terminal " + n` (used by the background list + the close aria-label). `n` rides on
  the tab object through close/reattach, so it's stable.
- `TerminalsPanel`: the tab button renders **`{tab.n}`** (number only) instead of `{tab.title}`; the
  background dropdown row keeps `{tab.title}` ("Terminal N"). Existing tab style unchanged (no new
  typography). "TERMINAL" label + dropdown items/label untouched.
- e2e (`terminals.spec`): the tab-label assertions become `"1"/"2"/"3"/"4"`; the background row stays
  `"Terminal 2"`.

## Constraints honored

Close stays a view detach (no kill); terminal tabs only; worktree-scoped; open/backgrounded/active are
client-only view state; status dots + background membership are mocked (no new server contract);
tokens/text styles untouched.
