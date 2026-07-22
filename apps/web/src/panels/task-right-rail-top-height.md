---
id: task-right-rail-top-height
type: task-spec
status: done
title: Align the right rail tab strip to the other columns' top height
parent: submodule-web-panels
---

# Align the right rail tab strip to the other columns' top height

## Request

The three full-height columns each have a top region + bottom hairline; the right rail's tab strip
(SPECS / ALL FILES / CHANGES + refresh icon) is shorter than the left panel top and the center header,
so the bottom dividers don't line up. Bring the right rail's top strip up to the same height as the
other two so all three dividers land on one line. (Contents, labels, alignment, vertical centering
unchanged; don't touch the other two tops or anything below.)

## Reconciliation (48px vs actual) — resolved to 48px

The three tops were actually **`h-[50px]`** in code, not 48px. First pass matched the right rail to the
siblings (50px); the user then confirmed they want **exactly 48px**. So all three column tops are set
to **`h-[48px]`** — an absolute pixel value (not the rem-based `h-12`) so the font-scale setting can't
shift the shared top height.

## Change

- **`RightPanel.tsx`** tab strip: `h-7` (28px) → **`h-[48px]`**.
- **`LeftPanel.tsx`** top region + **`Shell.tsx`** `MainHeader`: `h-[50px]` → **`h-[48px]`** (so the
  three bottom hairlines land on one line at 48px).

Everything else on each strip (tab buttons/labels, `items-center` centering, `gap`, `px-*`,
`border-b border-border2`, the refresh icon, the breadcrumb + git-status cluster) is unchanged.
