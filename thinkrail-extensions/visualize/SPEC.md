---
id: module-ext-visualize
type: module-design
status: draft
title: Visualize web extension
parent: module-thinkrail-extensions
depends-on: [module-ui, module-extension-api]
references: [submodule-web-chat]
---

## Responsibility

The props-driven presentation half of the `visualize` tool. The capability remains the host's existing
`pi-visualize` package; tool name joins the two halves without a wire change.

## Boundary

`@thinkrail/ext-visualize/web` is the only entrypoint: a default `defineWebExtension` descriptor and
named `MermaidView` for fenced mermaid in chat markdown. There is no root barrel or server entrypoint.
It consumes `extension-api/web`, per-file UI primitives, contracts, React and Remix Icon. It cannot
import app/host internals, pi packages, or a server half. The mermaid package stays dynamically loaded
inside the renderer, never pulled into the eager entry chunk.

## Rendering contract

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
