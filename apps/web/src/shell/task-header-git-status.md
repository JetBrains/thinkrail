---
id: task-header-git-status
type: task-spec
status: done
title: Consolidate workspace git status into the center header; full-height right rail
parent: submodule-web-shell
---

# Consolidate workspace git status into the center header; full-height right rail

## Request

Bring the active workspace's (per-worktree) git state together on the right edge of the center header,
remove the diff stats from the left-panel workspace row, swap the open-project button icon to
folder-open, and extend the right rail to full height (its own top, level with the header). Status is
**display-only** (mocked data; no git polling; no push/pull/sync). Frontend-only, minimal, own commit,
tokens untouched.

## Audit / reconciliation

- **No split-editor ("layout-columns") control exists** in this app (grep-confirmed). The request says
  "keep the existing split control at the far right" — there is nothing to keep, so the git-status
  cluster sits at the header's right edge and no split control / trailing divider is added. Noted.
- Header today (`shell/Shell.tsx` `MainHeader`): breadcrumb only, **two lines** — line 1
  `scope-project › scope-name`, line 2 `GitBranch + scope-branch · from scope-base`. Right side empty.
- Layout today: top-level `[left | main]`; `main` = `grid-rows[MainHeader | body]`; body(active) = nested
  `[center | right(files/terminals)]`. So the header spans center+right and the right rail starts
  *below* it. Point 5 needs 3 full-height columns.
- Diff stats live on `ProjectTree` `WorkspaceRow` (`hasStats` → `+added −removed`). Remove.
- The open-project "+" is `LeftPanel`'s `AddProjectMenu` trigger (`Plus`). Swap to `FolderOpen`.
- **e2e coupling:** `workspace-tabs.spec` asserts `scope-name` **and** `scope-branch` text. The new
  single-line crumb folds the branch into the name crumb + a base-branch tooltip, so `scope-branch`/
  `scope-base` are removed → update that test to assert `scope-name` only.

## Design

1. **Center header right — git-status cluster** (active workspace only), `GitStatusCluster` in
   `Shell.tsx`, fed by a clearly-labelled **mock** `mockGitStatus(workspaceId)` (deterministic per id,
   no wire): ahead (`ArrowUp` + count, `text-primary` teal) + behind (`ArrowDown` + count, `text-gold`
   amber), numbers in `--font-mono`; when both 0 → a subtle synced glyph (`Check` + "up to date",
   `text-hint`). Dirty → amber dot (`bg-gold`) + "uncommitted", only when dirty. No sync/push/pull.
2. **Breadcrumb single line:** `[Box muted] project › [GitBranch bright] {workspace name}`. Base branch
   moves into a **tooltip on the name crumb** (`from {baseBranch}`, prefixed with the full name when
   truncated). Second line removed (`scope-branch`/`scope-base` gone; `scope-project`/`scope-name` kept).
3. **Workspace row:** remove the `diffStats` block — row is branch icon + name only. (`diffStats` stays
   on the wire type; just unrendered.)
4. **Open-project trigger icon:** `Plus` → `FolderOpen` in `LeftPanel` (testid/aria/tooltip/behavior
   unchanged — the "+" glyph is reserved for create-workspace).
5. **Full-height 3-column layout** (active workspace): top-level horizontal group becomes
   `[left | center | right]` (new `autoSaveId` to avoid stale saved sizes). The **header lives inside
   the center column** (`grid-rows[MainHeader | CenterTabs]`), so `resize-left` and `resize-right` both
   run full height and each column has its own top; the right rail (files-over-terminals vertical group)
   reaches the top with its tab strip at the top edge. Welcome state stays `[left | (header + welcome)]`.

## Constraints honored

Display-only (no git actions); status is per active worktree; active workspace + split/panel sizes stay
client-only (resizable `autoSaveId` localStorage); tab behavior untouched; tokens untouched.
