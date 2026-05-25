---
id: module-e2e
type: module-design
status: active
title: E2E Tests
parent: design-doc
depends-on:
  - frontend-module
  - module-agent
covers:
  - e2e/
tags:
  - testing
  - e2e
  - playwright
---
# Bonsai e2e tests

Playwright tests that drive the real backend + frontend in a browser. They lock
in observable behavior (UI flows, WS/REST round-trips, persistence) so the
upcoming Python→Bun backend rewrite has a regression net.

## Prerequisites

- `ANTHROPIC_API_KEY` is set in the backend environment (or a Keychain entry
  created by `claude auth login` exists). The session-lifecycle and per-model
  specs make real Anthropic API calls. See "LLM specs" below for why.
- Chromium is installed: `npx playwright install chromium`.

The suite is self-starting: `playwright.config.ts` declares a `webServer` that
spawns the full Bonsai stack (`./run.sh` from the repo root) on dynamically-
picked free ports, then tears it down at the end of the run. You do **not**
need a separately-running `./run.sh` — but see below if you want to reuse one.

## Install

```bash
cd e2e
npm install
npx playwright install chromium
```

## Run

```bash
cd e2e
npm test                   # full suite, headless (starts Bonsai automatically)
npm test -- spec-tree      # subset by basename
npm run test:headed        # full suite with visible browser
npm run test:ui            # Playwright UI mode
npm run report             # open last HTML report
```

Each `npm test` invocation:

1. Picks two free TCP ports (one for backend, one for frontend).
2. Spawns `./run.sh` from the repo root with `BACKEND_PORT` / `FRONTEND_PORT`
   in its environment, and waits for the frontend URL to respond.
3. Tears the stack down via SIGTERM (Playwright → `run.sh`'s EXIT trap →
   `kill 0` → backend + frontend) when the suite finishes or aborts.

The first run pays the `uv sync` + `npm install` cost from `./run.sh`; the
webServer timeout is 5 min to absorb that. Subsequent runs reuse caches.

The suite runs sequentially (`fullyParallel: false`, `workers: 1`) and uses
chromium only. There are no retries — each spec must be deterministic.

## Layout

