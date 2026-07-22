---
id: task-usage-in-footer
type: task-spec
status: done
title: Relocate the usage bar into the left-panel footer
parent: submodule-web-panels
---

# Relocate the usage bar into the left-panel footer

## Request

Remove the standalone usage row (tokens · cost · context bar · %) that sat under the tabs, and put the
same usage into the left-panel footer as a new divided line beneath the Connected/help/settings row.
Relocate only — reuse `SessionStatsBar`, don't restyle. Nothing else changes.

## Change

- **`ChatHeader`** no longer renders `SessionStatsBar`; it keeps only extension status lines and now
  **returns null when there are none** (so no empty bar remains under the tabs). Its `stats` prop is gone;
  `ChatView` no longer passes/derives it for the header (it still fetches `session.getStats` into the
  store).
- **`store/selectors.ts`:** new `selectActiveSessionStats` — the active workspace's single chat-tab
  session stats (or null), so a global surface can read per-session usage.
- **`LeftPanel` footer:** now a flex-col — the existing row (Connected · help/settings) unchanged, then a
  **hairline-divided** (`border-t border-border2`) line rendering `SessionStatsBar` (reused as-is) via
  `selectActiveSessionStats`, shown only when a chat session is active.

Frontend-only; no wire/contract change (`SessionStats` already in the store per session).

## Verification

- lint + typecheck + check:deps green; `shell`/`layout`/`welcome`/`project-view` specs green.
- Verified (no-agent, chat open): exactly one `session-stats` node, now in `left-nav` (0 in the center);
  screenshot showed the divided usage line under the Connected/settings row.
