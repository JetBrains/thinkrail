---
id: app-mobile
type: app-design
status: active
parent: architecture
depends-on: [submodule-web-phone, module-design-tokens]
title: Mobile app (Capacitor wrapper of the phone shell)
---

## Responsibility

The native iOS/Android wrapper of the web client's phone shell ([[submodule-web-phone]]). It owns no UI and no
TypeScript that ships in the web view: `capacitor.config.ts` points the native shell at `apps/web`'s
`dist-phone/` build, and the setup scripts write the native configuration Capacitor cannot express.

## Boundary

- **Owns:** `capacitor.config.ts` (app id and name, `webDir: ../web/dist-phone`, the Dark palette's
  `background` read from the manifest so first paint matches, `ios.contentInset: never` and
  `ios.scrollEnabled: false` so only a screen's own list scrolls, `Keyboard.resize: native` so the keyboard
  resizes the web view rather than scrolling the page under it, and `server.androidScheme: http`);
  `scripts/ios-setup.ts`, `scripts/android-setup.ts`; the native plugin set in `package.json` (`@capacitor/app`,
  `@capacitor/barcode-scanner`, `@capacitor/keyboard`, pinned once in the root catalog with the web shell that
  imports their JavaScript).
- **Allowed deps:** `@thinkrail/design-tokens` (the theme manifest for the native background), Capacitor.
- **Forbidden:** UI or app logic of its own; importing any other workspace package from shipped code.

## Build & run

`bun run mobile:ios` (root) builds the phone shell (`bun run --cwd apps/web build:phone`), runs
`scripts/ios-setup.ts` (creates `ios/` with `cap add ios` when missing, then idempotently registers the
`thinkrail` URL scheme and the Local Network and Camera usage descriptions in `Info.plist`, and installs the app
icon — `packages/shared/assets/icon-ios.png`, the full-bleed iOS render of the one ThinkRail icon source, so the
phone and desktop icons cannot drift), syncs, and opens Xcode. `ios/` is generated per machine and git-ignored,
so the setup script is the only place native configuration is written.

`bun run mobile:android` is the same for Android: `scripts/android-setup.ts` creates `android/` with
`cap add android`, then idempotently adds the `thinkrail` deep-link intent filter, `usesCleartextTraffic`
(the LAN relay is plain `ws://`; Android 9+ blocks cleartext by default) and the camera permission to
`AndroidManifest.xml`, copies the launcher icons from `packages/shared/assets/android`, syncs, and opens
Android Studio. The WebView is served from `http://localhost` (`server.androidScheme`), not the default
`https`, because an https page may not open a `ws://` relay (mixed content); localhost stays a secure
context, so SubtleCrypto still works. The hardware back button first closes an open sheet or page, then pops
the stack, and only backgrounds the app from a tab root. `android/` is git-ignored like `ios/`. See
`RUNBOOK-mobile.md` for signing and on-device steps.

The same shell runs in a desktop browser for development (`bun run --cwd apps/web dev`, then `/phone.html`);
Capacitor's web fallbacks stand in for the native scanner and app events there.
