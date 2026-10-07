---
id: submodule-server-analytics
type: submodule-design
status: active
title: analytics — basic events and preference-controlled product insights
parent: module-server
depends-on: [module-contracts]
tags: [analytics, privacy]
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

Basic events are always on in keyed human runs: `app_installed`, `app_started`,
`chat_started { provider, model, auth_method }`, `message_sent { mode, provider, auth_method }`, and
`provider_login { provider, method, auth_method }`. `app_installed` carries only the standard environment
properties and is emitted before `app_started` once when a non-CI/non-test binary or desktop initialization
claims the shared installation marker. Initialization constructs the basic sink before claiming; once claimed,
the state is installed before enqueue. A sink-construction failure therefore leaves the marker available, while
a later delivery failure does not clear or retry it. Existing `{ id }` records emit on their first eligible packaged boot. Launch means
host boot, not UI readiness. Chats can be empty; a chat the host had to create without any usable model
reports `provider` and `model` as `none` with `auth_method: unknown`; the host's own model resolution
decides that case rather than pi's placeholder model (which would otherwise bucket as `custom`), while
a resolved chat reports the model the created session actually holds (a startup extension may switch it).
"Created a chat but had nothing to send with" thus stays distinguishable from a configured custom provider.
Sends count after `ackSend`, exclude TODO-control nudges, and do not prove successful execution. Login
requires correlated success, or the existing applied Central connection action. `auth_method` is a closed
`api_key | subscription | oauth | central | other | unknown` category, never credentials or account/plan
identities. It describes the observed authentication path, not billing entitlement. Host captures send
metadata before dispatch, uses each session/login's retained runtime, and leaves ambiguous modes
other/unknown. Central provenance uses loader registration metadata without inspecting opaque auth.

Additional events follow the `analyticsEnabled` preference. Their exact property unions and payload tests are
the schema. Product outcome fields use fixed enums or bounded buckets; acquisition touch fields below are
bounded browser-derived strings, never resource identities or arbitrary product payloads.

| Event | Signal |
| --- | --- |
| `setup_state_observed` | Provider/model/project readiness (`yes/no/unknown`); first current observation and changes, not every poll. |
| `setup_action_finished` | Explicit setup operation, outcome and fixed failure category; automatic Default provisioning is excluded. `directory_pick` is the native folder picker (succeeded / cancelled / failed, never the path); `project_open` reports the typed `not_git` / `already_open` reasons from the projects module's coded errors, and every untyped failure stays `unknown` — reasons are never derived from error text. |
| `agent_run_started` | Work-cycle origin, workspace kind and catalog-bucketed provider/model. |
| `agent_run_settled` | Final outcome, elapsed-time/retry/compaction buckets; only `agent_settled`, never attempt-level `agent_end`. |
| `task_completed` | Nonempty task-group completion transition after artifact reconciliation, change evidence and whether verification was recorded. |
| `plan_opened` | The plan surfaced for the user, by `surface` (`page`/`popup`); a deliberate open action, not every plan refetch. |
| `plan_item_added` | A user-added plan item (`origin:"user"`), by `surface` (`chat`/`page`); the user curating the plan, not agent re-plans. |
| `review_decided` | Actual user/agent approval or changes-requested decision, not aborted-review cleanup. |
| `review_comment_added` | A review comment created on a file/diff/doc, by `author` (`user`/`agent`) and `kind`; the human draft flow and the reviewer agent's findings, distinguished — not draft edits. |
| `review_comment_sent` | One event **per comment** delivered to the agent (the value moment), with `outdated` (`yes`/`no`); per-comment so added→sent→resolved is a countable funnel, and `outdated` is the re-anchoring quality signal. Delivery, not proof the agent acted usefully. |
| `review_comment_resolved` | A comment's terminal outcome, by `actor` (`user`/`agent`) and `outcome` (`resolved`/`dismissed`); the human update and the agent `resolve_comment` tool, not draft deletes or Clear. An agent `resolved` is the agent's claim, never proof the concern was fixed. |
| `pr_action_finished` | Outcome/category; created PRs remain distinct from updates, pushes and compare-page handoffs; `source` = `plan_page` when driven from the plan page's PR stage, else `other`. |
| `acquisition_linked` | One successful browser-claim redemption, carrying the transient journey/bridge ids and normalized first/last acquisition fields. |

