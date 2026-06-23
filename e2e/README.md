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
# ThinkRail e2e tests

Playwright tests that drive the real backend + frontend in a browser. They lock
in observable behavior (UI flows, WS/REST round-trips, persistence) so the
upcoming Python→Bun backend rewrite has a regression net.

## Prerequisites

- `ANTHROPIC_API_KEY` is set in the backend environment (or a Keychain entry
  created by `claude auth login` exists). The session-lifecycle and per-model
  specs make real Anthropic API calls. See "LLM specs" below for why.
- Chromium is installed: `npx playwright install chromium`.

The suite is self-starting: `playwright.config.ts` declares a `webServer` that
spawns the full ThinkRail stack (`./run.sh` from the repo root) on dynamically-
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
npm test                   # full suite, headless (starts ThinkRail automatically)
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
    board.ts, specs.ts  # seed helpers that write `.tr/` state directly
    appSettings.ts      # seedSessionDefaults / getSessionDefaults — direct
                        #   JSON-RPC client for the app-scope `appSettings/*`
                        #   methods (used to pre-load user-scoped session
                        #   defaults before opening the UI)
  tests/
    *.spec.ts           # one spec per surface area
```

ThinkRail is single-user / localhost-only — there's no auth fixture, no admin
user, no token. Every spec opens a fresh `tempProject` and goes straight to
`openProject(page, tempProject.path)`.

## Adding a new spec

1. Create `tests/<feature>.spec.ts` and import from `../fixtures` (this gives
   you `test`, `expect`, and the `tempProject` fixture).
2. Use the helpers in `helpers/` rather than raw selectors so churn is absorbed
   in one place. Add new selectors to `helpers/selectors.ts`.
3. Seed any `.tr/` state through the seed helpers (`seedProject`,
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
| SessionManager (sidebar Sessions tab, finished-session visibility) | `sidebar-sessions.spec.ts`, `draft-on-type.spec.ts` | Finished standalone sessions list as cards; finished ticket sessions surface as ticket folders; draft cards reopen |
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

Every spec uses the `tempProject` fixture (a fresh `os.tmpdir()/thinkrail-e2e-*`
directory) and seeds `.tr/` state on disk before driving the UI. No spec
depends on the source repo's working state — the previous `REPO_ROOT`-pinned
`new-session-model.spec.ts` was migrated to `tempProject` because leftover
session state in the dev project produced flaky agent startup.
