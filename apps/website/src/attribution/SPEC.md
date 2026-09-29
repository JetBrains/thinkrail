---
id: submodule-website-attribution
type: submodule-design
status: active
title: Website attribution claims
parent: module-website
tags: [website, analytics, attribution, cloudflare]
---

## Responsibility and boundary

Own the same-origin browser-claim protocol that transfers a consented website acquisition context to an installed ThinkRail host. Cloudflare Pages Functions expose the protocol and D1 provides short-lived atomic claim state.

- **Public surface:** `index.ts` exposes normal-page browser attribution; target-specific `claim.ts` and `server.ts` expose the analytics-free claim page and Pages handlers. These secondary entrypoints are the code-splitting boundary that prevents normal analytics/GTM modules entering the claim page or Worker bundle. The service and D1 repository remain internal.
- **Allowed dependencies:** the website analytics facade for normal-page recording, Web Platform APIs, Pages Functions, and the `ATTRIBUTION_DB` D1 binding.
- **Forbidden:** importing product server/desktop/CLI code; PostHog administration; account identity; changing installers or install commands; persisting user agent, referrer URL, Cookiebot values, or arbitrary request bodies.

## Protocol

All state-changing routes require the effective hostname `thinkrail.ai`; browser binding also requires
the exact same-origin `Origin`. The origin guard still returns not-found on preview and sibling hosts
before D1 access. Preview deployments have no D1 binding; the guard is not the data-isolation boundary.
Bodies and strings are bounded and unknown fields are rejected.

1. `POST /api/attribution/claims` accepts one 43-character canonical base64url SHA-256 `challenge`, atomically consumes the aggregate D1 create quota, stores a random 32-byte base64url claim ID plus creation and expiry times, and returns `claim_id`, the relative `claim_url`, and the ten-minute `expires_at` epoch-millisecond time. Exhausted quota returns 429.
2. The installed host opens `/attribution/claim/?id=<claim>`. On load, the static route reads a validated, unexpired journey/acquisition context from browser storage and makes one bind attempt. An invalid claim ID or missing/invalid context never binds. The owner accepts that a crafted claim link can bind a visitor's stored context.
3. `POST /api/attribution/claims/<id>/bind` is first-write-wins. It transiently stores the journey ID, normalized first/last-touch fields, and the context's latest desktop-download bridge ID when present. If the context has no bridge ID, as in a CLI claim, bind generates a random bridge ID.
4. After the one bounded bind attempt, the route replaces the location with `/blog/` regardless of outcome; it also navigates there when the claim ID or context is invalid or unavailable. The claim document initializes no PostHog or GTM loader and emits no browser analytics event; its no-referrer policy avoids referrer leakage, while `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` prevent clickjacking.
5. `status` and `redeem` accept one canonical 32-byte base64url `verifier` and derive its SHA-256 challenge. Verifier-authenticated status is advisory. Redeem uses `DELETE … RETURNING` to atomically consume one bound, unexpired row and returns the journey ID, bridge, and normalized acquisition context. Replay, wrong verifier, and unknown ID share the same not-found response; an authenticated unbound claim is pending and an authenticated expired claim is gone.

The browser never receives the verifier and the service never stores it. The host receives the journey ID only in the successful redeem response. No route enables CORS. Claim responses are `no-store`; the browser route is excluded from all browser analytics and search indexing.

## Data and delivery

The normalized touch shape contains bounded UTM `source`, `medium`, `campaign`, `content`, a closed referrer class, epoch-millisecond timestamp, and policy version `1`. It does not transfer the landing page to the app. PostHog derives landing/last-page analysis by joining website events carrying `journey_id` and `content_key`/`$pathname` with `acquisition_linked.journey_id`. The product server maintains a strict mirror of this schema without importing website code; both copies change together. Browser storage holds first/last touch by journey and the latest desktop-download bridge; a new journey resets both. A UTM-tagged or external search/social/referral touch advances the last touch and invalidates the prior bridge; untagged internal/direct navigation preserves both, while a later consented download replaces the bridge. Bridge-less events remain valid. Known Marketing denial or withdrawal clears the stored context; unknown consent preserves it. Normal-page reads require the current journey; the isolated claim route accepts only validated context within 30 days of its last touch. No `utm_term`, full URL, raw ad click ID, account data, IP, or user agent is stored. Claim rows expire after ten minutes and are deleted on redemption or cleanup during create.

D1 conditional updates are the bind and redeem linearization points. A quota table keyed only by UTC minute bucket atomically permits at most 1,000 creates in each bucket and carries no client identifier; older buckets are deleted opportunistically. Create consumes quota before deleting all expired claim rows, then uses one conditional insert to enforce a 50,000-row global active cap; capacity returns 503 without insertion. Distinct claims may bind and redeem the same bridge ID, while claim ID plus verifier challenge and atomic deletion preserve one-time claim redemption. Application code never logs claim IDs, challenges, campaign values, or request bodies. Deployment remains one Cloudflare Pages project: pinned Wrangler `4.124.0` validates the configuration and builds the static artifact and `functions/`; its preview environment overrides `d1_databases` with `[]`, while production alone binds `ATTRIBUTION_DB` and applies committed D1 migrations.
