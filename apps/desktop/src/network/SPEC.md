---
id: submodule-desktop-network
type: submodule-design
status: active
title: Desktop HTTP proxy
parent: module-desktop
tags: [desktop, network, proxy]
---

## Responsibility

Own the desktop host's HTTP proxy preference end to end on the host side: read the bounded client
preference (mode plus an optional manual target), resolve the effective proxy (the manual target or the
operating system's proxy), and apply it to the process HTTP(S) proxy environment variables before the
update controller and the embedded server issue network requests. The web client only renders the
preference and forwards writes through the existing preference RPC; the host remains the single owner of
how a preference value becomes process environment.

## Boundary

- **Public surface:** `applyProxySettings` plus the pure resolver/validation helpers its tests need,
  exported only through `index.ts`.
- **Allowed deps:** Bun/Node; the platform system-proxy source (Windows registry through `bun:ffi`).
- **Forbidden:** web or server imports; renderer-selected update feed URLs; spawning processes;
  ownership of the preference store itself (desktop startup owns that).

## Decisions

- Modes are `system`, `manual`, and `none`. A missing preference resolves to `system`, matching the
  JetBrains IDE HTTP Proxy default.
- `system` reads the operating system proxy; when the OS reports none, the effective proxy is empty
  (same as `none`). `manual` uses the stored `host:port` verbatim. `none` clears the proxy variables.
- The effective proxy is applied through `process.env.HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` so both
  the Electrobun updater's Bun `fetch` and the in-process server observe it. This is process-wide by
  design, not per-request.
- System-proxy reading is Windows-only in this change
  (`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`); macOS and Linux resolve to
  empty until a later change.
