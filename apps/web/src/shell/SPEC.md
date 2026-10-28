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

- **Owns:** `Shell` as the one composition root; topbar and persistent location context; active-project/workspace routing; single Settings, analytics-consent, survey-invitation, survey-window, attention-notification permission-preface, and Toaster mounts plus the keyboard-opened Create workspace dialog and the `Mod+K` / double-Shift search palette host (and the once-mounted attention-notification observer from [[submodule-web-notifications]]); theme application and global shortcuts; the command catalog the palette runs ([[submodule-web-commands]], [[submodule-web-search]]); the injected Layout, Keyboard and optional application Update settings sections; and integration of the workbench engine with store, persistence, panels, transport-backed domain state, and error boundaries.
- **Public surface:** `Shell`.
- **Allowed deps:** child layout modules; `updates`; `search` + `commands` (the palette and the command contract it composes for it); `panels`; `chat` app-integration hydration/rendering; `store`, `transport`, contracts (types, wire constants, and the shared `createQuitConfirmation` rule), `@thinkrail/ui/*`, `@thinkrail/locales` (UI strings), `i18n` (`useLocaleSync`, mounted once), `components/ErrorBoundary`, `components/QuietScrollArea`, `constants`, `lib`, and `themes`.
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
The location strip ([[submodule-web-shell-location-bar]]) is the one deliberate exception: its pills,
chips, and Remote / Pull request split buttons each carry `window-no-drag` while their captions and hairlines stay draggable, so a user can still
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
by the `locationBar` strip: captioned segments **Project · Workspace · Branch · from base · Remote · Pull
request** whose values are controls (project switcher, workspace actions + sibling switcher, branch card,
Remote and Pull request segments with the branch's next action), with the drop order and grammar owned by
[[submodule-web-shell-location-bar]]. Shell passes it the context project, the active workspace (or `null`
for Project Home), the branch status from `useBranchStatus`, and the callback that opens the shell-owned
New workspace dialog. No selected project
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

With an active workspace, `Shell` mounts the workbench directly; only a lazy Pierre resource body mounts a worker-pool provider, so an ordinary workspace neither requests Pierre's chunk nor starts its shared pool. Switching workspace changes resource contents and attention but never frame topology, Projects/Specs/Files/Review placement, side/bottom geometry, folds, visibility, alignment, or which singleton tool a group shows (a selected workspace resource such as a terminal stays per workspace). That is a React invariant too: `WorkspaceWorkbench` stays mounted across a switch and is re-targeted by its `workspaceId` prop, never keyed by workspace. The frame chrome—panel groups, persistent edge rails, side/bottom stacks, center strips, and the Projects tree—keeps its DOM; resource bodies and per-workspace tool contents swap. An auxiliary header may switch between its tool title and terminal-session strip according to workspace-local selection, without replacing the pane shell. Resource bodies are keyed by workspace as well as resource id, because some layout ids are deterministic (every workspace's initial terminal is `terminal:thinkrail-initial`): the same id must never carry one workspace's live xterm or pane into another's commit. A switch therefore paints no fade, skeleton, or empty frame for the chrome, and every hook the workbench calls must tolerate a changing `workspaceId`: state that belongs to one workspace is qualified by that id or lives in a workspace-keyed store slice, and no readiness flag computed for the previous workspace may be read for one effect pass against the next one. A first visit to a workspace whose local view has not been materialized yet does not remount either: once the frame is ready, the workbench renders the empty-view projection of that frame for the single commit before `layoutState` installs the identical view, so the frame keys never change. The "Restoring workspace layout" placeholder exists only before the local frame has hydrated. Entering or leaving Project Home swaps Shell branches and is not a workspace switch. Shell-owned wrappers around Projects and Specs use `components/QuietScrollArea`, as does the Project Home navigator; Files, Review, and xterm own their internal quiet-scroll surfaces in `panels`. These primitives never receive or infer placement. A frame command that changes the shape (fold/unfold, side or bottom visibility, alignment, group add/remove, preset apply/reset) never remounts the workbench's `ResizablePanelGroup`s or the resource bodies inside them: panels are added and removed in place and the engine enforces the committed sizes imperatively ([[submodule-web-shell-layout]], *Shape changes without remounts*), so a chat transcript, editor, terminal, or tool pane keeps its DOM and state while a neighbouring pane appears or disappears. Only a side stack that moves between the outer column and the aligned row (an alignment change, or hiding/showing a side that owns a bottom corner) remounts, because it changes parent. Without an active workspace, Shell mounts `ProjectHome`: Welcome beside the projects navigator using separate local geometry (the `thinkrail-shell-welcome` autosave plus a remembered expand size), never the workbench frame; its only tie to the frame is the pristine default — the pane opens at the built-in Balanced preset's left width, so a fresh surface shows the same Projects edge on Home and in the workbench. Its chrome is the workbench's: the same persistent 40 px left tool rail with one Projects entry (selected fill and Fill icon while shown, `aria-pressed`, `aria-controls` the pane) and the same plain pane header with a Hide control, composed from the primitives `layout` exports ([[submodule-web-shell-layout]]) around a shell-owned `useCollapsibleRegion`. While onboarding is active (`selectOnboardingActive` — the cold-start wizard shown, or still pending on a cold-start-shaped store) the rail and the Projects pane are not rendered at all, so a first-run user with no project and no model sees only the wizard; the Welcome panel stays mounted in place (panels are removed, not the group), so finishing the wizard keeps its hand-off dialog. No right or bottom rail renders there: Specs, Files, Review, and terminals are workspace resources, so an empty rail would advertise tools that cannot act. The rail entry, Hide, and `Mod+B` are one toggle: hiding returns focus to the rail control when focus was anywhere in the pane (header included) or on its separator, and leaves it alone otherwise; showing focuses the last-focused tree control, else the active row, else the first control — the header's Hide button is never the landing spot. Hiding Projects inside a workspace does not hide it on Project Home: Home is the navigation surface and keeps its own state. The Settings dialog, analytics-consent window, addressed survey invitation, the survey window, attention-notification permission preface, and Toasts each mount once above both branches (while the onboarding wizard is active, it asks for consent through its own privacy step instead and shell holds its window); the attention-notification observer (`useAttentionNotifications`) likewise runs once here. The consent window is a layout-agnostic panel shared by browser and desktop clients, gated by hydrated host configuration and protocol support; shell owns only its placement. Consent takes precedence over the automatic survey invitation so startup never stacks both prompts; the invitation waits and shows once consent closes.
After `main.tsx`'s synchronous first-paint apply, Shell is the sole mounted theme side-effect owner. While `welcomeGeneration === 0` it retains the versioned preference hint; afterward it projects store's opaque fixed id + fixed/system mode + optional pair through `themes` and writes the reconciled hint. Fixed mode has no media listener. System mode owns exactly one `prefers-color-scheme` listener, reapplies the locally resolved slot on change, and cleans it up on preference/unmount; that local event never mutates store, calls the host, or changes another client. No other component mutates `[data-theme]`.

