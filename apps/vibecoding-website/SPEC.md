---
id: module-vibecoding-website
type: module-design
status: active
title: Vibecoding website
parent: architecture
references: [module-website]
tags: [website, marketing, vibecoding]
depends-on: [module-website-analytics]
---

## Responsibility

The audience-specific marketing site at `https://vibecoding.thinkrail.ai/`. It presents ThinkRail to vibecoders through an animated product story, install flow, and interactive agent/worktree demonstrations. It is independently releasable from the IDE-shell landing and blog owned by [[module-website]].

The checked-in monorepo source is authoritative. Lovable was the design origin only; no generated runtime, hosted asset, or synchronization contract remains.

## Boundary

- **Independently deployed leaf.** Its only workspace dependency is [[module-website-analytics]]; it never imports `apps/website`, `apps/web`, contracts, server, or shared. The shared browser source is compiled into this site's static artifact, while cross-workspace third-party versions continue through the root dependency catalog.
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

A dedicated Cloudflare Pages project serves the static `dist/` artifact. A path-scoped production workflow builds from the frozen root lockfile and publishes the `main` branch when this module, [[module-website-analytics]], its production workflow, the root package manifest, or the lockfile changes. The root files are included because catalog and resolved dependency changes alter the artifact even when this app's manifest is unchanged. `vibecoding.thinkrail.ai` is the sole production hostname; provider previews are non-production and analytics-silent.

The production cutover from Lovable records the prior DNS target before attaching the Pages custom domain. Restoring that target is the rollback until the replacement is verified.

### PR preview deploys

Same-repository PRs that touch this module, [[module-website-analytics]], the root package manifest, or the lockfile get an independently reviewable Pages deployment from `.github/workflows/vibecoding-site-preview.yml`. The workflow uses the production build command and deploys to this module's existing `thinkrail-vibecoding` project on branch `pr-<number>`, producing the deterministic alias `https://pr-<number>.thinkrail-vibecoding.pages.dev`. It waits for HTTP 200 before publishing a sticky PR comment (marker `<!-- thinkrail-vibecoding-site-preview -->`) and a `Vibecoding website preview` commit status.

This workflow is independent of [[module-website]]'s preview workflow: each has its own path trigger, concurrency group, Pages deployment, comment marker, and status context. A PR that changes both website modules, the shared analytics package, or shared root dependency inputs therefore receives two comments and two statuses, while a single-site change produces only that site's preview. Fork PRs skip because Cloudflare credentials never cross the repository boundary. Preview aliases are public, analytics-silent, and left inert after a PR closes; a newer push cancels only the superseded preview for the same site and PR.
