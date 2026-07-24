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
section poses as a file of a `website` workspace (`README.md`, `features/*.md`, `install.sh`,
`CONTRIBUTING.md`) — except `#why`, which poses as a **chat tab** ("Why ThinkRail?") that replays a
stylized session: the question is typed into the composer, the tab titles itself from it, and the
answer is an animated metro map that builds itself outward from a YOU hub (five token-colored lines +
a Comfort Circle). The chrome reacts to scroll (active tab, tree selection, status-bar line counter)
like the editor is switching files; the why chat, being a chat and not a file, is deliberately absent
from the files rail.

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

The `#why` chat is, by contrast, a hand-authored *simulation* (no captured session): its metro-map
SVG is hand-drawn, colored entirely by theme tokens, and its replay/build animation is fully gated
on `html.anim` (JS present + motion allowed) — the finished map is the static state, so the section
reads complete with JS disabled and under `prefers-reduced-motion`.
