# RUNBOOK — build the ThinkRail mobile app on your iPhone (local, by link)

Goal: install the lightweight ThinkRail app on your iPhone from your Mac, and connect to the live sessions
running on your laptop — over your local Wi‑Fi, no cloud account.

The app (`apps/mobile`) is a thin "sessions" client over the shared `@thinkrail/remote-client`. The native
iOS project is generated on your Mac (not committed); everything else is in the repo.

## Prerequisites (on the Mac)
- Bun, Xcode (+ Command Line Tools), CocoaPods (`sudo gem install cocoapods` or `brew install cocoapods`).
- A free Apple ID is enough for a personal on-device install.
- iPhone connected by cable (trust the Mac) **and on the same Wi‑Fi as the laptop host**.

## 1. Build the web bundle
```bash
bun install
bun run --filter @thinkrail/mobile build      # → apps/mobile/dist
```

## 2. Generate + sync the iOS project
```bash
cd apps/mobile
bunx cap add ios          # creates apps/mobile/ios (one time)
bunx cap sync ios         # copies dist/ into the native shell
```
Register the URL scheme so scanned/opened links reach the app: in `ios/App/App/Info.plist` add a URL type
with scheme `thinkrail` (or just paste the link into the app's field — step 5).

## 3. Open in Xcode and run on the iPhone
```bash
bunx cap open ios
```
In Xcode: select the `App` target → **Signing & Capabilities** → pick your Apple ID team → select your
iPhone as the run destination → **Run** (▶). The app installs on the phone. (First run: on the iPhone,
Settings → General → VPN & Device Management → trust your developer certificate.)

## 4. Start the relay + host on the laptop
Find the laptop's LAN IP (`ipconfig getifaddr en0`), then:
```bash
# signaling relay (bind to LAN)
PORT=24243 HOST=0.0.0.0 bun packages/relay/src/main.ts

# the host with remote access (prints a pairing link)
bun run apps/cli/src/index.ts --remote --relay ws://<LAN-IP>:24243
#   installed build:  thinkrail --remote --relay ws://<LAN-IP>:24243
```
Copy the printed `thinkrail://pair?…` link. On the same Wi‑Fi the WebRTC connection is direct — **coturn is
not needed**. (coturn only matters on networks that block peer-to-peer, e.g. guest Wi‑Fi isolation.)

## 5. Pair on the phone
In the app: paste the link → **Add host**. The host's sessions appear in the list; tap one to see its live
activity and send a message. Add your server the same way (run the relay+host there too, paste its link).
The app remembers paired hosts and auto-reconnects (via `resume`) on reopen / network flaps.

## Scope / caveats (lightweight by design)
- Shows and drives **sessions** only — no file tree, diffs, terminals, or settings.
- The session screen currently shows an activity log + send; richer transcript, a full tool-approval UI, and
  push notifications are follow-ups (push needs a content-less "wake" from the relay — it is zero-knowledge).
- Nothing here has been run end-to-end yet; this runbook is the first real on-device test.
