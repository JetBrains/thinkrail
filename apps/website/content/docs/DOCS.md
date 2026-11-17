# ThinkRail Docs Author Guide

How to write pages for thinkrail.ai/docs. The site's design rules live in `apps/website/SPEC.md`.

## Page structure

Each page lives in its own folder under `content/docs/`:

```
content/docs/
├── build-an-extension/
│   └── index.md
└── extension-reference/
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

## Guarded code in the extension docs

The extension guide and reference show real code, never paraphrased code. `src/docsGuide.test.ts` reads
the sources at test time and fails when a page no longer matches them, so every fenced code block in
those pages starts right after a guard comment naming what it shows:

| Guard | The block must be |
| --- | --- |
| `<!-- guard: file palette/<path> -->` | the whole file of `extension-examples/palette/<path>` (`sdk/<path>` for `packages/extension-sdk`) |
| `<!-- guard: excerpt palette/<path> -->` | a contiguous run of that file's lines (common indentation removed); say "an excerpt" in the prose |
| `<!-- guard: package-json palette/package.json -->` | some of the sample's top-level fields, in file order, printed as the file prints them |
| `<!-- guard: tree -->` | the sample's layout: every source under `server/` and `web/`, and the manifest's built files |
| `<!-- guard: shell -->` | commands using the sample's scripts, its packages and real `thinkrail-extension build` options |
| `<!-- guard: extensions-json -->` | an `extensions.json` with absolute folders or `npm:` sources |
| `<!-- guard: manifest-cases -->` | manifest cases in the format of `packages/extension-api/src/manifestCases.json` that hold under the site's validator |

Tables and lists with a guard comment (`manifest-fields`, `server-descriptor`, `session-services`,
`render-props`, `registration-options`, `build-options`, `shared-modules`, `shared-modules-summary`)
are compared with the SDK's types, CLI and shared-module list. To change a sample file shown in a doc,
change the sample and paste the new text into the block; `bun test src/docsGuide.test.ts` says where
they differ.

## Preview

`bun run dev` in `apps/website` and open `http://localhost:4321/docs/`. Pages hot-reload on save.
