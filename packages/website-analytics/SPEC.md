---
id: module-website-analytics
type: module-design
status: active
title: Shared website analytics
parent: architecture
references: [module-website]
tags: [website, analytics, privacy]
---

## Responsibility

The browser analytics policy consumed by the unified public website. It is the single source for the PostHog project key, EU endpoints, browser journey state, typed event capture and loader, plus the Google Tag Manager container and loader. The consumer supplies its exact production hostname and marketing-consent source; this package never decides which product URL, route, or consent manager is production.

## Boundary

- **Public surface:** `src/index.ts` exports the configuration/event/consent types and `createWebsiteAnalytics({ productionHostname, marketingConsent })`. The returned facade exposes a pure hostname configuration function, an idempotent browser initializer, current/subscribed journey access, and typed capture for `content_viewed`, `install_cta_clicked`, and `download_started`. CTA locations are the closed `hero | install_section | quick_start | final_cta | blog_post` set; download platform, architecture, and artifact values are closed unions. The website supplies `bridge_id` for consented desktop downloads; the property remains optional so bridge-less downloads are valid.
- **Dependency-free browser module.** It uses typed DOM APIs and has no runtime package or workspace dependency. It never imports a website, the application analytics sink, contracts, server, or shared.
- **Build-time boundary.** [[module-website]] compiles this source once into its static artifact. A package change therefore triggers that site's production and PR-preview workflows.
- **No site knowledge.** Page structure, route-to-content keys, navigation, deployment provider, Cookiebot globals/events, consent UI, and the production hostname remain in the consuming website module. The package consumes only a current-value/subscription adapter.

## Runtime contract

The factory's pure configuration function returns the complete PostHog and GTM settings only when the observed hostname exactly equals the supplied production hostname. Localhost, IPs, provider previews, sibling subdomains, and every other host produce no configuration. The initializer applies the same gate before touching the DOM and does not append a duplicate vendor script when called again.

PostHog is progressive enhancement through the team's existing EU Cloud project:

- `array.js` and event ingest use the first-party managed reverse proxy at `p.thinkrail.ai`; `ui_host` remains `eu.posthog.com` so generated links target the real PostHog application.
- PostHog remains cookieless: `cookieless_mode: "always"`, `respect_dnt: true`, `disable_session_recording: true`, and `person_profiles: "identified_only"`. Autocapture and pageviews remain enabled. Cookieless server-hash mode must remain enabled in the PostHog project; its daily salt makes non-journey cross-day unique-visitor counts approximate.
- When the supplied marketing-consent source reports granted, the package reads or creates a validated random first-party journey ID and registers it for subsequent events. Unknown state leaves storage untouched; known denial removes any stale value without reading or creating one. Withdrawal removes storage and in-memory registration. Current/subscribed journey access exposes only that validated in-memory value while consent is granted; reading it never accesses storage or creates an ID. Events observed before grant are never retroactively enriched, and queued events lose both `journey_id` and `bridge_id` if that grant is withdrawn before delivery.
- Typed captures are production-gated and retain only the 100 most recent events until PostHog initializes. Preview/disabled hosts never queue, persist journey state or touch vendor clients; loader or initialization failure clears and disables the queue for that document.
- The public `phc_…` project key is expected in the static bundle. The host-side application sink remains separate and sends directly to PostHog EU because it has no browser ad-blocking concern.
- The loader uses typed script injection rather than `posthog-js` or a pasted minified bootstrap. The proxy's `array.js` establishes `window.posthog`; initialization occurs from its load handler.

GTM container `GTM-WDW2DZW4` loads alongside PostHog after the same production gate. No static `noscript` iframe is emitted because it cannot honor that gate. GTM itself stores nothing, but any cookie-setting tag configured in the container reopens the consent requirement for the public site; the container owner is responsible for that review. Route-specific downstream tags are expressed as GTM hostname + Page Path conditions, never by initializing another container.

## Verification

Package tests pin the vendor identifiers, URLs, privacy options, exact-host gate, and disabled-host behavior. The consuming site separately tests the production hostname it supplies so deployment identity cannot drift while the vendor policy remains unchanged.
