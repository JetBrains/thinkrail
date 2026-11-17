# ThinkRail Docs Author Guide

How to write pages for thinkrail.ai/docs. The site's design rules live in `apps/website/SPEC.md`.

## Page structure

Each page lives in its own folder under `content/docs/`:

```
content/docs/
└── build-an-extension/
    └── index.md
```

The folder name is for humans; the URL comes from the `slug` field.

## Frontmatter

```yaml
---
title: "Build a ThinkRail extension"   # Required: the H1, the tab title and the Files row
slug: build-an-extension               # Required: becomes /docs/build-an-extension/
description: "One or two sentences."   # Required: the lead under the title, the index card and the meta description
order: 10                              # Required: integer; the index and the Files rail sort by it, then by title
draft: true                            # Optional: skipped in production builds, shown in `bun run dev`
---
```

The schema in `src/content.config.ts` is the gate: a missing field, a malformed or reserved slug, or two
pages sharing a slug fail the build.

## Writing

- Do not repeat the title as an H1 in the body; start with prose or an `##` heading.
- Code blocks use the site's Shiki setup (` ```ts `, ` ```json `, ` ```bash `), as in blog posts.
- Link other pages by absolute path (`/docs/…`, `/extensions/`). Relative links must resolve to a built
  file or the build fails.
- Write plain technical prose for an outside developer. State limits as limits; no marketing tone.

## Preview

`bun run dev` in `apps/website` and open `http://localhost:4321/docs/`. Pages hot-reload on save.
