---
id: task-provider-auth-ux
type: task-spec
status: done
title: Provider authentication UX — in-app pi auth + jbcentral path
parent: architecture
references:
  - module-cli
  - submodule-server-agent
  - module-contracts
---

## Outcome (implemented)

Shipped on branch `jbcentral-auth-integration`; durable decisions promoted to
`architecture.md` (Decisions §7), `packages/server/src/auth/SPEC.md`, `apps/web/src/auth/SPEC.md`,
`packages/shared/SPEC.md` (/jbcentral), `packages/contracts/SPEC.md` (authProtocol), plus
transport/store/panels/cli spec touches. Verified by unit tests (server auth bridge, store reducer,
shared transforms) + e2e (`e2e/auth-gate.spec.ts` boots a zero-auth host and walks gate → API key →
success → shell; settings spec covers the Providers section) and a manual visual pass against the
mockup. Notable deltas from the design sketch: no `auth.answer`-less unwire flow (it's a direct call),
featured-tile order enforced client-side, and the e2e stub provider seeds only when the machine has
no pi auth at all.

## Request

Give users an easy way to authenticate model providers. Two paths exist conceptually:

1. **JetBrains Central (`jbcentral`)** — external CLI: install script → `jbcentral login` →
   `jbcentral add claude|codex` → run thinkrail with the proxy wired. Target: JetBrains AI
   subscribers / early-access users.
2. **Normal pi auth** — OAuth subscriptions (Claude Pro/Max, ChatGPT/Codex, GitHub Copilot) and
   API keys, stored in pi's `auth.json`. Today this requires running `pi` in a terminal and using
   `/login` — no ThinkRail UI exists for it.

Goal: design great UX for both, especially the pi-auth path.

## Current state (verified)

- `thinkrail jbcentral [--remove]` (apps/cli/src/jbcentral.ts): one-shot terminal command that
  rewires `models.json` provider baseUrls at the local jbcentral proxy. Does not launch the app.
  The user-described `thinkrail central` (launch + route + open browser) does **not** exist.
- No auth surface in `apps/web`. Empty model list + failed sends are the only signal of "not
  authenticated". SettingsDialog has a precedent block (read-only `gh` auth status).
- Server holds one shared `AuthStorage` + `ModelRegistry` (`piRuntime`). Key pi APIs:
  - `authStorage.login(providerId, callbacks)` — programmatic OAuth; callbacks are serializable
    (`onAuth{url}`, `onDeviceCode{userCode, verificationUri}`, `onPrompt`, `onSelect`,
    `onProgress`, `onManualCodeInput`, abort `signal`).
  - `authStorage.set(provider, { type: "api_key", key })`, `logout`, `getAuthStatus`, `hasAuth`,
    `getOAuthProviders()`.
- The server already bridges in-process dialog calls to the browser over WS (`webUiContext`) —
  the exact pattern an OAuth callback bridge needs.
- OAuth callback servers bind on the **host** (localhost) — fine for V1 (browser and host share a
  machine); remote/V2 needs the manual-code fallback (`onManualCodeInput`).

## Decisions (user-confirmed 2026-07-10)

1. **Scope: in-app pi auth UI + fully in-app jbcentral flow.** Clicking the JetBrains AI tile
   drives the whole chain from the running app — the host detects/installs `jbcentral`, runs
   `jbcentral login`, `jbcentral add claude` + `add codex`, wires the proxy into `models.json`,
   then hot-reloads the model registry (`ModelRegistry.refresh()` + `AuthStorage.reload()`).
   **No new CLI subcommand** (`thinkrail central` rejected); the existing terminal command stays
   `thinkrail jbcentral` and shares its pure logic with the server (moved to `packages/shared`).
   Approaches considered: pi-auth-only + docs for jbcentral (rejected: JetBrains flow stays
   clunky); read-only jbcentral status + snippets (rejected: user wants one-click).
2. **First run: hard gate.** Until ≥ 1 model is available (`model.list` non-empty — covers
   OAuth, API keys, env vars, and jbcentral-wired `models.json`), the shell is not reachable;
   the full-screen Connect surface is the app. No skip. Consequence for e2e (see Risks): CI
   boots with zero auth, so `globalSetup` must seed the isolated agent dir with a dummy custom
   provider (models.json apiKey entry) to keep the no-agent suite out of the gate, plus new
   gate specs that boot an empty agent dir deliberately.
3. **Featured tiles: JetBrains AI first and most prominent**, then Claude (OAuth), ChatGPT/Codex
   (OAuth), GitHub Copilot (device code); "Use an API key…" beneath opens the full searchable pi
   provider catalog with a paste-key form.
4. **Durable management: Settings → Providers** (same rows, status pills, Sign out / Replace
   key / Re-wire proxy), reachable after the gate. Model-picker empty states link there (auth
   can break later, e.g. revoked tokens).

## Wire (contracts) — sketch

- `auth.status` (read): featured providers + full catalog, each with `{ id, name, kind:
  oauth|api_key, authenticated, source?, label? }` (from `getProviderAuthStatus`), plus
  `jbcentral: { installed, wired, loggedIn? }` and `modelCount`.
- `auth.login { providerId }` → starts OAuth on the host; server pushes `auth.event` frames
  mirroring pi's `OAuthLoginCallbacks` (`auth-url` / `device-code` / `prompt` / `select` /
  `progress` / `done` / `error`); client replies via `auth.answer { requestId, value }`;
  `auth.cancel` aborts (wired to the `signal`).
