---
id: submodule-website-attribution
type: submodule-design
status: active
title: Website attribution context
parent: module-website
tags: [website, analytics, attribution]
---

## Responsibility and boundary

Own the consented browser acquisition context and the verifier-backed claim state used to hand that context to an installed ThinkRail host.

- **Public surface:** normalized first/last-touch and claim protocol types, browser storage, current-page recording, and per-download bridge generation through `index.ts`.
- **Allowed dependencies:** the website analytics facade, Web Platform APIs, and the deployment-supplied D1 database.
- **Forbidden:** product server/desktop/CLI code; PostHog administration; account identity; changing installers or install commands; storing full URLs, `utm_term`, raw ad click IDs, IP, or user agent.

## Browser contract

A context belongs to the current validated website journey and expires after 30 days. It contains bounded `source`, `medium`, `campaign`, `content`, a closed referrer class, content key, timestamp, and policy version. A new journey resets first and last touch. Untagged internal/direct navigation preserves an existing last acquisition touch; UTM-tagged or external search/social/referral navigation advances it.

A page records its initial navigation only when a journey already exists. A journey granted later does not replay that navigation; a subsequent install CTA records the then-current touch. Known denial or withdrawal clears the context.

Each consented desktop download receives a random canonical bridge ID before `download_started`; the event and stored context carry the same value. A later download replaces only the latest bridge. Bridge-less events remain valid when no journey exists and for CLI paths.

## Claim core

A claim stores a random ID, SHA-256 verifier challenge, creation time, and ten-minute expiry. Browser binding is first-write-wins and adds a transient journey ID, bridge ID, and strict first/last-touch context; a supplied desktop bridge is preserved and a bridge-less CLI claim receives a generated one. Status is advisory. Verifier-authenticated redeem atomically deletes and returns one bound, unexpired row; replay, wrong verifier, and unknown ID are indistinguishable.

D1 deletes expired rows before create, applies a global 1,000-creates-per-minute quota, and conditionally inserts only below a 50,000-row cap. Claim and bridge IDs are canonical 32-byte base64url values. The schema stores no verifier, full URL, `utm_term`, raw click ID, account data, IP, or user agent.
