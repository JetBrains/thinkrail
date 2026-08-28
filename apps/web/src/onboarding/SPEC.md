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
- **Shared intro/outro layout (`OnboardingScreen`).** The first (`step: "intro"`) and final
  (`step: "final"`) screens render through **one** private `OnboardingScreen` component — same full-card
  overlay (`absolute inset-0`, `bg-container-workspace-bg`, centered, `text-center`), same content column
  (`max-w-[720px]`, hero heading unconstrained so it sits on one line and wraps only when the viewport is
  genuinely narrow — the future mobile single-view), same sequential fade/translate reveal
  (`useSequentialReveal`, `motion-reduce:transition-none`; each section + the CTA carry
  `data-revealed`), and a **single primary `Button` CTA** revealed last as the only action in the content
  area. Vertical rhythm is layout-owned via per-section `gapBefore` mapped to the spacing scale — the
  requested 32px / 64px use the `xxl` / `xxxl` scale steps (`mt-xxl` / `mt-xxxl`) — named outside
  Tailwind's `--container-*` t-shirt scale on purpose: `2xl`/`3xl` there would make Tailwind v4 emit a
  spacing-derived `max-w-3xl` that silently shadows the container one `ChatView` relies on
  (`mx-auto max-w-3xl`), collapsing the chat column. Typography is mapped to
  existing semantic roles only (`tr-brand-hero` hero, `tr-heading-md` subtitle, `tr-heading-sm` section
  heading, `tr-text-ui`/`tr-text-metadata` support) — no component-specific type — and colour uses the
  existing Primary/text/container/border semantics only (no card, no success-green surface).
- **Intro** (`onboarding-intro`, first): reveals in sequence — "Welcome to ThinkRail" (`tr-brand-hero`),
  32px, the product subtitle (`tr-heading-md`), 64px, a **"Before we start"** heading (`tr-heading-sm`),
  32px, the Git prerequisite explanation (`tr-text-ui`) with **one compact, fully mocked Git row**
  (`onboarding-git`) that animates `Checking Git…` (spinner) → `Git is ready` (the semantic **success**
  role + check) — no clicks, always ends ready, no terminal/install/Git-config detail; it reveals the Git
  prerequisite before a real project could error. The intro **does not auto-advance**: it stays visible
  indefinitely until the user clicks the **"Start demo project"** CTA (`onboarding-start`), which enters
  the first interactive action. **Nothing here detects/invokes Git** or touches any real state; it is not
  a numbered onboarding step, and no coach mark shows during the intro. (The missing-Git install flow is
  deliberately out of scope — a future state once Git is bundled vs. externally installed is decided.)