## Workbench behavior

`WorkspaceWorkbench` owns the idle editor preload (`useIdleEditorPreload`): when `panels/editorWarm`'s
`useEditorWarm` allows it (not phone-class, not `saveData`), it schedules one `whenFilesTreeIdle` preload of the
code view (2 s idle timeout, 1.5 s fallback delay), which also waits for a loading Files tree to paint. The
preload runs once per page, not per workspace switch, and `lib`'s `whenPageActive` holds it until the page
is visible and online, checking again right before it runs: a hidden tab would pay about 3.9 MB and a 50–70 ms task for nothing, and a preload
that fails offline makes Chromium cache the failed chunk for the session. Once the preload has finished,
the first desktop code-view open from any surface — Files, quick open, chat links, review — renders
without a loading fallback; other renderers still load on their first mount.

The durable frame grammar and pure operations belong to [[submodule-web-shell-layout]]. Zustand carries one `WorkbenchFrame`, local layout preferences, and keyed `WorkspaceViewState` values; the mounted document is derived and never persisted as a second authority. Frame-plus-view transitions commit atomically through `layoutState`.

Auxiliary tools use persistent edge rails whose clusters mirror the panes; terminal groups are always
separate panes (tools and terminals never share one) and expose named session tabs inside their pane.
Center resources keep their existing strips. Rail activation changes only selection/visibility through
the layout engine; New terminal remains the only creation action, and the layout owns its placement
(into a terminal pane, or into a new pane below a tool pane) — the shell injects no side-menu actions. The
workbench receives workspace identity explicitly to fence pending drag/focus work without remounting.

