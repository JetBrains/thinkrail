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
segments — **Project · Workspace · Branch · from base · Remote · Pull request** — whose values are the
controls for switching project or workspace, acting on the workspace, and reading or retargeting the
branch. It renders what the store and `workspace.openReview` already report; it owns no host state.

## Boundary

- **Owns:** the segment grammar (caption over a 20px value row, segments separated by space alone),
  the pill/chip classes every value uses, the project switcher menu, the workspace menu (actions + sibling
  switcher + New workspace), the branch card (copy, based-on, compare-to picker, remote and review rows),
  the Remote and Pull request chips, and the responsive drop order.
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

- The strip and every segment stretch to the header's content box (39px: the 40px row minus its bottom
  border), never a fixed `h-topbar-row` — a 40px child in a 39px box centres on half pixels, blurring text
  on 1x screens and overlapping the border. A segment centres a 14px caption row (12px sentence-case
  `tr-text-metadata` in `text-subtle`, at its own 15px leading: `leading-none` lets the glyph box overflow
  the truncating row) over a 20px value row, leaving 2.5px above the caption row and below the value's hover
  fill. Segments carry no hairlines: `pl-8` plus the
  pills' own padding (≈42px text to text, 8px between hover fills) is the separation, because full-height
  rules read as a table and never line up with the tab strip's dividers below. A caption fragment (`· from <base>`,
  `· settled`) uses the caption's own face — never a second typeface inside the caption.
- Values are pills (`pillClass`: 20px, `window-no-drag`, hover `control-bg-hovered`, open
  `control-bg-selected`; the chevron is hidden at rest and appears on hover, keyboard focus, or while open)
  or status chips (`chipClass`: 20px, rounded-full, `tr-text-emphasis`, feedback-tinted `-subtle` fill with
  the solid feedback text; interactive chips hover to the `-muted` step). Every pill value is one style and one
  resting colour, `tr-title-section` in `text-muted` — the colour of workspace names in the Projects tree —
  brightening to `text-default` only on hover or while open: mixed resting greys read as accidental, so the
  only resting tonal step in the strip is caption (`text-subtle`) versus value. The project initial is a neutral tile (`control-bg-selected` / `text-muted`) so the
  least important glyph is not the only coloured one. Monospace stays inside the branch card, where the
  ref is the content, not in the strip.
- Captions stay part of the header drag region; every pill, chip, link, and the inline rename
  input opts out with `window-no-drag` (unit-tested), which is the deliberate relaxation of the shell's
  "buttons only in `topbar-actions`" rule for this strip alone.
- Drop order as the window narrows: project segment below `sm`, review chip below `sm`, branch and remote
  segments below `md`; the workspace segment never hides (e2e `topbar-chrome` keeps `scope-name` visible at
  phone width with insets). Inside the row the branch shrinks first (`shrink-[4]`), then the project
  (`shrink-[3]`), then the workspace, each capped by a `max-w`.

## Behaviour

- **Project** lists every open project (check on the current one), *Project home* (disabled while there),
  and *Add project…* (the shared `useOpenProject` picker + its dialogs). Choosing a project selects it with
  `reveal` and loads its workspace list, i.e. the same transition as the Projects tree.
- **Workspace** shows the active workspace's actions (Open in, Rename, Copy path, Reveal, **Settle** or
  **Keep active** — whichever applies, through the shared `workspaceActions` — and Remove through the
  shared confirm dialog; Default is non-removable and never settles) above *Switch to* (the project's
  **live** siblings, most recently active first — unlike the rail's stable host order, since a switcher
  serves "go back to what I was just in" — with `RunningIcon` while an agent works, then a
  **`Settled · N ›`** submenu listing the shelf rows with their reason chips — the same
  `selectWorkspacePartition` and shared `useNow` clock the rail renders, so the menu, active `· settled`
  caption, and rail never disagree as the idle boundary passes; below the settled protocol it instead
  preserves the host's raw legacy order and omits every shelf affordance. The list loads
  on first open when the tree has not) and *New workspace* with the `Mod+N` label, which opens the shell-owned
  dialog. While the active workspace is settled the caption reads **`Workspace · settled`** (the caption-
  fragment grammar `Branch · from base` already uses, in the warning tone), so a parked workspace you opened
  announces itself without a banner. Rename replaces the pill with the
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
- **Branch · from base** opens the git card, moving focus onto the card itself (not its first button, which
  would pop the copy tooltip) so one Tab reaches the actions: branch (copy → success toast), *Based on* (hidden for
  user-owned workspaces, whose caption is plain "Branch"), *Compare to* (the Changes panel's `BranchPicker`
  bound to `workspace.setDiffBase`, so the two controls can never disagree), and — only when the host has a
  review — *Remote* (`n commits to push · n commits behind origin` or "In sync with origin") and the
  PR/MR row with its link.
- **Remote** renders only while `unpushedCommits` (warning chip) or `behindCommits` (info chip) is non-zero
  and opens the same card. Both counts arrive on `OpenBranchReview`, so Remote (and the card's *Remote*
  row) can appear only alongside a review — a branch without one shows no remote state, not "in sync".
  **Pull request** is the `openReviewLabel` chip — success while the review is open, **info** reading
  *Merged #N* and **neutral** reading *Closed #N* once `OpenBranchReview.state` says so (a pre-v78 host
  omits `state` and the chip stays the open form) — a link when the provider reported a URL. Remote chips
  render only for an open review; divergence against a merged branch is noise. On v78 the host-kept
  `workspace.review` snapshot is authoritative for review presence/identity/state; a matching fresh
  `workspace.openReview` answer overlays only URL and divergence details. Thus a merged/cleared push cannot
  be masked by a stale hook cache, while a `gh` hiccup never blanks a chip the shelf still acts on. Without
  matching live details the PR row remains but the Remote summary hides — absent lookup-only counts mean
  unknown, never "In sync with origin." Pre-v78 hosts use the lookup alone and ignore rollback-stale snapshot
  fields. There is deliberately no "Open PR…" affordance: `pr.open` is a plan-session action and
  stays on the plan pane.
