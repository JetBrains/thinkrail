# RUNBOOK — build the ThinkRail mobile app on your iPhone (local, by link)

Goal: install the lightweight ThinkRail app on your iPhone from your Mac, and connect to the live sessions
running on your laptop — over your local Wi‑Fi, no cloud account.

The app (`apps/mobile`) is a thin "sessions" client over the shared `@thinkrail/remote-client`. The native
iOS project is generated on your Mac (not committed); everything else is in the repo.

## Prerequisites (on the Mac)
- Bun and the full Xcode app (not just Command Line Tools): install it, open it once, then
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. CocoaPods is not needed — Capacitor 8
  wires plugins through Swift Package Manager.
- A free Apple ID is enough for a personal on-device install.
- iPhone connected by cable (trust the Mac) **and on the same Wi‑Fi as the laptop host**. Enable
  Settings → Privacy & Security → **Developer Mode** (the toggle appears after Xcode has seen the phone once).

## 1. Build + sync the iOS project (one command)
```bash
bun install
bun run mobile:ios          # build dist/ → create ios/ if missing → patch Info.plist → cap sync → open Xcode
```
`ios/` is generated and git-ignored. `apps/mobile/scripts/ios-setup.ts` creates it on first run and
idempotently registers the `thinkrail://` URL scheme (so a scanned QR opens the app) and the Local Network
usage description (without it the phone cannot reach the laptop) and the Camera usage description (for the
in-app QR scan). After a UI change, re-run
`bun run mobile:ios` (or `bun run --cwd apps/mobile ios:sync` and press ▶ in Xcode again).

## 2. Run on the iPhone from Xcode
In Xcode: select the `App` target → **Signing & Capabilities** → pick your Apple ID team → select your
iPhone as the run destination → **Run** (▶). The app installs on the phone. (First run: on the iPhone,
Settings → General → VPN & Device Management → trust your developer certificate.) If the bundle id
`ai.thinkrail.mobile` is taken for your team, change it to a unique one in the target settings. A free Apple
ID signature expires after 7 days — just Run from Xcode again. 

## 3. Start the relay + host on the laptop
Find the laptop's LAN IP (`ipconfig getifaddr en0`), then:
```bash
# signaling relay (bind to LAN)
PORT=24243 HOST=0.0.0.0 bun packages/relay/src/main.ts

# the host with remote access (prints a pairing link)
bun run apps/cli/src/index.ts --remote --relay ws://<LAN-IP>:24243
#   installed build:  thinkrail --remote --relay ws://<LAN-IP>:24243
```
The CLI prints both the `thinkrail://pair?…` link **and a scannable QR** in the terminal. On the same Wi‑Fi
the WebRTC connection is direct — **coturn is not needed**. (coturn only matters on networks that block
peer-to-peer, e.g. guest Wi‑Fi isolation.)

## 4. Pair on the phone
First launch shows the **welcome screen**. Tap **Scan QR code** and point the phone at the terminal QR (or scan it with the
iPhone Camera — the `thinkrail://` link opens the app and pairs automatically), or paste the link and tap
**Connect**. The host's
projects appear (**Add computer** pairs another one); tap a project, then a workspace, then a chat to **pick up the ongoing conversation** — a session you started on the
laptop loads on the phone and keeps streaming — and send a message to continue it. Add your server the same
way (run the relay+host there too, paste its link).
The app remembers paired hosts and auto-reconnects (via `resume`) on reopen / network flaps.

## Scope / caveats (lightweight by design)
- Shows and drives **sessions** only — no file tree, diffs, terminals, or settings.
- The session screen loads the conversation (via `session.getMessages`) and refreshes as it streams, so the
  phone picks up a laptop-started session; a richer transcript renderer, a full tool-approval UI, and push
  notifications are follow-ups (push needs a content-less "wake" from the relay — it is zero-knowledge).
- Nothing here has been run end-to-end yet; this runbook is the first real on-device test.
