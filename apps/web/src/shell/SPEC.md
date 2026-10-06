---
id: submodule-web-shell
type: submodule-design
status: active
title: shell — responsive frame
parent: module-web
tags: [ui]
references: [module-desktop, module-contracts]
---

## Responsibility

The responsive composition root: top-level app chrome, active-project/workspace routing, theme application, global shortcuts, region error isolation, and composition of layout-agnostic panels into one frontend-local desktop workbench frame. A future mobile shell may project the same panels differently; it must not inherit desktop docking accidentally.

## Boundary

- **Owns:** `Shell` as the one composition root; topbar and persistent location context; active-project/workspace routing; single Settings, analytics-consent, interview-invitation, attention-notification permission-preface, and Toaster mounts plus the keyboard-opened Create workspace dialog and the `Mod+K` session switcher (and the once-mounted attention-notification observer from [[submodule-web-notifications]]); theme application and global shortcuts; the injected Layout and optional application Update settings sections; and integration of the workbench engine with store, persistence, panels, transport-backed domain state, and error boundaries.
- **Public surface:** `Shell`.
- **Allowed deps:** child layout modules; `updates`; `panels`; `chat` app-integration hydration/rendering; `store`, `transport`, contracts (types, wire constants, and the shared `createQuitConfirmation` rule), `@thinkrail/ui/*`, `components/ErrorBoundary`, `components/QuietScrollArea`, `constants`, `lib`, and `themes`.
- **Forbidden:** server/shared/pi imports; being imported by panels/store/transport; putting arrangement knowledge into a feature panel; or sending current frame/view state through transport.

## Internal modules

Every child is a directory module with `index.ts` as its public surface:

- `layout/` ([[submodule-web-shell-layout]]) is the pure frame/view mutation, projection, and rendering engine. It never imports feature panels, store/transport runtime, or persistence.
- `layoutState/` ([[submodule-web-shell-layout-state]]) owns local hydration, validation, persistence, pristine Balanced initialization, and atomic installation of pure layout results.
- `layoutIntents/` ([[submodule-web-shell-layout-intents]]) owns consume-once arrangement intent routing into pure layout transitions.
- `chatReconciliation/` ([[submodule-web-shell-chat-reconciliation]]) owns host session/local placement/cache/history convergence and chat deep-link orchestration.
- `terminalReconciliation/` ([[submodule-web-shell-terminal-reconciliation]]) owns host terminal-catalog/local placement convergence without owning PTY lifetime.
- `legacySelection/` ([[submodule-web-shell-legacy-selection]]) is the sole temporary adapter from workbench attention to migration-era active editor/terminal/preview mirrors.
- `locationBar/` ([[submodule-web-shell-location-bar]]) owns the topbar's captioned location segments and their project / workspace / branch controls; it reaches `panels` per-file and `store`/`transport`, never the layout engine.

The sibling dependency graph is: `layoutState → layout`; `chatReconciliation → layout + layoutState`; `terminalReconciliation → layout`; `layoutIntents → layout + chatReconciliation + terminalReconciliation`; `legacySelection` reaches store selectors/actions only; and `WorkspaceWorkbench` composes each active orchestration barrel with `layout`, panels, and render callbacks. Chat resource availability is isolated behind a per-session selector component; the parent workbench never subscribes to the whole `sessions` record, so a streaming runtime cannot invalidate every tab renderer and side tool behind it. Siblings import only through barrels. Tests live with the orchestration module that owns the behavior rather than making store tests import shell runtime effects.

## Composition

