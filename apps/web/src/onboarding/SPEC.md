---
id: submodule-web-onboarding
type: submodule-design
status: active
title: onboarding — the demo tour
parent: module-web
depends-on: [module-contracts, submodule-web-store, submodule-web-transport, submodule-server-demo]
tags: [v1, ui, onboarding]
---

## Responsibility

A **fully self-contained, mocked onboarding simulation**: a large modal card that lets the user *feel*
the complete ThinkRail loop — open a project, create two isolated workspaces, run two agents in parallel —
with **zero** touch of real domain state. Nothing here calls `demo.ensure`/`demo.reset`, creates
Projects/Workspaces/Sessions, invokes pi, opens the OS file picker, or mutates persistence. The fake
project, two fake workspaces, folder picker, prompts, agent responses, and progress all live only in this
component's **local React state**. It is a visual/interaction prototype, easy to iterate or remove.

Launched from the persistent left-panel `OnboardingLauncher` (or the empty-state Welcome "Try the To Do
App" card); both flip one **view flag** (`store.demoOpen`, a top-level, non-persisted boolean via
`openDemo`/`closeDemo`). While open, `OnboardingSimulation` renders above the real (dimmed) UI.

## The simulated card

- A centered modal (~`90vw × 90vh`) over a `bg-overlay` scrim; the card is an opaque `container-workspace-bg`
  sandbox rendering a simplified but faithful ThinkRail chrome (header / left `Projects` panel / center),
  built from the existing semantic tokens and `components/ui` — **not** wired to any store domain state.
- **Animated intro** (`step: "intro"`, first): lines reveal in sequence with restrained fade/translate
  transitions (`motion-reduce:transition-none`) — "Welcome to ThinkRail" (`tr-brand-hero`), the one-line
  product explanation (`tr-text-ui`), then a short **environment-readiness moment** ("Before we start" /
  "ThinkRail works with Git projects…") with **one compact, fully mocked Git row** that animates
  `Checking Git…` (spinner) → `Git is ready` (the semantic **success** role + check) — no clicks, always
  ends ready, no terminal/install/Git-config detail; it exists to reveal the Git prerequisite before a
  real project could error. Then the ~2-minute setup note (`tr-text-metadata`) and auto-advance into the
  first interactive action. **Nothing here detects/invokes Git** or touches any real state; it is not a
  numbered onboarding step, and no coach mark shows during the intro. (The missing-Git install flow is
  deliberately out of scope — a future state once Git is bundled vs. externally installed is decided.)
- **Close demo** (`onboarding-close`, a quiet `Button variant="ghost"` in the card's top-right) is present
  throughout — intro included — and is the only explicit pre-completion exit. It only clears the mocked
  experience (`closeDemo`); it touches no real state. Coach marks themselves stay non-dismissible.
- **Coach marks** reuse the tooltip + arrow treatment: a card-scoped **spotlight** dims everything inside
  the card except the current target with the `container-workspace-overlay` scrim (the workspace surface at
  the `veil` **50%** alpha step — a sanctioned color token, light enough to keep the interface legible;
  see `styles/colors.json`), drawn as four `pointer-events-auto` rects computed relative to the measured
  card rect (so only the card interior dims, the raised card stays legible). The Radix
  `components/ui/popover` (+ `PopoverArrow`) anchors to the target; Escape / outside-interaction /
  auto-focus are all prevented. The tooltip carries **only the title + instruction** — no step number,
  progress, or pagination. A coach mark is **non-dismissible** and advances only when its scripted action
  completes.
- The current actionable target wears a **temporary pulsing emphasis** — a `ring-2 ring-primary` glow at
  the target rect (`motion-safe:animate-pulse`; static under reduced motion), rendered by the spotlight
  and moving with it. It is onboarding-only emphasis, never a permanent hover/focus/selected/active state.
- A single **1px progress line** (`onboarding-progress`, `bg-primary`, smooth `transition-[width]`) sits on
  the card's bottom edge and advances across the scripted `STEP_ORDER`. No labels/percentages/dots.
- Only the current target is interactive; everything else is present but inert (covered by the dim).

## Scripted flow (local `step` state machine, numbered "of 4")

1. **Open a project** — empty-state Welcome with an "Open project" card (arrow points down to it); clicking
   opens a **fake** picker showing one `to-do-app` folder; selecting it opens the fake "To Do App" project.
2. **Create separate workspaces** — coach sits right of the left panel, arrow pointing back at the rail
   `+`; two clicks create two fake workspaces (`Add search`, `Completed filter`), teaching the isolated
   worktree-per-task model. No real worktrees.
3. **Start the first agent** — switches into the first workspace's fake composer; **Insert** fills the
   predetermined *"Add search functionality to the To Do app."*, **Send** shows a brief "Working…" then a
   predetermined successful result (a `setTimeout`, no model call), using the existing chat treatment.
4. **Run agents in parallel** — coach guides switching to the second workspace and sending *"Add a filter
   for completed tasks."*; the first workspace's row shows it already **done** while the second works —
   the payoff that separate workspaces hold independent, concurrent sessions. A left-panel note reinforces
   that switching tabs never stops a session.

**Completion** — a "You're ready to build" card with a single **Finish** action (`closeDemo`). Because the
whole thing is local state, replaying (reopen) starts fresh at step 1.

## Boundary

- **Public surface (barrel):** `OnboardingSimulation`, `OnboardingLauncher`, `useTargetRect` (anchor hook).
  The store exposes `demoOpen` + `openDemo`/`closeDemo`.
- **Allowed deps:** `store` (`demoOpen`/open/close), `components/ui` (`popover`, `button`), `constants`
  (`PRODUCT_NAME`), `lib`, `lucide-react`, React.
- **Forbidden:** `panels`, `shell` internals, `server`/`shared`/`pi`, `transport` (the simulation makes no
  network/wire calls). `panels` (`WelcomePanel` card, `ProjectTree` footer launcher) call `openDemo` — a
  one-way panels→onboarding edge, no cycle.

## Dormant (retained, not wired)

The earlier **real-domain** onboarding coach — `OnboardingDemo`, `OnboardingCoach`, `coach.ts`,
`Spotlight.ts`, `demo.ts` (`startDemo`/`resetDemo`), `persistence.ts`, the `onboarding` store slice +
selectors + `demo.ensure`/`demo.reset` wire — is **kept intact but unwired** (the shell mounts
`OnboardingSimulation`, not `OnboardingDemo`; entry points call `openDemo`). It is preserved deliberately
so this mocked prototype stays easy to iterate on or swap back, and so the server-side bundled-demo
capability (`submodule-server-demo`) remains available for a future real flow. It touches no live UI path.
