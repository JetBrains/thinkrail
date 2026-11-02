---
id: app-mobile
type: app-design
status: active
parent: architecture
depends-on: [module-chat-ui, module-contracts, module-remote-client, module-design-tokens, module-locales, module-ui]
title: Mobile app (lightweight remote sessions)
---

## Responsibility

A lightweight Capacitor (iOS/Android/web) client that pulls **live sessions from one or more hosts** (a
laptop, a server) onto a phone and lets you drive them — a thin viewer/controller, **not** the full ThinkRail
IDE. No file tree, diffs, terminals, layout, or settings. No cloud account: the device pairs each host by its
`thinkrail://pair` link and remembers it locally.

**Reaching a computer (no server deployed).** `thinkrail --remote` runs its own relay and its link lists the
computer's Wi‑Fi/LAN and Tailscale addresses plus its name, so the phone connects on the same Wi‑Fi, or from
anywhere when Tailscale is on for both; the connector races the addresses on every (re)connect. Pairing stays
host-authorized: the QR's one-time token, then the device key. `hostStatus.ts` turns a failed connect into
`network` (no address answered — `RelayUnreachableError` — shown as "use the same Wi‑Fi or turn on
Tailscale") or the host's own error. The tree shows an unreachable computer as a banner with **Reconnect**;
Settings → Computers lists each paired computer by name with Connected / Connecting… / the failure, plus
**Reconnect** and **Forget** (confirmed; it disconnects and drops the computer, so reconnecting needs a new
QR). Welcome's first step says which network to use.

## Boundary

- **Owns:** a small React/Vite UI — `App.tsx` (pairing, host reconnect, the drill-down route, deep links via
  `@capacitor/app` `appUrlOpen` + `getLaunchUrl`, which pair automatically), `Welcome.tsx` (first run, no
  paired host), `ProjectsScreen.tsx` — the IDE project tree on a phone, drawn with the shared
  `@thinkrail/ui/project-tree` glyphs and labels: each host's open projects (`project.list`) expand in place
  into their **live** workspaces (`workspace.list`, split by contracts' `partitionWorkspaces` with the host's
  `settleIdleDays` from its welcome — the Settled shelf is not shown on the phone), Default first, branch as
  the second line; the expanded set lives in `App` so returning from a chat keeps the tree; per-host
  "unreachable" notice with its reason; the header's gear opens the settings screen, where computers are
  added; a tapped workspace opens `WorkspaceScreen.tsx`
  (its chats from `session.list`, titled by contracts' `chatTitle`, aged by `compactAgeOf`: **Open** — the
  ones the host holds `live` — then **Recent**, the closed history, each newest first; tapping a closed one
  reopens it, because `session.getMessages` attaches a disk session the same way the IDE reopens a chat; the
  header's **+** starts one with `session.create`. A workspace whose only chat is live opens it directly, and
  a chat that is or becomes the workspace's only one backs out to the tree, since the list would reopen it); and `SessionScreen.tsx`, the IDE's chat on a phone: it renders the
  [[module-chat-ui]] components unchanged (`messagesToRuntime` → `deriveRows` → `ChatTurnView` for the
  transcript, the shared `Composer` with its slash commands from `session.getCommands`, the model/effort
  picker over `model.list` → `session.setModel` / `session.setThinkingLevel`, send / steer / follow-up /
  interrupt through the same `session.*` methods as the IDE, tool-card answers through
  `session.respondToTool`). It re-reads `session.getMessages` (coalesced 400ms) on the session's pi events
  rather than reducing the event stream; `main.tsx` registers the built-in tool cards and mounts the
  `TooltipProvider` the composer needs;
  `layout.tsx` (`Screen` frame, `ListRow`, loading/failed/empty states — a screen waits on `Loader`, the shared `RunningIcon` R mark at 56px over a caption: "Connecting to …" until a host's channel is up, then "Loading…"; a project expanding in the tree waits on an inline 14px one), `status.ts` (row marks from
  contracts' `sessionAttention`: the shared `RunningIcon` replaces the row glyph while a session in scope
  runs, the shared `AttentionDot` shows while one needs input or has an unread result — the IDE tree's
  vocabulary), `useHostRequest.ts` (one wire read per screen), `scanPairLink.ts` (the in-app QR scan via
  `@capacitor/barcode-scanner`; cancel is silent, a non-pairing QR or denied camera is reported),
  `PairForm.tsx`, `theme.ts`, the Capacitor config,
  `scripts/ios-setup.ts`, `scripts/android-setup.ts`, and a `localStorage` `KeyValueStore` (`store.ts`; the Capacitor WKWebView persists
  it on-device). Live status comes from the controller's `session.state` stream; lists are read on screen
  entry, and a workspace's chats re-read when a session appears or leaves in it.
- **Allowed deps:** `@thinkrail/remote-client` (the entire remote engine), `@thinkrail/chat-ui` (the chat
  renderers and composer — never a copy of them), `@thinkrail/contracts`,
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
four mobile layout roles: `touch` (44px, the minimum tap target, `h-touch` / `min-h-touch`),
`safe-top` / `safe-bottom` (the iOS safe-area insets), and `chat-gutter` (16px, the role
[[module-chat-ui]] asks every host to define). Text comes from `mobile.*` keys in
`packages/locales/en.json` (the i18n gate scans `apps/mobile/src`).

Screen headers follow iOS: a sub-screen shows an icon-only back arrow (its destination is the arrow's
accessible label, not visible text) with the title centered; the top level shows the large left title.

`SettingsScreen.tsx` opens with the brand card, then **Computers**: the paired hosts and `PairForm.tsx`'s
`PairActions` — grouped **Scan QR code** / **Enter link manually** rows (the latter opens the paste field),
the same `usePairing` flow `Welcome`'s first-run `PairForm` uses. Then the phone's own settings: the IDE Settings rows that apply to a device, rendered
with the shared `@thinkrail/ui/settings` primitives and the IDE's strings — **Theme mode**
(System / Light / Dark), **Contrast level** (Default / High) and **Language** (System or a bundled locale,
named by `languageName`). They are device preferences (`preferences.ts`, one JSON entry in the
`localStorage` store), never written to a host: a phone can pair several computers, and the IDE's own
choice belongs to the IDE. `theme.ts`'s `applyDevicePreferences` applies them before paint (a layout
effect in `App`) — the bundled `dark` / `light` / `high-contrast-*` manifest via `applyPalette`, following
`prefers-color-scheme` while System, and the locale via `resolveLocale` + `applyLocale`, following
`languagechange` while System. Custom themes, theme pairs and local locale files are host-folder features
and stay in the IDE.

**Type scale.** `index.css` re-points the shared primitive font sizes (`--tr-font-size-s10`…`s24`) to a touch
scale — the IDE's 14px UI text becomes 17px (iOS body), its 12px metadata 15px, every other step up in
proportion — so every semantic `tr-*` style, including the shared chat, tree and settings components,
grows together without forking a class; the tree's glyphs take 18px to match. The IDE's desktop density
stays as is.

The native shell's background is the Dark palette's `background`, read from the manifest by
`capacitor.config.ts`, so first paint matches.

## Build & run

`bun run mobile:ios` (root) builds `dist/`, runs `scripts/ios-setup.ts` (creates `ios/` with
`cap add ios` when missing, then idempotently registers the `thinkrail` URL scheme and the Local Network
and Camera usage descriptions in `Info.plist`, and installs the app icon — `packages/shared/assets/icon-ios.png`,
the full-bleed iOS render of the one ThinkRail icon source, so the phone and desktop icons cannot drift), syncs, and opens Xcode. `ios/` is generated per machine and
git-ignored, so the setup script is the only place native configuration is written.

`bun run mobile:android` is the same for Android: `scripts/android-setup.ts` creates `android/` with
`cap add android`, then idempotently adds the `thinkrail` deep-link intent filter, `usesCleartextTraffic`
(the LAN relay is plain `ws://`; Android 9+ blocks cleartext by default) and the camera permission to
`AndroidManifest.xml`, copies the launcher icons from `packages/shared/assets/android`, syncs, and opens
Android Studio. The WebView is served from `http://localhost` (`server.androidScheme`), not the default
`https`, because an https page may not open a `ws://` relay (mixed content); localhost stays a secure
context, so SubtleCrypto still works. The hardware back button walks the app's own routes (chat →
workspace or tree → tree, closing the pair form) and only backgrounds the app from the tree. `android/` is
git-ignored like `ios/`. See
`RUNBOOK-mobile.md` for signing and on-device steps.

## Not yet here

- Live token streaming: the transcript refreshes from `session.getMessages` on pi events instead of running
  the IDE's pi-event reducer (it lives in the web store; moving it into [[module-chat-ui]] is the next step).
- Code highlighting (no `CodeHighlighterProvider` yet — code renders plain), extension tool cards beyond the
  built-ins (e.g. ask-user-question, registered by the IDE's `extensions` module), extension UI dialogs
  (`ExtUiPrompt` over `piExtensionUi`), templates and `@` mentions in the composer, picker favorites, the
  Resources dock, and push notifications (a content-less "wake" push would need a
  relay feature, since the relay is zero-knowledge).
