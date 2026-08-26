---
id: submodule-vibecoding-analytics
type: submodule-design
status: active
title: Vibecoding website analytics
parent: module-vibecoding-website
tags: [website, analytics, privacy]
---

## Responsibility

Production-only loading of the existing Google Tag Manager container for `vibecoding.thinkrail.ai`. `index.ts` exposes a pure hostname configuration function and the initializer used by the page shell.

GTM remains the control plane for the current Cookiebot consent behavior and downstream Google Analytics, Google Ads, and Bing tags. The source owns only the container loader and its production gate; it does not duplicate container-managed tag configuration.

## Boundary

- The exact hostname `vibecoding.thinkrail.ai` is the only enabled environment. Localhost, IPs, branch deployments, and `pages.dev` previews inject no marketing script and send no event.
- Loading is a typed progressive enhancement, not a pasted minified bootstrap. The static GTM `noscript` iframe is deliberately absent because static markup cannot honor the hostname gate or consent state.
- The module may access browser DOM APIs but never imports landing components or another workspace.
- Tests pin the production gate, container identity, script URL, and disabled-host behavior.
