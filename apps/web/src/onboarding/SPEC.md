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

The first-run **demo tour**: enter the bundled To Do App demo, then guide a newcomer through three
**contextual coach-mark steps** that ride on the *real* ThinkRail interface (not a separate wizard), and
let them reset the demo to replay. It owns the tour's orchestration + overlay; the demo project itself is
a normal Project (server `demo` module) and every step advances by the user performing a **real** action,
never a synthetic one.

## Behaviour

- **Entry (`startDemo`).** `demo.ensure` → adopt the returned Project (`applyProjectUpdated`), arm the
  flow (`store.startOnboarding(projectId)`), select the project (lands on its Welcome), and load its
  workspaces so the rail reveals it. Errors degrade to a toast. Invoked by the Welcome "Try the To Do
  App" card (panels).
- **The three steps** (`selectCoach`, pure over store state; the current step is *derived*, never a stored
  counter, so it auto-advances and self-heals across reloads):
  1. **Create separate workspaces** — teaches the worktree/workspace model *before* any prompt. Anchors
     the demo Welcome's "Start building" card while zero non-Default workspaces exist, then re-anchors the
     rail `+` for the demo project once one exists. Completes at **two** non-Default demo workspaces.
  2. **Start the first agent** — anchors the **first** workspace's chat composer (guiding a switch to it
     first if it isn't active) and offers one-click **Insert** of *"Add search functionality to the To Do
     app."* Completes when that workspace's session has a sent user turn.
  3. **Run agents in parallel** — anchors the **second** (already-created) workspace: guides the user to
     switch to it, then anchors its composer and offers **Insert** of *"Add a filter for completed
     tasks."* Completes when that workspace's session has a sent user turn. The first agent keeps running,
     so parallelism is shown directly. This step never *creates* the second workspace — creation is step 1.
  A fourth **done** state ("You're all set") offers **Reset demo** + **Done**.
- **Auto-advance** is a consequence of the derived step: the step selectors read domain state (demo
  workspace count; whether each workspace's chat has a `kind: "user"` turn — `selectOnboardingStep` /
  `selectAgentStarted` / `selectDemoWorkspaces` in `store`). No wire traffic, no per-step store writes.
- **Reset (`resetDemo`).** `demo.reset` (archives the demo's workspaces, drops the record, deletes the
  copy) → re-`project.list` and re-install the snapshot (dropping the demo from Recents) → clear the
  onboarding slice. The demo's archived workspaces self-clear via the server's `workspace.removed`
  broadcasts. Replayable: back at the empty first-run Welcome, the "Try the To Do App" card returns.
- **Skip** dismisses the whole flow (`store.dismissOnboarding`) without touching the demo project.

## Coach-mark mechanism

- **One shell-mounted overlay** (`OnboardingCoach`); the shell composes it beside `Toaster`. Panels stay
  layout-agnostic — the coach never imports panels, and resolves each step's anchor by a stable
  attribute (`[data-testid="welcome-cta"]`, `[data-testid="chat-input"]`, `[data-onboarding="rail-add"]`
  + `[data-project-id]`, `[data-onboarding-ws]`) via `document.querySelector`, measured each animation
  frame so it tracks scroll/layout/late mounts. A missing target simply hides the popover (never
  mispoints).
- Renders the existing Radix `components/ui/popover` against a zero-size `PopoverAnchor` placed at the
  target's rect (fixed position); a `border-primary-muted` ring marks the target. **No full-screen
  scrim** — the real UI the user must click stays interactive (the ring/anchor is `pointer-events-none`).
- Geometry (left/top/width/height) is the only inline `style`; all colour/spacing/typography use semantic
  token utilities (precedent: `chat/turns` uses inline style for a dynamic transition duration).

## Persistence

Per-browser localStorage under a host-qualified key (mirrors `panels/projectExpansion`): the slice
(`flow` / `demoProjectId` / `dismissed`) is hydrated at boot (`initOnboardingPersistence`, wired in
`main.tsx`) and written on change, so the tour resumes where the user left it. Untrusted reads,
best-effort writes.

## Boundary

- **Public surface (barrel):** `OnboardingCoach`, `startDemo`, `resetDemo`, `selectCoach`,
  `initOnboardingPersistence`, `readPersistedOnboarding`.
- **Allowed deps:** `store` (slice + selectors + `toast`), `transport` (`getTransport`/`errorText`),
  `components/ui` (`popover`, `button`), `lib`, `contracts`, `lucide-react`.
- **Forbidden:** `panels`, `shell` internals, `server`/`shared`/`pi`. (`panels/WelcomePanel` may call the
  `startDemo`/`resetDemo` orchestration — a one-way panels→onboarding edge; onboarding never imports
  panels, so there is no cycle.)
