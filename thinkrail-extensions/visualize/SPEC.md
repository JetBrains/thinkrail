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
`defineServerExtension({ name: "visualize", title, description, extensions: [createVisualizeExtension({ validateMermaid })] })`
— no children, no skill packages — and may import `extension-api/server`, `@thinkrail/pi-visualize`,
`mermaid`, `linkedom`. `@thinkrail/ext-visualize/web` default-exports a `defineWebExtension` descriptor plus
named `MermaidView` and `MockupView` (with the `MockupViewport` type) for fenced mermaid and
mockup blocks in chat markdown, and consumes `extension-api/web`, per-file UI primitives (including
`html-frame`), contracts, React and Remix Icon. Neither half imports the other, app/host internals, or (web)
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
registration is primary and expanded by default; its title or diagram/comparison/mockup summary is available
without rendering. Invalid or streaming arguments remain defensive and tool errors preserve readable
result text.

`MermaidView` derives mermaid's strict-mode theme from the host's CSS variables and re-renders after a
completed `data-theme` swap. It supports a caller-supplied loading fallback, a fullscreen Dialog, and
pan/zoom controls. The fullscreen canvas owns modifier-wheel zoom and WebKit gesture pinch from its
local gesture-start baseline so desktop page zoom does not claim the gesture. Renderer failure shows
the error and a plain source block matching the app CodeBlock's unhighlighted branch; it never imports
the app's shiki highlighter. `args` and pan/zoom math retain focused unit coverage.

### Mockups

`MockupView` is the one renderer for every mockup surface — the `type: "mockup"` card (`MockupCard`),
comparison options carrying `html`, and the app's ```` ```mockup ```` fence — over one or two
documents (a pair is Before | After).

- **Sandbox.** Documents go through `@thinkrail/ui/html-frame` with form controls kept (inert: no
  scripts, no form action, `autofocus` stripped) into its measured frame (`allow-same-origin`, never
  `allow-scripts`). Same-origin is what lets the card read the content height and auto-fit; no
  postMessage or script runs inside.
- **Geometry.** The frame lays out at the viewport width (1280 / 768 / 390, default from `viewport`,
  switchable) and is scaled to fit the container, never up; height is the measured content clamped to
  120–4000 px, the inline card capping at 640 px with its own scroll. Values travel as `--mockup-*` CSS
  custom properties (the renderer-measured geometry exception).
- **Before/after.** Inline is one full-width frame with a Before | After switch, defaulting to After
  (the proposal is what the user decides on). Fullscreen shows both side by side when its body measures
  ≥ 1024 px, else the switch — measured width, not a media query, so a narrow window or panel behaves
  the same. The dialog focuses its own content on open, so Escape closes it instead of a tooltip.
  Comparison options with mockups stack in one column so each mockup keeps a readable scale.
- **Workspace assets (live).** Relative `src`, `srcset`, `poster`, SVG `<image href>`, and CSS `url()`
  (attribute and `<style>`) references are collected, normalized inside the workspace root (`..` past
  the root, absolute paths and URL schemes refused), resolved through the host-supplied
  `resolveAsset` from `ToolRenderProps` (or the fence's context), and rewritten only to `data:` URLs —
  so the frame's CSP never widens and a later file change shows in old mockups (accepted). Without a
  resolver, relative assets are stripped like any non-`data:` URL.
- Streaming or incomplete arguments show a placeholder; the Source toggle shows the raw HTML, wrapped
  (agent HTML is often one long line). A mockup never widens its container: `MockupView` and the
  comparison option cards are `min-w-0` — as grid/flex items they would otherwise size to the
  source's min-content width (post-mortem: a one-line document stretched an option card to ~5,500 px
  and pushed the transcript sideways).
