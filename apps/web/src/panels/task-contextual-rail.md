---
id: task-contextual-rail
type: task-spec
status: done
title: Contextual right rail (project vs worktree), project Scripts/Hooks, worktree-only terminal
parent: submodule-web-panels
---

# Contextual right rail (project vs worktree), project Scripts/Hooks, worktree-only terminal

## Request

The right rail's contents follow what's active — a read-only **project** or a **worktree** — and it's
always open in both. Scripts + Hooks are project-level; the terminal is worktree-level. Plus terminal tab
refinements. Frontend-only, mock data (saving/running hooks/scripts + real terminal process state are a
host follow-up).

## Change

- **`RightPanel` is contextual:** worktree → Specs / All files / Changes (as before); project → Specs /
  All files / **Scripts** / **Hooks**. Changes is worktree-only, Scripts/Hooks project-only. Default tab
  Specs. In project context Specs/All files show a muted placeholder (no project-fs wire — decided with
  the user). Context switch resets to a valid tab.
- **`ScriptsPanel`** (new, mock): intro + play(accent)/name/mono-command rows with an edit affordance, an
  "Add" control, and the "No scripts yet…" empty state.
- **`HooksPanel`** (new, mock): intro + On create / On archive descriptions + monospace command inputs
  (mock values) + the muted "Merge hooks (pre / post) — available with the PR flow later." note (no merge
  inputs — V1 has no merge flow).
- **Shell:** the rail mounts in both contexts (`hasRail = active workspace || selected project`); the
  terminal (`TerminalsPanel`) mounts **only** for a worktree (project → `RightPanel` alone, no vertical
  split). `CollapsedRail` + center sizing follow `hasRail`.
- **Gear shortcut:** the project row's settings gear opens the project **and** jumps the already-open rail
  to Hooks via new `store.requestRailTab` / `railTabRequest` (nonce, mirrors `changesRequest`). No
  separate settings popup.
- **`TerminalsPanel` (worktree-only):** tabs now show the full **"Terminal N"** name; the sole remaining
  tab isn't closable; **two fixed controls** — "+" (tooltip "Add new terminal", adds directly) and a
  separate background/history control (`History` icon, disabled until something is backgrounded, else a
  reattach menu). Closing a tab detaches (unchanged). A muted **branch label** (`GitBranch` +
  `workspace.branch`) at the bottom names the worktree.
- Decision recorded (user): terminal tabs use full "Terminal N" labels (supersedes the number-only
  `task-terminal-number-labels`); project Specs/All files are muted placeholders.

## Follow-up (out of scope — host/domain)

Persisting + running hooks/scripts, real background-terminal process state / status dots, and project-
level Specs/All files reads are host concerns and a separate change. All such data here is mock.

## Verification

- lint + typecheck + check:deps green.
- e2e (no-agent) green: `terminals` (full labels, no-close-last, separate background control), `project-
  view` (+ new: contextual rail tabs, no Changes/terminal, Scripts/Hooks content, gear → Hooks),
  `layout`/`shell`/`welcome`/`changes`/`doc-history`. Screenshots confirmed the project rail
  (Scripts/Hooks) and the worktree terminal (controls + branch label).
