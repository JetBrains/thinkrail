---
id: task-control-tooltips
type: task-spec
status: done
title: Tooltips across UI controls (shared primitive)
parent: submodule-web-components-ui
---

# Tooltips across UI controls

## Request

Add tooltips to controls app-wide, from one shared primitive. Hover-after-delay (~450ms) + keyboard
focus; hide on leave/blur; positioned to avoid panel-edge clipping (footer opens up, left-panel
controls open right). Per-control text is enumerated in the request. Frontend-only, minimal, own
commit, tokens untouched (dark theme, violet accent, three fonts); tooltip styled subtle-dark +
hairline + muted text. Constraints: close-tab tooltip must say the session keeps running; connection
tooltip reads existing `store.status` (not re-fetched); tooltip open/close is transient client-only.

## Audit

- `components/ui/tooltip.tsx` **already exists** (Radix, token-themed: `bg-elevated`, `border-border2`,
  `text-text`, `shadow-sm`) but is **unused**, and **no `TooltipProvider`** is mounted. Radix requires a
  Provider for the delay + focus behavior.
- Right-rail tabs (Specs / All files / Changes) always render as **text labels** → skip (per request).
- There is **no right-panel toggle** in this app (removed-conceptually; never existed) → that item is a
  no-op; note it.
- Chat tabs are **non-closable** (prior change); the close `×` exists only on **file/diff** tabs — the
  requested "keeps the session running" microcopy still applies verbatim (view-only action; must not
  imply disposal).
- e2e coupling to preserve: `add-project-menu`/`menu-open-project` (the "+" is a `DropdownMenuTrigger`),
  `project-expand`, `workspace-name`, `scope-project`/`scope-name`, `connection-status`,
  `editor-tab-close`, `open-settings`, `open-docs`.

## Design

- **`TooltipProvider`** mounted once in `main.tsx` around `<Shell/>` (`delayDuration={450}`).
- **`components/ui/tooltip.tsx`**: add a default `collisionPadding={8}` to `TooltipContent` so every
  tooltip stays clear of panel/viewport edges (Radix auto-flips `side` on collision).
- **`components/Tip.tsx`** (new shared helpers, one primitive underneath):
  - `Tip({ label, side, children })` — wraps a single control element (`TooltipTrigger asChild` +
    `TooltipContent`). The always-on case (icon buttons / the beacon).
  - `useIsTruncated<T>(dep)` — measures `scrollWidth > clientWidth` (re-checked on content change +
    `ResizeObserver`); callers show a full-text tooltip **only when truncated**.
- **Wiring (side picks the open direction; Radix flips on collision):**
  - LeftPanel top `+` → `Tip` "New project or add repository", `side="bottom"` (nested inside the
    existing `AddProjectMenu` `DropdownMenuTrigger` — trigger stays the one `Button`). Logo: none.
  - ProjectTree chevron → `Tip` "Collapse"/"Expand" by state, `side="right"`. Project name →
    truncated-only full-name tooltip (`side="right"`). Workspace name → truncated-only
    `"{name} · branch: {branch}"` (`side="right"`).
  - LeftPanel footer beacon → `Tip` (reads `store.status`) "Connected to host" / "Disconnected —
    trying to reconnect", `side="top"`; docs → "Docs & help"; settings → "Settings" (both `side="top"`).
  - Shell `MainHeader` breadcrumb `scope-project` + `scope-name` → truncated-only full-name tooltip
    (`side="bottom"`).
  - CenterTabs close `×` → `Tip` "Close tab (keeps the session running)", `side="bottom"`.
- Project-name tooltip is truncated-only (consistent with the workspace rule and to avoid noise on
  short names) — a small interpretation of "useful when truncated".

## Out of scope

Right-panel toggle tooltip (no such control); right-rail tab tooltips (text labels); any token change.