- `auth.setApiKey { providerId, key }`, `auth.logout { providerId }`.
- jbcentral steps, each idempotent + separately retryable, progress via the same `auth.event`
  stream: `jbcentral.install` (runs the platform install script — only ever after an explicit
  consent click showing the exact command), `jbcentral.login` (spawns `jbcentral login`; the
  browser opens host-side — V1 host == local machine; stdout-scraped URL mirrored in the UI),
  `jbcentral.configure` (`add claude` + `add codex` + proxy wiring — the shared
  `runJbcentral` transforms).
- After any successful change: host `AuthStorage.reload()` + `ModelRegistry.refresh()`, pushes
  an `auth.changed` invalidation; clients refetch `auth.status` + `model.list` (gate closes
  reactively when `modelCount > 0`).
- Security invariants: **key values never leave the host** (reads expose only status/labels;
  the key paste travels client→host once over the local/Tailscale-encrypted socket). The
  install script never runs without an explicit consent click.

## Risks / consequences

- **Hard gate × CI e2e:** the no-agent suite runs with zero provider auth — without seeding, the
  gate would block every spec. Mitigation in Decisions §2.
- **`jbcentral` is an external CLI we don't control:** login/add output formats may drift; all
  probes must degrade to "unknown" + a retry, never hang the wizard. Timeouts on every spawn.
- **Remote client (V2):** OAuth callback servers and `jbcentral login`'s browser both open
  host-side; a phone over Tailscale needs the manual-code path (`onManualCodeInput`) and
  URL-shown-in-UI fallbacks. Design the event frames to carry URLs so this degrades gracefully.
- Whether `auth.event` rides the existing extension-UI dialog frames or gets its own frame kind
  — leaning **own frame kind** (auth is app-level, not session-scoped; ext-UI frames are keyed by
  sessionId which auth doesn't have).

## UI/UX design

**Interactive mockup: `mockups/provider-auth/index.html`** (self-contained, app tokens, all
states clickable via the demo rail; state screenshots `01`–`09` beside it). Produced with the
frontend-design playbook, self-reviewed via browser screenshots (no subagent infra available in
this environment). Design language below — the mockup is authoritative for look & feel:

- **First-run**: full-screen hard gate (the app until a model exists) on `status=connected &&
  models.length===0`: ThinkRail wordmark, "Connect a model provider", featured tiles with
  JetBrains AI first/hero-sized, then Claude / ChatGPT / GitHub Copilot, "Use an API key
  instead" link → provider-list + paste-key form. **No skip.**
- **Flow panels**: clicking a tile swaps the gate content for a focused panel ("← All
  providers" returns). OAuth panel = pulsing waiting state, copyable auth URL ("browser didn't
  open? — works on another device too"), manual code fallback input, Cancel always visible
  (wired to the abort signal). Success = "You're connected" + model chips + Start building;
  the top-right status pill (`Host connected · N models`) flips live when models land.
- **Device code (Copilot)**: big-type user code + verification URL + copy buttons.
- **API key**: provider combobox (searchable, full pi catalog), masked paste field, inline
  validation (shape check client-side; on submit the host sets the key, refetches models, and
  reports success/failure), env-var hint ("already set ANTHROPIC_API_KEY? it's picked up
  automatically — this stores a key in pi's auth.json").
- **JetBrains AI tile**: a mini-wizard driven by the host — detected state decides the entry
  step (not installed → consent + install; installed, not logged in → login; logged in →
  configure). Each step streams progress, is retryable, and shows the equivalent terminal
  command (transparency + manual fallback). Early-access note: "choose the ThinkRail-Early
  organisation" surfaced at the login step.
- **Settings → Providers**: same tiles condensed to rows (status pill, Sign out / Replace key),
  plus the jbcentral status block.
- **Gate re-engagement + empty states**: the gate is condition-driven (`models.length === 0`),
  so revoked/expired auth that empties the model list re-opens it automatically. ModelSelector's
  empty state links to Settings → Providers for the softer "models exist, but not the one I
  want" case.
