# @thinkrail/pi-visualize

A [pi](https://pi.dev) extension that gives the agent a `visualize` tool for **diagrams** (Mermaid),
**option comparisons**, and **HTML UI mockups**, so it reaches for a picture instead of ASCII art, a
markdown table, or a prose description when it explains architecture, flows, trade-offs, or a UI change.

```bash
pi install npm:@thinkrail/pi-visualize
```

## What you get

- **`visualize` tool** — `type: "diagram"` with raw Mermaid source; `type: "comparison"` with options
  (name, description, pros, cons, `recommended`, optional inline Mermaid, optional `html` mockup); or
  `type: "mockup"` with static HTML/CSS in `html`, or `before` + `after` to contrast the current and
  proposed UI, and an optional `viewport` (`desktop` / `tablet` / `phone`). All take an optional `title`.
- **Mockups open in your browser.** In the terminal each mockup document is saved as a self-contained
  `.html` file under your temp directory and shown as an **Open in browser ↗** link (where the terminal
  supports links) plus its path. Workspace-relative images and fonts resolve against the session's
  directory; scripts and remote resources are blocked by the file's Content-Security-Policy. Expand the
  result to see the HTML source.
- **Terminal rendering.** Flowcharts, state, sequence, class and ER diagrams, pies, mindmaps,
  timelines and git graphs are drawn as Unicode box-drawing right in the pi TUI, in your pi theme's
  colours (via [`lovely-mermaid`](https://github.com/xl0/lovely-mermaid), the same engine family pi uses
  for Mermaid in chat messages). When a diagram is wider than your terminal, could only be drawn in
  part, or is a family the renderer does not know (gantt, xychart, …), the tool shows the Mermaid
  source in a code fence instead — it never wraps a diagram. Expand the tool result to see the source
  under the drawing. Comparisons render as markdown.
- **Readable everywhere.** The tool's text result is markdown — a ```mermaid fence or a sectioned
  comparison — so it also reads fine in `pi -p`, JSON/RPC mode, or any host without a renderer.

## Validation — what the tool checks

The tool rejects empty sources and shape errors (a diagram without `mermaid`, a comparison without
`options`, a mockup without `html` or a full `before` + `after` pair, a mockup over 256 KB) with a
message that tells the model how to fix the call. A mockup that contains scripts, `on*` handlers, or
http(s) resources is accepted with a note telling the model those parts are dropped when rendered.

Mermaid syntax is checked **best-effort** with the renderer's own parser: for the families it can draw,
the tool rejects an unknown flowchart direction (`flowchart XX`), a source in which nothing parses, and
any fragment the parser had to drop (a dangling `A -->`, an unclosed `[label`, an unreadable line),
naming what was dropped. Diagrams too big for the terminal renderer (over 128 nodes) are not rejected —
they render as source. It does **not** run the real Mermaid parser: the grammar is lenient, so some
malformed input still passes, and `accTitle`/`accDescr` lines are rejected although Mermaid accepts
them. Other families (gantt, xychart, …) pass through unchecked and render as source. The source is
always one keypress away in the TUI, so nothing is hidden.

Hosts that render Mermaid themselves can plug in a strict validator:

```ts
import { createVisualizeExtension } from "@thinkrail/pi-visualize";

export default createVisualizeExtension({
  // Throw to reject; the message is returned to the model with the field location.
  validateMermaid: async (source) => { await mermaid.parse(source); },
});
```

The injected validator **replaces** the default check.

## Requirements

pi ≥ the version listed under `devDependencies` in this package's `package.json` (the pi SDK packages
are peer dependencies supplied by your pi install). Works under Node (vanilla pi) and Bun.

## License

Apache-2.0 — part of [ThinkRail](https://thinkrail.ai).
