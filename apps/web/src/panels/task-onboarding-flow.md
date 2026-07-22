---
id: task-onboarding-flow
type: task-spec
status: done
title: First-run onboarding overlay (blocking), re-openable from the logo
parent: submodule-web-panels
---

# First-run onboarding overlay, re-openable from the logo

## Request

A full-viewport, sequential, step-indicated onboarding. **First launch** of a project → opens
automatically and is **blocking** (no dismiss/skip; must step through + approve the root path).
**Re-open** by clicking the product **logo** → same flow but **closable** (Done). Steps: (1) combined
Welcome + root-path approval (product name + description + a mock default root + approve control + "You
can change this later in settings."; approval required to proceed); (2) 2–3 feature explainers
(isolated worktrees + spec graph + parallel sessions); final step "Get started" closes it. Reuse
existing modal/button/text styles; mock the first-run flag + root path. Frontend-only.

## Design

- **Mock flag (`store/onboardingStorage.ts`, localStorage `thinkrail:onboardingSeen`):**
  `readOnboardingSeen()` / `markOnboardingSeen()`. Absent = first run.
- **Store:** transient `onboarding: "first-run" | "review" | null` + `openOnboarding(mode)` /
  `closeOnboarding()` (open state only — not persisted; the seen flag is the persisted mock).
- **`panels/Onboarding.tsx`** (mounted once by the shell, like `SettingsDialog`): on mount, if
  `!readOnboardingSeen()` → `openOnboarding("first-run")`. Renders a **full-viewport `Dialog`**
  (`DialogContent` with `!inset-0 !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0`,
  `hideClose` on first-run; `onEscapeKeyDown`/`onInteractOutside` `preventDefault` on first-run) — so
  first-run has **no** close affordance; review is closable. A `grid-rows-[auto_1fr_auto]` column: step
  dots (active `bg-primary`, else `bg-border2`) + "Step N of M", the step body (`DialogTitle` +
  `DialogDescription` per step for a11y), and a footer (Back when `i>0`; step 0 primary "Continue"
  disabled until the root is approved; last step "Get started"). Finish → `markOnboardingSeen()` (if
  first-run) + `closeOnboarding()`.
- **Root approval (step 0):** the mock path `~/.thinkrail/worktrees` in a mono box + a native checkbox
  (`accent-[var(--primary)]`) "Save worktrees here" + helper "You can change this later in settings.";
  the primary button is disabled until checked.
- **Logo trigger:** `LeftPanel`'s `app-logo` placeholder becomes a `<button>` → `openOnboarding("review")`
  (always available, per the dev/testing note). Same testid.
- **Feature steps:** isolated git worktrees (own branch + dir); a living spec graph the agent reads/plans/
  builds from; parallel agent sessions each in its own workspace.

## Testing (keep the blocking overlay out of every other e2e)

The blocking first-run would otherwise cover the viewport in every test. Single-point fix: a global
Playwright **`use.storageState`** (`e2e/fixtures/onboarding-seen.json`) that pre-seeds
`thinkrail:onboardingSeen=true` for the app origin — so all existing tests (incl. second-tab pages in
one context) start past first-run, untouched. New **`onboarding.spec`**: (a) first-run with
`test.use({ storageState: { cookies: [], origins: [] } })` — auto-opens, blocking (no close, Esc doesn't
dismiss), approve-gated step 0, steps through, "Get started" closes; (b) review — click `app-logo` →
opens closable, close works.

## Constraints honored

Reuses `Dialog`/`Button`/`DialogTitle`/`DialogDescription` + token utilities (no new styles/tokens);
mock flag + path (no wire/contract); only the overlay + its trigger added; other screens untouched.
