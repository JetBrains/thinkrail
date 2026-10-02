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

- **Dependency-light for vanilla users.** The package depends on `beautiful-mermaid` only (zero-DOM,
  synchronous). `mermaid` (~83 MB with its tree) and the `linkedom` DOM shim it needs under Node/Bun
  were rejected here: they buy strict parsing but no terminal rendering, and a host that renders with
  mermaid can inject that parser through the seam.
- **Default validation is a renderability probe, not syntax validation.** For the families
  `beautiful-mermaid` draws (flowchart/graph, state, sequence, class, ER, xychart — detected by header,
  comments skipped) the probe renders the source and rejects a bad header or an **empty drawing**. It
  cannot catch partial damage: the renderer silently drops malformed fragments (`A -->` keeps only `A`).
  Other families (gantt, pie, mindmap, gitGraph, …) and unknown headers **pass through unvalidated**
  rather than risk rejecting a diagram type the renderer merely does not know. All of this is stated in
  the README; the TUI always keeps the source reachable.
- **Terminal rendering tiers.** `renderCall` is a one-line summary (`visualize <title | diagram |
  comparison — N options>`). `renderResult` returns a width-aware component: in `render(width)` a
  diagram is drawn as box-drawing (`colorMode: "none"`, pi theme styling) only when every row fits the
  width **and** its terminal-cell width equals its string length — the renderer positions labels by
  `.length`, so wide (CJK) or combining characters would misalign borders; otherwise, for unknown
  families, or when rendering throws, the pi-tui `Markdown` fence of the source is shown. A diagram is
  never word-wrapped. Collapsed = drawing only; expanded = drawing + source fence. Diagrams render from
  defensively checked `result.details`; comparisons, errors (`context.isError`) and missing details
  render from `result.content`; partial results show a placeholder. Image-tier rendering
  (Kitty/iTerm2) is deferred: it needs SVG rasterisation without a browser and degrades under tmux/SSH.
- **Dual runtime.** Shipped code uses `node:`-free standard ESM and pi's host-provided packages only,
  so it runs under Node (vanilla pi, jiti) and Bun (ThinkRail). Runtime imports from
  `@earendil-works/pi-coding-agent` are limited to `getMarkdownTheme`; `@earendil-works/pi-tui` supplies
  `Text`, `Markdown`, `visibleWidth`.

## Boundary

- **Allowed deps:** `beautiful-mermaid` (exact pin); peers `@earendil-works/pi-ai` (`StringEnum`),
  `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`.
- **Forbidden:** anything from ThinkRail (`@thinkrail/*`, `apps/*`, `packages/server`), `mermaid`,
  `linkedom`, Bun-specific APIs.

## Structure

`index.ts` (exports + default), `src/extension.ts` (factory, tool registration, validator wrapping),
`src/schema.ts`, `src/validate.ts` (shape + source enumeration), `src/markdown.ts` (tier-1 fallbacks),
`src/diagramFamily.ts` (header detection), `src/probe.ts` (box-drawing render + default validator),
`src/tui.ts` (renderers + `DiagramComponent`). `bun test` covers each; the vanilla-parity gate in
[[module-pi-extensions]] exercises the packed artifact.