- **Close demo** (`onboarding-close`, a quiet `Button variant="ghost"` in the card's top-right) is present
  throughout — intro included — and is the only explicit pre-completion exit. It only clears the mocked
  experience (`closeDemo`); it touches no real state. Coach marks themselves stay non-dismissible.
- **The two predetermined tasks** (used in the dialog prompt *and* later in the composer/chat, one source
  of truth): *"Implement a search feature in my To Do app."* and *"Add filtering by tags so I can quickly
  show tasks with a specific tag."*
- **Reusing the real Create-workspace dialog.** Step 2 renders the production `panels/NewWorkspaceDialog`
  verbatim via a small **injected** `renderCreateDialog` render-prop (the shell composition root supplies
  it — same inversion it uses for `SettingsDialog`'s Layout section — so `onboarding` never imports
  `panels`, no cycle). The dialog runs in an **inert `preview` mode** (optional props on the shared
  component, default off): all its wire reads are skipped, submit is short-circuited to `onPreviewCreate`,
  and the Create button's `↵` key-badge is hidden (Create is text-only) — so the exact real dialog UI is
  taught while **no** workspace/session/wire work happens. The task is passed as `initialPrompt` and the
  seam **types it in** character-by-character (instant under reduced motion), keeping Create inactive
  until done and firing `onPreviewReady` so the sim only shows the Create coach once typing finishes. Its
  coach uses a **viewport-scoped** spotlight (the dialog is a portaled modal): a pulse ring on Create + a
  tooltip to the dialog's right; every other step uses the card-scoped spotlight.
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
- **Coach surface = inverted/high-contrast.** Every coach tooltip (both card- and viewport-scoped) renders
  on `bg-primary` with `text-text-on-primary` and a `fill-primary` arrow, so it stands out from the dark
  ThinkRail UI.
- **Inverse system surface (design-system extension).** The fake folder picker needed a neutral
  light/inverse surface, which the semantic layer previously lacked. Rather than a picker-specific token,
  the color model was **extended** with a small, reusable **inverse-surface family** in `styles/colors.json`:
  `container-inverse-bg` (the theme *foreground* used as a surface — off-white on the dark themes, dark on
  the light ones, i.e. always contrasting the app), `text-on-inverse` (+ `-muted`), `border-inverse`, and
  `container-inverse-selected`, all derived from existing palette keys + the shared alpha scale. Any future
  "this is the operating system / a system overlay" surface reuses it. Coach marks keep the `primary`
  high-contrast treatment (brand emphasis), distinct from this neutral inverse.
- A single **1px progress line** (`onboarding-progress`, `bg-primary`, smooth `transition-[width]`) sits on
  the card's bottom edge and advances across the scripted `STEP_ORDER`. No labels/percentages/dots.
- Only the current target is interactive; everything else is present but inert (covered by the dim).

## Scripted flow (local `step` state machine)

1. **Open a project** — empty-state Welcome with an "Open project" card (arrow points down to it); clicking
   opens a **fake, simplified macOS-Finder-style folder picker** rendered on a **light / inverse system
   surface** so it reads as "your computer" opened on top of the dark app (not another ThinkRail panel):
   a header labelled **"Your computer"** with a plain **Your computer › My Documents › Projects**
   breadcrumb (no technical `/Users/…` path), a `radius-lg` window, and three columns — Locations
   (**My Documents** selected) → My Documents contents (**Projects** selected) → `my-app` / `notes` /
   `to-do-app`. Only `to-do-app` is interactive (spotlit with the pulsing primary emphasis, coach above
   it, arrow down); everything else stays under the dim and does nothing. Selecting `to-do-app` opens the
   fake "To Do App" project. The light surface is the sanctioned **`container-inverse-*` / `text-on-inverse*`
   / `border-inverse`** semantic family (see below) — no macOS assets or hardcoded grays. The rest of the
   onboarding stays dark; only the picker inverts.
   The demo card carries a soft **brand glow** — a blurred `bg-primary-soft` layer behind it (not
   `feedback-success`; onboarding emphasis, not a success state), extending slightly beyond the card
   without altering its background, border, or layout.
2. **Create the first workspace** — coach at the rail `+` opens the **real** `NewWorkspaceDialog` (preview
   seam below); the task **types itself** into the real prompt field (focused, blinking caret; instant
   under reduced motion), Create stays inactive until typing finishes, then the coach re-points to the
   right of the dialog with its arrow on the emphasized **Create**. Clicking Create enters the first
   workspace.
3. **First agent starts, and keeps running** — the first workspace shows concise, believable agent
   activity (reads files → plan → "Working…") in the real chat visual language and **stays running**; its
   rail row keeps a working indicator. The coach points back at the rail `+`: "start a second task — your
   first agent keeps working here."
4. **Create the second workspace** — same real dialog + typed task for *"Add filtering by tags…"*.
5. **Second agent + full workbench** — entering the second workspace shows the integrated workbench, all
   **mocked** with the real visual language: an active agent chat (center), a right-side
   Files/Specs/Changes strip, and a bottom **Terminal** strip — so it reads as ThinkRail, not a bare chat.
6. **Agent asks for feedback** — the second agent pauses with a **question widget** ("Where should tag
   filters appear?" + options + a custom field); a coach points at it ("Give the agent feedback"). The
   user must choose an option or type their own; on answer the agent acknowledges and resumes.
7. **Parallel payoff** — while the second agent continues, the coach moves to the **left nav** and
   highlights the **first** workspace (pulsing primary): "Your agents work in parallel — your first task
   kept running. Check its progress." The second workspace visibly stays active; a left-panel note states
   switching views never stops a session.
8. **Return to the first workspace** — clicking it shows the first agent **completed** (result + a small
   Changes summary), making the "I left, worked elsewhere, came back done" point.

**Completion** (`step: "final"`, progress 100%) — the **same `OnboardingScreen` layout** as the intro
(no card, no success-green treatment): **"That's the workflow."** (`tr-brand-hero`), 32px, **"Now try it
with your own project."** (`tr-heading-md`), revealed sequentially, then a single **"Start working on your
own project"** CTA (`onboarding-finish`, `closeDemo`) as the only action in the content area — no docs
link. The global **Close demo** control stays. Local state, so reopening replays from the intro. The agent activity, workbench sides, terminal, and question widget are **faithful mocks** (the
real chat/panels/terminal/question components are chat-runtime/store-coupled and can't mount in an
isolated mock); only `NewWorkspaceDialog` is the real component (preview seam).

## Boundary

- **Public surface (barrel):** `OnboardingSimulation` (takes a `renderCreateDialog` render-prop),
  `OnboardingLauncher`, `useTargetRect` (anchor hook). The store exposes `demoOpen` + `openDemo`/`closeDemo`.
- **Allowed deps:** `store` (`demoOpen`/open/close), `components/ui` (`popover`, `button`), `constants`
  (`PRODUCT_NAME`), `lib`, `lucide-react`, React.
- **Forbidden:** `panels`, `shell` internals, `server`/`shared`/`pi`, `transport` (the simulation makes no
  network/wire calls). It reuses the real `NewWorkspaceDialog` **without importing `panels`** — the shell
  injects it through `renderCreateDialog`. `panels` (`WelcomePanel` card, `ProjectTree` footer launcher)
  call `openDemo` — a one-way panels→onboarding edge, no cycle.

## Dormant (retained, not wired)

The earlier **real-domain** onboarding coach — `OnboardingDemo`, `OnboardingCoach`, `coach.ts`,
`Spotlight.ts`, `demo.ts` (`startDemo`/`resetDemo`), `persistence.ts`, the `onboarding` store slice +
selectors + `demo.ensure`/`demo.reset` wire — is **kept intact but unwired** (the shell mounts
`OnboardingSimulation`, not `OnboardingDemo`; entry points call `openDemo`). It is preserved deliberately
so this mocked prototype stays easy to iterate on or swap back, and so the server-side bundled-demo
capability (`submodule-server-demo`) remains available for a future real flow. It touches no live UI path.
