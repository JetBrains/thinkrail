---
id: submodule-web-auth
type: submodule-design
status: active
title: auth — provider-auth UI (gate + providers settings)
parent: module-web
depends-on: [module-contracts]
references: [submodule-server-auth, task-provider-auth-ux]
tags: [v1, ui, auth]
---

## Responsibility

The provider-auth UX: the **first-run hard gate** (`AuthGate` — while the host reports zero
available models, this full-screen overlay IS the app) and the durable **Settings→Providers**
section (`ProvidersSection`). Everything renders host state (`auth.status` + the `auth.event`
flow fold in the store) and drives host flows over the wire — no auth logic lives in the browser.

## Boundary

- **Owns:** `AuthGate` (the gate: condition `status === "connected" && authStatus != null &&
  modelCount === 0` — a *definitive* zero, never a loading flash; plus the success beat that holds
  the gate open after models land until "Start building"), the gate's home tiles (JetBrains AI
  hero first, then the featured OAuth trio, then "Use an API key"), the flow panels — `JbWizard`
  (Install → Sign in → Connect models; consent-first install with the exact command shown;
  auto-chains stages on `done ok`; every stage retryable), `OAuthPanel` (waiting pulse, copyable
  auth URL, device code, `prompt`/`select`/`manual-code` answers via `auth.answer`, Cancel always
  visible), `ApiKeyPanel` (searchable key-capable catalog + masked key + env-var hint) —
  `ProvidersSection` (OAuth rows Sign in/out, the jbcentral wire/unwire block, compact add-a-key
  form), `ProviderMark` (brand glyphs via `--brand-*` tokens only), and the shared `bits`
  (CopyRow / WaitingPulse / StepRow / LogTail).
- **Public surface (barrel):** `AuthGate`, `ProvidersSection`.
- **Allowed deps:** `store` (authStatus / authFlow / models + their actions), `transport`
  (`getTransport` for `auth.*`/`jbcentral.*` requests), `components/ui`, `lib`, `constants`
  (wordmark), `contracts` (types), lucide.
- **Forbidden:** `panels`/`shell`/`chat` (the shell mounts the gate; SettingsDialog mounts the
  section); any pi package; inline styles / raw hex (brand colors are tokens).

## Get right

- The gate is **condition-driven, no skip**: it re-engages if auth breaks later (modelCount → 0),
  and closes reactively from any client's success (`changed` → status refetch).
- A key value crosses the wire exactly once (`auth.setApiKey`) and is never rendered back.
- Cancel must always be reachable during a flow, and a failed flow always offers a retry — the
  server aborts superseded flows, so a stuck flow can't wedge the gate.
- e2e hooks: `auth-gate`, `auth-gate-pill`, `auth-tile-*`, `auth-apikey-*`, `auth-jb-*`,
  `auth-oauth-*`, `auth-gate-success`/`auth-gate-enter`, `settings-providers`,
  `settings-provider-*`, `settings-jb-status`, `settings-apikey-*`.
