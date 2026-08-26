---
id: module-vibecoding-website
type: module-design
status: active
title: Vibecoding website
parent: architecture
references: [module-website]
tags: [website, marketing, vibecoding]
---

## Responsibility

The audience-specific marketing site at `https://vibecoding.thinkrail.ai/`. It presents ThinkRail to vibecoders through an animated product story, install flow, and interactive agent/worktree demonstrations. It is independently releasable from the IDE-shell landing and blog owned by [[module-website]].

The checked-in monorepo source is authoritative. Lovable was the design origin only; no generated runtime, hosted asset, or synchronization contract remains.

## Boundary

- **Standalone leaf.** It has no workspace dependency and never imports `apps/website`, `apps/web`, contracts, server, or shared. Cross-workspace version reuse happens through the root dependency catalog, not source imports.
- **Static Astro output with React islands and Tailwind v4.** Astro renders crawlable HTML into `dist/`; React is limited to the interactions that need browser state. There is no application server, TanStack router, React Query, Nitro, or Lovable runtime.
- **Self-contained build.** Fonts and brand/media assets are emitted from checked-in files or build-time font packages. Production output contains no `/__l5e`, Lovable preview-domain, or Google Fonts dependency.
- **One public route.** The site owns `/`; the existing blog remains solely under [[module-website]]. Unknown paths use the static host's not-found behavior.

The package composes two sibling submodules without an edge between them:

```text
src/pages/index.astro ──▶ src/landing
src/pages/index.astro ──▶ src/analytics
```

`src/landing` never initializes tracking. `src/analytics` never imports or interprets landing components.

## Deployment

A dedicated Cloudflare Pages project serves the static `dist/` artifact. A path-scoped GitHub Actions workflow builds from the frozen root lockfile and publishes on `main` only when this module or its workflow changes. `vibecoding.thinkrail.ai` is the sole production hostname; provider previews are non-production and analytics-silent.

The production cutover from Lovable records the prior DNS target before attaching the Pages custom domain. Restoring that target is the rollback until the replacement is verified.
