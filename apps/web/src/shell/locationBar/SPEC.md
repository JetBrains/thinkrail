---
id: submodule-web-shell-location-bar
type: submodule-design
status: active
title: shell/locationBar — captioned location segments in the topbar
parent: submodule-web-shell
depends-on: [submodule-web-panels]
tags: [ui, topbar, public-surface-checked]
---

## Responsibility

The persistent "where am I / what state is it in" strip after the ThinkRail mark: one row of captioned
segments — **PROJECT · WORKSPACE · BRANCH · from base · REMOTE · PULL REQUEST** — whose values are the
controls for switching project or workspace, acting on the workspace, and reading or retargeting the
branch. It renders what the store and `workspace.openReview` already report; it owns no host state.

## Boundary

- **Owns:** the segment grammar (caption over a 22px value row, full-height hairlines between segments),
  the pill/chip classes every value uses, the project switcher menu, the workspace menu (actions + sibling
  switcher + New workspace), the branch card (copy, based-on, compare-to picker, remote and review rows),
  the REMOTE and PULL REQUEST chips, and the responsive drop order.
- **Public surface (`index.ts`):**
  - `LocationBar`
- **Allowed deps:** `store` (projects, workspaces, session state, diff base selector, toasts), `transport`
  (`workspace.setDiffBase`), `lib` (`copyText`, `platformShortcutLabel`), `components/RunningIcon`,
  `@thinkrail/ui/*`, `@remixicon/react`, contracts types, and these `panels` files per-file:
  `workspaceActions` (the one implementation of open-in / rename / reveal / remove / `editor.list` /
  `workspace.list`, shared with `ProjectTree`), `RemoveWorkspaceDialog`, `BranchPicker` + `branches`,
  `useOpenProject`, `useOpenBranchReview` (`openReviewLabel`).
- **Forbidden:** server/shared/pi; layout engine, intents, or frame state; being imported by anything
  other than `Shell`; a second implementation of a workspace action that `panels/workspaceActions` has.

## Grammar

- A segment is `h-topbar-row`, `border-l` from the second segment on, and its vertical rhythm is spent
  explicitly on the spacing scale — `py-4`, a 10px caption row (`tr-text-caption leading-none` in
  `text-subtle`), `gap-2`, a 20px value row — so the 40px strip keeps a visible margin above the caption and
  below the pill instead of whatever `justify-center` leaves over. The caption can carry a lowercase code
  fragment (`· from <base>` as `tr-code-text-small leading-none`), which is why the uppercase caption style
  exists at 10px: eyebrow's 18px line would not fit above a 20px value.
- Values are pills (`pillClass`: 20px, `window-no-drag`, resting chevron in `text-subtle`, hover
  `control-bg-hovered`, open `control-bg-selected`) or status chips (`chipClass`: 20px, rounded-full,
  `tr-text-emphasis`, feedback-tinted `-subtle` fill with the solid feedback text; interactive chips hover to
  the `-muted` step). Project names are `tr-text-ui`, the workspace name `tr-title-section`, branch names
  `tr-code-text` — the typeface change is what separates identity from git state.
- Captions and hairlines stay part of the header drag region; every pill, chip, link, and the inline rename
  input opts out with `window-no-drag` (unit-tested), which is the deliberate relaxation of the shell's
  "buttons only in `topbar-actions`" rule for this strip alone.
- Drop order as the window narrows: project segment below `sm`, review chip below `sm`, branch and remote
  segments below `md`; the workspace segment never hides (e2e `topbar-chrome` keeps `scope-name` visible at
  phone width with insets). Inside the row the branch shrinks first (`shrink-[4]`), then the project
  (`shrink-[3]`), then the workspace, each capped by a `max-w`.

## Behaviour

- **PROJECT** lists every open project (check on the current one), *Project home* (disabled while there),
  and *Add project…* (the shared `useOpenProject` picker + its dialogs). Choosing a project selects it with
  `reveal` and loads its workspace list, i.e. the same transition as the Projects tree.
- **WORKSPACE** shows the active workspace's actions (Open in, Rename, Copy path, Reveal, Remove — the
  latter through the shared confirm dialog; Default is non-removable) above *Switch to* (siblings with
  `RunningIcon` while an agent works, loading the list on first open when the tree has not) and *New
  workspace* with the `Mod+N` label, which opens the shell-owned dialog. Rename replaces the pill with the
  chrome-less inline input used elsewhere and runs on the tree's shared `useWorkspaceRename` controller:
  Enter/blur commit, Escape cancels, unchanged or blank never requests, and a commit made while the socket's
  rename capability is unknown stays pending in the editor until a capable welcome restores it. The dispatch
  is bound to the workspace the edit started on, and because this segment is one persistent instance (the
  tree's rows are keyed per workspace), activating another workspace while the editor is open abandons the
  edit — pending offline commit included — rather than letting a later welcome rename the newly active
  workspace. The Remove confirmation follows the same rule: it renders from the workspace snapshotted when
  Remove was chosen and dismisses itself if the active workspace changes underneath it (browser Back, a
  remote removal fallback), so confirming can never delete a workspace other than the one it names. At
  Project home the pill reads "Project home" and offers only the switcher and creation.
- **BRANCH · from base** opens the git card, moving focus onto the card itself (not its first button, which
  would pop the copy tooltip) so one Tab reaches the actions: branch (copy → success toast), *Based on* (hidden for
  user-owned workspaces, whose caption is plain "BRANCH"), *Compare to* (the Changes panel's `BranchPicker`
  bound to `workspace.setDiffBase`, so the two controls can never disagree), and — only when the host has a
  review — *Remote* (`n commits to push · n commits behind origin` or "In sync with origin") and the
  PR/MR row with its link.
- **REMOTE** renders only while `unpushedCommits` (warning chip) or `behindCommits` (info chip) is non-zero
  and opens the same card. Both counts arrive on `OpenBranchReview`, which the host only produces for a
  branch with an open PR/MR, so REMOTE (and the card's *Remote* row) can appear only alongside a review — a
  branch without one shows no remote state, not "in sync". **PULL REQUEST** is the `openReviewLabel` success
  chip, a link when the provider reported a URL. There is deliberately no "Open PR…" affordance: `pr.open` is
  a plan-session action and stays on the plan pane.
