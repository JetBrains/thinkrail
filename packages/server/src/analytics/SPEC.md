---
id: submodule-server-analytics
type: submodule-design
status: active
title: analytics — basic events and consented product insights
parent: module-server
depends-on: [module-contracts]
tags: [v1, analytics, privacy]
---

## Responsibility and boundary

Host-only product analytics shared by CLI/source/desktop, delivered personless to PostHog EU.
The module owns the closed event vocabulary, catalog bucketing, installation identity usage, delivery,
consent gates and bounded shutdown. Host alone observes feature outcomes and captures events; feature
modules remain analytics-free. Sibling dependency edges belong to [[module-server]].

- **Public surface:** initialization, basic capture, consent-scoped additional capture, additional-data
  enablement, shutdown/test reset, event types, bucket helpers and `BuildKind`.
- **Allowed deps:** persistence, log, contracts types, pi-ai's built-in catalog, Node, and `posthog-node`
  inside the sink only.
- **Forbidden:** importing host/feature siblings; being imported outside host; exposing the installation
  UUID on the wire; copying rich feature payloads into telemetry; browser autocapture or a native-only sink.

## Events

Basic events are always on in human runs: `app_started`,
`chat_started { provider, model, auth_method }`, `message_sent { mode, provider, auth_method }`, and
`provider_login { provider, method, auth_method }`. First observed launch defines first use; there is no install
announcement/marker or provider-change event. Launch means host boot, not UI readiness. Chats can be empty;
sends count after `ackSend`, exclude TODO-control nudges, and do not prove successful execution. Login
requires correlated success, or the existing applied Central connection action. `auth_method` is a closed
`api_key | subscription | oauth | central | other | unknown` category, never credentials or account/plan
identities. It describes the observed authentication path, not billing entitlement. Host captures send
metadata before dispatch, uses each session/login's retained runtime, and leaves ambiguous modes
other/unknown. Central provenance uses loader registration metadata without inspecting opaque auth.

Additional events require explicit consent. Their exact property unions and payload tests are the schema;
all properties are fixed enums or bounded buckets, never resource identities or free-form strings.

| Event | Signal |
| --- | --- |
| `setup_state_observed` | Provider/model/project readiness (`yes/no/unknown`); first current observation and changes, not every poll. |
| `setup_action_finished` | Explicit setup operation, outcome and fixed failure category; automatic Default provisioning is excluded. |
| `agent_run_started` | Work-cycle origin, workspace kind and catalog-bucketed provider/model. |
| `agent_run_settled` | Final outcome, elapsed-time/retry/compaction buckets; only `agent_settled`, never attempt-level `agent_end`. |
| `task_completed` | Nonempty task-group completion transition after artifact reconciliation, change evidence and whether verification was recorded. |
| `review_decided` | Actual user/agent approval or changes-requested decision, not aborted-review cleanup. |
| `pr_action_finished` | Outcome/category; created PRs remain distinct from updates, pushes and compare-page handoffs. |

Correlation is transient and scoped to one consent grant. No history replay or reconstruction of work
started before consent; asynchronous results from a revoked grant remain discarded after re-enabling.
Internal/unknown work never inflates user activation. A normal stop or agent-declared task/verification
status is not proof of value, correctness or a passed test. Arrival order is not execution order.

## Consent and delivery

`analyticsEnabled` is the additional-data preference; `analyticsConsentConfirmed` records an explicit
choice. Both must be true. Legacy preferences seed the first-launch window, not consent; absent preferences
default off. Settings owns atomic persistence and host applies the gate. Window behavior belongs to
[[submodule-web-panels]]. Later launches use the saved decision.

CI and `NODE_ENV=test` create no vendor clients. `--no-analytics` / `THINKRAIL_NO_ANALYTICS` suppress only
additional events without changing consent. Host-side analytics is the sole environment-policy reader
across launchers.

Additional revocation drops queued/retrying requests at the transport boundary without stopping basics;
an already-sent request cannot be recalled. Revoked queues never revive. Capture/boot never block product
flows or throw into callers; graceful shutdown awaits an idempotent two-second SDK drain.

## Data boundary

The stable UUID stays in server-only `installation.json`; shared data directories share it. Counts describe
installations, not people. Every event carries `app_version`, `channel`, `os`, `arch`, `build` plus its
closed properties. Only built-in provider/model names pass raw; custom values become `custom`, preserving
the existing explicit `jbcentral` login name. No content, paths/names, resource IDs, credentials, arbitrary
errors, token/cost counts or recordings are collected.

The sink uses the committed public key, EU endpoint, disabled GeoIP enrichment and
`$process_person_profile: false`; key/endpoint/fetch injection supports tests and self-hosting. Personless
processing does not remove UUID linkage; vendor IP-discard/retention policy is separate. Automated/schema,
consent-revocation, migration, host-trigger and packaged loopback-delivery tests pin these boundaries.
