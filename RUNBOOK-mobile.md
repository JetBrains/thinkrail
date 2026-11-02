# RUNBOOK — build the ThinkRail mobile app on your iPhone or Android phone (local, by link)

Goal: install the lightweight ThinkRail app on your phone from your Mac, and connect to the live sessions
running on your laptop — over your local Wi‑Fi, no cloud account.

The app (`apps/mobile`) is a thin "sessions" client over the shared `@thinkrail/remote-client`. The native
iOS and Android projects are generated on your Mac (not committed); everything else is in the repo.
Sections 1–2 are iPhone, 2a is Android; 3–4 are the same for both.

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

## 2a. Android instead: build and run from Android Studio
Install Android Studio (`brew install --cask android-studio`), open it once and finish the setup wizard (it
brings the JDK and the Android SDK). On the phone: Settings → About phone → tap **Build number** seven
times, then Developer options → **USB debugging**; connect it by cable and allow the Mac.
```bash
bun install
bun run mobile:android      # build dist/ → create android/ if missing → patch the manifest → cap sync → open Android Studio
```
`android/` is generated and git-ignored. `apps/mobile/scripts/android-setup.ts` creates it on first run and
idempotently registers the `thinkrail://` link, allows cleartext traffic (the LAN relay is plain `ws://`,
which Android blocks by default), adds the camera permission and installs the launcher icons. In Android
Studio wait for the Gradle sync, pick your phone and press **Run** (▶). No developer account is needed and the
install does not expire. After a UI change: `bun run --cwd apps/mobile android:sync`, then ▶ again.

## 3. Start the host with remote access on the laptop
```bash
bun run apps/cli/src/index.ts --remote
#   installed build:  thinkrail --remote
```
`--remote` runs its own signaling relay (port 24243) — nothing else to start, nothing deployed. It prints the
addresses a phone can reach it at — this computer's **Wi‑Fi/LAN** IP and, when Tailscale is running, its
**Tailscale** IP — then a `thinkrail://pair?…` link and a scannable QR carrying all of them plus the computer's
name. The code is single-use and expires after a few minutes — press **Enter** in that terminal for a fresh one.

- **Same Wi‑Fi:** the phone uses the LAN address; the WebRTC connection is direct.
- **Away from home:** install [Tailscale](https://tailscale.com) on the laptop and the phone, sign both into the
  same tailnet and keep it on; the phone reaches the Tailscale address from any network.
- An external relay still works: `--relay ws://<host>:<port>` (or `THINKRAIL_RELAY_URL`) skips the built-in one.
- If 24243 is taken (e.g. an old standalone relay still running), the built-in relay picks a free port; stop
  the other one so the port — and the addresses a paired phone saved — stay the same across restarts.

## 4. Pair on the phone
First launch shows the **welcome screen**. Tap **Scan QR code** and point the phone at the terminal QR (or scan it with the
phone camera — the `thinkrail://` link opens the app and pairs automatically), or paste the link and tap
**Connect**. The host's
projects appear (Settings → **Computers** pairs another one, and shows whether each computer is reachable, with
**Reconnect** and **Forget**); tap a project to expand its workspaces, then a workspace
to **pick up the ongoing conversation** — a session you started on the
laptop loads on the phone and keeps streaming — and send a message to continue it. Add your server the same
way (run the relay+host there too, paste its link).
The app remembers paired hosts and auto-reconnects (via `resume`) on reopen / network flaps.

## Scope / caveats (lightweight by design)
- Shows and drives **sessions** only — no file tree, diffs, terminals, or settings.
- The session screen loads the conversation (via `session.getMessages`) and refreshes as it streams, so the
  phone picks up a laptop-started session; a richer transcript renderer, a full tool-approval UI, and push
  notifications are follow-ups (push needs a content-less "wake" from the relay — it is zero-knowledge).