```
e2e/
  globalSetup.ts        # fail-fast health check before any spec runs
  playwright.config.ts  # serial chromium config
  fixtures/
    project.ts          # `tempProject` fixture: makes/cleans an `os.tmpdir()` dir
    index.ts            # `test` export consumed by every spec
  helpers/
    project.ts          # openProject(page, path)
    session.ts          # startSessionWithModel, startSessionConnectivityCheck,
                        #   waitForSessionActivity, waitForIdle, endSession
    selectors.ts        # central CSS/role selectors for every screen
    board.ts, specs.ts  # seed helpers that write `.bonsai/` state directly
    appSettings.ts      # seedSessionDefaults / getSessionDefaults — direct
                        #   JSON-RPC client for the app-scope `appSettings/*`
                        #   methods (used to pre-load user-scoped session
                        #   defaults before opening the UI)
  tests/
    *.spec.ts           # one spec per surface area
```

Bonsai is single-user / localhost-only — there's no auth fixture, no admin
user, no token. Every spec opens a fresh `tempProject` and goes straight to
`openProject(page, tempProject.path)`.

## Adding a new spec

1. Create `tests/<feature>.spec.ts` and import from `../fixtures` (this gives
   you `test`, `expect`, and the `tempProject` fixture).
2. Use the helpers in `helpers/` rather than raw selectors so churn is absorbed
   in one place. Add new selectors to `helpers/selectors.ts`.
3. Seed any `.bonsai/` state through the seed helpers (`seedProject`,
   `seedTicket`, `seedDrafts`, `seedTrashedPlan`) — write to disk before
   `openProject`. Avoid driving setup through real LLM calls when the goal is
   to exercise the UI for that state.
4. Smoke-style assertions only: page renders, primary action succeeds, obvious
   negative path fails gracefully. Don't assert deep content.
5. Run just your file: `npm test -- <feature>`. Then run the whole suite once
   before committing.

## LLM specs

The following specs make real Anthropic API calls and tag themselves with
`test.slow()`:

- `tests/session-lifecycle.spec.ts`
- `tests/new-session-model.spec.ts`

We keep real LLM calls (rather than mocking the SDK) because the rewrite
has to preserve the exact behavior of the backend's agent runner — including
the SDK error surface (`API Error`, `thinking.type.enabled`, etc.). A mocked
session would not catch the regressions this suite is meant to lock in.

If the full run becomes too long, split LLM specs into a separate command by
adding to `package.json`:

```json
"test:llm": "playwright test session-lifecycle new-session-model",
"test:fast": "playwright test --grep-invert 'session-lifecycle|new-session-model'"
```

(Currently the full suite is fast enough that no split is in place.)

## Coverage map

Every component under `frontend/src/components/` is exercised by at least one
spec — directly or transitively — except where noted as a documented gap.

| Component | Primary spec(s) | Notes |
|-----------|------------------|-------|
| AppShell (Header, StatusBar, SettingsModal) | `app-shell.spec.ts`, `user-settings-dialog.spec.ts` | Status bar visible; SettingsModal nav tabs + Session Defaults round-trip |
| AppShell/LeftPanel, ResizeHandle | `settings.spec.ts`, `_smoke.spec.ts` | Alt+B toggle persists; status bar visible |
| BoardView (KanbanColumn, MetaTicketBoard/Card, CreateTicketModal, BoardCardContextMenu, TaskBoard/Card) | `board.spec.ts` | Create + move-via-context-menu + reload |
| ChatStream (InputArea, AssistantMessage, ToolCallCard, ErrorBanner, SessionStatusLine, DiffCard, ApprovalCard, etc.) | `session-lifecycle.spec.ts`, `new-session-model.spec.ts` | Real LLM; tool-call card appears |
| CommandPalette | `trash-and-palette.spec.ts` | Alt+K, action mode, spec-picker mode |
| ContextPanel (modes, sections) | `vis.spec.ts` | Dashboard pin/unpin; auto-mode toggle. Other modes (spec/session) untested — documented gap |
| DiffCard (chat) | `plan-and-drafts.spec.ts` | Draft-diff path live |
| FileTree | `file-explorer.spec.ts` | Expand subdir, click leaf |
| FileViewer | `file-explorer.spec.ts`, `spec-tree.spec.ts`, `settings.spec.ts` | Markdown + non-spec text + settings.json |
| GoalFilePanel | (gap) | Renders only for goal-mode sessions; documented gap |
| MarkdownEditor | `spec-editor.spec.ts` | Edit body, save, preview updates |
| MetaTicketDetail (TicketDescriptionView, TicketInfo, TicketProgressBar) | `meta-ticket.spec.ts`, `plan-and-drafts.spec.ts` | Edit description, link spec, plan/drafts |
| Notifications/ToastContainer | (gap) | Specs assert against `ChatStream`'s `ErrorBanner`; the toast renderer itself has no spec — documented gap |
| ProjectPicker | `project-picker.spec.ts`, `project-init.spec.ts`, `_smoke.spec.ts` | Recent list, autocomplete, invalid path |
| SessionManager (sidebar Sessions tab, card click, footer button) | `sidebar-sessions.spec.ts` | Renders 3 tabs; footer focuses Sessions + uncollapses; view↔sidebar coupling; card click from Board |
| SessionPanel (SessionTabBar, StickyContextBar, WelcomeScreen) | `session-lifecycle.spec.ts`, every spec that opens an empty project | Routing between welcome/session views |
| SessionPanel/NewProjectScreen | `project-init.spec.ts` | First-time init flow |
| SpecTree | `spec-tree.spec.ts`, `spec-editor.spec.ts`, `trash-and-palette.spec.ts` | Tree expand, click, palette spec-picker |
| TrashModal | `trash-and-palette.spec.ts` | Restore a seeded trashed plan |
| `shared/`, `ui/` | (transitive) | Utility primitives — covered through every spec that renders them |

### Documented gaps

- **GoalFilePanel** — only renders for `isGoalSession=true` sessions; would
  require a goal-mode session helper. Track in a follow-up if the rewrite
  changes goal sessions.
- **Notifications/ToastContainer** — specs assert against the `ChatStream`
  `ErrorBanner`, not the global `ToastContainer`. The toast renderer (positive
  *and* negative paths) has no e2e coverage. Low risk because the renderer is
  a thin Zustand-driven list.

## Project isolation

Every spec uses the `tempProject` fixture (a fresh `os.tmpdir()/bonsai-e2e-*`
directory) and seeds `.bonsai/` state on disk before driving the UI. No spec
depends on the source repo's working state — the previous `REPO_ROOT`-pinned
`new-session-model.spec.ts` was migrated to `tempProject` because leftover
session state in the dev project produced flaky agent startup.

## Electron e2e

A second test surface lives under `e2e/electron/`. It drives the **real Electron
desktop app** — the same `BrowserWindow` end users get, with the production
PyInstaller backend spawned as a child process — using Playwright's
[`_electron` API](https://playwright.dev/docs/api/class-electron). The web
suite covers `localhost:3000`/`:8000` (Vite + dev backend); the Electron
suite covers the `BrowserWindow` shell, the spawned PyInstaller bundle, free-
port pick (9100–9199), single-instance lock, and the `before-quit` SIGTERM →
SIGKILL shutdown path.

### Layout

```
e2e/electron/
  playwright.config.ts        # electron-only Playwright config (separate from the web one)
  globalSetup.ts              # auto-build: PyInstaller bundle + electron tsc compile
  fixtures/
    electronApp.ts            # `electronApp` + `tempProject` fixtures
    index.ts                  # re-exports `test`, `expect`, types
  helpers/
    openProject.ts            # ProjectPicker → AppShell, mirrors helpers/project.ts
  tests/
    _smoke.spec.ts            # first spec — launch + open project + status bar
```

CSS / role selectors are reused unchanged from `e2e/helpers/selectors.ts` —
the same React SPA renders inside the BrowserWindow as in the dev server.

### How auto-build works

The Electron suite has its own `globalSetup.ts` that runs once before any
spec. It guarantees two artifacts exist:

1. `packaging/dist/bonsai-dir/bonsai`  — the PyInstaller backend bundle
2. `electron/dist-electron/main.js`     — the compiled Electron main process

Build behavior is controlled by environment variables:

| Env | Behavior |
|-----|----------|
| _(default)_ | Build whichever artifact is missing. Reuse what's already there. |
| `BONSAI_E2E_REBUILD=1` | Force a fresh `build_and_install.sh --no-install` and `tsc`. |
| `BONSAI_E2E_SKIP_BUILD=1` | Skip both checks; assume bundles are pre-staged (CI sets this after downloading the `bonsai-dir-*` artifact). |

A clean build is ~50 s on Apple Silicon (PyInstaller analysis dominates).
Subsequent runs reuse the cached bundle and complete in ~5 s — the only fresh
work is the per-test Electron launch.

### How a single test runs

```
electron.launch (per test)
  args: [<repo>/electron, --user-data-dir=<tmp>]
  env:  BONSAI_BACKEND_DIR=<repo>/packaging/dist/bonsai-dir
        + inherited PATH, HOME, etc.

  ├── Electron main (electron/dist-electron/main.js)
  │     ├── pick free port in 9100–9199
  │     ├── spawn bonsai-dir/bonsai --port <p> --no-browser
  │     ├── TCP-poll → ready
  │     └── BrowserWindow.loadURL → SPA renders
  └── firstWindow() → Playwright Page handle

[test body uses `window.locator(...)` etc.]

electronApp.close() (test teardown)
  ├── before-quit → SIGTERM child, 5 s grace, SIGKILL fallback
  └── userData dir removed
```

`--user-data-dir=<tmp>` keeps each test's AppStore SQLite isolated — no
recents-list pollution between specs and no interference with the developer's
real `~/.bonsai/`.

### Run

```bash
cd e2e
npm install                        # one-time, includes @playwright/test
npm run test:electron              # default — auto-builds if needed
npm run test:all                   # web suite + electron suite

# Force a fresh PyInstaller + tsc rebuild before running
BONSAI_E2E_REBUILD=1 npm run test:electron

# Reuse a pre-staged bundle (CI)
BONSAI_E2E_SKIP_BUILD=1 npm run test:electron

npm run report:electron            # open the electron HTML report
```

Note: `npm run test:electron` does **not** require `./run.sh` to be running —
the spawned PyInstaller backend is the test's own backend. (Contrast: the
web suite's `globalSetup.ts` requires the dev backend on `:8000` and fails
fast if it isn't there.)

### Adding a new electron spec

1. Create `electron/tests/<feature>.spec.ts`. Import:
   ```ts
   import { test, expect } from "../fixtures";
   import { openProject } from "../helpers/openProject";
   import { appShell, projectPicker, /* ... */ } from "../../helpers/selectors";
   ```
2. Use the fixtures: `test('...', async ({ electronApp, tempProject }) => { ... })`.
3. Drive interactions through `electronApp.window` (a Playwright `Page`). All
   normal Playwright APIs work: `locator`, `getByRole`, `keyboard`, `screenshot`.
4. Reuse the central selectors — don't hand-write CSS in specs.
5. Don't use the web `helpers/project.ts` `openProject` — it talks to
   `localhost:3000` and would never resolve here. The Electron equivalent is
   `electron/helpers/openProject.ts`.
6. Each test gets a fresh Electron process and a fresh `userData` dir, so no
   teardown beyond the temp project is needed.

### What this surface validates that the web suite cannot

| Concern | Web suite | Electron suite |
|---------|-----------|----------------|
| PyInstaller bundle boots, serves API | — | ✓ |
| Free-port selection (9100–9199) | — | ✓ |
| `BrowserWindow` sandbox + contextIsolation | — | ✓ (renderer config exercised) |
| Single-instance lock | — | (covered by future spec) |
| `before-quit` SIGTERM → SIGKILL | — | ✓ (every test teardown) |
| Backend-crash dialog | — | (covered by future spec) |
| Shell-env import (Finder-launch credential resolution) | — | ✓ (`session-start-from-shell-env.spec.ts`) |
| `<dataDir>/.env` dotenv fallback | — | ✓ (`session-start-from-data-dir-env.spec.ts`) |
| React UI flows | ✓ | ✓ (transitive) |
| Real LLM / tool calls | ✓ | (deferred — same backend, no value to duplicate) |

### Why a separate Playwright config

The two suites have incompatible `globalSetup` requirements:

- Web suite: backend must already be running on `:8000`. Fail fast if not.
- Electron suite: backend must NOT be on `:8000` from outside; the test
  spawns its own on a port in 9100–9199.

A shared `globalSetup` would have to branch on which project is running and
conditionally probe vs. build. Two configs is simpler — and `npm run test:all`
runs them sequentially.

### CI

The same `electron` matrix in `.github/workflows/build.yml` that produces
installers is the natural place to wire this up: download the
`bonsai-dir-<os>` artifact, set `BONSAI_E2E_SKIP_BUILD=1`, run
`npm run test:electron`. Not enabled in CI yet — track in a follow-up if the
suite grows beyond the smoke spec.