The topbar keeps ThinkRail identity, connection state, Settings, and compact location context, and doubles
as the **window title bar** when a native host removes its own strip ([[module-desktop]], *Native window
chrome*). It is a fixed `h-topbar-row` (`--topbar-row-height`, 40px — macOS title-bar proportions, so
native traffic lights sit centred in it) with `px-16`, and it is host-agnostic: the only host-shaped input
is three CSS custom properties on `<html>`. `--window-chrome-inset-left` / `--window-chrome-inset-right`
are consumed through the `w-window-chrome-inset-*` spacing tokens by one `aria-hidden` edge spacer on each
side (`window-chrome-inset-left|right`); unset (any browser) they resolve to `0px` and the header looks as
before, while the desktop publishes `64px` on macOS so content starts at 80px and collapses it to `0px` in
fullscreen. `--window-chrome-drag-region` drives the header's `window-drag` utility, which resolves to
`no-drag` unless the host publishes `drag`, so a browser tab or a natively decorated window never gains a
drag strip. Padding was deliberately not used for the inset: the `spacingUsage` gate lets padding utilities
name only canonical steps, and a CSS `padding-left: max(…)` would need a gate exemption. The header is
`select-none`; its whole trailing action cluster (`topbar-actions`) is `window-no-drag`, so any button
placed inside it — the Update affordance, quota Retry, Settings — is excluded from dragging by
construction; `Shell.tsx` itself places no other button in the header (`topbarChrome.test.ts` gates this).
The location strip ([[submodule-web-shell-location-bar]]) is the one deliberate exception: its pills and
chips each carry `window-no-drag` while their captions and hairlines stay draggable, so a user can still
grab the strip between controls. Plain text such as the connection label stays draggable. The one other button group is
`NativeWindowControls`: when the host installs the optional `NativeWindowControlsBridge`
(`__THINKRAIL_NATIVE_WINDOW_CONTROLS__`, [[module-contracts]]) — today only the Windows desktop — Shell
mounts `useNativeWindowControls`, which mirrors `updates`' capability hook (read the global once, `getState`,
subscribe, `null` in a browser; the state carries no revision, so the initial `getState` snapshot is dropped
once any push has arrived), and renders three props-driven 46×40 caption buttons (minimize,
maximize-or-restore, close) as a `window-no-drag` overlay pinned to the header's top-right, inside the zone the
host reserved through the right inset; they disappear while the state says `fullScreen`. The controls own
no window state and never enter the store; the hook reports a rejected action or snapshot read with `console.warn` rather
than throwing. Windows caption-button conventions (no tooltips, full-height hit targets, a red-tinted close
hover via `feedback-error-subtle`) are deliberate; macOS keeps AppKit's traffic lights and never sees the
bridge.
`SettingsDialog` portals out of the header and is unaffected. Nothing in the shell names or imports the
desktop host. `Shell` mounts the optional update hook, injects the version-gated empty host action, and passes
normalized state into props-driven controls. Its compact status affordance opens the injected Update section;
without a capability, neither renders. Panels receive optional React content, never launcher or native-runtime
checks. The topbar identity is the icon-only ThinkRail mark—the same
vector served as `public/favicon.svg`, inlined at 32×32 and rendered
through semantic `text-primary`—with no divider before location. With a context project the mark is followed
by the `locationBar` strip: captioned segments **PROJECT · WORKSPACE · BRANCH · from base · REMOTE · PULL
REQUEST** whose values are controls (project switcher, workspace actions + sibling switcher, branch card,
remote/PR status chips), with the drop order and grammar owned by [[submodule-web-shell-location-bar]]. Shell
passes it the context project, the active workspace (or `null` for Project Home), the open review from
`useOpenBranchReview`, and the callback that opens the shell-owned New workspace dialog. No selected project
leaves the logo alone.

Immediately before host connection status, the topbar conditionally renders the **JetBrains recurring-quota
readout** (protocol v59): a neutral Coins icon + locale-formatted `remaining / total credits`. It exists only
when the synchronized setting is enabled and the host reports healthy Central; zero has no warning policy.
Loaded/loading are non-button content with a freshness tooltip. First failure is `Quota unavailable · Retry`;
later failure preserves the last value as stale with a small warning freshness marker and Retry. Neither
numeric updates nor the polling loop are aria-live. Narrow widths hide `credits` and the existing connection
label before either icon or quota number.

`Shell` owns the visible-client polling controller: immediate request on activation/reconnect/provider
invalidation/visible resume/config change, then one non-overlapping request after each configured
`1–3600` second interval (default 30). Hidden documents and disabled/host-hidden results cancel the timer;
Retry forces completed-cache age but still joins host single-flight. Request sequence guards prevent an old
response restoring a superseded state. The host owns health, cache, and deduplication; shell never invokes or
interprets Central directly.

