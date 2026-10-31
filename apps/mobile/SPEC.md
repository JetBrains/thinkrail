---
id: app-mobile
type: app-design
status: active
parent: architecture
depends-on: [module-contracts, module-remote-client]
title: Mobile app (lightweight remote sessions)
---

## Responsibility

A lightweight Capacitor (iOS/Android/web) client that pulls **live sessions from one or more hosts** (a
laptop, a server) onto a phone and lets you drive them — a thin viewer/controller, **not** the full ThinkRail
IDE. No file tree, diffs, terminals, layout, or settings. No cloud account: the device pairs each host by its
`thinkrail://pair` link and remembers it locally.

## Boundary

- **Owns:** a small React/Vite UI (`src/App.tsx` — host list, add-by-link, aggregated session list, and a
  session screen that **picks up an ongoing session**: it loads the conversation via `session.getMessages`,
  refreshes it as the session streams, and sends via `session.followUp` — so a session started on the laptop
  can be continued on the phone), the Capacitor config, and a `localStorage` `KeyValueStore` (`src/store.ts`;
  the Capacitor WKWebView persists it on-device).
- **Allowed deps:** `@thinkrail/remote-client` (the entire remote engine — connector, wire client, host
  registry, multi-host session controller), `@thinkrail/contracts` (protocol + session types), React, Vite,
  Capacitor, platform APIs. Never `server`, `pi`, or `web`.
- **Forbidden:** importing `apps/web`, `server`, or `pi`; reimplementing the remote protocol (it lives in
  `remote-client`).

## Build & run

Native iOS/Android builds need a dev machine with Xcode / Android SDK — see `RUNBOOK-mobile.md`. The web
sources here are workspace-typechecked; the native project (`ios/`) is generated on the build machine via
`cap add ios` and is not committed.

## Not yet here

- Rich transcript rendering (today the session screen loads `session.getMessages` and renders a plain-text
  transcript that refreshes as the session streams; the full renderer from `apps/web/chat` can be reused
  later), a proper tool-approval UI, and push notifications (a content-less "wake" push would need a relay
  feature, since the relay is zero-knowledge).
