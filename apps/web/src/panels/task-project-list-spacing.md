---
id: task-project-list-spacing
type: task-spec
status: done
title: Exact vertical spacing around PROJECTS list items + header gap
parent: submodule-web-panels
---

# Exact vertical spacing around PROJECTS list items + header gap

## Request

Apply exact vertical spacing in the left PROJECTS list: 24px below the PROJECTS header before the first
item; collapsed items 12px top + bottom (12px each side of the divider); expanded groups 12px at the very
top, 6px project-row→first-worktree and between worktrees, 12px after the last worktree before the divider.
Edge-to-edge dividers, fonts, colors, hover chevron/buttons, and highlights unchanged.

## Change (`ProjectTree`)

Exact px (the `--space-*` tokens are font-fluid, so arbitrary values — as the chat rhythm already does):

- Dropped the nav's `gap-sm`; the projects `<ul>` gets `mt-[12px]`.
- The per-project block wrapper gets `py-[12px]` (always; the `bg-elevated` open-group tint stays
  conditional). Across a divider that reads 12|divider|12; combined with the `ul mt-[12px]` the header→
  first-row gap totals **24px**. Collapsed = the row with 12px top/bottom.
- The worktree `<ul>` gets `mt-[6px]` (project row → first worktree) + `gap-[6px]` (between worktrees); the
  wrapper's `pb-[12px]` sets the last worktree off from the next divider.

## Follow-up: 6px divider gaps + full-bleed tint

Tightened the divider-adjacent spacing 12px → **6px** (block `py-[12px]` → `py-[6px]`; header kept at 24px
via `ul mt-[12px]` → `mt-[18px]`), and made the hover / active-primary / gray-group backgrounds
**full-bleed** — edge-to-edge and up to the dividers. The tinted element is `-mx-md` (negating the nav
`p-md`) with content re-inset by existing tokens (`px-md` on the block; `calc(var(--spacing-md)+…xs/xl)`
paddings on the full-bleed project / worktree rows), so only the background bleeds — content doesn't move.
Collapsed → the block wrapper holds the hover/active tint (filling its full height to the dividers); open →
the wrapper is the neutral group tint and the active row/worktree tints itself full-bleed over it. No
rounding on the full-bleed tints. Measured: header→row 24, group-top→row 6, row→worktree 6, worktree→
group-bottom 6; the active worktree + gray group span the panel edges (0…navWidth).

## Verification

- lint + typecheck + check:deps green; `shell`/`projects`/`workspace-lifecycle`/`project-view` specs green.
- Measured on a real expanded project (bounding boxes): header→row **24px**, group-top→row **12px**,
  row→worktree **6px**, worktree→group-bottom **12px** — all exact. Between-worktrees `gap-[6px]` and the
  collapsed 12|divider|12 follow from the same `py-[12px]`/`gap-[6px]`.
