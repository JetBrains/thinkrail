---
id: submodule-desktop-network
type: submodule-design
status: active
title: Desktop system proxy resolver
parent: module-desktop
tags: [desktop, network, proxy]
---

## Responsibility

Own the desktop-only system-proxy resolver that the host injects into the server: read the operating
system's proxy configuration and return separate HTTP/HTTPS targets plus a bypass list. Windows reads
`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
(`ProxyEnable`/`ProxyServer`/`ProxyOverride`) through `bun:ffi`; other platforms report none until a
later change.

## Boundary

- **Public surface:** `readSystemProxy` and `proxyInfoFromSettings`, exported only through `index.ts`.
- **Allowed deps:** Bun/Node; `@thinkrail/contracts` for the `SystemProxyInfo` shape.
- **Forbidden:** proxy application (owned by the server proxy module); web or server imports; spawning
  processes.

## Decisions

- A bare `host:port` in `ProxyServer` serves both protocols; `http=`/`https=` selectors resolve
  independently; `socks=` is ignored (Bun's HTTP proxy variables do not carry a SOCKS transport).
- The loopback interface (`localhost`, `127.0.0.1`) is always bypassed, and `ProxyOverride` entries are
  carried through as `NO_PROXY`; `<local>` is covered by the loopback default.
