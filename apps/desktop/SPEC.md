---
id: module-desktop
type: module-design
status: draft
title: Desktop launcher/client (Electrobun)
parent: architecture
depends-on: [module-server, module-contracts]
tags: [desktop, deferred]
references: [submodule-web-navigation]
---

## Responsibility

A native Electrobun shell over the same web UI and wire. Its local-host profile embeds `createServer()`
in-process and opens a native window; a later shared-client profile can dial an existing ThinkRail host
without introducing a second UI or engine architecture. The sibling of `apps/cli`.

## Status

Deferred. Not built in early V1 — the CLI host is the V1 entrypoint. This reserves local-host and
shared-client profiles over the same server, contracts, web bundle, and navigation model.

## Boundary

- **Owns:** Electrobun lifecycle; local `createServer()` startup; shared-endpoint profile selection; loading the built web artifact; per-window route persistence; native deep-link handoff.
- **Public surface:** the packaged desktop application.
- **Allowed deps:** `server` in local-host mode; `contracts` for compatibility/native bridge types; the built web artifact; Electrobun.
- **Forbidden:** reimplementing agent/domain logic, introducing a desktop-only wire or UI state model, or storing one active location on the backend.

## Get right (when built)

- The local server is embedded, not spawned (same Bun event loop).
- `port:0` → derive the webview URL from the actual origin (`/ws` + `inferUrl`); never persist yesterday's loopback port.
- Persist the web module's backend-relative route locally per `{ backendProfileId, windowId }`, outside webview cache, and append it only after resolving the selected profile/origin.
- Routes carry no credentials and never become one backend-owned active location shared by all clients.
- Browser fallback stays free: the standalone host serves the same `web/dist` with native hooks disabled.
