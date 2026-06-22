---
id: module-desktop
type: module-design
status: draft
title: Desktop host launcher (Electrobun)
parent: architecture
depends-on: [module-server, module-contracts]
tags: [desktop, deferred]
---

## Responsibility

A native desktop launcher (Electrobun, OS webview). Embeds the same `createServer()` in-process and opens
a native window instead of a browser. The sibling of `apps/cli`.

## Status

Deferred. Not built in early V1 — the CLI host is the V1 entrypoint. This spec exists to keep the module
graph complete and to reserve the seam: because both launchers embed the same host library, adding the
desktop shell is a launcher swap, not an architecture change.

## Get right (when built)

- Server is embedded, not spawned (same Bun event loop).
- `port:0` → derive the webview URL from the actual origin (`/ws` + `inferUrl`).
- Browser fallback stays free: the standalone host serves the same `web/dist` with native hooks disabled.
