---
id: submodule-vibecoding-analytics
type: submodule-design
status: active
title: Vibecoding website analytics
parent: module-vibecoding-website
tags: [website, analytics, privacy]
depends-on: [module-website-analytics]
---

## Responsibility

The site-local facade that configures [[module-website-analytics]] for `vibecoding.thinkrail.ai`. `index.ts` exposes the pure hostname configuration function and combined PostHog/GTM initializer used by the page shell; vendor identifiers, privacy options, and loaders remain shared.

The existing GTM container remains the control plane for Cookiebot and its downstream Google Analytics, Google Ads, and Bing tags. PostHog runs alongside it under the shared cookieless browser policy.

## Boundary

- The exact hostname `vibecoding.thinkrail.ai` is the only enabled environment. Localhost, IPs, branch deployments, sibling subdomains, and `pages.dev` previews inject no analytics script or send an event.
- Its only external module edge is [[module-website-analytics]]. It never imports landing components, another website, or another workspace package.
- The page shell imports this facade rather than the shared package directly, keeping deployment identity inside the site boundary.
- Tests pin the site-owned production hostname and disabled-host behavior; shared package tests pin vendor identities, URLs, privacy options, and loaders.
