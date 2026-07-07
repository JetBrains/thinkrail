---
id: pi-visualize-module
type: module-design
status: active
title: pi-visualize extension
parent: architecture
tags: [pi-extension, visualization, mermaid]
---

# pi-visualize

A standalone **pi extension** that registers one tool, `visualize`, for rendering **diagrams** (raw
mermaid) and **option comparisons**. It is the *capability* half of the visualization feature; the
*presentation* half (rich cards in the ThinkRail web chat) lives in `apps/web/src/chat/tools/visualize/`
and is joined to this package only by the tool **name**.

This package has **no dependency on ThinkRail** and is installable into any bare `pi`.

## What it owns

- The `visualize` tool definition: name, description, TypeBox schema, per-type shape validation, and the
  **tier-1 markdown fallback** returned as the tool's `content`.

## Public surface

- **Default export** — the pi `ExtensionFactory` (`(pi) => pi.registerTool(…)`), loaded by pi's resource
  loader directly from `index.ts` (raw `.ts`; no build step, matching `pi-web-access`).
- **The tool contract** other renderers key on: the name `"visualize"` and its argument shape
  (`type: "diagram" | "comparison"`, `title?`, `mermaid?`, `options?[]`). Changing this shape is a
  breaking change for every renderer.

## Boundary

- **Allowed deps:** `typebox` (schema), `@earendil-works/pi-ai` (`StringEnum`), and
  `@earendil-works/pi-coding-agent` (**types only**). All declared as `peerDependencies` — the host pi
  provides them at runtime.
- **Forbidden:** anything from ThinkRail (`@thinkrail/*`, `apps/web`, the server). Reaching into the
  host would defeat portability.

## Structure

- `index.ts` — factory + `registerTool` + `execute` (validate → build fallback `content` → return
  `{ content, details }`).
- `src/schema.ts` — `VisualizeSchema` (flat object, discriminated by `type`) + inferred types.
- `src/validate.ts` — `validateShape` (throws on bad per-type shape; mermaid *syntax* is not checked here).
- `src/markdown.ts` — tier-1 fallback builders (`mermaidFence`, `comparisonMarkdown`).
- `*.test.ts` — `bun test` unit coverage of the above.

## Rendering tiers (graceful degradation)

1. **`content` markdown** — *this package*. Readable in any host (TUI, piped output, a UI without a
   custom renderer). For `diagram`, a fenced ```mermaid block; for `comparison`, a sectioned list.
2. **`renderResult` (TUI)** — **deferred.** A tier-2 renderer using pi-tui's `Markdown` component would
   render the fallback more nicely in pi's terminal. Deferred from V1: it's TUI-only polish, sourcing a
   `MarkdownTheme` is unconfirmed, and tier-1 already degrades acceptably. Adding it later touches only
   this file and adds a `@earendil-works/pi-tui` peer dep.
3. **Web renderer** — *not here*; lives in `apps/web` and renders mermaid → SVG + styled cards.

## Not here

- Rich rendering (mermaid → SVG, styled comparison cards) — host-specific, keyed to the tool name.
- mermaid *syntax* validation — a render-time concern for the renderer, not the capability.
