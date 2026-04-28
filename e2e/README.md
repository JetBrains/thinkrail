# Bonsai e2e tests

Playwright tests that drive the real backend + frontend in a browser.

## Prerequisites

- Bonsai is running locally (`./run.sh` from repo root) — backend on :8000, frontend on :3000.
- Anthropic credentials are reachable to the backend (env `ANTHROPIC_API_KEY` or macOS Keychain entry created by `claude auth login`). The tests start real agent sessions, so a working API key is required.

## Install

```bash
cd e2e
npm install
npx playwright install chromium
```

## Run

```bash
cd e2e
npm test                 # headless
npm run test:headed      # with visible browser
npm run test:ui          # Playwright UI mode
npm run report           # open last HTML report
```

Override URLs if the app is not on the defaults:

```bash
BONSAI_FRONTEND_URL=http://localhost:3000 \
BONSAI_BACKEND_URL=http://localhost:8000 \
npm test
```

## What's covered

- `tests/new-session-model.spec.ts` — starts a new agent session for each supported model (Opus 4.6, Opus 4.7, Sonnet 4.6, Haiku 4.5) and asserts no API error banner (`API Error`, `thinking.type.enabled`, etc.) appears. Originally added to lock in the Opus 4.7 regression where the bundled CLI sent `thinking.type=enabled` for a model that requires `thinking.type=adaptive`.

## Fixtures

- `fixtures/admin.ts` — creates a fresh admin user via the backend CLI (`uv run python -m app.cli create-user`) and returns the `bns_` token. Each test run gets its own user so tests don't depend on global state.
