---
id: task-project-avatar-placeholder
type: task-spec
status: done
title: "Project rows: colored rounded-square avatar placeholder instead of the cube icon"
parent: submodule-web-panels
---

# Project rows: colored rounded-square avatar placeholder

## Request

Replace each PROJECTS-list project's leading **cube icon** (`Box`) with a small **rounded-square avatar
placeholder** (solid color fill, rounded corners) so projects read like distinct apps. Each project gets
a **deterministic** color from its id (stable per project). Compact, aligned with the row (roughly the
current icon's footprint). Workspace-row branch icon unchanged. Nothing else changes.

## Design (minimal, `ProjectTree.tsx` only)

- `ProjectRow`'s `<Box className="size-4 …" />` → a `<div aria-hidden>` avatar: `size-4 shrink-0`
  (same footprint), `rounded-[var(--radius-sm)]` (existing radius token), and a `bg-*` fill picked
  deterministically.
- **Deterministic color from existing tokens** (no raw hex / new tokens, honoring the styling invariant):
  a small palette of the app's existing color utilities `["bg-primary","bg-blue","bg-green","bg-gold",
  "bg-red"]`; a stable string hash of `project.id` indexes into it → the same project always shows the
  same color. Collisions past 5 projects are fine for a placeholder.
- The avatar color is **per-project, not selection-derived** (drops the old `isSelected ? text-primary :
  text-muted` icon tint) — selection is still shown by the row's accent border + tint (unchanged). The
  name span styling and row layout are untouched. `Box` import removed.

## Constraints honored

Only the project row's leading icon swaps; workspace branch icon, row layout, spacing, text styles, and
other panels untouched. Existing tokens only (color utilities + radius token). Frontend-only; no
wire/contract change.
