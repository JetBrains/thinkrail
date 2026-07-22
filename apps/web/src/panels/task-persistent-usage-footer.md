---
id: task-persistent-usage-footer
type: task-spec
status: done
title: Make the usage footer a persistent application-level surface
parent: submodule-web-panels
---

# Make the usage footer a persistent application-level surface

## Request

The left-sidebar usage line (tokens · cost · progress) only showed when a workspace chat was active
(`task-usage-in-footer` relocated it there, gated on `selectActiveSessionStats`). It represents overall
application usage, so it must be **always visible** — welcome / project / workspace / onboarding — never
appearing or disappearing while navigating. Layout/IA only; keep the design + mocked values.

## Change

`LeftPanel`: the usage line is no longer conditional. `stats = selectActiveSessionStats ?? MOCK_USAGE`
(a clearly-labelled `MOCK_USAGE: SessionStats` — same shape/formatting) and the `SessionStatsBar` row
always renders under the Connected/help/settings row (same fixed position, divider, spacing, sizing). It
already lives in the shared sidebar footer, so it's a single instance (no duplicate rows) and no
component moved. How usage is calculated/loaded for a real session is unchanged — only the mock fallback
makes it persistent.

## Verification

- lint + typecheck + check:deps green; `shell`/`welcome`/`layout`/`project-view` specs green; the
  `@agent` `composer.live` (asserts `session-stats` visible + "tok") stays valid (real stats when a
  session is active). Screenshot confirmed the usage line on the Welcome screen (no project/workspace).
