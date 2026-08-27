---
id: submodule-website-vibecoding
type: submodule-design
status: active
title: Vibecoding landing experience
parent: module-website
tags: [website, marketing, vibecoding, react]
---

## Responsibility

The audience-specific experience directly served at `https://thinkrail.ai/vibecoding/`: its header navigation, hero and quick start, platform/shell install controls, scripted chat, principles and capabilities, orchestration animation, workflow explanations, call to action, metadata, and route-local presentation. It preserves the approved visual design while the parent website owns route composition, analytics, SEO aggregation, deployment, and cross-route validation.

`index.ts` is the only public surface. The route receives crawlable server-rendered content, then hydrates one React island for stateful interactions.

## Boundary

- May depend on React and Lucide plus its own Tailwind entry stylesheet and checked-in assets under `public/vibecoding/`. It has no workspace dependency.
- Must not import the parent IDE-shell components or hand-written stylesheet, blog modules, analytics, Astro page composition, package-wide build validation, deployment configuration, another workspace, or a copied UI kit.
- Tailwind uses `source(none)` and scans this module only. Its preflight, fonts, tokens, utilities, and animations are emitted only in the stylesheet referenced by `/vibecoding/`; the parent landing and blog must never reference that stylesheet or the React renderer/component chunks.
- Install commands are one typed model shared by both picker instances. macOS/Linux/WSL use `install.sh`; PowerShell uses `install.ps1`; Command Prompt explicitly launches PowerShell.
- The initial HTML contains the complete marketing message. JavaScript enhances controls and animation rather than making content discoverable.
- Every control is keyboard-operable. Motion-heavy effects resolve to a stable final state under `prefers-reduced-motion`; canvas animation pauses when reduced motion is requested or the document is hidden.
- Components use local Tailwind utilities mapped to this module's semantic tokens. They do not carry raw colour literals or inline style objects; runtime geometry uses DOM/SVG attributes or stylesheet-owned custom properties.
