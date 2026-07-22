---
id: task-worktree-modal-refine
type: task-spec
status: done
title: "Refine the create modal: worktree wording, root-path chip, button + placeholder"
parent: submodule-web-panels
---

# Refine the create modal: worktree wording, root-path chip, button + placeholder

## Request

Refine `NewWorkspaceDialog`'s chrome — call the thing a "worktree", add a read-only root-path display,
simplify the Create button, tweak the placeholder. No behavior/layout changes beyond the added chip.

## Change

- **Wording:** title `Create workspace` → **`Create new worktree`**; Create button `Create` →
  **`Create worktree`**. Subtitle unchanged.
- **Create button:** removed the `↵` return-glyph span — text only.
- **Root-path chip:** on the project + branch pickers row, added a read-only chip (`ws-root-path`) showing
  where the worktree lands — a `Folder` icon + mono `~/.thinkrail/worktrees/…` (`MOCK_WORKTREE_ROOT`, the
  same value onboarding shows). Reuses the pill tokens (`h-8`, `border-border2`, `bg-[var(--input-bg)]`,
  `rounded-[var(--radius-md)]`) but with no chevron / hover / handler — display-only, not editable here.
- **Placeholder:** `What do you want to work on?` → **`Describe your task…`**.

Frontend-only; the root path is a display-only mock (no host lookup, no wire/contract change). Create's
behavior, the merged input+controls container, and all other modals are untouched.

## Verification

- lint + typecheck + check:deps green.
- `e2e/new-workspace.spec.ts` updated (title assertion → "Create new worktree"; asserts the `ws-root-path`
  chip shows `.thinkrail/worktrees`) — both no-agent tests pass; the `create-workspace` testid is unchanged
  so the `@agent`/live create flows keep working.
- Screenshot confirmed the row (project · branch · read-only path chip), text-only button, and placeholder.