Resource opens route to that workspace's last-focused surviving center group. Reopening a canonical resource selects its local placement rather than duplicating it. Resource close does not remove the frame group when it becomes empty. Explicit split/add/remove/merge commands own topology; group removal deterministically rehomes resources from every locally retained workspace view before one state commit. Applying a preset follows the same all-views rule. Moving a singleton tool or resizing/folding/showing a region changes the one frame; moving a file/chat/diff/document/terminal among existing groups changes only the active workspace view. Pointer/resize drafts stay runtime-local and publish one local transition on completion.

The layout persistence boundary is `layoutState`, not the store. Browsers qualify state by backend endpoint and frontend-surface identity; native windows use the injected stable string adapter's profile/window scope with a fixed key independent of the host's dynamic port. Both paths persist and decode the same bounded document. State is schema-validated on load and restored on reload or supported window-session restoration. Simultaneous windows do not observe each other's storage writes. A surface with no valid local document starts from the Balanced frame; old host snapshots and old browser attention keys are never read.

Project/file/change/review/chat/terminal views receive only resource identity, visibility, and container bounds. Moving a view cannot change module dependencies or make it inspect the frame. A terminal body mounts only while that terminal is locally selected in a visible, unfolded group; hidden terminal tabs stay unmounted while their host PTYs continue running.

Every async resource/session/catalog hydration checks connection generation, workspace lifetime, and the current local frame/view identity before installing data or a follow-up placement. A peer-created chat remains discoverable through host history but does not open a local tab. Host terminal catalog membership is shared: reconciliation removes dead local references and places a newly discovered catalog tab into a compatible local terminal slot without changing frame geometry or stealing attention. Explicit terminal close remains host-domain lifetime and converges removal in every surface.

Default-terminal creation no longer depends on a host layout revision. The workspace-creation flow carries a host-owned pending marker; the host reserves the deterministic process-free terminal catalog entry and clears the marker only after durable success. Each frontend then places the catalog tab locally, normally into its bottom slot; PTY attach still waits for the visibility gate.

## Layout settings

Built-in presets remain web-owned. The Layout section presents built-ins plus the host-synchronized custom preset catalog, while default preset selection and independent side/bottom limits are local to this frontend surface. The selected default is the explicit Reset frame target; it is not reapplied on workspace switches because every workspace shares the current frame. Capture/rename/delete changes only the shared custom definition. Which preset is applied is never stored: a card reads as applied while the live frame matches that preset's geometry (`frameMatchesPreset`), so a manual resize simply clears the mark. Apply or Reset (each behind one confirm) replaces this window's frame and reflows all retained workspace views, preserving resource identities, then persists locally; another frontend is unaffected. A preset card keeps its actions inside the card: a longer translated label wraps the action row instead of overflowing onto the neighbouring card.

## Long-operation feedback

