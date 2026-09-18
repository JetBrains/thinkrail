---
id: submodule-website-attribution
type: submodule-design
status: active
title: Website attribution context
parent: module-website
tags: [website, analytics, attribution]
---

## Responsibility and boundary

Own the consented browser acquisition context used by website events and the later installation claim protocol.

- **Public surface:** normalized first/last-touch types and parsing, browser storage, current-page recording, and per-download bridge generation through `index.ts`.
- **Allowed dependencies:** the website analytics facade and Web Platform APIs.
- **Forbidden:** product server/desktop/CLI code; PostHog administration; account identity; changing installers or install commands; storing full URLs, `utm_term`, raw ad click IDs, IP, or user agent.

## Browser contract

A context belongs to the current validated website journey and expires after 30 days. It contains bounded `source`, `medium`, `campaign`, `content`, a closed referrer class, content key, timestamp, and policy version. A new journey resets first and last touch. Untagged internal/direct navigation preserves an existing last acquisition touch; UTM-tagged or external search/social/referral navigation advances it.

A page records its initial navigation only when a journey already exists. A journey granted later does not replay that navigation; a subsequent install CTA records the then-current touch. Known denial or withdrawal clears the context.

Each consented desktop download receives a random canonical bridge ID before `download_started`; the event and stored context carry the same value. A later download replaces only the latest bridge. Bridge-less events remain valid when no journey exists and for CLI paths.
