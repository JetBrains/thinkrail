---
id: submodule-server-proxy
type: submodule-design
status: active
title: Host HTTP proxy application
parent: module-server
depends-on: [module-contracts]
tags: [host, network, proxy]
---

## Responsibility

Own the host-side application of the shared `proxy` config to the process HTTP(S) proxy environment
variables. The server resolves an explicit proxy config (`system` / `manual` / `none`) into effective
HTTP/HTTPS targets plus a bypass list, then writes or clears both casing variants of
`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY`. An absent config leaves the environment untouched, so
launch/Environment variables survive.

## Boundary

- **Public surface:** `applyProxyConfig`, `normalizeManualProxy`, `resolveProxy`, and the
  `SystemProxyResolver` type, exported only through `index.ts`.
- **Allowed deps:** `@thinkrail/contracts` (the `ProxyConfig` / `ProxyMode` / `SystemProxyInfo` types).
- **Forbidden:** platform-specific system-proxy reading (the launcher injects a resolver); web or
  desktop imports.

## Decisions

- The effective proxy is applied through `process.env` so the in-process server and the desktop
  updater's Bun `fetch` both observe it; this is process-wide by design.
- Both uppercase and lowercase variable names are replaced or cleared, matching Bun 1.4.4's
  lowercase-first lookup.
- `manual` targets are validated as `host:port` directly (not through `URL.port`, which drops default
  ports); `system` is resolved by the injected resolver; `none` clears everything.
