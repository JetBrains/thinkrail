---
id: module-website-analytics
type: module-design
status: active
title: Shared website analytics
parent: architecture
references: [module-website, module-vibecoding-website]
tags: [website, analytics, privacy]
---

## Responsibility

The browser analytics policy shared by the independently deployed public marketing sites. It is the single source for the PostHog project key, EU endpoints, privacy configuration and loader, plus the Google Tag Manager container and loader. A consumer supplies its own exact production hostname; this package never decides which product URL is production.

## Boundary

- **Public surface:** `src/index.ts` exports the configuration types and `createWebsiteAnalytics({ productionHostname })`. The returned facade exposes a pure hostname configuration function and an idempotent browser initializer.
- **Dependency-free browser module.** It uses typed DOM APIs and has no runtime package or workspace dependency. It never imports a website, the application analytics sink, contracts, server, or shared.
- **Build-time reuse.** [[module-website]] and [[module-vibecoding-website]] compile this source into separate static artifacts. Neither site's runtime or deployment depends on the other. Because a package change alters both artifacts, both sites' production and PR-preview workflow path filters include this package.
- **No site knowledge.** Page structure, navigation, deployment provider, consent UI, and production hostnames remain in the consuming website modules.

## Runtime contract

The factory's pure configuration function returns the complete PostHog and GTM settings only when the observed hostname exactly equals the supplied production hostname. Localhost, IPs, provider previews, sibling subdomains, and every other host produce no configuration. The initializer applies the same gate before touching the DOM and does not append a duplicate vendor script when called again.

PostHog is progressive enhancement through the team's existing EU Cloud project:

- `array.js` and event ingest use the first-party managed reverse proxy at `p.thinkrail.ai`; `ui_host` remains `eu.posthog.com` so generated links target the real PostHog application.
- The browser is genuinely cookieless: `cookieless_mode: "always"`, `respect_dnt: true`, `disable_session_recording: true`, and `person_profiles: "identified_only"`. Autocapture and pageviews remain enabled. Cookieless server-hash mode must remain enabled in the PostHog project; its daily salt makes cross-day unique-visitor counts approximate.
- The public `phc_…` project key is expected in the static bundle. The host-side application sink remains separate and sends directly to PostHog EU because it has no browser ad-blocking concern.
- The loader uses typed script injection rather than `posthog-js` or a pasted minified bootstrap. The proxy's `array.js` establishes `window.posthog`; initialization occurs from its load handler.

GTM container `GTM-WDW2DZW4` loads alongside PostHog after the same production gate. No static `noscript` iframe is emitted because it cannot honor that gate. GTM itself stores nothing, but any cookie-setting tag configured in the container reopens the consent requirement for both sites; the container owner is responsible for that review.

## Verification

Package tests pin the shared vendor identifiers, URLs, privacy options, exact-host gate, and disabled-host behavior. Each consuming site separately tests the production hostname it supplies so a deployment identity cannot drift while the shared vendor policy remains unchanged.
