---
id: submodule-web-phone
type: submodule-design
status: active
parent: module-web
depends-on: [module-chat-ui, module-contracts, module-remote-client, module-design-tokens, module-locales, module-ui]
title: phone — the phone shell (lightweight remote sessions)
---

## Responsibility

The web client's second shell, built as its own entry (`phone.html` → `main.tsx`, `vite build --mode phone`
→ `dist-phone/`) and shipped inside the Capacitor wrapper [[app-mobile]]. It pulls **live sessions from one or
more hosts** (a laptop, a server) onto a phone and lets you drive them — a thin viewer/controller, **not** the
full ThinkRail IDE.

**Several computers, one store.** The overview — the Devices tree, the Sessions tab, its badge and Done list,
read-only access — spans every paired computer through `remote-client`'s `remoteSessions` and per-screen wire
reads. A chat is the web client's own: `storeHost.ts` mounts the web store and transport on that chat's
computer (`mountRemoteSession`, which resets the previous computer's state), and the chat reads its transcript,
queue, dialogs, notices, model and stats from the store's event reducer, exactly as the IDE does. No file tree, diffs, terminals, layout, or settings. No cloud account: the device pairs each host by its
`thinkrail://pair` link and remembers it locally.

**Reaching a computer (no server deployed).** `thinkrail --remote` runs its own relay and its link lists the
computer's Wi‑Fi/LAN and Tailscale addresses plus its name, so the phone connects on the same Wi‑Fi, or from
anywhere when Tailscale is on for both; the connector races the addresses on every (re)connect. Pairing stays
host-authorized: the QR's one-time token, then the device key. `hostStatus.ts` turns a failed connect into
`network` (no address answered — `RelayUnreachableError` — shown as "use the same Wi‑Fi or turn on
Tailscale"), a `RemoteConnectError` code with its own what-to-do line (expired QR, phone access off, app
older than the computer, no direct route, …), or the raw message of anything unexpected. A computer lost for
good (`onLost` — it revoked this phone) leaves any of its screens for the Devices tab, where its row shows
why. Open, its row shows `HostBanner` in place of its projects, with the one action that fixes the failure
(`recoveryOf`): **Scan QR code** in place when the phone must pair again (revoked, the key changed, an expired
code), **Reconnect** for a passing failure, nothing when only an app update helps. Welcome fits one screen without scrolling: three one-line steps (which network, how to turn access on, scan) and the scan button, with the paste field folded behind **Enter link manually**.

## Boundary

- **Owns:** a small React/Vite UI — `App.tsx` (pairing, host reconnect, the drill-down route, deep links via
  `@capacitor/app` `appUrlOpen` + `getLaunchUrl`, which pair automatically), `Welcome.tsx` (first run, no
  paired host), and three tabs under a bottom `TabBar.tsx` — **Devices · Sessions · Settings** — with
the screens pushed over them as a stack (`navigation.ts`). **Devices** (`ComputersScreen.tsx`, `ProjectTree.tsx`): the
IDE project tree with the paired computers as its top level, all on one screen — nothing about it opens a
separate page. A computer row shows Connected / Connecting… / the failure and its sessions' marks, starts
open and folds on tap; open, it shows its open projects (`project.list`), each expanding in place into its
**live** workspaces (`workspace.list`, split by contracts' `partitionWorkspaces` with the host's
`settleIdleDays` from its welcome — the Settled shelf is not shown on the phone), Default first, branch as
the second line, drawn with the shared `@thinkrail/ui/project-tree` glyphs and labels; the open and expanded
sets live in `App` so returning from a chat keeps the tree. The header's **+ Device** opens **Add a device**
(`AddComputerScreen.tsx`): Welcome's three `PairSteps`, then scan or paste a link; pairing returns to where it
was opened from, and the phone names itself to the computer by its kind (`deviceLabel.ts`: iPhone, iPad,
Android phone / tablet), renamable there. A computer that made this phone **read-only** (`accessFor`, from
`remote.deviceAccess`) shows "Connected · Read only" with no project or workspace actions, its chats end in a
read-only note instead of the composer and model picker, a chat list without **+**, and a workspace without a
chat says it cannot start one — the computer refuses those writes anyway. A computer row's ⋯ reconnects or forgets it (confirmed; pairing again needs a new QR, the last one leaves for
Welcome). **Sessions** (`ChatsScreen.tsx`, `chats.ts`): the sessions that need a look — **Needs you** (a
question, an unread result or failure), then **Running**, then **Done**: the ones the phone saw waiting or working
that since finished (`settleDone`, newest first, at most 20, kept on the device until **Clear**), so an answered
session does not vanish once its result is read elsewhere; other idle ones stay in the tree — each naming its project and workspace,
the tab badged with the Needs-you count; a tap lands in that chat. **Settings**: **Devices** — each paired device with Connected / Connecting… / the failure, **Forget** at the right edge of its line (confirmed in place) and, only when unreachable, **Reconnect** under the reason; then the same **Scan QR code** / **Enter link manually** rows as Add a device — then theme and language. the IDE tree's actions, on touch (`TreeActions.tsx` over `sheet.tsx`'s
  bottom `Sheet` / `ConfirmSheet` / `RenameSheet`, built on the shared `@thinkrail/ui/dialog`, with the IDE's
  strings; short action menus and confirmations stay bottom sheets, a list you pick from — models, base
  branches — opens as a full page with a back arrow, never a floating inset window): a project row's **+** opens `NewWorktreeScreen.tsx`, the IDE's New workspace dialog on a phone —
  an optional task, the base branch (its own stack screen over `git.listBranches`, default first, via `baseBranches`) and
  the model + effort (`ModelSheet`, starting from `model.default`); its one button runs `newWorktree.ts`'s
  `startWorktree` (`workspace.create` → `session.create` with a picked model → `session.prompt` with the task)
  and lands in that chat, a first message that did not go back in its field with why — and its **⋯** offers New worktree,
  Rename (`project.rename`) and Close project (confirmed, `project.close`); a workspace row's **⋯** offers
  Rename (worktrees only), Mark as read / unread, Settle (blocked while running or unread, as in the IDE; the
  phone hides the Settled shelf, so it is unsettled on the computer) and Remove (confirmed; "Remove from
  ThinkRail" for an external folder). Rows update from the host's pushes; a failure shows in a dismissible
  banner at the top of the tree; a tapped workspace always lands in a chat, as the IDE does (`WorkspaceScreen.tsx`'s `WorkspaceOpener`):
  the newest chat the host holds `live`, else the newest from history (`session.getMessages` attaches a disk
  session, the same reopen the IDE does), else a new one via `session.create`; back returns to the screen it came from. When
  the workspace has more than one chat the chat header shows a history button opening `ChatHistoryScreen`:
  **Open** chats, then **Recent** (closed) ones, each newest first, the current one marked, **+** to start a
  chat; picking one switches to it and back returns to the chat. Titles come from contracts' `chatTitle`,
  ages from `compactAgeOf`; and `SessionScreen.tsx`, the IDE's chat on a phone (its header: back, the title after it, and
  one action — the chat history when the workspace has more than one chat, else **New chat** (none when
  read-only); under it, centered on the chat background, the IDE toolbar's usage line as its own strip —
  `SessionUsage.tsx` over chat-ui's `contextPart` / `usageParts` from `session.getStats`, read with every
  transcript refresh and after a model change: a slim `<meter>` of the context used with its percent of the
  window, since the phone font lacks the IDE's ▰ / ▱, then the billed parts, on one line; a tap opens the toolbar's
  buttons under it — `ChatTools.tsx`'s **Resources** (`session.resources`, refreshed on `session.resourcesChanged`,
  as chat-ui's `ResourceRow`s, live first; a subagent opens its transcript, Stop only with write access) and
  **Skills** (`skills.state`, grouped by chat-ui's `groupSkills` with the IDE dialog's group / All plugins / per-skill
  switches, Enable for a skill awaiting confirmation and Reload; read-only phones see them locked)
  as full pages): it renders the
  [[module-chat-ui]] components unchanged (`messagesToRuntime` → `deriveRows` → `ChatTurnView` for the
  transcript, the shared `Composer` with its slash commands from `session.getCommands`, the model/effort
  picker over `model.list` → `session.setModel` / `session.setThinkingLevel`, its current model and effort read from each
  `session.getMessages` summary, since `session.list` reports `model: null` for a chat not yet loaded on the host — on a phone the row above the
  field, `ModelSheet.tsx`: a full page with a back arrow (`sheet.tsx`'s `PageSheet`; no autofocus, so no keyboard) with the IDE's `EffortSlider` (levels from the catalog entry) that applies at once
  over models grouped by provider (`modelSections.ts`, current provider first, a search field only past 8
  models); a tap picks and closes, and the composer's `/model` opens it — send / steer / follow-up /
  interrupt through the same `session.*` methods as the IDE, tool-card answers through
  `session.respondToTool`). Extension cards are the IDE's own registry (`registerWebExtensions`), with the
  store's `hostState.awaitingToolCallId` so only the call the agent waits on accepts an answer. An extension
  dialog (`select` / `confirm` / `input` / `editor`) is the store's `pendingExtUi` — fed from `session.state`'s
  `needsInput` as in the IDE — so a phone that opens a chat after it was raised still sees it: on its tool card
  when that call is in the transcript, else docked above the composer, answered through `session.extUiReply`
  and hidden at once. Text buttons in the transcript and the dock are `touch` tall. What the IDE shows around
  its transcript the phone shows too: **Try again** under a provider failure (sends the IDE's `Try again.`);
  the shared `QueueStrip` above the field from the store's queue, whose edit puts a queued message back in the
  field (`queuedDraft.ts`) and remove drops it (`session.removeQueued`), and stop restores the queue to the
  field (`session.abort` with `restoreQueue`); the shared `StreamIndicator` under the transcript while it runs;
  an extension's `notify` as a system/error row in the transcript, and a provider notice as the shared
  `ExtraUsageNotice` above the field.
  `setStatus` / `setWidget` / `setTitle` are IDE chrome and not shown. Paths in tool cards are relative to the
  workspace's `worktreePath`. An Agent card's **Open transcript** pushes `SubagentScreen.tsx`, the IDE's
  subagent transcript dialog as a stack screen over `subagent.getTranscript`, re-read while the run is
  queued or running; back returns to the chat as left. Diagrams (fenced mermaid and visualize) render inline
  with the shared fullscreen pan/zoom view; changed-file lists are text only, since the phone opens no files. The
  transcript streams token by token from the store (`hydrateStandaloneChat` loads it without a workbench
  placement, `useTranscriptSync` repairs it after a reconnect, `useSessionStats` refreshes the usage line);
  `main.tsx` registers the built-in tool cards and the IDE's extensions and mounts the `TooltipProvider` the
  composer needs;
  `layout.tsx` (`Screen` frame and `ScreenHeader`, `ListRow`, loading/failed/empty states — a screen waits on `Loader`, the shared `RunningIcon` R mark at 56px over "Loading…"; a level of the tree waits on, or says it is empty in, an inline line at its depth; a screen with nothing to list shows `EmptyState` — an icon tile, a title, why, and the buttons that fix it, never "go to Settings"), `status.ts` (row marks from
  contracts' `sessionAttention`: the shared `RunningIcon` replaces the row glyph while a session in scope
  runs, the shared `AttentionDot` shows while one needs input or has an unread result — the IDE tree's
  vocabulary), `useHostRequest.ts` (one wire read per screen), `scanPairLink.ts` (the in-app QR scan via
  `@capacitor/barcode-scanner`; cancel is silent, a non-pairing QR or denied camera is reported, and a device
  with no camera — the iOS Simulator, where the native scanner shows nothing and never answers — says so and
  opens the paste field),
  `PairForm.tsx`, `theme.ts`, `storeHost.ts`, and a `localStorage` `KeyValueStore` (`deviceStore.ts`; the
  Capacitor WKWebView persists it on-device). Live status comes from the controller's `session.state` stream; lists are read on screen
  entry, and a workspace's chats re-read when a session appears or leaves in it.
- **Allowed deps:** the sibling `store`, `transport`, `extensions` barrels, `shell/chatReconciliation`, and the
  chat hooks `chat/useTranscriptSync`, `chat/useSessionStats`, `chat/useModelCatalog`;
  `@thinkrail/remote-client` (the entire remote engine), `@thinkrail/chat-ui` (the chat renderers and composer —
  never a copy of them), `@thinkrail/contracts`, `@thinkrail/design-tokens` (palettes, semantic CSS,
  `applyPalette`), `@thinkrail/locales/react`, `@thinkrail/ui` primitives, Remix Icon, `@capacitor/app` and
  `@capacitor/barcode-scanner` (their web fallbacks keep the shell usable in a browser), platform APIs.
- **Forbidden:** being imported by any other web module (it is an entry, not a library); a chat state of its
  own beside the store's; reimplementing the remote protocol (it lives in `remote-client`); a second colour,
  type, spacing or radius source.

## Look

The shell speaks the same visual language as the IDE: `phone.css` imports
`@thinkrail/design-tokens/styles.css`, so components name only semantic utilities (`bg-container-header-bg`,
`text-text-muted`, `tr-title-card`, `p-16`, `rounded-md`), never raw colours or Tailwind's stock palette.
The rules in `apps/web/src/styles/COLOR.md`, `SPACING.md` and `TYPOGRAPHY.md` apply; its touch rhythm (the roles below and larger steps than the IDE's density) is its own, so the
spacing and button adoption guards skip `src/phone/` while the colour and typography guards cover it. The app adds only
four mobile layout roles: `touch` (44px, the minimum tap target, `h-touch` / `min-h-touch`),
`safe-top` / `safe-bottom` (the iOS safe-area insets), and `chat-gutter` (16px, the role
[[module-chat-ui]] asks every host to define). Text comes from `mobile.*` keys in
`packages/locales/en.json` (the i18n gate scans `apps/mobile/src`).

A screen stands on the IDE surface it replaces: the tab roots and the computer's tree on `container-sidebar-bg` (the IDE's
sidebar), the chat and every other screen on `container-workspace-bg`; `Screen`'s `surface` picks it.

Screen headers follow iOS: a sub-screen shows an icon-only back arrow (its destination is the arrow's
accessible label, not visible text) with the title centered; the top level shows the large left title.

Navigation is a stack over tabs, as on iOS/Android: `App` keeps every tab root and the screens under the top
one mounted, hidden and `inert` (the tree under a chat, the chat under its history), the tab bar only on the
roots, so back shows them exactly as left — scroll,
expanded projects, transcript — with no reload. `useHostRequest` starts a reopened screen from the read's
last value for that host and refreshes in place; the tree re-reads `project.list` on `project.updated` and a
project's `workspace.list` on `workspace.created/updated/removed`, keeping the rows on screen, so rows keyed
by id stay put and only a new one appears. A loader shows only the first time a read has no value.

Add a device pairs through `PairForm.tsx`'s `PairActions` — grouped **Scan QR code** /
**Enter link manually** rows (the latter opens the paste field), the same `usePairing` flow `Welcome`'s
first-run `PairForm` uses. `SettingsScreen.tsx` opens with the brand card, then the phone's own settings: the IDE Settings rows that apply to a device, rendered
with the shared `@thinkrail/ui/settings` primitives and the IDE's strings — **Theme mode**
(System / Light / Dark), **Contrast level** (Default / High) and **Language** (System or a bundled locale,
named by `languageName`). They are device preferences (`preferences.ts`, one JSON entry in the
`localStorage` store), never written to a host: a phone can pair several computers, and the IDE's own
choice belongs to the IDE. `theme.ts`'s `applyDevicePreferences` applies them before paint (a layout
effect in `App`) — the bundled `dark` / `light` / `high-contrast-*` manifest via `applyPalette`, following
`prefers-color-scheme` while System, and the locale via `resolveLocale` + `applyLocale`, following
`languagechange` while System. Custom themes, theme pairs and local locale files are host-folder features
and stay in the IDE.

**Type scale.** `phone.css` re-points the shared primitive font sizes (`--tr-font-size-s10`…`s24`) to a touch
scale — the IDE's 14px UI text becomes 17px (iOS body), its 12px metadata 15px, every other step up in
proportion — so every semantic `tr-*` style, including the shared chat, tree and settings components,
grows together without forking a class. The tree reads at list size: project names `tr-heading-sm` (19px) with 22px
glyphs, workspace names `tr-title-section` (17px) in the default text colour with 20px glyphs, every row at
least a touch target. The IDE's desktop density
stays as is.

The native shell's background is the Dark palette's `background`, read from the manifest by
`capacitor.config.ts`, so first paint matches. The keyboard resizes the native web view (`Keyboard.resize: native`)
rather than letting iOS scroll the page under it, which left the screen shifted up with the header off-screen once
the keyboard closed. A tab under another screen stays mounted (its scroll kept) but transparent, inert and
untouchable — not `visibility: hidden`, which iOS WebKit repaints blank but for its buttons on every later return to
that tab. The page itself never scrolls (`ios.scrollEnabled: false`, `html`/`body` with no overflow):
only a screen's own list does, so the header and tab bar cannot be dragged off with it. The composer grows to its
`compact` limit, and chat lists hang their markers outside so a long path starts on the marker's line.

## Not yet here

- Adding a project (open / create / clone need the computer's folders), picking the new worktree's base branch,
  opening an existing worktree, and the Settled shelf.
- Code highlighting (no `CodeHighlighterProvider` yet — code renders plain), an extension's status line and
  widgets (`setStatus` / `setWidget`), templates and `@` mentions in the composer, picker favorites, the
  Resources dock, and push notifications (a content-less "wake" push would need a
  relay feature, since the relay is zero-knowledge).
