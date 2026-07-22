---
id: task-projects-list-refine
type: task-spec
status: done
title: "Refine the PROJECTS list: dividers, hover chevron/gear, two-level highlight, footer"
parent: submodule-web-panels
---

# Refine the PROJECTS list: dividers, hover chevron/gear, two-level highlight, footer

## Request

Make projects read as distinct blocks and fix the footer alignment (left panel only).

## Change (`ProjectTree` + `LeftPanel`)

1. **Divider between projects:** an edge-to-edge hairline (`-mx-md h-px bg-border2`, bleeding past the
   nav's `p-md`) before each top-level project except the first — between projects only, never between
   worktrees.
2. **Hover chevron in the avatar slot:** the always-visible chevron is gone. The `size-4` slot shows the
   colored avatar by default; on row hover it swaps in place to the expand/collapse chevron (avatar
   `group-hover:opacity-0`, chevron `opacity-0 group-hover:opacity-100`, both `absolute inset-0`) — same
   slot, no reflow, text doesn't move. Clicking the slot toggles expand/collapse.
3. **Two-level highlight:** an expanded (open) project group — the row + its worktrees — gets a subtle
   neutral tint (`bg-elevated`) on the wrapping block; within it the single active item (the active
   worktree, or the project row when the project is selected with no active workspace, i.e. its
   `ProjectView`) gets `bg-[var(--primary-20)]` (raised from the old `--primary-10`; dropped the old
   `border-l-2` accent) so it reads clearly brighter than the group.
4. **Hover gear:** next to the hover "+" (create worktree), a settings gear (`project-settings`, existing
   `Settings` icon) appears on row hover and opens the project's `ProjectView` (`selectProject`).
5. **Footer:** "Connected" stays left; help + settings are grouped in a right-aligned `ml-auto` cluster.

Existing tokens/icons/styles only; no new tokens. Worktree branch glyph, avatars, and row text unchanged.

## Verification

- lint + typecheck + check:deps green.
- No-agent specs green: `shell`, `projects`, `doc-history` (clicks `project-item`), `workspace-lifecycle`
  (clicks `project-expand`), `new-workspace`, `project-view` (+ a new test: the hover gear opens the
  project screen). Screenshots confirmed the divider-less single-project group tint, the primary-20 active
  worktree, the hover chevron swap (verified avatar `opacity:0` / chevron `opacity:1` after settle), the
  hover "+"/gear pair, and the right-aligned footer.
