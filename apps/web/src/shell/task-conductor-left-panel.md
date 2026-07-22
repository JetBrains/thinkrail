---
id: task-conductor-left-panel
type: task-spec
status: done
title: Conductor-style full-height left panel (no global top bar)
parent: submodule-web-shell
---

# Conductor-style full-height left panel (no global top bar)

## Request

Rework the shell into a full-height left panel + a separate main area, each with its own top region
(the left|main divider runs to the very top). Element-by-element:
1. Remove the global top bar spanning the window.
2. Left panel top region (~50px, own bottom hairline): accent square logo placeholder (~26px, ~7px
   radius) at left; a **"+"** at the right corner opening a dropdown **New project / Add existing
   repository** — replaces the old "+" beside the PROJECTS header.
3. Projects list: keep the **PROJECTS** label; project rows use the **cube** icon (as the Create-
   workspace project chip does), not folder; active project = violet-accent left border + subtle tint
   + chevron expand/collapse; workspaces nested one level under, git-branch icon, indented.
4. Left panel footer (own top hairline): left-aligned group — connection beacon (dot + label, green
   when connected), a documentation/help icon, a settings icon.
5. Main-area top header: keep the breadcrumb (project > workspace) at left; **remove** the settings
   gear + Connected indicator from the top-right (both moved to the footer); leave the right-panel
   toggle as is.

Frontend-only, minimal, mocked data where needed, keep existing tokens (dark Darcula, violet accent,
three fonts). Own commit. Do not break: connection state is reused (not re-fetched); expanded/active/
panel-width stay client-only view state (never sent to server); projects/workspaces stay a server
projection; tab behavior untouched.

## Audit / constraints found

- Global bar lives in `shell/Shell.tsx`: wordmark, breadcrumb (`scope-context`/`scope-project`/
  `scope-name`/`scope-branch`/`scope-base`), `connection-status` (+`data-status`), `open-settings`
  gear. Below it, one horizontal `ResizablePanelGroup` (`thinkrail-shell`) = left|center|right; a
  separate welcome group (`thinkrail-shell-welcome`).
- The old "+" is `ProjectTree`'s header button (`add-project-menu` trigger → `AddProjectMenu` with
  `menu-open-project`). **e2e coupling (must preserve):** `fixtures/app.ts` + `projects`/`ask-restart`
  drive `add-project-menu` → `menu-open-project`; `layout.spec` measures `left-nav` width + drags
  `resize-left`; `shell`/`welcome`/`connection-status`/`open-settings`/`scope-*` are asserted widely.
- The **cube** icon is lucide `Box` (used in `NewWorkspaceDialog`'s project chip).
- There is **no** existing "right-panel toggle" in the codebase → that clause is a no-op (nothing added
  or removed); the main header's right side stays empty.
- `AddProjectMenu` is shared with `WelcomePanel` — relabeling flows through both (acceptable, keeps the
  UI consistent; `menu-open-project` testid + `onOpen` preserved so e2e + Welcome keep working).

## Design

- **New `panels/LeftPanel.tsx`** (parent panel, like `RightPanel`→children): `h-full` grid
  `[auto_1fr_auto]`, `data-testid="left-nav"`, `bg-surface-sidebar`.
  - Top region `h-[50px]`, `border-b`: accent square logo (`bg-primary size-[26px] rounded-[7px]`,
    `data-testid="app-logo"`) + the `AddProjectMenu` "+" (`add-project-menu`) at the right corner. Owns
    `useOpenProject` (moved from `ProjectTree`) + renders its `dialogs`.
  - Middle: `overflow-auto` `<ProjectTree />` (list only).
  - Footer `border-t`: left-aligned `connection-status` beacon (reuses `store.status` — not re-fetched),
    a `HelpCircle` docs button (placeholder → `toast.info`), the `open-settings` gear.
- **`ProjectTree`**: drop the header "+"/`AddProjectMenu`/`useOpenProject`/`dialogs`; keep the
  **PROJECTS** label + list. `ProjectRow` icon `Folder`→`Box`; active project adds
  `border-l-2 border-primary bg-[var(--primary-10)]` (violet accent border + subtle tint), inactive
  `border-l-2 border-transparent` (no width shift). Workspace rows already use `GitBranch` + indent —
  unchanged. The per-project `add-workspace` "+" is a different button — kept.
- **`AddProjectMenu`**: items become **New project** (`menu-new-project`) + **Add existing
  repository** (`menu-open-project`) — both call `onOpen` (the existing pick-folder flow already
  git-inits a non-git folder = "new project", or opens an existing repo). Drop the disabled GitHub
  item; keep Recents.
- **`Shell.tsx`**: remove the global `<header>`. Top-level horizontal group (new `autoSaveId`
  `thinkrail-shell-v2` to avoid stale saved 3-panel sizes): `left` (`LeftPanel`) | `resize-left` |
  `main`. `main` = grid `[auto_1fr]`: a **`MainHeader`** (breadcrumb, `h-[50px]`, `border-b`, `scope-*`
  testids moved verbatim; right side empty) over the body. Body = active-workspace → nested horizontal
  group (`thinkrail-main`) center|right(files/terminals, `thinkrail-right`); else → `WelcomePanel`.
  `SettingsDialog` + `Toaster` stay mounted once.

## Assumptions (unconfirmed, recorded)

- "New project" and "Add existing repository" both route through the existing open/init picker (no
  separate new-project backend exists; frontend-only). 
- Help icon is a placeholder (`toast.info("Documentation coming soon")`) — no docs URL exists.
- Expanded-project state stays in-memory client view state (as today) — already never sent to the
  server; panel widths persist via `autoSaveId` localStorage. Not adding new persistence.

## Token note (flagged, not acted on)

The task says "violet #8C81FF accent". The live `--primary` token is currently **teal #2dd4bf** (from
an earlier approved rebrand commit). This task is layout-only and must not change tokens, so all accent
use is via `--primary` utilities (themeable, no raw hex) — rendering as whatever the token is. Reverting
the teal rebrand is offered separately, not done here.
