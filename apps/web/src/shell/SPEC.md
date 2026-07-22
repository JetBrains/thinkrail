---
id: submodule-web-shell
type: submodule-design
status: active
title: shell — responsive frame
parent: module-web
tags: [v1, ui]
---

## Responsibility

The responsive frame and UI composition root: arranges panels into the 3-column desktop layout (and,
later, the mobile single-view-with-switcher).

## Boundary

- **Owns:** `Shell.tsx` — a **Conductor-style** frame: **no global top bar**, **three full-height
  columns** each with its own top. One top-level horizontal `ResizablePanelGroup` (`autoSaveId`
  `thinkrail-cols`): **`panels/LeftPanel`** (`left`) | **center** | **right rail** (`right`), with
  `resize-left`/`resize-right` running the **full height**. The **center** column routes on the store's
  two nav ids: **active workspace** → `grid-rows-[auto_1fr]` of the **`MainHeader`** over `CenterTabs`
  (header spans only the center) + the **right rail** as a vertical files-over-**terminals** group
  (`thinkrail-right`); else **a project is selected** → the read-only **`panels/ProjectView`** in the
  center (its own header, no `MainHeader`) **with the right rail still beside it** — but the rail is
  `RightPanel` **alone** (no vertical split, **no terminal**: terminals are worktree-scoped); else (no
  project) → `MainHeader` over `panels/WelcomePanel` (no rail). The **right rail is contextual** and open
  in both project + worktree contexts (`hasRail = active workspace || selected project`); `RightPanel`
  swaps its own tab set. `resize-terminals` (the vertical handle) exists only in the worktree layout, and
  only while the terminal is expanded: `panelCollapsed.terminal` (via `togglePanel("terminal")`) **omits
  the terminal `ResizablePanel`** (files take the height) and drops a thin `terminal-collapsed` re-expand
  bar (`PanelBottom`) at the bottom — the downward equivalent of the side panels' `CollapsedRail`.
  **Collapsible panels:** a `panel-left` toggle (in `LeftPanel`'s top bar) and a `panel-right` toggle
  (right end of the right-rail tab strip) collapse their side via `store.togglePanel` (client-only,
  localStorage). A collapsed side is **omitted from the group** (the center flexes into the freed space;
  the center panel keeps its slot so its content never remounts) and replaced by a thin **`CollapsedRail`**
  beside the group — a fixed-width bar whose 48px top holds the same re-expand toggle (`toggle-left-panel`
  / `toggle-right-panel`, `PanelLeft`/`PanelRight`), so a collapsed panel is always reachable. **`MainHeader`**
  is a **single-line** breadcrumb — `Box`
  (cube, muted) project `›` `GitBranch` (bright) workspace name (`scope-context`/`scope-project`/
  `scope-name`, store-derived, auto-renames live); the **base branch is a tooltip on the name crumb**
  (`from {baseBranch}`), not a second line. For an active workspace its right edge carries a
  **read-only git-status cluster** (`GitStatusCluster`): ahead (`text-primary`) / behind (`text-gold`)
  in `--font-mono`, or a synced glyph when both are 0, plus a `bg-gold` dirty dot + "uncommitted" when
  dirty — fed by a clearly-labelled **mock** `mockGitStatus(workspaceId)` (deterministic per id; **no
  git polling / wire call / actions** — display-only; a real per-worktree status feed lands when
  push/pull/sync is scoped). There is no split-editor control in this app, so nothing sits past the
  cluster. Mounts the `panels/SettingsDialog` (store-driven, via
  `store.openSettings()` — open state lives in the store so the left-panel gear and the Welcome provider
  warning can both open it), the **`panels/Onboarding`** overlay (auto-opens blocking on first run, or
  the left-panel help button re-opens it), the **`panels/ProjectDialogs`** (store-driven via
  `store.openProjectDialog(kind)` — the three unified project-entry dialogs opened from the rail menu +
  Welcome cards), and the `panels/Toaster` once, outside the layout branches. **Owns the theme DOM side-effect** — the single place that applies the store's
  (host-owned) `theme`: a `useEffect` on `store.theme` calls `utils/theme` `applyTheme(theme)` +
  `writeThemeHint(theme)` (the localStorage first-paint cache). The value flows store ← transport (welcome /
  `settings.changed`); the shell just performs the swap, so no other component touches `[data-theme]`.
- **Public surface:** `Shell`.
- **Allowed deps:** `panels` (`LeftPanel`, `CenterTabs`, `RightPanel`, `TerminalsPanel`, `WelcomePanel`,
  `SettingsDialog`, `Toaster`), `store` (theme + project/workspace context for the breadcrumb),
  `components/ui` (resizable), `components/ErrorBoundary`, `utils` (`theme`'s
  `applyTheme`/`writeThemeHint`).
- **Forbidden:** `server`/`shared`/`pi`; being imported by `panels`/`store`/`transport`.

## Error resilience (why panels can't blank the app)

Panels render (and lazily import) untrusted-shaped data; a throw during render or a failed lazy chunk
(e.g. a stale Vite dep → 504) would otherwise propagate to the React root and unmount the **whole**
tree, leaving the bare gray `--bg-dark` background. So the shell wraps each independently-mounted
region — **center (`CenterTabs`)**, **right (`RightPanel`)**, **terminals (`TerminalsPanel`)** — in its
own `components/ErrorBoundary`, keyed with `resetKeys={[activeWorkspaceId]}` so switching workspace
clears a stuck error. A **last-resort boundary wraps `<Shell />` in `main.tsx`**. `CenterTabs` adds a
per-tab boundary (`resetKeys={[active.id]}`) so one bad tab keeps the tab strip usable. The boundary
detects failed dynamic imports (`isChunkLoadError`) and steers those to a page **reload** (re-fetches
the chunk) rather than an in-place retry. Each region degrades independently — never the whole app.
