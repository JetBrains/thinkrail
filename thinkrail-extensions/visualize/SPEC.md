---
id: module-ext-visualize
type: module-design
status: active
title: Visualize extension
parent: module-thinkrail-extensions
depends-on: [module-ui, module-extension-api, module-pi-visualize]
references: [submodule-web-chat, submodule-server-extensions]
---

## Responsibility

The ThinkRail halves of the `visualize` tool. `./server` composes the portable capability
([[module-pi-visualize]]) with the **strict** mermaid validator the browser renderer agrees with; `./web`
is the props-driven presentation. The tool name joins the two without a wire change.

## Boundary

Two entrypoints and no root barrel. `@thinkrail/ext-visualize/server` default-exports
`defineServerExtension({ name: "visualize", extensions: [createVisualizeExtension({ validateMermaid })] })`
— no children, no skill packages — and may import `extension-api/server`, `@thinkrail.ai/pi-visualize`,
`mermaid`, `linkedom`. `@thinkrail/ext-visualize/web` default-exports a `defineWebExtension` descriptor plus
named `MermaidView` for fenced mermaid in chat markdown, and consumes `extension-api/web`, per-file UI
primitives, contracts, React and Remix Icon. Neither half imports the other, app/host internals, or (web)
any pi package; the browser loads `mermaid` lazily inside the renderer, never in the eager entry chunk.

## Strict validation (server)

The validator is the one injected through the pi package's `validateMermaid` seam, which **replaces** the
package's best-effort `lovely-mermaid` probe; the package still owns shape checks, empty-source rejection,
source enumeration and the field-specific diagnostic. The guarantee is **syntax parsing by the exact
`mermaid` version the web renderer uses** (catalog-pinned), not SVG/layout success — the renderer keeps
its defensive fallback.

- `mermaid` needs browser globals while its parser initialises and DOMPurify needs a real `document`
  for flowchart/class/state/gantt/mindmap (verified under Bun), so `linkedom` is required, not optional:
  a lightweight DOM exists only during the lazy `import("mermaid")`, and the previous `window`/`document`
  descriptors are restored in `finally`.
- `mermaid.parse` calls are serialised through a promise tail stored on the mermaid instance (so every
  loaded copy of this module shares it) because mermaid resets shared configuration per parse.
- Invalid syntax surfaces as the package's `isError` tool result asking the model to correct and retry;
  the extension injects no prompt and forces no retry.

The host composes this descriptor from the server registry ([[submodule-server-extensions]]); a strict
validation call through that composition is pinned in `packages/server` (dev) and in the artifact probes
(CLI binary and desktop), so the vanilla probe can never be what runs in ThinkRail.

## Rendering contract (web)

Diagrams, comparison options and recommended choices preserve the existing chat presentation. The
registration is primary and expanded by default; its title or diagram/comparison summary is available
without rendering. Invalid or streaming arguments remain defensive and tool errors preserve readable
result text.

`MermaidView` derives mermaid's strict-mode theme from the host's CSS variables and re-renders after a
completed `data-theme` swap. It supports a caller-supplied loading fallback, a fullscreen Dialog, and
pan/zoom controls. The fullscreen canvas owns modifier-wheel zoom and WebKit gesture pinch from its
local gesture-start baseline so desktop page zoom does not claim the gesture. Renderer failure shows
the error and a plain source block matching the app CodeBlock's unhighlighted branch; it never imports
the app's shiki highlighter. `args` and pan/zoom math retain focused unit coverage.
