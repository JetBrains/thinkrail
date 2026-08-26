---
id: submodule-vibecoding-landing
type: submodule-design
status: active
title: Vibecoding landing experience
parent: module-vibecoding-website
tags: [website, marketing, react]
---

## Responsibility

The server-rendered landing story and its browser enhancements: header navigation, hero and quick start, platform/shell install picker, scripted chat, product principles and capabilities, orchestration animation, workflow explanations, call to action, and footer. `index.ts` is the only public surface.

The design and interactions preserve the approved Lovable experience while the copy remains constrained by the product goal and architecture specs. Worktrees are isolation, not sandboxes; per-step model routing and autonomous durable memory are not presented as shipped behavior.

## Boundary

- May depend on React and Lucide plus this app's own stylesheet and checked-in assets.
- Must not import analytics, Astro page composition, deployment configuration, another workspace, or a generic copied UI kit.
- Install commands are one typed data model shared by both picker instances. macOS/Linux/WSL use `install.sh`; PowerShell uses `install.ps1`; Command Prompt explicitly launches PowerShell.
- The initial HTML contains the complete marketing content. JavaScript enhances controls and animations rather than making the page's message discoverable.
- Every control is keyboard-operable. Motion-heavy effects resolve to a stable final state under `prefers-reduced-motion`; canvas animation pauses when reduced motion is requested or the document is hidden.
- Styling uses local Tailwind utilities mapped to this app's semantic tokens. Components do not carry raw colour literals or inline style objects; runtime geometry is expressed through DOM/SVG attributes or stylesheet-owned custom properties.
