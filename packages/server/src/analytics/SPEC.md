---
id: submodule-server-analytics
type: submodule-design
status: active
title: analytics — anonymous usage analytics (PostHog sink)
parent: module-server
depends-on: [module-contracts]
tags: [v1, analytics, privacy]
---

## Responsibility

Anonymous, no-personal-data usage analytics, emitted **host-side only**. Answers product questions —
unique users, version/platform, model preference, provider auth — via a **closed event set** delivered
to **PostHog (EU cloud)** through the official `posthog-node` SDK. The SDK is an implementation detail
**inside** the sink: the delivery backend hides behind the `AnalyticsSink` interface — swapping vendors
is implementing a new sink, nothing else moves (exercised for real twice: GA4's Measurement Protocol →
a hand-rolled PostHog capture POST → `posthog-node`, each swap contained to `sink.ts` + the key seam;
PostHog won on free tier, EU residency, and a self-host path).

## Boundary

- **Owns:**
  - `events.ts` — the closed `AnalyticsEvent` union (`app_installed` / `app_started` /
    `chat_started {provider, model}` / `message_sent {mode}` / `provider_login {provider, method}`) and
    `bucketProvider()` / `bucketProviderModel()`: identity passes raw **only** when it matches pi's
    built-in catalog (`getBuiltinProviders()` / `getBuiltinModels()`); a custom provider — or a custom
    model id on a known provider — becomes `"custom"`. Fails closed. The machine-checked privacy pin is
    the **unit tests**: they assert every event variant's exact outgoing properties — there is
    deliberately no runtime allowlist filter (the union is closed and we control every call site; a
    content-leaking field fails CI, and runtime filtering was judged over-engineering).
  - `sink.ts` — `AnalyticsSink { send(clientId, events); setSending?(enabled); shutdown?() }`;
    `createPostHogSink({ apiKey, host?, fetchImpl? })` wraps `posthog-node` (EU cloud by default):
    `flushAt: 1` (a handful of events per run — dispatch each capture immediately; the SDK still
    retries failed sends), `disableGeoip: true` (explicit even though it is the SDK default — the "no
    IP-derived fields" invariant enforced sender-side), `disableCompression: true` (tiny payloads;
    keeps the wire inspectable for the test seam and debugging), a custom `fetch` as the injected test
    seam, SDK errors swallowed to the debug log (`on("error")` — never a user-facing warn). Every
    outgoing event is **personless** (`$process_person_profile: false` — no person profiles
    server-side; unique users still count by `distinct_id` = the install id). **`setSending(false)` is
    a transport-level gate on the very `fetch` the SDK is handed** — every subsequent SDK request
    (queued flushes AND the retry loop of an already-failed send) dies at the gate with a synthetic
    200, zero network; this is deliberately NOT the SDK's `disable()`, which only stops new enqueues
    (`optedOut` is never checked in its flush/retry paths). `shutdown()` drains the queue (bounded,
    2s) for graceful stops. Plus `noopSink` (disabled/dev: events vanish).
  - `service.ts` — the facade: `initializeAnalytics(opts)` (installation record via `persistence`,
    sink selection, env stamping, first-run notice + `app_installed` announce, `app_started`),
    `track(event)`, `setAnalyticsSending(enabled)`, `shutdownAnalytics()` (best-effort flush — the
    host's `stop()` fires it without awaiting), `resetAnalyticsForTests()`.
- **Engagement (`message_sent`):** one event per user-authored send, `mode` from the closed vocabulary
  `prompt` | `steer` | `follow_up` (pi's three send methods) — never anything about the message (no
  text, no length, no image count) and no identity params (model preference is `chat_started`'s job).
  New-chat and existing-chat sends are the same event; `chat_started` stays the new-chat signal. Fired
  by `host` from `session.prompt`/`steer`/`followUp` **after the send is accepted** (`ackSend`), so a
  rejected send never counts — and **only for user-authored** sends: the same wire methods also carry
  internal control traffic (the client's TODO wake-nudge), which `isControlMessage` filters out, so the
  count stays "messages the user sent" and never inflates with the app's own prompts.
- **Public surface (barrel):** `initializeAnalytics`, `track`, `setAnalyticsSending`,
  `shutdownAnalytics`, `resetAnalyticsForTests`, the event types + bucket helpers.
- **Allowed deps:** `persistence` (installation record + data dir), `contracts` (types),
  `@earendil-works/pi-ai` (the built-in catalog — server-side value import), `posthog-node` (the
  delivery SDK — value-imported **only** in `sink.ts`), Node `crypto`/`process`.
- **Forbidden:** importing `host` or any other sibling; being imported by anything but `host` (all
  `track()` call sites live in `host` — feature modules stay analytics-free; `provider_login` method
  attribution is host's `loginAnalytics` correlation, see `submodule-server-host`); putting the
  installation id on the wire in any form.

## Get right (the privacy contract)

- **The only stable identifier** is the per-install uuid4 in `persistence`'s server-only
  `installation.json` — minted once, **never rotated** (id continuity across opt-out/opt-in is the
  chosen posture: a returning opt-in is the same install, not a fresh cohort), never crossing the wire
  (deliberately not in the broadcast `config.json`).
- **The flag only gates sending:** `AppConfig.analyticsEnabled` (host-mediated — `host` syncs
  `setAnalyticsSending` on every settings change; this module has no `settings` edge). Disabled ⇒ zero
  network **from that instant**: the service stops emitting AND propagates the flip into the sink's
  transport gate, so events already queued inside the SDK — and retries of an already-failed send —
  are dropped client-side (an HTTP request already on the wire cannot be recalled; everything after it
  can, and is). `app_installed` fires at most once per install (the `announced` bit), on the first
  sending-enabled boot, together with the first-run notice.
- **Only stable/nightly releases send — ever:** the sink is real only when `channel` is in the
  release allowlist (`stable` / `nightly`) AND a baked key is present; anything else (dev, source,
  e2e, an unknown channel) fails closed to the noop sink. There is deliberately **no env-var key
  override** — a dev run has no path to the network at all (pipeline verification happens by calling
  `initializeAnalytics` directly with a release-like channel, or on a real nightly).
  `THINKRAIL_POSTHOG_HOST` still retargets the endpoint of a *sending* (release) build — the future
  self-host seam.
- **Never sent:** paths, file/spec names, prompts, code, transcripts, token counts, hostnames,
  usernames, IP-derived fields, or any free-form user string. Params on every event: `app_version`,
  `channel`, `os`, `arch` — plus only the closed per-event params above; the unit tests pin each
  variant's exact non-`$` properties (transport framing — the SDK's `$lib*` fields, `$geoip_disable`,
  and the personless flag — is the sink's, never an event param).
- **Fire-and-forget:** `track`/`initializeAnalytics` never throw into callers and never block boot.
  `shutdownAnalytics` is **idempotent** (one drain, memoized) and awaited where awaiting is possible:
  `bootHost`'s SIGINT/SIGTERM handler drains it (bounded, concurrent with session settling) before
  `process.exit`; the sync `server.stop()` fires the same memoized drain best-effort. An abrupt kill
  may still drop the final instants' events — accepted (with `flushAt: 1` anything older than the
  last moment is already dispatched).
