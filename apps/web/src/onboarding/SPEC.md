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

The **demo tour**: launchable any time from a persistent left-panel control, it opens on a **simulated
empty-first-run state** (view-only — the real project registry is never touched), teaches opening a
project through a **simulated folder picker**, then materializes the bundled To Do App demo and guides a
newcomer through the remaining **contextual coach-mark steps** on the *real* ThinkRail interface. Every
live step advances by the user performing a **real** action, never a synthetic one.

All coach marks use one **spotlight** treatment: the viewport is dimmed with the
`container-workspace-overlay` scrim (the workspace surface at the `veil` 70% alpha step — a sanctioned
color token, see `styles/colors.json`), the single actionable target stays clear + interactive, and a
tooltip with an arrow points at it. A coach mark is **non-dismissible** — no close/Skip/Next, no
outside-click or Escape; it clears only when its action completes. Leaving the tour is a **separate** Exit
control (and the final done card), not a coach-mark dismissal.

### Stages (`onboarding.stage`)

- **`welcome`** (simulated) — a full-viewport opaque scaffold (`container-workspace-bg` shell chrome)
  showing an empty Welcome with an "Open project" card, spotlighted ("Step 1 of 4 · Open a project").
  Clicking it advances to `picker`. No real project exists yet.
- **`picker`** (simulated) — a lightened Finder-like surface with a single selectable `to-do-app` folder,
  spotlighted ("Choose your project folder"). This is a **controlled frontend simulation** — no real OS
  picker, no filesystem/backend. Selecting it runs `startDemo` (real `demo.ensure`), which moves to `live`.
- **`live`** — the real ThinkRail UI with the real demo project; `OnboardingCoach` spotlights the real
  controls for steps 2–4 (create two workspaces → first agent → second agent in parallel).

The manual launcher enters at `welcome`; the empty-state Welcome "Try the To Do App" card enters directly
at `live` (skipping the simulation, since a genuinely-empty user needs no simulated empty state).

## Behaviour

- **Entry (`startDemo`).** `demo.ensure` → adopt the returned Project (`applyProjectUpdated`), arm the
  flow (`store.startOnboarding(projectId)`), select the project (lands on its Welcome), and load its
  workspaces so the rail reveals it. Errors degrade to a toast. Invoked by the Welcome "Try the To Do
  App" card (panels).
- **The live steps** (`selectCoach`, pure over store state; the current step is *derived*, never a stored
  counter, so it auto-advances and self-heals across reloads; numbered *of 4* since the simulated
  open-project stage is step 1):
  2. **Create separate workspaces** — teaches the worktree/workspace model *before* any prompt. Anchors
     the demo Welcome's "Start building" card while zero non-Default workspaces exist, then re-anchors the
     rail `+` for the demo project once one exists. Completes at **two** non-Default demo workspaces.
  3. **Start the first agent** — anchors the **first** workspace's chat composer (guiding a switch to it
     first if it isn't active) and offers one-click **Insert** of *"Add search functionality to the To Do
     app."* Completes when that workspace's session has a sent user turn.
  4. **Run agents in parallel** — anchors the **second** (already-created) workspace: guides the user to
     switch to it, then anchors its composer and offers **Insert** of *"Add a filter for completed
     tasks."* Completes when that workspace's session has a sent user turn. The first agent keeps running,
     so parallelism is shown directly. This step never *creates* the second workspace — creation is step 2.
  A final **done** state ("You're all set") offers **Reset demo** + **Done**.
- **Auto-advance** is a consequence of the derived step: the step selectors read domain state (demo
  workspace count; whether each workspace's chat has a `kind: "user"` turn — `selectOnboardingStep` /
  `selectAgentStarted` / `selectDemoWorkspaces` in `store`). No wire traffic, no per-step store writes.
- **Reset (`resetDemo`).** `demo.reset` (archives the demo's workspaces, drops the record, deletes the
  copy) → re-`project.list` and re-install the snapshot (dropping the demo from Recents) → clear the
  onboarding slice. The demo's archived workspaces self-clear via the server's `workspace.removed`
  broadcasts. Replayable: back at the empty first-run Welcome, the "Try the To Do App" card returns.
- **Exit** (`onboarding-exit`, a fixed corner control shown for every stage) clears the tour view state
  (`store.resetOnboarding`) and restores the normal UI; any real demo project already created remains as a
  normal project. This is the only manual escape — coach marks themselves never dismiss.

## Coach-mark mechanism

- **One shell-mounted overlay** (`OnboardingDemo`); the shell composes it beside `Toaster`. It renders the
  simulated `welcome`/`picker` scaffolds itself and delegates the `live` stage to `OnboardingCoach`.
  Panels stay layout-agnostic — the overlay never imports panels, and resolves each target by a stable
  attribute (`[data-testid="welcome-cta"]`, `[data-testid="chat-input"]`, `[data-onboarding="rail-add"]`
  + `[data-project-id]`, `[data-onboarding-ws]`, and the simulated `[data-onboarding="demo-open"]` /
  `[data-onboarding="demo-folder"]`) via `document.querySelector`, measured each animation frame so it
  tracks scroll/layout/late mounts. A missing target simply hides the tooltip (never mispoints).
- The shared **`Spotlight`** primitive draws four `container-workspace-overlay` dim rects around the target
  rect (each `pointer-events-auto`, so the dimmed area both reads as inert and absorbs any outside click —
  the non-dismissible guarantee), leaving the target hole clear + interactive, and renders the existing
  Radix `components/ui/popover` (with a `PopoverArrow`) against a zero-size `PopoverAnchor` at the rect,
  with Escape / outside-interaction handlers prevented.
- Geometry (left/top/width/height) is the only inline `style`; all colour/spacing/typography use semantic
  token utilities (precedent: `chat/turns` uses inline style for a dynamic transition duration).

## Persistence

Per-browser localStorage under a host-qualified key (mirrors `panels/projectExpansion`): the slice
(`flow` / `stage` / `demoProjectId` / `dismissed`) is hydrated at boot (`initOnboardingPersistence`, wired
in `main.tsx`) and written on change, so the tour resumes where the user left it. Untrusted reads,
best-effort writes.

## Boundary

- **Public surface (barrel):** `OnboardingDemo`, `OnboardingCoach`, `OnboardingLauncher`, `startDemo`,
  `resetDemo`, `selectCoach`, `initOnboardingPersistence`, `readPersistedOnboarding`.
- **Allowed deps:** `store` (slice + selectors + `toast`), `transport` (`getTransport`/`errorText`),
  `components/ui` (`popover`, `button`), `lib`, `contracts`, `lucide-react`.
- **Forbidden:** `panels`, `shell` internals, `server`/`shared`/`pi`. (`panels/WelcomePanel` may call the
  `startDemo`/`resetDemo` orchestration — a one-way panels→onboarding edge; onboarding never imports
  panels, so there is no cycle.)
