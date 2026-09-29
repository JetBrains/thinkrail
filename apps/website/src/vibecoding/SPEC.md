---
id: submodule-website-vibecoding
type: submodule-design
status: active
title: Vibecoding landing experience
parent: module-website
tags: [website, marketing, vibecoding, react]
---

## Responsibility

The audience-specific experience directly served at `https://thinkrail.ai/vibecoding/` and, as
further routes over the same module, at `https://thinkrail.ai/agentic-development/` and
`https://thinkrail.ai/agentic-ide/`: its header navigation, hero and quick start, desktop download controls, scripted chat, principles and capabilities, orchestration animation, workflow explanations, call to action, metadata, and route-local presentation. It preserves the approved visual design while the parent website owns route composition, analytics, SEO aggregation, deployment, and cross-route validation.

`index.ts` is the only public surface. Each route receives crawlable server-rendered content, then hydrates one React island for stateful interactions.

Two props parameterize `Landing` per route. `heroTitle` defaults to the vibecoding copy ("Vibe code
without losing control."); `/agentic-development/` passes "Agentic development without losing
control.". `positioning` (`"control" | "compounding"`, default `control`) selects the marketing
copy variant: `/agentic-ide/` passes `compounding` with hero title "The agentic IDE that gets
better every time you use it." — a positioning test (2026-02) framing ThinkRail as the IDE that
improves with use (living specs, reusable skills, upcoming extensions) rather than the control
framing. Under `compounding`, the hero subtitle, chat-demo script (one added "how do you get better
over time" exchange; the worktree exchange stays), principles, capabilities (plus a coming-soon
"Extensions" card), spec-first heading/subtitle, and CTA swap; every other section is shared, and
copy variants live beside their components, keyed by `Positioning`. A full module copy was rejected
(2026-02): ~25 duplicated files that would drift, against the repo's no-duplication rule.

The agentic-development and agentic-ide routes reuse the vibecoding identity wholesale: same
`siteMetadata` title/description, same `/vibecoding/` favicon, OG image, and wordmark asset URLs,
and a canonical + `og:url` pointing at `https://thinkrail.ai/vibecoding/` (decision, 2026-02:
near-identical content, so the original stays the search-primary page; the extra URLs serve
campaigns/tests/direct links and are excluded from the sitemap). `validateBuild.ts` pins all of
this per route, including each route's hero title and a positioning marker per variant — a dropped
prop would silently render the defaults.

## Boundary

- May depend on React and Lucide plus its own Tailwind entry stylesheet and checked-in assets under `public/vibecoding/`. It has no workspace dependency.
- Must not import the parent IDE-shell components or hand-written stylesheet, blog modules, analytics, Astro page composition, package-wide build validation, deployment configuration, another workspace, or a copied UI kit.
- Tailwind uses `source(none)` and scans this module only. Its preflight, fonts, tokens, utilities, and animations are emitted only in the stylesheet referenced by `/vibecoding/`; the parent landing and blog must never reference that stylesheet or the React renderer/component chunks.
- The route presents desktop applications only. One typed download model drives compact macOS / Windows / Linux tabs with one compatibility line and restrained actions; macOS exposes Apple Silicon, Windows exposes x64, and Linux exposes x64 plus ARM64 without browser architecture guessing. No command-line product, launcher command, copy control, disclosure, Windows shell state, or analytics import reaches the vibecoding/agentic experience. The parent website's document-level delegation observes its static download links and derives `quick_start` or `final_cta` from the containing section. The final CTA does not repeat the picker: it detects a supported desktop OS for one compact download action and links Linux, unknown/mobile, or alternate-platform visitors back to Quick start. Every download uses GitHub's versionless `releases/latest/download` aliases.
- The initial HTML contains the complete marketing message. JavaScript enhances controls and animation rather than making content discoverable.
- Every control is keyboard-operable. Motion-heavy effects resolve to a stable final state under `prefers-reduced-motion`; canvas animation pauses when reduced motion is requested or the document is hidden.
- Components use local Tailwind utilities mapped to this module's semantic tokens. They do not carry raw colour literals or inline style objects; runtime geometry uses DOM/SVG attributes or stylesheet-owned custom properties.
