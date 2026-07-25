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

Anonymous, no-personal-data usage analytics, emitted **host-side only** (design + privacy rationale:
`task-analytics` while it lives; the invariants below are the durable contract). Answers product
questions — unique users, version/platform, model preference, provider auth — via a **closed event
set** delivered to **PostHog (EU cloud)** over its capture API (a plain `fetch` POST — no vendor
SDK; none of the major backends need one server-side). The delivery backend hides behind the
`AnalyticsSink` interface — swapping vendors is implementing a new sink, nothing else moves
(exercised for real once already: the first sink was GA4's Measurement Protocol, replaced pre-ship
by user decision — PostHog's free tier, EU residency, and self-host path won).

## Boundary

- **Owns:**
  - `events.ts` — the closed `AnalyticsEvent` union (`app_installed` / `app_started` /
    `chat_started {provider, model}` / `provider_login {provider, method}`), the
    **`PARAM_ALLOWLIST`** (the machine-checked privacy invariant — a param key outside it fails the
    unit test), and `bucketProviderModel()`: identity passes raw **only** when it matches pi's
    built-in catalog (`getProviders()` / `getModels()` from `@earendil-works/pi-ai/compat`); a
    custom provider — or a custom model id on a known provider — becomes `"custom"`. Fails closed.
  - `sink.ts` — `AnalyticsSink { send(events) }`; `createPostHogSink({ apiKey, host?, fetchImpl? })`
    (fire-and-forget POST to `{host}/batch/`, EU cloud by default; errors swallowed + debug-logged,
    no retries) and `noopSink`. Every outgoing event is **personless**
    (`$process_person_profile: false` — no person profiles server-side; unique users still count by
    `distinct_id` = the install id) and carries **`$geoip_disable: true`** (the "no IP-derived
    fields" invariant enforced sender-side, belt to the project-level GeoIP-off braces).
  - `service.ts` — the facade: `initializeAnalytics(opts)` (installation record via `persistence`,
    sink selection, env stamping, first-run notice + `app_installed` announce, `app_started`),
    `track(event)`, `setAnalyticsSending(enabled)`, `resetAnalyticsForTests()`.
- **Public surface (barrel):** `initializeAnalytics`, `track`, `setAnalyticsSending`,
  `resetAnalyticsForTests`, the event types.
- **Allowed deps:** `persistence` (installation record + data dir), `contracts` (types),
  `@earendil-works/pi-ai/compat` (the built-in catalog — server-side value import), Node
  `crypto`/`process`.
- **Forbidden:** importing `host` or any other sibling; being imported by anything but `host` (all
  `track()` call sites live in `host` — feature modules stay analytics-free); putting the
  installation id on the wire in any form.

## Get right (the privacy contract)

- **The only stable identifier** is the per-install uuid4 in `persistence`'s server-only
  `installation.json` — minted once, **never rotated** (deliberate divergence from thinkrail-v1's
  fresh-id-on-re-enable; the user chose id continuity), never crossing the wire (deliberately not in
  the broadcast `config.json`).
- **The flag only gates sending:** `AppConfig.analyticsEnabled` (host-mediated — `host` syncs
  `setAnalyticsSending` on every settings change; this module has no `settings` edge). Disabled ⇒
  zero network. `app_installed` fires at most once per install (the `announced` bit), on the first
  sending-enabled boot, together with the first-run notice.
- **Dev runs never send:** a baked key is refused when `channel === "dev"`; source builds have no
  baked key anyway (double gate — e2e inherits the silence). Only the explicit
  `THINKRAIL_POSTHOG_API_KEY` env override can send from a dev run, and those events still carry
  `channel: "dev"` (`THINKRAIL_POSTHOG_HOST` retargets the endpoint — the future self-host seam).
- **Never sent:** paths, file/spec names, prompts, code, transcripts, token counts, hostnames,
  usernames, IP-derived fields, or any free-form user string. Params on every event:
  `app_version`, `channel`, `os`, `arch` — nothing else outside the per-event params above
  (transport framing like the two `$`-flags is the sink's, not the event model's).
- **Fire-and-forget:** `track`/`initializeAnalytics` never throw into callers and never block boot.
