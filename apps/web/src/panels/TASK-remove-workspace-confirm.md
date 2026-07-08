---
id: task-remove-workspace-confirm
type: task-spec
status: done
title: Workspace-removal confirmation — anchor it to the row, reword to "Remove … workspace"
parent: submodule-web-panels
tags: [v1, ui, ux]
---

## Request

Two tweaks to the workspace-deletion confirmation in `ProjectTree`:

1. **Position** — the confirmation should appear **right after / anchored to the workspace row** we mean
   to remove, rather than as a centered modal in the middle of the screen.
2. **Wording** — the heading should read **"Remove {workspace name} workspace"** (the user finds this
   reads better than the current `Archive {name}?`).

## Current behaviour (baseline)

- `WorkspaceRow` has an archive button (`Archive` icon, aria-label "Archive workspace",
  `data-testid="workspace-archive"`).
- Clicking it opens the shared `ConfirmDialog` (a **centered modal** built on `components/ui/dialog`),
  titled `Archive {name}?`, with a description ("deletes chats, terminals, worktree; the git branch is
  kept"), a destructive confirm button labelled **"Archive"** (`data-testid="confirm-archive"`), and
  Cancel. Confirming runs the **optimistic, non-blocking** `archiveWorkspace` (drop row + tabs, fire
  `workspace.remove` without awaiting, reconcile a failure by re-listing).
- e2e (`e2e/workspaces.spec.ts`) drives it via `workspace-archive` then `confirm-archive`.

## Decisions (confirmed with user)

1. **Placement — anchored popover below the Remove button.** Replace the centered `ConfirmDialog` modal
   with a small popover anchored to the row's **Remove button** (`side="bottom"`, `align="end"` so its
   right border lines up with the button's), opening just beneath it. Same optimistic Cancel/Remove
   choice, now contextual to the button. _(Refined from an initial row-anchored `align="start"` design at
   the user's request — align on the button's right border.)_
2. **Reword the whole action to "Remove".** Heading `Remove {name} workspace`, confirm button `Remove`,
   row button aria-label `Remove workspace`. Test ids follow suit (`workspace-remove` / `confirm-remove`)
   and the single e2e reference is updated. The row icon is a **`Trash2`** glyph (swapped from `Archive`
   at the user's request, to match the "Remove" wording).

## Design

- **New `ConfirmPopover` (panels)** — a reusable anchored confirmation built on `components/ui/popover`,
  mirroring the old `ConfirmDialog` API (`title`, `description`, `confirmLabel`, `cancelLabel`,
  `destructive`, `confirmTestId`, `onConfirm`, `open`/`onOpenChange`) plus `side`/`align`. It wraps its
  `children` (the caller's `PopoverAnchor` + `PopoverTrigger`) in a `Popover` and renders the confirm
  body in `PopoverContent`. Keeps the deliberate-choice contract: **Cancel first** (takes initial
  focus), a warning glyph on a `destructive` confirm; Esc + outside-click cancel (safe).
- **`ConfirmDialog` is deleted** — it was used only here and becomes dead code. Panels' `SPEC.md` is
  updated to describe `ConfirmPopover` instead.
- **`ProjectTree`** drops the shared `archiveTarget` state + the single bottom-of-nav dialog. Confirm
  state moves **into each `WorkspaceRow`** (local `confirmOpen`): the `Trash2` remove button is the
  `PopoverTrigger` **and** the popover's anchor (no row-level `PopoverAnchor`; `align="end"`), and
  confirming calls the parent's optimistic `onRemove` (still
  `store.removeWorkspace` + `clearWorkspaceTabs` + fire-and-forget `workspace.remove`, reconcile on
  failure by re-listing). Popover content is portaled to `document.body`, so the narrow nav never clips it.
- **e2e** (`workspaces.spec.ts`): `workspace-archive` → `workspace-remove`, `confirm-archive` →
  `confirm-remove`. Flow is unchanged (hover row → click remove → click confirm).

## Out of scope

- No change to removal semantics (still optimistic + non-blocking; branch kept).
- No icon change; no rename of internal store method `removeWorkspace`.

## Outcome

Landed. `ConfirmPopover` added; `ConfirmDialog` deleted; `ProjectTree`/`WorkspaceRow` reworked to the
anchored per-row popover with the "Remove … workspace" wording; e2e + `store` comments/spec updated.
Gates green: `lint`, `typecheck` (8/8 packages), no-agent `e2e` (18/18, incl. the reworded
`workspaces.spec.ts` flow). Durable decision promoted into `panels/SPEC.md`; this task-spec can be
retired.
