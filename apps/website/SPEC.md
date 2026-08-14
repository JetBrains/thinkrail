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
`install.sh`, `CONTRIBUTING.md`). The **file tree is the source of truth for the page's navigation
structure**, and its selection reacts to scroll (scroll-spy) like the editor is switching files. The
top editor **tab strip is derived from that file-tree navigation** — not a hand-maintained list — and
is interactive: the active tab **follows the currently visible section via the same scroll-spy**, and
**clicking a tab scrolls to its section**. The strip holds **exactly one navigational tab per unique
section target**: the tree may stay hierarchical and repeat a target across rows, but duplicate
targets collapse to a single tab, so scroll-spy always activates exactly one tab per section. The
strip **scrolls** (`overflow-x: auto`, scrollbar hidden) — the tabs overflow below ~1500px and every one
must stay reachable. Its bottom divider is drawn **per tab**, not on the strip: a strip border sits
outside the scrollport, where the active tab cannot paint over it to merge into the content. The
status bar is a plain copyright footer, not a live line counter.

Not part of the product: nothing in the app depends on it, and it ships to GitHub Pages, not in the
binary.

## Boundary

- **Standalone leaf.** No workspace deps — it must never import `@thinkrail/contracts`, `server`,
  `shared`, or `web`. It is not on the wire and has no protocol knowledge.
- Vite + vanilla TypeScript + hand-written CSS. No React, no Tailwind, no runtime deps at all —
  `devDependencies` only (`vite` pinned exact, `typescript` via `catalog:`). The two
  `@fontsource-variable/*` packages are build-time asset sources, not runtime deps: vite emits their
  woff2 files into `dist/`. They are shared with `apps/web`, so they come from the root
  `workspaces.catalog` — one pin for both apps, which is what keeps the site's faces identical to the
  app's.
- **Fonts are self-hosted; the site makes no external font request.** Packages and stacks are copied
  from the app's `typography.json`, not imported — and `src/fonts.test.ts` reads that JSON at test time
  and fails on drift, which is what makes copying safe. `--font-display` mirrors the app's `brand`
  family — **Orbitron** (`@fontsource-variable/orbitron`, self-hosted), a distinct display face for the
  brand elements (wordmark + hero heading), falling back to `--font-sans`; section headings and the
  tagline are the interface face (`--font-sans`), matching the app.
- **Brand values are copied, not imported.** Theme palettes are lifted at authoring time from
  `apps/web/src/themes/bundled/*.theme.json` (dark = default, darcula, light, gruvbox) into the site's
  own CSS custom properties under `[data-theme]`; the site never reaches into `apps/web` at build time
  (the app's tokens assume the theme engine's runtime swap).
- **A colour with a contrast floor gets a `:root` token, never the region-inherited `--accent`.**
  `.hero` re-points `--accent` for its artwork, so descendants reading it inherit a value chosen for dark
  backgrounds. `--link` and `--focus-ring` are declared once on `:root` as `var(--accent)`, which resolves
  against the *root* accent — per-theme, but out of reach of a region override.
- All marketing copy is static DOM text; JS only *enhances* (scroll-spy, the derived editor-tab strip
  and its scroll-spy/click navigation, terminal typing, chat streaming replay, theme switcher, copy
  buttons, star count, install-platform selection). The page must read complete with JS disabled (the
  editor tabs are a JS-built navigation affordance over content that is already reachable by scrolling
  and via the file tree), and animations are skipped under `prefers-reduced-motion`.
- The hero's install command has **macOS / Linux / Windows** tabs. Browser hints choose only the
  initial supported desktop OS; they never hide alternatives or claim to detect an ambiguous mobile
  platform. Windows adds **PowerShell / Command Prompt / WSL** tabs: native shells use `install.ps1`
  (the stable command is deliberately identical in both), while WSL uses `install.sh` and therefore
  installs the Linux build inside that distro. Every hero panel remains in the static DOM; JS turns the
  complete fallback into the tabbed view. The detailed Install section keeps its existing complete,
  mixed-platform reference rather than duplicating the picker.

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

**The deploy fails fast rather than hanging.** `deploy-pages` only creates the Pages deployment and then
polls it, so a stalled backend hangs the step until timeout — 10min on 2026-08-06 (`31107056870`),
leaving `main` red and the site stale. Hence `timeout: 180000` (a healthy deploy reports `succeed` in
~10s), `retention-days: 7` on the artifact so re-running the `deploy` job stays a valid remedy for a
week, and `cancel-in-progress: false` so an in-flight publish finishes. Don't add an in-job retry: the
deployment is keyed by `GITHUB_SHA` and the timeout cancels it, so a second attempt moments later only
reads back `deployment_cancelled`. Re-deploying that SHA *later* is fine — hence the remedy above.

## Assets

`public/og.png` is a capture of the site's own hero. The transcript in the `features/agent-chat.md`
section is from a real `pi` session captured in the app while it worked on this repo. Re-capture
method lives in the task-spec that built this module.
