---
id: module-pi-visualize
type: module-design
status: draft
title: "@thinkrail.ai/pi-visualize — the visualize tool for vanilla pi"
parent: module-pi-extensions
tags: [pi-extension, visualization, mermaid]
---

## Responsibility

The published, portable half of the visualization capability: one tool, `visualize`, that validates a
diagram or comparison request, returns a markdown fallback as the model-facing result, and draws the
result in pi's terminal UI. It knows nothing about ThinkRail. Successor of [[pi-visualize-module]]
(`packages/pi-visualize`), which stays loaded by the ThinkRail host until the wiring PR composes this
package through [[module-thinkrail-extensions]] and deletes it.

## Public surface

- **Default export** — the pi `ExtensionFactory` with the default configuration; what `pi install`
  loads through the `pi` manifest.
- **`createVisualizeExtension({ validateMermaid? })`** — returns an `ExtensionFactory` with an injected
  `MermaidValidator: (source) => void | Promise<void>`. The validator **replaces** the default check
  (never supplements it, so a stricter engine can accept syntax the probe would reject). The package
  keeps shape checks, empty-source rejection, source enumeration, awaiting the callback and wrapping any
  throw into the field-specific diagnostic (`` `mermaid` `` / `` `options[N].mermaid` ``) that asks the
  model to correct and retry.
- **The tool contract** renderers key on: the name `"visualize"`, its argument shape
  (`type: "diagram" | "comparison"`, `title?`, `mermaid?`, `options?[]`), and `details` = the validated
  params. Changing this shape is a breaking change for every renderer, including ThinkRail's.

## Decisions

- **Dependency-light for vanilla users: `lovely-mermaid`.** The package depends on `lovely-mermaid` only
  (zero dependencies, ~1 MB, synchronous, Apache-2.0). It is the maintained successor of `grok-mermaid`,
  the engine pi itself uses to draw ```` ```mermaid ```` fences in chat messages — pi never applies that
  to tool results, hence this package's own renderer — so a `visualize` diagram looks like one the
  model writes inline. `mermaid` (~83 MB with its tree) and the `linkedom` DOM shim it needs under
  Node/Bun were rejected here: they buy strict parsing but no terminal rendering, and a host that
  renders with mermaid can inject that parser through the seam.
- **Post-mortem: `beautiful-mermaid` was replaced.** Its ASCII engine (shared by the `@vercel` and
  `@ktrysmt` forks) routes every edge between one pair of nodes along a single path, so a
  back-and-forth or parallel pair — the common request/response or `Idle ⇄ Running` shape — overprinted
  labels, dropped one, or lost which way each went, and the collapsed TUI showed that drawing with no
  hint. Found in a live vanilla-pi check on an OAuth flow; it also cost ~10 MB with `elkjs`.
- **Default validation is the renderer's own parse, best-effort.** For the kinds `lovely-mermaid`
  draws (flowchart/graph, state, sequence, class, ER, pie, mindmap, timeline, gitGraph — its
  `diagramKind`, which skips frontmatter, directives and comments) the probe rejects an unknown
  flowchart direction (`lovely-mermaid` silently accepts `flowchart XX`; mermaid does not), a source
  in which nothing parsed (`render` → `null`), and any fragment the parse **dropped** (`warnings`:
  dangling links, unclosed labels, unreadable statements). The size-cap warning (`diagram truncated`)
  is a renderer limit, not a source error, and is never a rejection. The library advises against
  gating *rendering* on warnings because streamed sources warn mid-edit; a tool call is complete, so a
  dropped fragment there is a real defect worth a retry. Accepted cost: the grammar is lenient (an
  unclosed class body passes) and has rare false positives (`accTitle`/`accDescr`); a host with a
  strict parser replaces the probe through the seam. Other families (gantt, xychart, …) **pass through
  unvalidated** rather than risk rejecting a diagram type the renderer merely does not know.
- **Terminal rendering tiers.** `renderCall` is a one-line summary (`visualize <title | diagram |
  comparison — N options>`). `renderResult` returns a width-aware component: in `render(width)` a
  diagram is drawn only when the art is **complete** (no warnings) and every row fits the width by
  pi-tui's `visibleWidth` (which agrees with the renderer's grapheme-correct widths, so CJK and emoji
  labels draw); otherwise, and for kinds the renderer does not draw, the pi-tui `Markdown` fence of the
  source is shown. Span roles map to pi's theme exactly as pi's native renderer does (`border` →
  `borderMuted`, `text` → `text`, `edge` → `accent`, `edgeLabel` → `muted`). A diagram is never
  word-wrapped. Collapsed = drawing only; expanded = drawing + source fence. Diagrams render from
  defensively checked `result.details`; comparisons, errors (`context.isError`) and missing details
  render from `result.content`; partial results show a placeholder. Image-tier rendering
  (Kitty/iTerm2) is deferred: it needs SVG rasterisation without a browser and degrades under tmux/SSH.
- **Dual runtime.** Shipped code uses `node:`-free standard ESM and pi's host-provided packages only,
  so it runs under Node (vanilla pi, jiti) and Bun (ThinkRail). Runtime imports from
  `@earendil-works/pi-coding-agent` are limited to `getMarkdownTheme`; `@earendil-works/pi-tui` supplies
  `Text`, `Markdown`, `visibleWidth`.

## Boundary

- **Allowed deps:** `lovely-mermaid` (exact pin); peers `@earendil-works/pi-ai` (`StringEnum`),
  `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`.
- **Forbidden:** anything from ThinkRail (`@thinkrail/*`, `apps/*`, `packages/server`), `mermaid`,
  `linkedom`, Bun-specific APIs.

## Structure

`index.ts` (exports + default), `src/extension.ts` (factory, tool registration, validator wrapping),
`src/schema.ts`, `src/validate.ts` (shape + source enumeration), `src/markdown.ts` (tier-1 fallbacks),
`src/probe.ts` (default validator), `src/tui.ts` (renderers + `DiagramComponent`). `bun test` covers each; the vanilla-parity gate in
[[module-pi-extensions]] exercises the packed artifact.
