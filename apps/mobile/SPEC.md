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

## Boundary

- **Owns:** a small React/Vite UI — `App.tsx` (pairing, host reconnect, the drill-down route, deep links via
  `@capacitor/app` `appUrlOpen` + `getLaunchUrl`, which pair automatically), `Welcome.tsx` (first run, no
  paired host), the three list screens that read the IDE project tree as screens — `ProjectsScreen.tsx`
  (each host's open projects from `project.list`, per-host "unreachable" notice, add-computer form) →
  `ProjectScreen.tsx` (the project's workspaces from `workspace.list`, default / worktree / external glyphs,
  branch as the second line) → `WorkspaceScreen.tsx` (its **active** chats — `session.list` entries the host holds `live`,
  i.e. open in ThinkRail since it started, not the closed history — newest first, titled by contracts'
  `chatTitle`, aged by `compactAgeOf`; a workspace normally has one, which opens directly and whose back
  returns to the project, so the list shows only when there are several) — and `SessionScreen.tsx`, the IDE's chat on a phone: it renders the
  [[module-chat-ui]] components unchanged (`messagesToRuntime` → `deriveRows` → `ChatTurnView` for the
  transcript, the shared `Composer` with its slash commands from `session.getCommands`, the model/effort
  picker over `model.list` → `session.setModel` / `session.setThinkingLevel`, send / steer / follow-up /
  interrupt through the same `session.*` methods as the IDE, tool-card answers through
  `session.respondToTool`). It re-reads `session.getMessages` (coalesced 400ms) on the session's pi events
  rather than reducing the event stream; `main.tsx` registers the built-in tool cards and mounts the
  `TooltipProvider` the composer needs;
  `layout.tsx` (`Screen` frame, `ListRow`, loading/failed/empty states), `status.ts` (row marks from
  contracts' `sessionAttention`: the shared `RunningIcon` replaces the row glyph while a session in scope
  runs, the shared `AttentionDot` shows while one needs input or has an unread result — the IDE tree's
  vocabulary), `useHostRequest.ts` (one wire read per screen), `scanPairLink.ts` (the in-app QR scan via
  `@capacitor/barcode-scanner`; cancel is silent, a non-pairing QR or denied camera is reported),
  `PairForm.tsx`, `theme.ts`, the Capacitor config,
  `scripts/ios-setup.ts`, and a `localStorage` `KeyValueStore` (`store.ts`; the Capacitor WKWebView persists
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

The theme follows the operating system: `theme.ts` applies the bundled **Dark** or **Light** manifest with
`applyPalette` and swaps on `prefers-color-scheme` changes. There is no theme picker — that is an IDE
setting. The native shell's background is the Dark palette's `background`, read from the manifest by
`capacitor.config.ts`, so first paint matches.

## Build & run

`bun run mobile:ios` (root) builds `dist/`, runs `scripts/ios-setup.ts` (creates `ios/` with
`cap add ios` when missing, then idempotently registers the `thinkrail` URL scheme and the Local Network
and Camera usage descriptions in `Info.plist`, and installs the app icon — `packages/shared/assets/icon-ios.png`,
the full-bleed iOS render of the one ThinkRail icon source, so the phone and desktop icons cannot drift), syncs, and opens Xcode. `ios/` is generated per machine and
git-ignored, so the setup script is the only place native configuration is written. See
`RUNBOOK-mobile.md` for signing and on-device steps.

## Not yet here

- Live token streaming: the transcript refreshes from `session.getMessages` on pi events instead of running
  the IDE's pi-event reducer (it lives in the web store; moving it into [[module-chat-ui]] is the next step).
- Code highlighting (no `CodeHighlighterProvider` yet — code renders plain), extension tool cards beyond the
  built-ins (e.g. ask-user-question, registered by the IDE's `extensions` module), extension UI dialogs
  (`ExtUiPrompt` over `piExtensionUi`), templates and `@` mentions in the composer, picker favorites, the
  Resources dock, removing a paired host, and push notifications (a content-less "wake" push would need a
  relay feature, since the relay is zero-knowledge).