Starting an agent session is seconds-long (watcher readiness + `session.create`), so it is never silent:
every chat-start path — the New-chat buttons (empty center and tab bar) and Settings › MCP servers' *Open a
chat*, which share `panels/openChat`'s `startChatInTab`, `NewWorkspaceDialog`'s create-and-kick-off flow,
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
prefilled with the **real** title (empty for an unnamed chat, never its first-prompt label), focused, and
selected. Enter or blur commits, Escape cancels, and blank, over-80-character, and
unchanged values never issue a request. Keyboard commit/cancel restores the replacement tab or history-row
control; pointer blur preserves the user's new focus target. The named, viewport-bounded interactive history
popover remains open and scrollable while its row is edited. The controls render only when the welcome
protocol supports `session.rename`.

**Unnamed chats read as their first prompt.** Every shell surface that shows a chat title renders one
`lib` `chatLabel` (the store's `selectChatTitle` for panels): a real name wins; a chat the agent has not
named yet shows the head of its first prompt in the same style as a named chat, else the generic label —
the search palette's chat rows included. The element carries the label's
`data-title-source="name" | "prompt" | "default"` and, for a prompt label, the full first line as its
tooltip. The tab strip receives the prompts as the Workbench's `chatFirstPrompts` prop
(`selectUnnamedChatFirstPrompts`, by session id, covering a plan document's chat too) beside the rename
callback — the layout document itself is never relabelled, because every Workbench mutation commits a
derivative of the document it was given and a relabelled copy would persist the fallback as the tab's
name; `openPlan` likewise stores the real chat name (and the title fold renames the plan tab with its
chat), so the plan tab is worded at render and follows the real title once it lands. Recently closed
rows read `selectChatFirstPrompt` (the host's state record first, so a row a peer's `session.created` added
without a prompt picks it up from the next state push); the palette's chat rows read the same selector
through `selectRecordFirstPrompts` ([[submodule-web-search]]). Nothing writes the label: the agent's
`set_title` or a manual rename replaces it everywhere through the same `session_info_changed` fold.

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
- `Mod+K` and double Shift open the search palette ([[submodule-web-search]]); the topbar search button is the pointer route. `SearchPaletteHost` mounts the palette only while `searchOpen` is true and composes everything it runs from the shell side: `paletteCatalog.ts` builds the command list (every chord-bound action listed with its shortcut, calling the same handler its owner binds) and the Settings section rows (each opens its section — the palette never flips a setting in place); `useSearchPalette` turns store state into the props-driven palette's items — work items from `buildWorkItems` over the normalized attention snapshot (`sessionStateByWorkspace`), so chats in workspaces this client has not loaded still appear, their titles backfilled with `workspace.list` / `session.list` while the palette is open (`paletteBackfill.ts`) — every open project whose workspace list this client has not loaded, or whose list lacks a workspace the session snapshot reports (a peer created it while this client was away), is listed without diff stats and merged in the host's order without replacing rows already held (so a collapsed project's workspaces are searchable, and no worktree is diffed for it); every workspace with a chat whose title is still unknown — and, after a reconnect, every workspace listed before, since a rename may have been missed while away — is asked, active and context-project ones first, and its sessions are recorded through `noteClosedChats` into the history projection, so the palette keeps no title cache and a rename broadcast reaches these rows like any other; a reply is installed only if no rename landed while it was in flight (`sessionTitleRevision`) and the connection is the same, otherwise it is dropped and asked again; both queues hold four requests in flight across palette openings, never ask for a key already in flight but run it once more after it lands when it was asked for meanwhile, a workspace is asked again only when its set of sessions or the welcome generation changes (a host-refused read included, so a broken transcript is not re-scanned; a timeout is retried on the next schedule), and while the palette is open the backfill watches the store and re-reads the queues whenever the welcome generation, the open projects, the normalized snapshot's sessions or the rename revision change (a palette opened during cold-start hydration catches up without reopening, and a listing a rename overtook is asked again); the former switcher's attention set minus running chats is the empty state's **Waiting for you** group (`selectSwitcherGroups`), and the context project / active workspace are ranking boosts. A pick navigates through `activateWorkspaceFromRoute` / `selectProject`; a chat whose workspace row this client has not loaded first loads its project's list without diff stats and merges it in (`paletteNavigation.ts`, the backfill's merge), and opens only if it is still the latest pick — a project pick counts — and no navigation (workspace, Project Home or a counted tab switch — the workspace's navigation tick, so a tab an earlier route target opens on its own does not count) happened while the list loaded; **Work in project folder** hands the same guard (`beginPick`) to `enterDefaultWorkspace` as its `stillWanted`, so a late `workspace.list` reply does not pull the user back to the Default workspace. Open state lives in [[submodule-web-store]] (`searchOpen` + `openSearch` / `closeSearch`) so an aggregate attention notification from [[submodule-web-notifications]] can surface the palette on click; the host keys the palette on `searchSession`, so that click resets an already-open palette to its Waiting view. The palette opens over the first-run wizard as the topbar Settings button does: its project commands end the wizard the way the wizard's own project cards do, and the analytics consent window still follows. The open palette is the topmost chord layer and owns its own keys (`Mod+K` and double Shift → close, Escape in its own order), so the global `Mod+K` is suppressed behind it like behind any modal; `Ctrl+R` is swallowed, not acted upon, while it is open (plain `Ctrl+R` reloads browsers on Windows/Linux). The global chord accepts neither Shift nor Alt; outside the palette it keeps winning over Monaco's `⌘K` chord prefix, as before.
- Double Shift is detected by the pure `createDoubleShiftDetector` from capture-phase `keydown`/`keyup`; `pointerdown`, window blur and a hidden document reset it, and it does not fire through another open modal. It is off per client through the `doubleShiftSearch` preference (the Keyboard settings section `search` exports and shell injects into `SettingsDialog`, like Layout and Updates).
- Row and header glyphs reuse the `ProjectTree` vocabulary: a leading `RiChat2Line` (wrapped in `RunningIcon` while running) and a trailing `AttentionDot` for a session that needs attention — no bespoke per-outcome glyphs.

Letter chords match physical `KeyboardEvent.code`, never layout-dependent `key`. The layout and create chords remain app-owned inside xterm, do not repeat, and are suppressed while a modal dialog is open. With no active workspace, right/bottom chords neither act nor swallow the browser chord; `Mod+B` toggles the Project Home Projects pane with the focus rules above. With no context project, `Mod+N` likewise neither acts nor swallows. Terminal `Ctrl+R` still belongs to xterm; `Ctrl+Shift+R`, macOS `Cmd+R`, F5, and browser reload remain untouched. All other arrangement operations are exposed by the layout command/menu system in [[submodule-web-shell-layout]].

**Native shortcuts.** Shell always mounts the `AppShortcuts` leaf. `useAppShortcuts` reads `NativeShortcutsBridge` (`__THINKRAIL_NATIVE_SHORTCUTS__`, [[module-contracts]]; desktop hosts only) once. Without the bridge it adds no listeners and renders nothing. With the bridge, the leaf renders the hint, so hint changes re-render only that leaf. Every app-level close/quit/settings shortcut dispatches through one command table, `shortcutCommands.ts`: a command id (`close-item`, `quit`, `open-settings`) maps to Ctrl chords per shortcut platform, each chord carrying its terminal rule, and the hook supplies the id → handler map. Both native commands from `subscribeCommand` and web keydown chords run the same handler. The shortcut platform is `platformFamily()` (`apple` / `windows` / `linux`) when the bridge exists, else `browser`.

| Platform | Quit | Close item | Open Settings |
| --- | --- | --- | --- |
| apple | native Cmd+Q (host-confirmed) | native Cmd+W | native Cmd+, |
| linux | web Ctrl+Q (web-confirmed) | web Ctrl+W, Ctrl+F4 | web Ctrl+, |
| windows | none (Alt+F4 is the OS window close) | web Ctrl+W, Ctrl+F4 | web Ctrl+, |
| browser | none | none | none |

Web chords are Ctrl only (no Meta/Alt; no Shift except where it produces a punctuation chord's character), handled in the window capture phase, and act once per physical press: a repeat keydown is swallowed but never runs. Inside xterm, Ctrl+W is neither handled nor prevented, so the shell gets it; Ctrl+F4, Ctrl+Q, and Ctrl+, stay app-owned. The table binds nothing on apple (native owns those chords) and nothing in a browser, so the hook adds window key listeners only where `hasWebShortcuts` is true. Letter chords match the typed Latin letter (`key`), falling back to `code` when the layout types a non-Latin letter; Punctuation chords (Ctrl+,) match the typed ASCII character, Shift allowed when it produced it (Russian Windows Shift+/), falling back to `code` without Shift when the layout types a non-ASCII character there — so AZERTY's `Comma` key (`;`) and US Shift+Comma (`<`) do not match; the macOS menu also matches by character. F4 matches `code`. This is the deliberate exception to the physical-`code` rule above: close and quit are destructive, and on AZERTY or Dvorak the W/Q positions type undo or select-all. Modifiers and the chord match first; the xterm check runs only for a matched chord. Web-owned chords do not fire while focus is inside the sandboxed HTML preview iframe: its keydowns never reach the parent window.

`open-settings` (native or web) opens Settings at its default section only when no modal layer is open: an already-open Settings stays as it is (section and drafts kept) and another dialog keeps the keyboard. The guard lives here, not in the store's `openSettings`, whose callers deep-link sections. The browser deliberately binds no Settings chord: Mac browsers own Cmd+, for their own settings, and the desktop is the primary surface. The Settings gear tooltip advertises the chord (`Settings (⌘,)` / `Settings (Ctrl+,)`) only where it is bound, from the same bridge-and-platform read (`readSettingsShortcutLabel`).

Quit confirmation runs the shared contracts `createQuitConfirmation` rule in both places: the host on macOS, the web on Linux. The web adapter tracks held from the Ctrl+Q keydown until keyup of that same physical `code` or Control, calls `sync()` on keyup, and treats window blur or a hidden document as `cancel()`: an already-confirmed gesture (hint `release`) quits, otherwise it hides. A confirmed quit calls `bridge.quit()` once; if it rejects, the adapter resets the rule so the pill hides and Ctrl+Q works again. Either way the web renders the hint as `QuitHintOverlay`, one centered, `pointer-events-none` `role="status"` pill that fades out on `hidden` and keeps the last text while fading; the text names the platform chord (`⌘Q` / `Ctrl+Q`).

`close-item` is never a window close: if a dismissible layer is open (modal or open Radix dialog/alertdialog/menu anywhere; a chat history overlay only inside the DOM-focused group, or anywhere when no group has focus; selectors and the xterm test shared with `useGlobalHotkeys` in `shortcutLayers.ts`), the hook dispatches `Escape` to the focused element so each layer keeps its own Escape semantics. The Escape is synthetic (untrusted), so each dismissible layer must catch Escape at document/window level or on an ancestor of focus and must not filter on `isTrusted`; Radix `DismissableLayer` (document capture) and `HistoryOverlay` (window capture) do, and e2e `close-quit-shortcuts` guards it. Otherwise it fires `requestClose` on the shell-owned `closeRequestChannel.ts` (injected into the workbench as `subscribeCloseRequest`, so no render cascade), and the workbench closes the selected tab of the focused group, else of the last-focused center group, through the same `onRequestClose` path as the tab X (terminal confirmation included). Singleton tools, folded groups, and whole regions are never closed; nothing closable is a no-op. With no active workspace only the layer step applies. Each chord has one owner: a chord in the command table is never also bound in `useGlobalHotkeys`, and a chord the host forwards natively is never in the table for that platform.