With an active workspace, `Shell` mounts the workbench directly; only a lazy Pierre resource body mounts a worker-pool provider, so an ordinary workspace neither requests Pierre's chunk nor starts its shared pool. Switching workspace changes resource contents and attention but never frame topology, Projects/Specs/Files/Changes/Review placement, side/bottom geometry, folds, visibility, alignment, or which singleton tool a group shows (a selected workspace resource such as a terminal stays per workspace). That is a React invariant too: `WorkspaceWorkbench` stays mounted across a switch and is re-targeted by its `workspaceId` prop, never keyed by workspace. The frame chrome—panel groups, side/bottom stacks, tab strips, the Projects tree—keeps its DOM; only resource bodies and per-workspace tool contents swap. Resource bodies are keyed by workspace as well as resource id, because some layout ids are deterministic (every workspace's initial terminal is `terminal:thinkrail-initial`): the same id must never carry one workspace's live xterm or pane into another's commit. A switch therefore paints no fade, skeleton, or empty frame for the chrome, and every hook the workbench calls must tolerate a changing `workspaceId`: state that belongs to one workspace is qualified by that id or lives in a workspace-keyed store slice, and no readiness flag computed for the previous workspace may be read for one effect pass against the next one. A first visit to a workspace whose local view has not been materialized yet does not remount either: once the frame is ready, the workbench renders the empty-view projection of that frame for the single commit before `layoutState` installs the identical view, so the frame keys never change. The "Restoring workspace layout" placeholder exists only before the local frame has hydrated. Entering or leaving Project Home swaps Shell branches and is not a workspace switch. Shell-owned wrappers around Projects, Files, and Specs use `components/QuietScrollArea`, as does the Project Home navigator; Changes/Review and xterm own their internal quiet-scroll surfaces in `panels`. These primitives never receive or infer placement. `@thinkrail/ui/resizable` cannot reconcile a panel-count change in place, so a frame command that changes the shape (preset apply/reset, group add/remove, side or bottom visibility) forces the aligned-row and outer `ResizablePanelGroup`s to remount through the single frame-level projection epoch; they carry `motion-safe:animate-fade-in` (an opacity-only twin of `animate-reveal` — no `transform`, since these subtrees can contain ChatView's `position: sticky` breadcrumbs) so the shape change reads as a soft cross-fade rather than a jump. Without an active workspace, Shell mounts Welcome beside the projects navigator using separate local geometry. The Settings dialog, analytics-consent window, addressed interview invitation, attention-notification permission preface, and Toasts each mount once above both branches; the attention-notification observer (`useAttentionNotifications`) likewise runs once here. The consent window is a layout-agnostic panel shared by browser and desktop clients, gated by hydrated host configuration and protocol support; shell owns only its placement. Consent takes precedence over the automatic interview invitation so startup never stacks both prompts.
After `main.tsx`'s synchronous first-paint apply, Shell is the sole mounted theme side-effect owner. While `welcomeGeneration === 0` it retains the versioned preference hint; afterward it projects store's opaque fixed id + fixed/system mode + optional pair through `themes` and writes the reconciled hint. Fixed mode has no media listener. System mode owns exactly one `prefers-color-scheme` listener, reapplies the locally resolved slot on change, and cleans it up on preference/unmount; that local event never mutates store, calls the host, or changes another client. No other component mutates `[data-theme]`.

## Workbench behavior

The durable frame grammar and pure operations belong to [[submodule-web-shell-layout]]. Zustand carries one `WorkbenchFrame`, local layout preferences, and keyed `WorkspaceViewState` values; the mounted document is derived and never persisted as a second authority. Frame-plus-view transitions commit atomically through `layoutState`.

Resource opens route to that workspace's last-focused surviving center group. Reopening a canonical resource selects its local placement rather than duplicating it. Resource close does not remove the frame group when it becomes empty. Explicit split/add/remove/merge commands own topology; group removal deterministically rehomes resources from every locally retained workspace view before one state commit. Applying a preset follows the same all-views rule. Moving a singleton tool or resizing/folding/showing a region changes the one frame; moving a file/chat/diff/document/terminal among existing groups changes only the active workspace view. Pointer/resize drafts stay runtime-local and publish one local transition on completion.

The layout persistence boundary is `layoutState`, not the store. Browsers qualify state by backend endpoint and frontend-surface identity; native windows use the injected stable string adapter's profile/window scope with a fixed key independent of the host's dynamic port. Both paths persist and decode the same bounded document. State is schema-validated on load and restored on reload or supported window-session restoration. Simultaneous windows do not observe each other's storage writes. A surface with no valid local document starts from the Balanced frame; old host snapshots and old browser attention keys are never read.

Project/file/change/review/chat/terminal views receive only resource identity, visibility, and container bounds. Moving a view cannot change module dependencies or make it inspect the frame. A terminal body mounts only while that terminal is locally selected in a visible, unfolded group; hidden terminal tabs stay unmounted while their host PTYs continue running.

Every async resource/session/catalog hydration checks connection generation, workspace lifetime, and the current local frame/view identity before installing data or a follow-up placement. A peer-created chat remains discoverable through host history but does not open a local tab. Host terminal catalog membership is shared: reconciliation removes dead local references and places a newly discovered catalog tab into a compatible local terminal slot without changing frame geometry or stealing attention. Explicit terminal close remains host-domain lifetime and converges removal in every surface.

Default-terminal creation no longer depends on a host layout revision. The workspace-creation flow carries a host-owned pending marker; the host reserves the deterministic process-free terminal catalog entry and clears the marker only after durable success. Each frontend then places the catalog tab locally, normally into its bottom slot; PTY attach still waits for the visibility gate.

## Layout settings

Built-in presets remain web-owned. The Layout section presents built-ins plus the host-synchronized custom preset catalog, while default preset selection and independent side/bottom limits are local to this frontend surface. The selected default is the explicit Reset frame target; it is not reapplied on workspace switches because every workspace shares the current frame. Capture/rename/delete changes only the shared custom definition. Apply or Reset replaces this window's frame and reflows all retained workspace views, preserving resource identities, then persists locally; another frontend is unaffected.

## Long-operation feedback

Starting an agent session is seconds-long (watcher readiness + `session.create`), so it is never silent:
every chat-start path — the empty-center New-chat button, `NewWorkspaceDialog`'s create-and-kick-off flow,
and reopening a closed chat (`openChatInTab`) — brackets its request with the store's per-workspace
chat-start counter (`beginChatStart`/`endChatStart`, a counter because starts can overlap); worktree
creation does the same per-project (`beginWorktreeCreation`/`endWorktreeCreation`), which `ProjectTree`
renders as a pending row under the project — the list stays put and the new worktree lands where the
row was. Consumers show it as an inline pending state where the result will appear: the empty-center button flips to a disabled
spinner ("Starting chat…", also the double-click guard), and the chat-history trigger spins while a
reopened chat hydrates. Workspace removal drops the counter with the rest of the per-workspace state.

## Error resilience

Every independently mounted workbench resource body—including documents, terminals, and singleton tools—has its own keyed region boundary, so one bad lazy panel cannot blank workbench chrome, sibling groups, or shell. Switching workspace or resource resets stuck region errors. Failed dynamic chunks offer a page reload rather than retrying the same stale module. `main.tsx` retains the last-resort boundary around `Shell`.

Invalid local layout state falls back to the Balanced safe frame without contaminating domain state. A local persistence failure leaves the live frame usable and reports one actionable error. A custom-preset settings failure leaves both the instantiated current frame and catalog unchanged.

A chat tab whose session isn't in the local runtime cache yet renders the same content skeleton as every
other restoring resource — never a manual "Retry" affordance up front, because `chatReconciliation`'s
placement/catalog convergence already auto-hydrates it in the overwhelming majority of cases within a
second or two, and a retry button shown immediately reads as "this failed" for what is normal loading.
`ChatResourceBody` only swaps the skeleton for an explicit retry message once hydration has stayed
stalled past a short grace window (`CHAT_RETRY_DELAY_MS`), so the retry affordance surfaces solely for the
genuinely-stuck case it exists for.

## Chat title controls

A chat tab's existing context menu gains **Rename chat**, and every row in the workspace's **Recently
closed** chat menu gains a visible pencil action. Like workspace rename, each action replaces its own label
in place with a chrome-less single-line input carrying the same typography and geometry; the field is
prefilled, focused, and selected. Enter or blur commits, Escape cancels, and blank, over-80-character, and
unchanged values never issue a request. Keyboard commit/cancel restores the replacement tab or history-row
control; pointer blur preserves the user's new focus target. The named, viewport-bounded interactive history
popover remains open and scrollable while its row is edited. The controls render only when the welcome
protocol supports `session.rename`.

The shell injects the chat-only mutation callback into the otherwise domain-neutral Workbench tab menu rather
than teaching the pure layout engine how sessions are persisted. A commit has no optimistic domain write: the
inline editor returns to the prior host-owned label until the existing `session_info_changed` store fold
updates open tabs and closed history everywhere; rejection retains that snapshot and raises the standard
error toast. Renaming a closed chat does not open or select it; renaming an open chat does not change placement
or focus. Automatic title arrival uses this same label fold but opens no editor, notification, or focus
transition. ChatView's `/name` command is the independent keyboard entry point to the same wire mutation.

## Global chords

`useGlobalHotkeys` remains the one capture-phase owner of app-wide chords. It routes commands through the workbench command surface rather than imperative feature-panel refs:

- `Ctrl+R` opens chat history for the locally selected chat, or the workspace's most-recent chat fallback;
- `Mod+B` toggles the left side, restoring local group/tab attention or an eligible singleton tool;
- `Mod+J` does the same for the right side;
- `Mod+Shift+J` toggles bottom, restoring local bottom attention, a bottom-targeted singleton, or the terminal creation surface;
- `Mod+N`, and its alias `Mod+Alt+N`, open `NewWorkspaceDialog` for the context project (the active workspace's project, else the selected project). The shell owns this one keyboard-opened instance as local state — it is not store state and not the `ProjectTree`/`WelcomePanel` instances, which keep their own return-focus and prompt-seeding semantics. `Mod+N` is the canonical chord and the one shortcut chrome advertises first; the alias exists because browsers reserve Cmd/Ctrl+N for a new window and never deliver it to the page, while the desktop webview does. This is the only chord that accepts Alt.
- `Mod+K` opens `SessionSwitcher`, a modal palette listing live sessions — only those needing attention or running, grouped by project in `ProjectTree` order and sorted needs-input > error > unread > running within each. It is driven by the global normalized attention snapshot (`sessionStateByWorkspace`), so it surfaces sessions in workspaces this client has not loaded; it backfills their workspace names and chat titles with `workspace.list`/`session.list` on open and jumps to a pick via `activateWorkspaceFromRoute`. Its open state lives in [[submodule-web-store]] (`sessionSwitcherOpen` + `openSessionSwitcher`/`closeSessionSwitcher`/`toggleSessionSwitcher`) so an aggregate attention notification from [[submodule-web-notifications]] can surface the palette on click; shell binds the chord through `toggleSessionSwitcher`. Because the palette is itself a modal, the global chord is suppressed while it is open, so it owns its own `Mod+K` close toggle (alongside `Esc`/backdrop). It accepts neither Shift nor Alt.
- Row and header glyphs reuse the `ProjectTree` vocabulary: a leading `RiChat2Line` (wrapped in `RunningIcon` while running) and a trailing `AttentionDot` for a session that needs attention — no bespoke per-outcome glyphs.

Letter chords match physical `KeyboardEvent.code`, never layout-dependent `key`. The layout and create chords remain app-owned inside xterm, do not repeat, and are suppressed while a modal dialog is open. With no active workspace, right/bottom chords neither act nor swallow the browser chord; Projects remains available. With no context project, `Mod+N` likewise neither acts nor swallows. Terminal `Ctrl+R` still belongs to xterm; `Ctrl+Shift+R`, macOS `Cmd+R`, F5, and browser reload remain untouched. All other arrangement operations are exposed by the layout command/menu system in [[submodule-web-shell-layout]].

**Native shortcuts.** Shell always mounts the `AppShortcuts` leaf. `useAppShortcuts` reads `NativeShortcutsBridge` (`__THINKRAIL_NATIVE_SHORTCUTS__`, [[module-contracts]]; desktop hosts only) once. Without the bridge it adds no listeners and renders nothing. With the bridge, the leaf renders the hint, so hint changes re-render only that leaf. Every app-level close/quit shortcut dispatches through one command table, `shortcutCommands.ts`: a command id (`close-item`, `quit`) maps to Ctrl chords per shortcut platform, each chord carrying its terminal rule, and the hook supplies the id → handler map. Both native commands from `subscribeCommand` and web keydown chords run the same handler. The shortcut platform is `platformFamily()` (`apple` / `windows` / `linux`) when the bridge exists, else `browser`.

| Platform | Quit | Close item |
| --- | --- | --- |
| apple | native Cmd+Q (host-confirmed) | native Cmd+W |
| linux | web Ctrl+Q (web-confirmed) | web Ctrl+W, Ctrl+F4 |
| windows | none (Alt+F4 is the OS window close) | web Ctrl+W, Ctrl+F4 |
| browser | none | none |

Web chords are Ctrl only (no Meta/Alt/Shift), handled in the window capture phase, and act once per physical press: a repeat keydown is swallowed but never runs. Inside xterm, Ctrl+W is neither handled nor prevented, so the shell gets it; Ctrl+F4 and Ctrl+Q stay app-owned. The table binds nothing on apple (native owns those chords) and nothing in a browser, so the hook adds window key listeners only where `hasWebShortcuts` is true. Letter chords match the typed Latin letter (`key`), falling back to `code` when the layout types a non-Latin letter; F4 matches `code`. This is the deliberate exception to the physical-`code` rule above: close and quit are destructive, and on AZERTY or Dvorak the W/Q positions type undo or select-all. Modifiers and the chord match first; the xterm check runs only for a matched chord. Web-owned chords do not fire while focus is inside the sandboxed HTML preview iframe: its keydowns never reach the parent window.

Quit confirmation runs the shared contracts `createQuitConfirmation` rule in both places: the host on macOS, the web on Linux. The web adapter tracks held from the Ctrl+Q keydown until keyup of that same physical `code` or Control, calls `sync()` on keyup, and treats window blur or a hidden document as `cancel()`: an already-confirmed gesture (hint `release`) quits, otherwise it hides. A confirmed quit calls `bridge.quit()` once; if it rejects, the adapter resets the rule so the pill hides and Ctrl+Q works again. Either way the web renders the hint as `QuitHintOverlay`, one centered, `pointer-events-none` `role="status"` pill that fades out on `hidden` and keeps the last text while fading; the text names the platform chord (`⌘Q` / `Ctrl+Q`).

`close-item` is never a window close: if a dismissible layer is open (modal or open Radix dialog/alertdialog/menu anywhere; a chat history overlay only inside the DOM-focused group, or anywhere when no group has focus; selectors and the xterm test shared with `useGlobalHotkeys` in `shortcutLayers.ts`), the hook dispatches `Escape` to the focused element so each layer keeps its own Escape semantics. The Escape is synthetic (untrusted), so each dismissible layer must catch Escape at document/window level or on an ancestor of focus and must not filter on `isTrusted`; Radix `DismissableLayer` (document capture) and `HistoryOverlay` (window capture) do, and e2e `close-quit-shortcuts` guards it. Otherwise it fires `requestClose` on the shell-owned `closeRequestChannel.ts` (injected into the workbench as `subscribeCloseRequest`, so no render cascade), and the workbench closes the selected tab of the focused group, else of the last-focused center group, through the same `onRequestClose` path as the tab X (terminal confirmation included). Singleton tools, folded groups, and whole regions are never closed; nothing closable is a no-op. With no active workspace only the layer step applies. Each chord has one owner: a chord in the command table is never also bound in `useGlobalHotkeys`, and a chord the host forwards natively is never in the table for that platform.
