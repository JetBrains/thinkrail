---
id: module-website
type: module-design
status: active
title: Project website (thinkrail.ai landing)
parent: architecture
tags: [website, marketing]
---

## Responsibility

The project's public website — a single landing page whose creative conceit is that **the site IS the
IDE**: a faithful HTML/CSS recreation of the ThinkRail shell (title bar, project rail, tab strip,
files rail, terminal, status bar) whose center "editor" is the normally-scrolling page content. Each
section poses as a file of a `website` workspace (`README.md`, `why.md`, `features/*.md`,
`install.sh`, `CONTRIBUTING.md`); the chrome reacts to scroll (active tab,
tree selection, status-bar line counter) like the editor is switching files.

Not part of the product: nothing in the app depends on it, and it ships to GitHub Pages, not in the
binary.

## Boundary

- **Standalone leaf.** No workspace deps — it must never import `@thinkrail/contracts`, `server`,
  `shared`, or `web`. It is not on the wire and has no protocol knowledge.
- Vite + vanilla TypeScript + hand-written CSS. No React, no Tailwind, no runtime deps at all —
  `devDependencies` only (`vite` pinned exact, `typescript` via `catalog:`).
- **Brand values are copied, not imported.** Theme palettes are lifted at authoring time from
  `apps/web/src/themes/bundled/*.theme.json` (dark = default, darcula, light, gruvbox) into the site's
  own CSS custom properties under `[data-theme]`; the site never reaches into `apps/web` at build time
  (the app's tokens assume the theme engine's runtime swap).
- All marketing copy is static DOM text; JS only *enhances* (scroll-spy, terminal typing, chat
  streaming replay, theme switcher, copy buttons, star count). The page must read complete with JS
  disabled, and animations are skipped under `prefers-reduced-motion`.

## Analytics

PostHog (the team's existing project, **EU** cloud). Loaded as **progressive enhancement, production
only**: `src/analytics.ts` injects PostHog's `array.js` from the first-party proxy at runtime and
calls `posthog.init()` **only when `location.hostname === "thinkrail.ai"`** — localhost, `vite dev`,
`preview`, and the `jetbrains.github.io` apex send nothing. The prod gate + config are a pure
`analyticsConfig(hostname)` function, unit-tested in `src/analytics.test.ts` (`bun:test`, no browser).

- **No npm dep.** We inject the CDN script at runtime rather than importing `posthog-js`, so the
  no-runtime-deps boundary holds. We also do **not** paste PostHog's minified bootstrap snippet: Biome
  lints JS inside `<script>` and the snippet trips it (`noCommaOperator`, `noAssignInExpressions`, …),
  which would force a forbidden `biome-ignore`. A clean typed loader avoids both. Safe because
  `array.js` self-assigns `window.posthog` on load (its stub-queue replay is guarded), so `init()` in
  the load handler needs no bootstrap stub.
- **Genuinely cookieless — stores nothing on the device.** `cookieless_mode: "always"`: PostHog sets
  **no cookie and no local/session storage**; visitor identity is a privacy-preserving hash computed
  server-side from a daily-rotating salt + IP + host + user-agent. Nothing persistent lands in the
  browser, so **no consent banner is required** under GDPR/ePrivacy. Also `respect_dnt: true`,
  `disable_session_recording: true`; autocapture + pageviews stay on. `person_profiles:
  "identified_only"` — the site never calls `identify()` (cookieless mode forbids it anyway).
  - **Operational dependency:** requires **"Cookieless server hash mode" enabled in the PostHog
    project settings** (Project Settings → Web analytics). If it is off, cookieless events are dropped.
  - Trade-off: the daily salt makes cross-day identity coarse (a visitor returning on a later day
    counts as new); pageview counts stay accurate, unique-visitor counts are approximate.
- **First-party ingest via PostHog's managed reverse proxy** — `p.thinkrail.ai`, so ad blockers (which
  match on `*.posthog.com`) don't drop the beacon. One host covers both PostHog EU origins: the proxy
  routes `/static/*` + `/array/*` to `eu-assets.i.posthog.com` and everything else to
  `eu.i.posthog.com`, so `api_host` **and** the injected `array.js` URL are the proxy. `ui_host:
  "https://eu.posthog.com"` stays PostHog's real app origin — mandatory with a proxy, or in-app links
  and the toolbar point at the proxy. Both are pinned in `analytics.test.ts`.
  - **Managed, not self-hosted:** PostHog operates it (DNS `CNAME` → their Cloudflare edge; SSL +
    routing theirs). Consequence: traffic also transits **Cloudflare**, a PostHog
    [subprocessor](https://posthog.com/subprocessors) under their DPA — no new controller, still EU.
    We run no proxy infrastructure; the site stays static on GitHub Pages.
  - Cookieless server-hash identity is unaffected: the proxy forwards `X-Forwarded-For`, so the
    daily-salt hash still sees the real client IP.
  - **The host-side sink is deliberately NOT proxied** (`packages/server/src/analytics` keeps
    `eu.i.posthog.com`): `posthog-node` runs in our own process, where no ad blocker exists — a proxy
    would add a hop and a subprocessor for nothing.
- The `phc_…` project key is **public/client-safe** by design (meant to ship in browser code) — not a
  secret, so embedding it in the static build is expected.

**Google Tag Manager** (container `GTM-WDW2DZW4`) runs **alongside** PostHog, under the same rules:
production-only typed loader (`src/gtm.ts`, no pasted minified snippet — same Biome reasoning as
PostHog), gated on `location.hostname === "thinkrail.ai"` with the pure `gtmConfig(hostname)`
unit-tested in `src/gtm.test.ts`. GTM lives **only in this module** — it must never appear in
`apps/web` or anything that ships in user instances (local or cloud).
- **No `<noscript>` iframe** (deliberate): it is static HTML that can't be hostname-gated, and
  JS-disabled tracking isn't worth loosening the production-only gate.
- **Consent caveat:** the site's "no consent banner required" stance rests on cookieless PostHog. GTM
  itself stores nothing, but tags configured *inside* the container (e.g. GA4) typically set cookies —
  whoever adds such tags in the GTM UI owns re-opening the consent question.

## Deploy

`.github/workflows/site.yml` builds (`bun run --filter @thinkrail/website build`) and publishes
`apps/website/dist` to GitHub Pages on pushes to `main` that touch this module (plus manual dispatch).
Vite `base: "./"` keeps the build servable at `/thinkrail/` and on any custom domain. One-time repo
settings: Pages → Source: GitHub Actions, and Pages → Custom domain: `thinkrail.ai` — the public
identity. Canonical/OG URLs in `index.html` (and the README website link) point at
`https://thinkrail.ai/`, never the `jetbrains.github.io/thinkrail` address (which redirects there).

## Assets

`public/og.png` is a capture of the site's own hero. The transcript in the `features/agent-chat.md`
section is from a real `pi` session captured in the app while it worked on this repo. Re-capture
method lives in the task-spec that built this module.
