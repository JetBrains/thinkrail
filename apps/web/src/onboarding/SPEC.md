---
id: submodule-web-onboarding
type: submodule-design
status: active
title: onboarding — first-run education: intro overlay + worktree game + echo hooks
parent: module-web
depends-on: [module-contracts]
covers: [first-run-intro, worktree-game, onboarding-state, workspace-echoes]
tags: [v1, ui, onboarding]
---

## Responsibility

First-run **education choreography**: the one-time intro overlay (absorbed from PR #113), the
**60-second worktree prediction game**, the canned demo content both run on, and the durable
"seen" state. The module teaches ThinkRail's core working model — *every task runs in a workspace;
created workspaces are fresh parallel folders cut from a commit* — before the user hits the three
classic worktree surprises (uncommitted/untracked files stay behind; the environment must be rebuilt;
the folder path differs).

Division of labor with sibling features: **#105 (Default workspace)** removes the forced strangeness
(the project folder itself is a workspace), **#93 (lifecycle hooks)** automates the environment, and
this module teaches the mental model. Education for the model, automation for the environment — the
game never lectures about `node_modules`; it hands off to hooks.

## Boundary

- **Owns:** overlay choreography (blocking `first-run` / dismissible `review` — #113's model,
  unchanged), the intro screens, the game (beat shell + five beats), `content.ts` (demo repo fixture +
  every copy string), the durable seen-state accessors, and the one-time localStorage→config migration.
- **Public surface (barrel `index.ts`):** `<Onboarding />` (mounted once by `shell`) and the
  content/testid constants tests need. Nothing else. Open/close travels through the store's existing
  transient state (`onboarding: "first-run" | "review" | null`, `openOnboarding` / `closeOnboarding`)
  — the same pattern as `settingsOpen`; callers (help button, echo banner) use the store action and
  never import this module's internals.
- **Allowed deps:** `components/ui`, `store`, `lib`, `contracts` (types), and the transport's public
  `request` surface for `settings.update` — the established pattern (`AppearanceSettings`): fire the
  update, converge on the `settings.changed` broadcast. **Forbidden:** transport internals, `panels`
  internals, anything server-side.
- **The whole module ships eagerly** — gate, intro screens, and the game alike; there is no
  `React.lazy` split here. Unlike `panels`' Monaco/shiki/xterm surfaces, nothing in this module pulls a
  heavy dependency (the game is Tailwind transitions + `lucide-react` only, per the implementation
  constraints below), so a lazy/Suspense boundary would add ceremony without a real bundle-size win.
  Code-splitting stays reserved for Monaco-scale payloads — the `panels` convention (`panels/SPEC.md`)
  — and the overlay is small enough not to need it.

## Durable state (and the principle change)

`AppConfig` (contracts; persisted in `~/.thinkrail/config.json`, the documented "small, extensible
bag") gains:

```ts
onboarding?: {
  introSeenAt?: string;              // ISO-8601 — intro completed or skipped
  workspaceBannerDismissedAt?: string; // ISO-8601 — first-worktree banner dismissed
}
```

- **Host-synced on purpose.** First-run is *blocking* (per #113); a per-device flag would re-block
  every new browser — including the V2 phone. `AppConfig` rides the existing loop
  (`server.welcome` → `settings.update` → `settings.changed`), so no client ever re-nags and a second
  concurrent client auto-dismisses. Timestamps, not booleans: same cost, better debugging, leaves room
  for "re-show after a major change".
- **Auto-open rule:** only after `server.welcome` is processed (config known) **and**
  `introSeenAt` is absent. Completing *or skipping* the intro sets it — never nag twice.
- **Migration:** if config lacks `introSeenAt` but the legacy `thinkrail:onboardingSeen` localStorage
  key (from #113) reads `"true"`, fold it into config via `settings.update` and do not show. #113's
  original per-device storage module is deleted (its logic now lives in this module's
  `legacyStorage.ts`/`state.ts`); the legacy key is removed after folding.
- **Principle revision** (`panels/SPEC.md`): "empty-state surfaces work *without introducing
  onboarding state*" survives for empty states; these **two fields are the sole, spec'd exception**,
  and nothing else may gate on them.

## The overlay (absorbing #113)

`panels/Onboarding.tsx` moves into this module as the intro shell, structure preserved: screen 1
(welcome/philosophy), screen 2 (three-feature carousel with autoplay), pagination, blocking first-run
vs dismissible review mode (re-opened from the left-panel help button). Changes:

- The **"Isolated git worktrees" feature card's media placeholder becomes the game entry** — a live
  "Try it — the 60-second game" affordance instead of a future GIF. The other two cards keep their
  placeholders.
- The game runs *inside the same overlay* (a third, pushed view). The game's **Skip returns to the
  carousel in both modes** — it never dismisses the overlay itself (review-mode dismissal stays on
  the dialog's own affordances); Esc handling stays the overlay's, exactly as #113 built it.
- No separate replay surface: review mode (help button) and the echo banner's "How it works" are the
  re-entry points. (The earlier idea of a Welcome replay card is dropped — redundant with the help
  button.)
- `MOCK_ROOT` stays a display-only constant in game copy; *real* paths appear only in the echoes,
  which read them from workspace records.

## The game — five beats, ≤90s, skippable at every step

Canned demo project (`guitar-tuner`) — deterministic, zero wire dependencies: `src/app.ts`
(committed), `src/tuner.ts` (committed, **modified since**), `README.md` (committed), `.env`
(untracked), `notes.todo` (untracked), `node_modules/` (ignored). **The game does not reuse the
Changes panel's VCS decoration colors** (`statusNameClass`: untracked = muted green, per the VS Code
convention) — those answer *"what changed vs base?"*, while the game asks *"will this travel?"*, and
green on `.env` would say "included" when the lesson is the opposite. Instead: **status pills are
neutral gray in the predict phase** (color would leak the answer), and **in the reveal, color encodes
fate** — gold = *stays here*, green ✓ = *present in the new workspace*. Every beat is **predict →
reveal → one-line why**. Tone: never "Wrong!" — "Almost everyone expects this — here's the twist."

1. **What comes along?** — "You create workspace `fix-pitch-bug`, base: `main`. Tap every file
   you'll find inside it." The setup states the **base-branch fact** (verified against
   `workspaces.ts createWorkspace`): the base can be *any local or remote branch*; the workspace
   always gets its **own fresh branch**, cut from the base exactly as it stands at its last commit —
   it never checks an existing branch out as-is. Reveal animates **copies** of the committed files
   flying from the project folder into the workspace — **the originals never move, dim, or get
   struck out** (the left folder is explicitly labeled *untouched*; each original pulses briefly as
   its copy departs, so provenance is visible); `.env` / `notes.todo` / `node_modules` wear gold
   *stays here* tags; the `tuner.ts` copy is **flagged "at its last commit — without your edit"**.
   *"A workspace starts from a commit, not from your folder."*
2. **Where does it live?** — three options → reveal is a **filesystem tree view**: `~/projects/
   guitar-tuner` (tagged *your project — untouched*) and `~/.thinkrail/worktrees/<slug>/<branch>`
   (pointer: *your new workspace*) side by side in one tree, so the "different folder, original
   intact" fact is *seen*, not told. Copy is **Default-aware** (#105): *"Your **Default workspace**
   is the project folder itself; every workspace you create is a fresh parallel folder."* (True
   pre-#105 too; the "Default" naming lives in one string.)
3. **Will it run?** — "First `npm start` in the new workspace?" → reveal: fails — dependencies and
   secrets never travel. Pivot to the fix: *"That's why ThinkRail has setup hooks — declare
   `npm install` + copy `.env` once; they run on every new workspace."* The reveal then plays the
   **lifecycle mini-movie**: a CSS-only looping storyboard — *create → a fresh folder appears →
   onCreate hooks set it up → you work → onDelete cleans up* — showing the original folder untouched
   throughout (`prefers-reduced-motion` → the five frames render as a static storyboard). The same
   loop doubles as ambient media in the overlay's worktrees feature card, behind the game CTA. The
   hooks CTA slot sits behind the hooks-availability constant (generic copy until #93 lands, then
   links to the hooks dialog).
4. **One repo, many folders** — "You commit in the workspace; does your main folder's history have
   it?" → reveal: **yes** — one shared `.git`; branches and commits are shared, uncommitted mess never
   is.
5. **The payoff** — "Main folder is mid-mess; an urgent fix is needed?" → reveal: just create another
   workspace; the mess stays untouched, the fix ships in parallel, the workspace is deleted after
   merge. *"Every task gets a clean, parallel, disposable folder."*

End screen: warm score ("4/5 — most git veterans miss #3"), a three-bullet recap (starts from a
commit · separate folder, Default = your folder · environment is rebuilt, hooks automate it), and a
single continue CTA. No score persistence — replay is always fresh.

**Implementation constraints:** one shared beat shell (tap-select for beat 1, choice cards for 2–5);
**no new dependencies** — Tailwind transitions only; `prefers-reduced-motion` → instant reveals;
keyboard navigable; ≥44px tap targets; all copy centralized in `content.ts`; token utilities only
(themeable), testids per element (`onboarding-game`, `game-beat-<n>`, `game-skip`, …).

## Echoes (point-of-use; rendered in `panels/`, content owned here)

- **Echo 1 — New Workspace dialog.** A permanent quiet line under the branch picker: *"Fresh checkout
  of `<baseRef>` — uncommitted & untracked files in your project folder stay behind."* On dialog open,
  `git.projectStatus` is fetched non-blocking; when dirty, the line gains real counts ("right now:
  3 modified · 2 untracked"; tooltip lists up to 8 names), and env-looking files (`.env*`, `*.local`)
  add a hooks nudge behind the same hooks constant. Fetch failure/slowness → static line only. Never a
  spinner, never a blocker.
- **Echo 2 — first-worktree banner.** On every activation of a workspace with `kind !== "default"`
  (trivially true pre-#105, correct post-#105) **until dismissed once** (`workspaceBannerDismissedAt`
  absent): a slim banner above the center tabs — *"This workspace lives at `<path>` — a separate folder on branch `<branch>`."*
  Buttons: **How it works** (opens the overlay in review mode at the game) / **Got it** (writes the
  dismiss timestamp; cross-client, it's about the user learning, not the device).

## Contracts & server deltas

- `AppConfig.onboarding` as above.
- New method **`git.projectStatus { projectId } → GitStatus`** — status of the **project root**
  (git's main working tree): current branch, changes **vs `HEAD`** (staged + unstaged; a root folder
  has no `baseBranch` — the question is "what stays behind", i.e. uncommitted work) plus untracked.
  Sibling of `git.listBranches` / `git.prefetch`, which already take `projectId` and operate on
  `Project.path`; reuses `GitFileChange`. Bump `PROTOCOL_VERSION`.
- Server: `git` module gains `projectStatus`; `settings` reads became per-request (cache removed) so
  file-seeded config is visible immediately — the e2e isolation doctrine.

## Verification

- **e2e seeding switches mechanisms:** `global-setup.ts` seeds `config.json` with both timestamps set,
  and `resetState()` **rewrites that canonical config every test** (today it leaves `config.json`
  alone — that must change so the onboarding spec can't poison later specs). #113's global
  `storageState` fixture (`onboarding-seen.json` + the `playwright.config.ts` entry) is removed —
  superseded.
- **`e2e/onboarding.spec.ts`** (extends #113's): first-run appears on virgin config and blocks
  (Esc/outside no-op); completing *and* skipping both persist across reload; full game playthrough
  (canned content = deterministic) including the tap-select beat and reveal states; game Skip returns
  to the carousel; **legacy migration** (localStorage `"true"` + virgin config → no overlay, config
  folded); review mode is dismissible.
- **Echo specs:** static line always present; dirty counts appear with a seeded modified + untracked
  fixture file; env-file nudge; banner shows on the first worktree workspace (not the Default,
  post-#105), dismiss persists across reload and clients.
- **Unit:** beat-content well-formedness (every beat has prediction set / reveal / why-line; beat 1's
  answer set matches the demo repo model); server `projectStatus` against a temp repo
  (`workspaces.test.ts` pattern).
- Full gate for every step: `check:deps` · `lint` · `typecheck` · `test` · `e2e`.

## Rollout

1. Contracts + server `git.projectStatus` + `AppConfig.onboarding` + spec deltas. (Independent of
   #113/#105.)
2. Onboarding module absorbing the overlay + storage migration, **in the same PR as the e2e seeding
   switch** — config seeding must replace the `storageState` fixture in the exact change where the
   gate starts reading config, or the whole suite meets the blocking overlay. Assumes #113 merges
   first; if it stalls, its component is re-homed from the handoff branch in coordination with its
   author.
3. The game in the worktrees slot.
4. Echoes (dialog line + banner).
5. Hooks CTA constant flips when #93 lands; Default-workspace string confirmed when #105 lands.

## Integration deltas (sibling specs to update during implementation)

- `apps/web/SPEC.md` — module graph: add the `onboarding` node + edges `shell → onboarding` (mount),
  `panels → onboarding` (banner helpers via barrel), `onboarding → components/ui, store, transport`
  (public `request`), `contracts` (types).
- `apps/web/src/panels/SPEC.md` — the principle revision (narrow two-field exception); Echo 1 in
  `NewWorkspaceDialog`; Echo 2 banner; `Onboarding.tsx` re-homed out of panels.
- `apps/web/src/store/SPEC.md` — transient open-state note stays (plus the new `onboardingView` field);
  the durable-state description now points at `AppConfig.onboarding`, not a storage mirror.
- `apps/web/src/shell/SPEC.md` — mounts `<Onboarding />` (from this module).
- `packages/contracts/SPEC.md` — `AppConfig.onboarding`, `git.projectStatus`, protocol bump.
- `packages/server/src/git/SPEC.md` — `projectStatus`.
- `goal-and-requirements.md` — one V1 scope line: first-run workspace education.

## Open points

- Final game copy is written at implementation in `content.ts` and reviewed via before/after
  screenshots (UI-visible change).
- #113 merge timing (sequencing assumption in Rollout step 2).
