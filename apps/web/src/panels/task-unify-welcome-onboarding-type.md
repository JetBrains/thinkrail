---
id: task-unify-welcome-onboarding-type
type: task-spec
status: done
title: Unify welcome/onboarding typography, shrink title, swap the two triggers
parent: submodule-web-panels
---

# Unify welcome/onboarding typography, shrink title, swap the two triggers

## Request

Make the main (welcome) and onboarding screens share one text scale (based on the main screen's, which
is about right), **reduce the too-large title on both** to a moderate heading, and swap the triggers:
header logo → main/welcome screen; left-panel footer "?" → onboarding (keep first-run auto-open).

## Change

- **Typography (existing tokens only):** the shared description scale is the main screen's `text-md`
  (15px) — onboarding's `DialogDescription` moves `text-sm` → `text-md`. The shared **title** is reduced
  to the existing `--font-xl` (25px) heading token on both: `WelcomePanel`'s hero `text-[44px]` →
  `text-[length:var(--font-xl)]` (keeps its accent-font/`text-primary`/extrabold brand treatment, just
  moderate size), and `Onboarding`'s `DialogTitle` `text-lg` → `text-[length:var(--font-xl)]`. So both
  screens' "ThinkRail" reads at the same size (one family). No new tokens/sizes; the onboarding feature
  titles keep the plain `DialogTitle` weight/color (not branded).
- **Triggers:** new `store.showWelcome()` = `{ selectedProjectId: null, activeWorkspaceId: null }`. The
  header logo (`app-logo`) now calls `showWelcome()` (was `openOnboarding("review")`); the footer help
  button (`open-docs`, `?`) now calls `openOnboarding("review")` (was a docs toast). First-run auto-open
  is unchanged (Onboarding's `onboardingStorage` check). Labels updated for accuracy ("ThinkRail home",
  "Getting started"); no screen copy/steps/cards/layout changed.

## Verification

- lint + typecheck + check:deps green.
- e2e (no-agent): `onboarding` (review now via `open-docs`, + worktree-help), a new `welcome` test (logo →
  Welcome, ProjectView gone), `shell`. Screenshots confirmed the reduced/unified titles on both screens.