The review-comment funnel is host-observed off existing wire/tool actions: `review_comment_added`
off the `review.commentAdd` handler (human, `author:user`) and each plan-review finding the host files
into the Review tab (`author:agent`, with the persisted `kind`, so an anchor fallback reads as `review`).
`review_comment_sent` fires once per comment for every delivery to an agent: `review.sendComment` /
`review.sendBatch`, the plan-review fix delivered to the worker (button path after its acknowledgement,
tool path when its locked file+mark+record transaction commits), and the user's Request-fix. Per-comment
keeps added→sent→resolved countable across a personless population (a per-action count bucket would make
that ratio unrecoverable); `outdated` reports anchor drift in the already-re-anchored send set. It fires on
**acceptance**, not when a detached prompt starts: a pre-turn rejection (bad model/expired key) rolls the
comments back to draft, so an early capture would inflate the conversion. `review_comment_resolved` fires
only on an actual transition into `resolved`/`dismissed` — `review.commentUpdate` (user) and the agent
`resolve_comment` seam (`agent`/`resolved`) — so an idempotent repeat from a stale client never counts
twice. No comment body, path, anchor text or line numbers are ever copied — only the closed
`author`/`kind`/`actor`/`outcome`/`outdated` enums.

The plan/TODO funnel rides existing wire actions, never browser autocapture: the host captures
`plan_opened` off a deliberate `todo.list { opened }` call (the plan page open or the chat popup open —
not the automatic refetches), `plan_item_added` off a successful `todo.add` (`surface` names the in-chat add row or
the plan page's add row), and stamps the `source` discriminator on
`pr_action_finished` from the `pr.open` caller (`plan_page` when the plan page's PR button drove it). The
plan page's Review stage runs through pi-subagents delegation ([[submodule-server-host]]'s plan review),
whose asynchronous verdict is decoupled from the triggering surface, so `review_decided` carries no source
today. `surface`/`source` are closed enums; absence defaults to `chat`/`other`, so an omitted param never
fabricates plan-page attribution.

The acquisition touch schema is a strict server-side mirror of [[submodule-website-attribution]]: bounded
normalized UTM source/medium/campaign/content strings, closed referrer class, timestamp, and policy version.
The website and server copies change together; product packages never import website code. The landing page
is not transferred; PostHog joins website events to `acquisition_linked` through `journey_id`. While the
additional grant is active, persisted campaign-only first/last fields enrich later basic and additional
events except `app_installed`; enriched basics use only the current grant's revocable sink, while
unenriched basics stay on the permanent basic sink. Revocation therefore drops queued/retrying enriched
basics together with additional events, without stopping ordinary basics; only `acquisition_linked` carries
journey/bridge ids. Acquisition expires 30 days after `last_touch`: startup terminalizes expired or invalid
state, and every capture checks before enrichment so a process crossing expiry clears memory and atomically
replaces the file with the terminal attempt marker. The first `app_started` remains unenriched when linking
occurs during that launch.

Correlation is transient and scoped to one enabled-preference period. No history replay or reconstruction
of work started before sharing is enabled; asynchronous results from a disabled period remain discarded
after re-enabling.
Internal/unknown work never inflates user activation. A normal stop or agent-declared task/verification
status is not proof of value, correctness or a passed test. Arrival order is not execution order.

## Preference and delivery

`analyticsEnabled` is the additional-data preference and host delivery gate; `analyticsConsentConfirmed` records
completion of the first-run dialog, not a continuing delivery gate. Host initialization keeps an unconfirmed
configuration off until that dialog mounts. The dialog's default-on mount prime persists `analyticsEnabled: true`
without confirmation and enables delivery as soon as the applied settings update succeeds, before the user presses
Done. Changing the switch applies its preference immediately. Done persists the current preference with
confirmation; that confirmation controls prompt lifecycle only. After initialization, only an applied settings
update that explicitly includes `analyticsEnabled` changes the grant; unrelated full-config broadcasts preserve
it. Settings changes write preference and confirmation together. Window behavior belongs to
[[submodule-web-panels]]. Confirmed later launches do not prime or reopen.

Only builds stamped with a project key report (see Data boundary); unkeyed source/dev builds, CI and
`NODE_ENV=test` create no vendor clients and claim no installation marker. `--no-analytics` / `THINKRAIL_NO_ANALYTICS` suppress only
additional events without changing consent. Host-side analytics is the sole environment-policy reader
across launchers. Browser attribution is additionally limited to binary/desktop human runs with both
preference and confirmation true, an injected launcher opener, and no prior attempt. Source, CI/test,
per-run suppression, explicit off, and CLI `--no-open` do not consume the attempt. The dialog's
unconfirmed on-prime can enable ordinary additional events but cannot start attribution; the final
confirmed update can. Saved confirmed-on starts only after the CLI has opened its normal local UI or the
desktop window's first `dom-ready`; server boot and elapsed time do not imply launcher readiness.

The host generates a random 32-byte verifier, sends its SHA-256 challenge, requires strict protocol
responses, invokes the returned same-origin relative claim URL opener exactly once without awaiting it,
and performs at most 54 status polls at 10-second intervals followed by one redeem. Each request has an
abort timeout and the whole claim has a nine-minute deadline, below the website claim lifetime. The current
consent generation owns an AbortController; revocation and shutdown abort fetch and body reading and remove
enrichment before subsequent capture.
Failures and completed attempts are terminal and never auto-retry; re-enabling only restores a still-valid
stored campaign record. A validated redemption activates memory and emits `acquisition_linked` while its
generation remains active even if best-effort campaign persistence fails.

Additional revocation drops queued/retrying requests at the transport boundary without stopping basics;
an already-sent request cannot be recalled. Revoked queues never revive. Capture/boot never block product
flows or throw into callers; graceful shutdown awaits an idempotent two-second SDK drain.

## Data boundary

The stable installation UUID and optional `appInstalled: true` field remain server-only;
[[submodule-server-persistence]] owns exclusive ID creation and the at-most-once cross-process install claim.
A crash after claiming may lose that event, never duplicate it. Separate `attribution.json` stores either a
terminal browser-attempt marker or validated first/last campaign context, never a claim ID, verifier,
challenge, claim URL, journey/bridge IDs, IP, or user agent. Expired or invalid context becomes terminal; stored campaign data
survives preference off/on, while active enrichment does not. Other state has no single-instance coordination.
Counts describe installations, not people. Every event carries `app_version`, `channel`, `os`, `arch`, `build`
plus its
closed properties. Only built-in provider/model names pass raw; custom values become `custom`, preserving
the existing explicit `jbcentral` login name. No chat/file contents, paths/names, resource IDs, credentials,
arbitrary errors, token/cost counts or recordings are collected.

The sink uses the launcher-supplied public key, EU endpoint, disabled GeoIP enrichment and
`$process_person_profile: false`; key/endpoint/fetch injection supports tests and self-hosting. The
repository carries no key: release CI stamps it into [[module-shared]]'s version seam, so source, dev
and locally built artifacts (`channel=dev`, `0.0.0-*`) can never pollute production data. A 2026-10-06
spike of 275 `app_installed` from unstamped dev desktop/binary harness runs without `CI=1` motivated
this; the `CI`/test mutes alone relied on every harness remembering them. The `phc_` key stays a public
ingestion key extractable from shipped binaries, so this stops accidental pollution, not deliberate abuse. Personless
processing does not remove UUID linkage; vendor IP-discard/retention policy is separate. Automated/schema,
consent-revocation, migration, host-trigger and packaged loopback-delivery tests pin these boundaries.
