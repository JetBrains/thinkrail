---
id: app-mobile
type: app-design
status: active
parent: architecture
depends-on: [module-contracts, module-remote-client, module-design-tokens, module-locales, module-ui]
title: Mobile app (lightweight remote sessions)
---

## Responsibility

A lightweight Capacitor (iOS/Android/web) client that pulls **live sessions from one or more hosts** (a
laptop, a server) onto a phone and lets you drive them — a thin viewer/controller, **not** the full ThinkRail
IDE. No file tree, diffs, terminals, layout, or settings. No cloud account: the device pairs each host by its
`thinkrail://pair` link and remembers it locally.

## Boundary

- **Owns:** a small React/Vite UI — `App.tsx` (pairing, host reconnect, screen routing, deep links via
  `@capacitor/app` `appUrlOpen` + `getLaunchUrl`, which pair automatically), `Welcome.tsx` (first run, no
  paired host), `SessionList.tsx` (aggregated sessions + per-host "unreachable" notice + add-computer form),
  `scanPairLink.ts` (the in-app QR scan via `@capacitor/barcode-scanner`; cancel is silent, a non-pairing QR
  or denied camera is reported), `SessionScreen.tsx` (picks up an ongoing session: loads `session.getMessages`, refreshes it as the session
  streams, sends via `session.followUp`), `PairForm.tsx`, `transcript.ts` (best-effort plain-text lines),
  `theme.ts`, the Capacitor config, `scripts/ios-setup.ts`, and a `localStorage` `KeyValueStore`
  (`store.ts`; the Capacitor WKWebView persists it on-device).
- **Allowed deps:** `@thinkrail/remote-client` (the entire remote engine), `@thinkrail/contracts`,
  `@thinkrail/design-tokens` (palettes, semantic CSS, `applyPalette`), `@thinkrail/locales/react`,
  `@thinkrail/ui` primitives, Remix Icon, `@capacitor/barcode-scanner`, React, Vite, Tailwind v4, Capacitor, platform APIs. Never
  `server`, `pi`, `web`, or `shared`.
- **Forbidden:** importing `apps/web`, `server`, or `pi`; reimplementing the remote protocol (it lives in
  `remote-client`); a second colour, type, spacing or radius source.

## Look

The app speaks the same visual language as the IDE: `src/index.css` imports
`@thinkrail/design-tokens/styles.css`, so components name only semantic utilities (`bg-container-header-bg`,
`text-text-muted`, `tr-title-card`, `p-16`, `rounded-md`), never raw colours or Tailwind's stock palette.
The rules in `apps/web/src/styles/COLOR.md`, `SPACING.md` and `TYPOGRAPHY.md` apply. The app adds only
three mobile layout roles: `touch` (44px, the minimum tap target, `h-touch` / `min-h-touch`) and
`safe-top` / `safe-bottom` (the iOS safe-area insets). Text comes from `mobile.*` keys in
`packages/locales/en.json` (the i18n gate scans `apps/mobile/src`).

The theme follows the operating system: `theme.ts` applies the bundled **Dark** or **Light** manifest with
`applyPalette` and swaps on `prefers-color-scheme` changes. There is no theme picker — that is an IDE
setting. The native shell's background is the Dark palette's `background`, read from the manifest by
`capacitor.config.ts`, so first paint matches.

## Build & run

`bun run mobile:ios` (root) builds `dist/`, runs `scripts/ios-setup.ts` (creates `ios/` with
`cap add ios` when missing, then idempotently registers the `thinkrail` URL scheme and the Local Network
and Camera usage descriptions in `Info.plist`), syncs, and opens Xcode. `ios/` is generated per machine and
git-ignored, so the setup script is the only place native configuration is written. See
`RUNBOOK-mobile.md` for signing and on-device steps.

## Not yet here

- Rich transcript rendering (today: plain-text lines — user bubbles, assistant text, other roles muted;
  the full renderer from `apps/web/chat` can be reused later), a proper tool-approval UI, removing a paired
  host, and push notifications (a content-less "wake" push would need a relay feature, since the relay is
  zero-knowledge). The session screen does not re-attach if its host connects after the screen opened.
