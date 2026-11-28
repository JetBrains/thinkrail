---
id: submodule-web-shell
type: submodule-design
status: active
title: shell — responsive frame
parent: module-web
tags: [ui]
references: [module-desktop, module-contracts, submodule-web-settingskit]
---

## Responsibility

The responsive composition root: top-level app chrome, active-project/workspace routing, theme application, global shortcuts, region error isolation, and composition of layout-agnostic panels into one frontend-local desktop workbench frame. A future mobile shell may project the same panels differently; it must not inherit desktop docking accidentally.

## Boundary

- **Owns:** `Shell` as the one composition root; topbar and persistent location context; active-project/workspace routing; single Settings, analytics-consent, survey-invitation, survey-window, attention-notification permission-preface, and Toaster mounts plus the keyboard-opened Create workspace dialog, the `Mod+K` / double-Shift search palette host, the `Mod+Shift+F` Find in Files host, the `Ctrl+Tab` recent workspace switcher and the `Mod+?` keyboard-shortcuts dialog (and the once-mounted attention-notification observer from [[submodule-web-notifications]]); the enabled web extensions' global overlays (`ExtensionOverlays`, *Global chords*); theme application and global shortcuts; focus recovery (*Focus recovery*) and the Esc that leaves a text field, then climbs to the main area (*Esc leaves a text field*, *Esc climbs to the main area*); the command catalog the palette runs ([[submodule-web-commands]], [[submodule-web-search]]); the injected Layout, Keyboard and optional application Update settings sections; and integration of the workbench engine with store, persistence, panels, transport-backed domain state, and error boundaries.
- **Public surface:** `Shell`.
- **Allowed deps:** child layout modules; `updates`; `settingsKit` (the Layout and Keyboard sections' blocks, and `SETTING_ATTR`, by which `chordActions` and `useAppShortcuts` find the Settings layer); `search` + `commands` (the palette and the command contract it composes for it); `keybindings` (the chord table and resolver `useGlobalHotkeys` matches through and the palette's shortcuts read, and the shortcut catalog the cheatsheet renders); `findInFiles` (the window `FindInFilesHost` composes); `extensions` (the enabled extensions whose overlays and shortcut rows it mounts, every extension's commands it resolves, and the panel list) and `@thinkrail/extension-api/web` (panel types); `panels`; `chat` app-integration hydration/rendering; `store`, `transport`, contracts (types, wire constants, and the shared `createQuitConfirmation` rule), `@thinkrail/ui/*`, `@thinkrail/locales` (UI strings), `i18n` (`useLocaleSync`, mounted once), `components/ErrorBoundary`, `components/QuietScrollArea`, `constants`, `lib`, `themes`, and `clientPreferences` (`markdownOutlinePreference` persists the store's Markdown outline visibility and side per client, through the same adapter `layoutState` uses).
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
fullscreen. The `data-window-chrome-drag-region` attribute on `<html>` drives the header's `window-drag`
utility, which resolves to `no-drag` unless the host publishes `drag`, so a browser tab or a natively
decorated window never gains a drag strip. Padding was deliberately not used for the inset: the `spacingUsage` gate lets padding utilities
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

With an active workspace, `Shell` mounts the workbench directly; only a lazy Pierre resource body mounts a worker-pool provider, so an ordinary workspace neither requests Pierre's chunk nor starts its shared pool. Switching workspace changes resource contents and attention but never frame topology, Projects/Specs/Files/Review placement, side/bottom geometry, folds, visibility, alignment, or which singleton tool a group shows (a selected workspace resource such as a terminal stays per workspace). That is a React invariant too: `WorkspaceWorkbench` stays mounted across a switch and is re-targeted by its `workspaceId` prop, never keyed by workspace. The frame chrome—panel groups, persistent edge rails, side/bottom stacks, center strips, and the Projects tree—keeps its DOM; resource bodies and per-workspace tool contents swap. An auxiliary header may switch between its tool title and terminal-session strip according to workspace-local selection, without replacing the pane shell. Resource bodies are keyed by workspace as well as resource id, because some layout ids are deterministic (every workspace's initial terminal is `terminal:thinkrail-initial`): the same id must never carry one workspace's live xterm or pane into another's commit. A switch therefore paints no fade, skeleton, or empty frame for the chrome, and every hook the workbench calls must tolerate a changing `workspaceId`: state that belongs to one workspace is qualified by that id or lives in a workspace-keyed store slice, and no readiness flag computed for the previous workspace may be read for one effect pass against the next one. A first visit to a workspace whose local view has not been materialized yet does not remount either: once the frame is ready, the workbench renders the empty-view projection of that frame for the single commit before `layoutState` installs the identical view, so the frame keys never change. The "Restoring workspace layout" placeholder exists only before the local frame has hydrated. Entering or leaving Project Home swaps Shell branches and is not a workspace switch. A **chat without a project** (`kind: "chat"`) is a workspace to the frame — the same chrome, placements and rails — with an availability projection on top: the Specs and Review tool bodies, and any `changes` or git `diff` center body, render "Not available in a chat without a project" instead of asking the host (no `spec.graph`, `review.get`, `workspace.turns`, git status or branch-status polling for a chat — the Plan page likewise skips branch status and hides its branch line, commits menu and Open PR), Files, terminals, Plan and a file comparison (two of the chat's files, no git) work on the chat's folder, the empty center reads *Chats · Chat* and its New chat starts a sibling chat, and switching chat ↔ workspace never changes the frame. `Shell` opens the Create dialog for `selectContextRepoProject` — or with no repository (`projectId: null`) when the host supports chats, which forces the dialog's chat target. Shell-owned wrappers around Projects and Specs use `components/QuietScrollArea`, as does the Project Home navigator; Files, Review, and xterm own their internal quiet-scroll surfaces in `panels`. These primitives never receive or infer placement. A frame command that changes the shape (fold/unfold, side or bottom visibility, alignment, group add/remove, preset apply/reset) never remounts the workbench's `ResizablePanelGroup`s or the resource bodies inside them: panels are added and removed in place and the engine enforces the committed sizes imperatively ([[submodule-web-shell-layout]], *Shape changes without remounts*), so a chat transcript, editor, terminal, or tool pane keeps its DOM and state while a neighbouring pane appears or disappears. Only a side stack that moves between the outer column and the aligned row (an alignment change, or hiding/showing a side that owns a bottom corner) remounts, because it changes parent. Without an active workspace, Shell mounts `ProjectHome`: Welcome beside the projects navigator using separate local geometry (the `thinkrail-shell-welcome` autosave plus a remembered expand size), never the workbench frame; its only tie to the frame is the pristine default — the pane opens at the built-in Balanced preset's left width, so a fresh surface shows the same Projects edge on Home and in the workbench. Its chrome is the workbench's: the same persistent 40 px left tool rail with one Projects entry (selected fill and Fill icon while shown, `aria-pressed`, `aria-controls` the pane), the same footer — the extensions' rail icons above the keyboard-shortcuts icon (`useLeftRailFooter`, *Extension panels*) —, and the same plain pane header with a Hide control, composed from the primitives `layout` exports ([[submodule-web-shell-layout]]) around a shell-owned `useCollapsibleRegion`. While onboarding is active (`selectOnboardingActive` — the cold-start wizard shown, or still pending on a cold-start-shaped store) the rail and the Projects pane are not rendered at all, so a first-run user with no project and no model sees only the wizard; the Welcome panel stays mounted in place (panels are removed, not the group), so finishing the wizard keeps its hand-off dialog. No right or bottom rail renders there: Specs, Files, Review, and terminals are workspace resources, so an empty rail would advertise tools that cannot act. The rail entry, Hide, and `Mod+B` are one toggle: hiding returns focus to the rail control when focus was anywhere in the pane (header included) or on its separator, and leaves it alone otherwise; showing focuses the last-focused tree control, else the active row, else the first control — the header's Hide button is never the landing spot. Hiding Projects inside a workspace does not hide it on Project Home: Home is the navigation surface and keeps its own state. The Settings dialog, analytics-consent window, addressed survey invitation, the survey window, attention-notification permission preface, and Toasts each mount once above both branches (while the onboarding wizard is active, it asks for consent through its own privacy step instead and shell holds its window); the attention-notification observer (`useAttentionNotifications`) likewise runs once here. The consent window is a layout-agnostic panel shared by browser and desktop clients, gated by hydrated host configuration and protocol support; shell owns only its placement. Consent takes precedence over the automatic survey invitation so startup never stacks both prompts; the invitation waits and shows once consent closes.
After `main.tsx`'s synchronous first-paint apply, Shell is the sole mounted theme side-effect owner. While `welcomeGeneration === 0` it retains the versioned preference hint; afterward it projects store's opaque fixed id + fixed/system mode + optional pair through `themes` and writes the reconciled hint. Fixed mode has no media listener. System mode owns exactly one `prefers-color-scheme` listener, reapplies the locally resolved slot on change, and cleans it up on preference/unmount; that local event never mutates store, calls the host, or changes another client. No other component mutates `[data-theme]`.

`AppResourceHost` registers the bundled resource renderers once, at import, with interactive-HTML globs for
`WORKSPACE_MOCKUP_DIR` — and none when `hasNativeMessageBridge(globalThis)` finds an Electrobun or WebView2
message bridge on the page, because those answer every frame and a mockup script could reach native code
([[module-resource-renderers]], [[electrobun-compatibility]]). The check runs after the desktop preload,
which installs the bridges before any page script.

## Workbench behavior

Chat tabs show the shared `AttentionDot` when their own normalized session state needs input or has an
unread completion. A tab-local subscriber reads the store selector without invalidating the workbench's
render callbacks. Selection alone does not clear the dot; the existing host state and completion-read
acknowledgment remain authoritative. Tab markers do not move focus or change layout.

`WorkspaceWorkbench` owns the idle editor preload (`useIdleEditorPreload`): when `panels/editorWarm`'s
`useEditorWarm` allows it (not phone-class, not `saveData`), it schedules one `whenFilesTreeIdle` preload of the
code view (2 s idle timeout, 1.5 s fallback delay), which also waits for a loading Files tree to paint. The
preload runs once per page, not per workspace switch, and `lib`'s `whenPageActive` holds it until the page
is visible and online, checking again right before it runs: a hidden tab would pay about 3.9 MB and a 50–70 ms task for nothing, and a preload
that fails offline makes engines that cache failed module fetches (Chromium before 156) keep the failed chunk
for the session; newer Chromium refetches it on the next load. Once the preload has finished,
the first desktop code-view open from any surface — Files, quick open, chat links, review — renders
without a loading fallback; other renderers still load on their first mount.

The durable frame grammar and pure operations belong to [[submodule-web-shell-layout]]. Zustand carries one `WorkbenchFrame`, local layout preferences, and keyed `WorkspaceViewState` values; the mounted document is derived and never persisted as a second authority. Frame-plus-view transitions commit atomically through `layoutState`.

Auxiliary tools use persistent edge rails whose clusters mirror the panes; terminal groups are always
separate panes (tools and terminals never share one) and expose named session tabs inside their pane.
Center resources keep their existing strips. Rail activation changes only selection/visibility through
the layout engine; New terminal remains the only creation action, and the layout owns its placement
(into a terminal pane, or into a new pane below a tool pane) — the shell injects no side-menu actions. The
workbench receives workspace identity explicitly to fence pending drag/focus work without remounting.

**Where focus goes on an open** (user, 2026-11-20; VS Code's rule). An open asks the layout to focus
the opened tab's button by default. A keyboard open from a tree — Enter on a row (its click has
`detail === 0`) or Mod+Enter — and a search-palette file pick open with `focus: "content"`
(`panels`' `KEYBOARD_OPEN` / `treeOpenFocus`, through `openFileInTab`'s options, `LayoutOpenOptions.focus`
and the `open` intent into a content focus request, [[submodule-web-shell-layout]]): focus lands on
the tab's `[data-focus-default]` target once it renders — a reading surface, the Markdown block cursor or
the read-only editor ([[module-resource-renderers]]); a view with none keeps the tab button (an image,
and HTML, whose frame would swallow every key). A pointer click from a tree opens with
`focus: "none"`, so focus stays on the row; a double click keeps today's tab-button focus. The trees
that share it: Files, Specs and Artifacts (their Outputs too); Changes opens diffs and keeps the
tab-button focus.

Resource opens route to that workspace's last-focused surviving center group. Reopening a canonical resource selects its local placement rather than duplicating it. Resource close does not remove the frame group when it becomes empty. Explicit split/add/remove/merge commands own topology; group removal deterministically rehomes resources from every locally retained workspace view before one state commit. Applying a preset follows the same all-views rule. Moving a singleton tool or resizing/folding/showing a region changes the one frame; moving a file/chat/diff/document/terminal among existing groups changes only the active workspace view. Pointer/resize drafts stay runtime-local and publish one local transition on completion.

The layout persistence boundary is `layoutState`, not the store. Browsers qualify state by backend endpoint and frontend-surface identity; native windows use the injected stable string adapter's profile/window scope with a fixed key independent of the host's dynamic port. Both paths persist and decode the same bounded document. State is schema-validated on load and restored on reload or supported window-session restoration. Simultaneous windows do not observe each other's storage writes. A surface with no valid local document starts from the Balanced frame; old host snapshots and old browser attention keys are never read.

Project/file/change/review/chat/terminal views receive only resource identity, visibility, and container bounds. Moving a view cannot change module dependencies or make it inspect the frame. A terminal body mounts only while that terminal is locally selected in a visible, unfolded group; hidden terminal tabs stay unmounted while their host PTYs continue running.

Every async resource/session/catalog hydration checks connection generation, workspace lifetime, and the current local frame/view identity before installing data or a follow-up placement. A peer-created chat remains discoverable through host history but does not open a local tab. Host terminal catalog membership is shared: reconciliation removes dead local references and places a newly discovered catalog tab into a compatible local terminal slot without changing frame geometry or stealing attention. Explicit terminal close remains host-domain lifetime and converges removal in every surface.

Default-terminal creation no longer depends on a host layout revision. The workspace-creation flow carries a host-owned pending marker; the host reserves the deterministic process-free terminal catalog entry and clears the marker only after durable success. Each frontend then places the catalog tab locally, normally into its bottom slot; PTY attach still waits for the visibility gate.

## Extension panels

An `extension` center tab hosts a panel an extension's web half declares; the shell knows panels only
through the web registry ([[submodule-web-extensions]]), never by name. `ExtensionPanelBody` looks the
tab's extension and panel up and renders a placeholder instead of the panel, first match wins
(`extensionPanelState`): missing (no web registration), unsupported (the host predates `extension.query`,
`supportsExtensionQuery`, v130), disabled (in `disabledExtensions`, with *Open Settings*, decided before
the catalog arrives), the catalog read failed (with *Retry*), missing (the extension is absent from the
host's `extension.list`); a host not yet welcomed or a catalog still loading shows a loading region.
Otherwise it lazy-loads the panel (one `React.lazy` per declaration) inside its own `ErrorBoundary`
(`reportId: "extension-panel"`) and hands it a `PanelHost` (`extensionPanelHost.ts`) built over transport
and the shared `paletteNavigator`: `query` is `extension.query` for that extension only, refused locally
as `UNKNOWN_EXTENSION_QUERY` below v130; `openChat` enters the target workspace through the navigator
with the chat as its route target, so chat reconciliation opens it like any palette pick, and with an
anchor it loads the workspace row and sets the store's `chatLocationRequest` (message index, anchor text,
tool call, approximate) — the same jump the history search uses; `openPanel` looks the extension's own
panel up in the registry and opens its tab in this workspace's view, named with the given title (tab
`name`, which wins over the title key); `renderToolCall` renders `chat/ToolCallPreview` — the tool's
registered renderer, no card, fold or interaction — inside its own `ErrorBoundary`
(`reportId: "extension-panel-tool-call"`); `openFile` opens the workspace-relative path through
`panels/openTabs` (`openFileAtLine` with a line, else `openFileInTab`, both as a kept tab), first entering
the target workspace through the navigator when it is not the panel's own; `openArtifacts` reveals this
workspace's Artifacts tool on a view that lists the extension's write (`panels/artifactActions`
`revealArtifactsListing`: Outputs, which lists only what the agent published, becomes List); and
`hostApiVersion` comes from the extension's catalog entry, read once per connection generation (a failed
read is forgotten, so *Retry* asks again). A panel therefore never reaches the store or transport itself.
The host is memoized per mount, so a re-render never reloads the panel.

**A chat pane** is the second placement ([[module-extension-api]]'s `chatPane`): the panel sits beside
its chat inside the chat's center tab. `ChatResourceBody` reads the chat's pane through
`useExtensionChatPane` and injects it into `ChatView` as a `chat/ChatPaneSplit` slot (its id — the chat
action's —, title, width and close and resize callbacks, and the body as an element), so `chat` imports
neither `shell` nor `extensions` ([[submodule-web-chat]]). The pane body (`ExtensionChatPaneBody`) and
the tab body share one gate (`useExtensionPanelGate` → `extensionPanelState`) and one renderer
(`GatedExtensionPanel`: placeholders, loading region, lazy load, `ErrorBoundary`), keyed by chat and
panel so replacing the panel remounts it. A pane shows only while its panel is openable
(`chatPaneShown`: ready, loading, or a failed catalog read with *Retry*); while it is not — the
extension switched off in Settings, a host too old, the catalog lacking it — the chat takes its full
width, and the stored pane returns with the extension. Its `PanelHost` has `placement: "chatPane"` and
the pane members: `showInChat(at)` sets `chatLocationRequest` for this chat with `focus: false` — the
chat is already shown, so nothing navigates and focus stays in the pane; `openAsTab()`
(`moveChatPaneToTab`) opens the tab the chat action's tab path opens (same params, the chat's title),
hands the pane's saved view state to that tab's key first (`transferPanelViewState`), then closes the
pane; `closePane()` closes it. A tab's host has `placement: "tab"` and no pane members.

**Panel view state** lives in the store, runtime only (not persisted across reloads): one JSON-like
value per extension tab (keyed by the tab's resource identity — extension, panel and params, the tuple
its doc id is minted from, so a placement alias cannot split it) and per chat pane (`chatPaneViewKey`:
chat, extension, panel), both under the workspace. The host reads it once, in a `useState`
initializer, when the panel mounts — a tab brought back remounts and restores it — and
`saveViewState` writes through `savePanelViewState`, which no component subscribes to, so saving
re-renders nothing. A view handed over by *Open as tab* bumps the key's epoch: the one subscriber, the
panel frame's `selectPanelViewEpoch`, remounts a destination tab that is already mounted (visible in
another group) on the handed-over view, and the host it replaced saves nothing more (each host saves
only while the epoch it mounted with is current), so its unmount cannot write back the old view. A
save whose owner is gone writes nothing (*store*'s `savePanelViewState`: no tab of that identity left in
the workspace's view, or a pane key whose chat has no pane or is deleted), so the unmount flush after a
close or a chat deletion cannot bring a dropped value back. Closing an extension tab drops its value by
the closed identity (`releaseClosedTab` → `dropPanelViewState`), cached or not — a tab restored from the
layout has no cache —, deleting a chat drops its pane and the pane's values, and removing a workspace
drops all of them; a closed chat keeps its pane, so reopening it shows the pane again.

**Which panels an entry point offers is one rule**, `openableExtensionPanels` (`extensionPanelHost.ts`;
`useOpenableExtensionPanels()` reads it from the store and the host's catalog): a panel is openable
while its web registration declares it, its extension is not in `disabledExtensions`, the host answers
`extension.query` (`supportsExtensionQuery`), and — once the catalog of this connection is read
(`useExtensionCatalog`, shared with the tab body) — the host lists the extension; while the catalog
loads or failed, the protocol gate alone decides. A payload-version skew is not filtered: the panel's own
update notice is the answer to it. Every entry point below reads this rule (a chord, at event time,
through `currentOpenableExtensionPanels` over the cached catalog), so a switched-off extension is offered
nowhere while its restored tabs show the placeholder.

The palette lists `view.extension.<ext>.<panel>` for every openable panel whose `scopes` include
`project` (a `session`-only panel opens only from another panel, with its params), matching its
translated `keywords` beside its title. With a workspace active it opens one tab per (extension, panel,
params) in that workspace's view ([[submodule-web-shell-layout]]), focusing an existing one; on a
project's Home it enters the project's Default workspace first (`openExtensionPanelInProject`, under the
palette's `beginPick` guard like *Work in project folder* and *Ask the agent*) and opens the tab there. A
panel whose `rail` names a command shows that command's current chord on its row.

**Entry points** (`extensionEntryPoints.tsx`; the SDK seams are [[module-extension-api]]'s `chatAction`
and `rail`, and nothing here names an extension):
- **For a chat.** `useChatActions()` maps every openable panel with a `chatAction` to a `lib` `ChatAction`
  (its header label — the action's `label`, else the panel's `title` —, its `menuLabel`, the panel's icon
  and `run`), which the shell hands to every chat surface: `ChatView` (its header link,
  [[submodule-web-chat]]), `ProjectTree` for the Chats list's row menu ([[submodule-web-panels]]), the
  recently closed popover (an icon button per row, before *Rename*) and, bound per chat tab whose chat has a
  session file (`useChatTabActions`, the store's `selectPersistedChatTabs`), the tab menu and the palette's
  *Active tab* group. Each surface shows them only for a chat with a session file (`selectChatPersisted`:
  pi writes the file with the first message, so an empty chat has nothing to read). `run` opens the panel
  with the action's `params` for that chat in the active workspace — on Project Home it enters the chat's
  workspace first — and names the tab after the chat (its known title, else its first prompt), so
  opening the same chat's panel again focuses that tab. **One routing rule** covers every one of those
  surfaces (`openExtensionPanelForChat`): a `chatPane` panel whose chat has a tab in the center of the
  active workspace's view (`selectChatPlacedInCenter`) opens beside it instead — the chat's tab is
  selected first when it is not the attended one (`openChatInTab`), then the store's per-chat pane opens
  (`openChatPane`, replacing another panel's pane, keeping the width) and, for a `wide` panel, the
  shell's `hideAllPanels` runs once; a pane already showing that panel stays as it is. Anywhere else —
  the chat not open, open in another workspace, Project Home, a recently closed chat — and for a panel
  without `chatPane`, the tab opens as above. Such an action carries `pane: true`, which `ChatView`'s
  header shows as a toggle; the menus keep a plain item. Chat and panels code never reads the registry;
  a store action was not needed, since the shell mounts every surface that shows one.
- **The rail.** `useLeftRailFooter()` puts an icon for every openable panel with a `rail` (its `icon`,
  its `rail.label` or `title` with the rail command's current chord as tooltip) above the keyboard icon,
  in a workspace and on Project Home, whenever there is somewhere to open it (an active workspace, else a
  context repository). A click and the rail command's chord both run `openExtensionPanelHere`: the active
  workspace, else `openExtensionPanelInProject` for `selectContextRepoProject`, like the palette row.
  `useGlobalHotkeys` routes a matched extension command that is some panel's `rail.command`
  (`railCommandPanel`) to that panel instead of the overlay — only while the panel is openable and no
  modal is open, else the press is left alone — so the command lists, rebinds and shows under the
  extension's own area like any other ([[submodule-web-keybindings]]).

**Wide panels hide the panes once, when they open.** `openExtensionPanel`, which every entry point above
goes through as a tab — the palette row, the rail icon and its chord, a chat action's tab path and
`PanelHost.openPanel` —, calls `hideAllPanels` after opening the tab of a panel declaring `wide`
([[module-extension-api]]) only when that tab was not already placed in the workspace's view
(`selectLayoutIdentityPlacement`, read before `openDoc`); focusing an open one leaves the panes alone, so
a pane the user brought back with `Mod+B` stays. The chat-pane path is the same rule: a pane already
showing that panel hides nothing. Panes the user brought back hide again only when another wide panel
opens. Nothing restores them on its own; *Hide all panels* (*Global chords*) brings back what that hide
took. Switching tabs in the strip, restoring tabs on reload and Project Home's own navigator never hide
anything.

## Layout settings

Built-in presets remain web-owned. The Layout section presents built-ins plus the host-synchronized custom preset catalog, while default preset selection and independent side/bottom limits are local to this frontend surface. The selected default is the explicit Reset frame target; it is not reapplied on workspace switches because every workspace shares the current frame. Capture/rename/delete changes only the shared custom definition. Which preset is applied is never stored: a row reads as **Current** while the live frame matches that preset's geometry (`frameMatchesPreset`), so a manual resize simply clears the mark. Apply or Reset (each behind one confirm) replaces this window's frame and reflows all retained workspace views, preserving resource identities, then persists locally; another frontend is unaffected. A preset row keeps its buttons inside the row: a longer translated label wraps them instead of overflowing.

`LayoutSettings` is built on the Settings kit ([[submodule-web-settingskit]]) in two groups: **Presets** (the presets list, Add new layout, Reset to default and the Advanced group limits) and **Documents** (the Markdown outline position, moved from Appearance). [[submodule-web-panels]]' Settings paragraph describes each row once.

## Long-operation feedback

Starting an agent session is seconds-long (watcher readiness + `session.create`), so it is never silent:
every chat-start path — the New-chat buttons (empty center and tab bar) and Settings › MCP servers' *Open a
chat*, which share `panels/openChat`'s `startChatInTab`, `NewWorkspaceDialog`'s create-and-kick-off flow,
and reopening a closed chat (`openChatInTab`) — brackets its request with the store's per-workspace
chat-start counter (`beginChatStart`/`endChatStart`, a counter because starts can overlap). Worktree
creation is **host-owned state, not a client counter**: each background creation is a row under its project
and, when selected, the shell renders `panels/WorkspaceCreation`'s view in `ProjectHome`'s main pane (its
`main` slot) instead of the welcome surface — the list stays put and the new worktree lands where its row
was. The shell also mounts the creation chat handoff and a second `NewWorkspaceDialog` for the store's Edit &
retry draft. Consumers show it as an inline pending state where the result will appear: the empty-center button flips to a disabled
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
the search palette's chat rows, the Chats section, the topbar's chat segment and a chat workspace's empty
center included. The element carries the label's
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

`useGlobalHotkeys` remains the one capture-phase owner of app-wide chords. The chords are declared once in the [[submodule-web-keybindings]] table and resolved with the user's overrides and the web extensions' commands; `keybindingState.ts` is the one place that resolves — once per change of the store's `keybindingOverrides` (ignored below `supportsKeybindings`, so an older host runs the defaults) or `disabledExtensions` — and hands the result to the binder (`currentKeybindings()` at event time) and to every reader (`useResolvedKeybindings`, `useKeybindingKeys`, `useKeybindingLabel`). It resolves the local key sets too — `LOCAL_SETS`: the app's `APP_LOCAL_SET` and the resource renderers' `REVIEW_SURFACE_COMMANDS` as a ThinkRail set in scope `review.surface`, with the extensions' scoped commands in the same input — and `selectLocalKeymap`, memoized on the resolved table, is the value `Shell` provides through `@thinkrail/ui/local-keys`' `LocalKeymapProvider` around its whole tree (portals included), so every element's `useLocalKeys` sees a rebind at once. **The binder yields to a focused element's local keys:** `routeHotkey` asks `matchLocal(resolved, localScopesOf(target), event, { textEntry })` first and, on a hit, dispatches no app chord, extension command or history — the element's own handler acts. `shortcutSurface.ts`' `localScopesOf` walks from the focused element outward collecting the app's scope selectors (rail entry, transcript, composer, history overlay, Changes review, review surfaces, palette, Find in Files) and any `[data-key-scope]`, innermost first. The workbench tab strip and the app's tree declare theirs (`data-key-scope="tabs"` on `layout`'s tablist, `"trees"` on `panels`' `Tree`) instead of being matched by ARIA role: the question card's tab chips are ARIA tabs that handle no `tabs.*` command, so a role match made a `tabs.close` rebound onto Mod+L swallow Focus composer there (#1416's review); the cheatsheet's surface map reads the same markers. A scope whose handlers read a shifted press of an unshifted arrow twin as the extending arrow declares `extendsWithShift` ([[submodule-web-keybindings]]), and `matchLocal` yields that variant too, so a global chord on the Shift variant (Shift+Mod+J toggling the bottom panel once `arrows.down` is Mod+J) cannot take a review cursor's or the swipe divider's extension. `useGlobalHotkeys` matches through it (`matchKeybinding`, then an id → handler map whose missing handler means unavailable) and the palette shows each chord with `keybindingShortcut` over the same result, so a rebind applies and shows at once. It routes commands through the workbench command surface rather than imperative feature-panel refs:

- `Alt+1…9` / `Shift+Alt+1…9` (`suggestions.send1…9` / `edit1…9`) send or edit chip N of a chat's next-step
  row ([[submodule-web-chat]], *Composer suggestions*) from anywhere — a tree, a tab strip, the question
  card, the input — except inside xterm (readline keeps Alt+digit), inside Monaco (`isInCodeEditor`), behind
  a modal layer and while a claim holds the keyboard (hint mode). The target is the registered chat whose
  root contains `event.target`, else the one `selectHistoryTarget` names (the target `Ctrl+R` and Mod+L
  use, not a second notion of "the last chat"); `routeHotkey` routes the press only when that chat shows
  chip N (`hasSuggestion`), so otherwise it reaches the element untouched (macOS Option+digit types its
  character). A focused element's local key on the same chord still wins there. Focus stays put.
- `Ctrl+R` opens chat history for the locally selected chat, or the workspace's most-recent chat fallback; the literal `Ctrl+R` acts even during IME composition (it would reload the browser), while a chord the user rebinds history to waits composition out like every other chord;
- `Mod+B` toggles the left side, restoring local group/tab attention or an eligible singleton tool;
- `Mod+J` does the same for the right side;
- `Mod+Shift+J` toggles bottom, restoring local bottom attention, a bottom-targeted singleton, or the terminal creation surface;
- `Mod+Shift+F12` (`view.toggleAllPanels`, *Hide all panels*; JetBrains' *Hide All Tool Windows*) hides every
  one of left, right and bottom that shows — the toggles' own visibility: shown and not every group folded —
  and remembers exactly which it hid. The next press restores exactly those through the same show operations
  as `Mod+B` / `Mod+J` / `Mod+Shift+J` (local attention, an eligible singleton tool, the bottom creation
  surface), selecting what they would focus while focus stays where it is; hiding recovers focus like a side
  hide. Any commit that shows a pane — a rail entry, a side or bottom chord, a pane's Hide or unhide, a menu
  or palette layout command, a preset, a reveal — clears the memory, so the next press hides whatever shows.
  With nothing shown and nothing remembered it shows left and right. The memory is runtime-only (a reload
  starts with none; [[submodule-web-shell-layout-state]]). `chordActions.hideAllPanels(workspaceId)` is the
  hide half alone, into the same memory: it does nothing when nothing shows and never restores; opening (not focusing) a
  wide extension panel calls it (*Extension panels*);
- `Mod+N`, and its alias `Mod+Alt+N`, open `NewWorkspaceDialog` for the context project (the active workspace's project, else the selected project). The shell owns this one keyboard-opened instance as local state — it is not store state and not the `ProjectTree`/`WelcomePanel` instances, which keep their own return-focus and prompt-seeding semantics. `Mod+N` is the canonical chord and the one shortcut chrome advertises first; the alias exists because browsers reserve Cmd/Ctrl+N for a new window and never deliver it to the page, while the desktop webview does.
- `Mod+K`, double Shift and the topbar search button open the search palette ([[submodule-web-search]]). `SearchPaletteHost` mounts it only while `searchOpen` is true and composes what it runs: `paletteCatalog.ts` builds the command list for the current context (a command exists only where it applies; every chord-bound action shows its shortcut and runs the very function its chord runs — the side/bottom toggles, *Hide all panels* and history open live in `chordActions.ts`, which `useGlobalHotkeys` binds too), one row per Settings section, each opening its section, and one `setting:<entryId>` row per individual setting — the entries Settings search offers in this context (`panels/settingsCatalog`'s `availableSettings` over the same nav groups and `useSettingsCatalogContext`), titled with the setting and "Settings › <section>" — which opens Settings on it (`openSettings(section, id)`, a search jump: focus and flash). The palette never flips a setting in place, and it adds no per-shortcut rows: it already lists the commands. `SearchPaletteHost` supplies `renderFilePreview` — a `ResourcePreview` from `@thinkrail/resource-renderers` keyed by workspace + path, with a section's heading line as its `reveal`, under `AppResourceHost`'s **`PALETTE_PREVIEW_HOST`** (built once beside the app's `HOST`): its `readFile` and `bytesUrl` carry the palette's `maxBytes` (`FILE_TOO_LARGE` becomes the "too large to preview" message), it refuses a read while the host is unreachable, and its change subscription stays silent until this connection's welcome and then refreshes once — so the palette's file and spec previews are the preview tab's renderer, bounded. The host search context names the active workspace and the context project; the host resolves the root (Project Home searches the project's Default folder). `useSearchPalette` turns store state into the props-driven palette's items: work items from `buildWorkItems` over the normalized session snapshot, so chats in workspaces this client never opened appear, named by their state record's title; **Waiting for you** is those chats that need the user (`waitingItems`); the context project and active workspace are ranking boosts. The palette's Start work row and `Mod+↵` call `PaletteStart.openDialog(text)`, which opens the keyboard-owned `NewWorkspaceDialog` instance (the `Mod+N` one) with the text as `initialPrompt` — or, when that dialog or the store's Edit & retry dialog is already open (an attention notification can open the palette over it), keeps it as it is, its draft and any creation in flight untouched, and returns `false` so the palette returns focus to it; the palette's New workspace row keeps an open dialog the same way, but does not hand focus back to it. The dialog is the only start path, so the palette never creates a workspace or sends a prompt itself. The `#` scope's Ask the agent row and `Alt+↵` call `PaletteAsk.ask(text)` instead, which starts a new chat (`startChatInTab`) in the active workspace — on Project Home in the context project's Default, entered through `enterDefaultWorkspace` under a `paletteNavigator.beginPick()` guard like Work in project folder, so a later pick or navigation while the list loads keeps the user where they went and drops the ask — with the question and the spec-citing note as its first prompt.
- While the palette is open, `paletteBackfill.ts` makes collapsed projects' workspaces searchable: it lists, without diff stats, each open project whose workspace list this client never loaded or that lacks a workspace the snapshot reports (a peer created it while this client was away), and merges the reply in the host's order without replacing rows already held, so no worktree is diffed for it. It asks nothing while disconnected or before the welcome, keeps four requests in flight across openings, drops a reply from an earlier connection, and re-reads its queue when the connection, the welcome, the open projects or the reported workspaces change. No palette request names a chat; against an older host an unvisited chat reads as its first prompt.
- A pick navigates through `activateWorkspaceFromRoute` / `selectProject`. A chat whose workspace row is missing first loads its project's list (`paletteNavigation.ts`, the same merge) and opens only if it is still the latest pick — a project pick counts — and no navigation happened meanwhile: a change of the active workspace, the selected project or a counted tab switch (the navigation tick) drops it even when it comes back (A → B → A), because the pick watches for the change (the store's `isNavigationChange`) as route restore and `chat`'s `openWorkspace` do; a tab an earlier route target opens on its own does not count. It opens only if the workspace is in that list — a stale hit or a failed list tells the user why instead of activating an id no row backs, and a chat whose deletion did not finish (`deletionPending`, held or just loaded) is refused the same way, as its sidebar row is disabled. A workspace or chat row that opened then calls `requestComposerFocus`, so the attended chat's input takes focus — for a chat row, only that chat's input. A destination showing a non-chat tab keeps its tab and focus, and the workbench drops the request then, so no chat can take it later. Host hits, project rows, the sidebar and the topbar switcher send no request: a file, spec or plan hit wants its own surface, and the sidebar keeps keyboard focus on its row. **Work in project folder** hands the same guard (`beginPick`) to `enterDefaultWorkspace` as its `stillWanted`, so a late `workspace.list` reply does not pull the user back to the Default workspace. A host hit opens through `openHostHit.ts` — a file as a tab, a spec in the Specs tool, a section there scrolled to its heading line (`requestSpecView` with the line), a transcript at its message, a plan with its chat and the Plan tool — each only after the navigator resolved `true`.
- Open state lives in [[submodule-web-store]] (`searchOpen` + `openSearch` / `closeSearch`) so an aggregate attention notification from [[submodule-web-notifications]] can open the palette; the host keys it on `searchSession`, so that click resets an already-open palette to its Waiting view. It opens over the first-run wizard as the topbar Settings button does, and its project commands end the wizard the way the wizard's own project cards do. The open palette is the topmost chord layer and owns its keys (`Mod+K` and double Shift close it, Escape in its own order), so the global `Mod+K` is suppressed behind it like behind any modal; plain `Ctrl+R` is swallowed, not acted upon, while it is open (it reloads browsers on Windows/Linux). The global chord accepts neither Shift nor Alt and keeps winning over Monaco's `⌘K` chord prefix.
- **`Ctrl+Tab` / `Ctrl+Shift+Tab` switch recent workspaces** (`workspace.recentNext` / `recentPrevious`,
  [[submodule-web-keybindings]]), macOS Cmd+Tab / VS Code style. A tap returns to the previous workspace;
  holding the modifier and pressing Tab again shows the list and steps it (Shift+Tab, the reverse chord and
  ↑ step back, ↓ forward); releasing every non-Shift modifier the chord was pressed with, or Enter, opens the
  highlighted row; Esc, the window losing focus (a non-capture `blur`, so focus moving inside the page
  during the hold never cancels) or a click outside cancel, and a row click opens it. The rows and their
  order are `search`'s `recentWorkspaces` (*Recent workspace switcher* there) over the palette's own work
  items (`workItemsSource.ts`, shared with `useSearchPalette`, so a pick opens exactly as a palette pick —
  latest pick wins, a stale row is toasted, the chat input takes focus) and they refresh while open, the
  palette's workspace backfill listing collapsed projects meanwhile. `recentSwitcher.ts` is the store-free
  controller and `RecentSwitcherHost` its one wiring and mount. It opens on the row after the current one
  (the reverse chord: the oldest), and a chord rebound without a held modifier switches at once. With no
  other workspace loaded yet (a collapsed project's list loads lazily, so after a restart the previous
  workspace may have no row) a held chord still opens — invisible, with the backfill running — and the
  list appears, on the row after the current one, once a list brings one; releasing with nothing else
  opens nothing, and the in-flight lists still land for the next press. The list shows only after 150 ms
  of holding, so a tap never flashes it.
  While open it holds the keyboard claim (*The claim*, below) and its own capture listener takes every key,
  so no app chord, palette or text field acts; it is shell-local state, not store state — nothing else
  opens it. Browsers keep Ctrl+Tab for their tabs, so it is a desktop-app gesture unless rebound.
  Unconfirmed: the Windows and Linux desktop webviews deliver Ctrl+Tab to the page (macOS WKWebView does,
  and no native menu accelerator claims it).
- **`Mod+?` opens the keyboard-shortcuts cheatsheet** (`shortcuts.open`, the one table chord matched on
  the typed character, [[submodule-web-keybindings]]). `ShortcutsDialogHost` mounts `ShortcutsDialog`
  only while the store's `shortcutsOpen` is true (`openShortcuts` / `closeShortcuts`); the chord, the
  keyboard icon at the foot of the left tool rail and the palette's *Keyboard shortcuts* row open it. It
  lists the catalog's `shortcutRows` for this client (`desktop` is the native-shortcut bridge read the
  palette makes) over the resolved table — local keys at their effective chords, a direction row's arrow
  beside its twin's current letter — plus every enabled web extension's commands and `shortcuts`, each
  extension's in a section of its own after the catalog's surfaces, titled with its `title` like its
  Settings → Keyboard area (`shortcutSections`; `data-surface="extension"`, `data-extension`), rather
  than unlabelled in General — as surface
  sections under a filter matching a row's title or key label, with a count beside it ("117 shortcuts",
  "17 of 117" while filtering). A chord that loses to another command is shown struck through after the
  active ones, with "inactive: taken by {winner}" under the title; a switched-off extension's rows stay
  hidden. The dialog fills the window less a `--space-24` margin and flows the sections into as many
  ~18rem columns as fit, never splitting one. The scroller and the column flow are separate elements: a height-constrained
  multi-column box overflows sideways, so the list scrolls only down. A row wraps between its chords, never
  inside one, and its title keeps at least half the row. Sections keep the catalog's order (no longer
  current-first, 2026-11-15); the section of the surface focused just before it opened is highlighted
  ("you are here", `data-current`) and scrolled into view (`block: "nearest"`; focus stays in the filter).
  `shortcutSurface.ts` maps the element Radix is about to move focus from (a terminal, the chat input,
  the chat transcript, the chat history overlay, Changes review or any renderer's `data-review-surface` —
  a diff's or Markdown preview's cursor proxy, a region frame, the swipe divider — or a review composer or
  card, the Settings dialog (`[data-settings-dialog]`, the catalog's `settings` surface: its section list,
  walk keys, lists and Esc; matched before trees and tab strips, so a tree inside Settings reads as
  Settings), a tree, a tab strip, a rail entry); elsewhere nothing is highlighted. Rows are reference only and
  hold nothing focusable, so the filter's ↑ / ↓ / PageUp / PageDown scroll the list. Esc closes it and so
  does `Mod+?` — handled by the dialog, since global chords are suppressed behind a modal — and focus
  returns to where it was.
- **Settings → Keyboard** is shell's `KeyboardSettings`, on the Settings kit ([[submodule-web-settingskit]]).
  The page description carries the `Mod+K` note (a sentence without a chord when the user unbound it) and
  where shortcuts are saved. A **Search** group (This computer) holds the double-Shift switch
  (`settings-double-shift`, catalog `double-shift`, Reset to on). A **Shortcuts** group holds the editor
  (`KeybindingEditor`), kept whole in the section (user, 2026-11-17): a `Tree leaveAtEdges` by area over the
  `keybindingList` rows ([[submodule-web-keybindings]], *Editor rows and edits*), grouped by
  `shell/keybindingAreas`: one area per catalog surface in catalog order, then one per web extension tagged
  Extension (and Off, its rows muted but editable, while switched off). An area is a level-1 row
  (`keybinding-group`), **collapsed by default**, showing:
  - "N shortcuts" ("n of N" while filtering);
  - "● N changed" while any row is overridden, with a Reset button that drops every changed override in
    the area (Delete on the area does the same, without a confirm; → on an area expands it, so Delete is the
    keyboard's way to that Reset);
  - the "local · when focus is in a sidebar tree" caption when every row shares one local scope; an area
    with mixed scopes captions each local run inside instead (an extension scope reads "when focus is in
    {extension}").

  →/← open and close an area, and Enter/Space toggle it; the tree's edges and ← on a collapsed area leave to
  the Settings walk. Shortcuts are level-2 rows (`keybinding-row`, `data-setting-id="shortcut:<entry id>"`).
  Table, local and extension commands are editable; locked element keys, desktop rows and display-only
  chords show a lock and read `aria-disabled`. A direction row shows its arrow locked, "always works", then
  its twin's letter as the editable alias (recording there edits the shared twin, so it applies in every
  element; the four General `arrows.*` rows edit the same commands).
  - **Filter and jumps.** "Filter by name" matches the title or a key label. The filter is a row
    (`keyboard-filter`): Enter or Space enters the field, Enter or Esc on a clean field returns to the row.
    Search by keys (the row's button, reached with → from the row or Tab from the field) turns the field
    into a recorder whose next chord — a plain letter or a locked
    arrow included — filters to rows showing it; Esc leaves. A filter opens every area with a match and
    hides the rest; Esc in a filter with text clears it before the walk takes Esc. A Settings jump to
    `shortcut:<id>` opens the area holding it on every jump (`useSettingsJump`'s `seq`, at mount too) and
    clears the filter and the by-keys mode, so `jumpToSetting` reaches the row; Voice's "Change…" relies on
    it. Shell passes `useShortcutSearchEntries` (one `SettingsSearchEntry` per row: title, chords or "Not
    assigned", the area and chord labels as keywords) to `SettingsDialog`'s `searchEntries`, so Settings
    search finds individual shortcuts.
  - **Recording.** Enter (or Space) or a click on a row (or its **Change** button) records (`chordFromEvent`, the
    command's `plain` — true for every local command — as `allowPlain`). The row's chord reads "Press a new
    shortcut… Esc cancels" ("Press a key or a chord…" on a local row, "Press a new key for the alias…" on
    a direction row), framed by the kit's editing frame (`focus-ring-editing`, as an entered control is) so
    a recording row reads apart from a merely focused one, and the row keeps focus. A modifier alone keeps waiting, AltGraph is ignored, and Esc
    cancels; Settings stays open, because the recorder's Esc is an element step the dialog holds for
    (`holdSettingsEscape`). Tab is not captured: leaving cancels. While recording — and while the filter
    has focus in Search by keys — the editor holds the keyboard claim (`claimKeyboard`, below), so no app
    chord, extension command or double Shift acts on the press being recorded. An outcome's buttons
    (Replace, Cancel, Assign anyway, Dismiss) belong to the shortcut's row: → walks Change, Reset, then
    them, in screen order.
  - **Outcomes,** in order: a plain key on a non-plain command → "A shortcut needs…" (dismiss); a
    desktop-native chord, or a press either desktop platform's `shortcutCommands` matcher owns on this
    layout (`isDesktopShortcut`: AZERTY's `KeyZ` Ctrl+W, Russian `Shift+Slash` Ctrl+,) → refused with
    the same desktop message; a chord active on another command (none for a switched-off extension's
    command, `chordHolders`) → "{chord} is already used by {command}" with Replace / Cancel (Replace writes `assignChord`'s explicit unbind; a browser-reserved
    chord adds the browser sentence); a plain key an element owns, on a plain command → "{key} also acts in
    {places}…" with Assign anyway — also for any global chord a local key holds (`localUses`: "Ctrl+K
    also acts in sidebar trees…"); a browser-reserved chord in a browser → Assign anyway; else it assigns.
    A chord equal to the defaults drops the override (kept while a customised twin would win it,
    `assignChord`). **On a local row** the outcomes are: a navigation
    primitive → "↓ is a navigation key — locked in every element" (dismiss; the command's own primitive
    default records); desktop-native as above; a key another command holds inside an element this
    command acts in (`chordHolders`) → "J is already used by Move down (alias) inside sidebar trees",
    naming every holder ("X is already used by Search the visible rows inside sidebar trees and Copy the
    message… inside the chat transcript"), with Replace (clears each) / Cancel; a chord a global command holds (`globalHolder`) → "F runs “{global}” everywhere
    else; inside sidebar trees it will run “{local}” instead" (no "else" for a modified chord) with Assign
    anyway; browser-reserved → Assign anyway; else it assigns, and a key other elements also use adds an
    info note "C also acts in the chat transcript — a different element, so no conflict".
  - **Rows.** An overridden row shows a **Changed** tag (the kit's word, as everywhere in Settings),
    "Default: …" and a Reset button; Delete on the row resets it. A lost chord is struck through with
    "{chord} is taken by {winner} — inactive" and an Assign another button. A mark appears per element that
    takes the row's chord over ("Inside sidebar trees, F runs “Search the visible rows”"; `commandTitle`
    also names a reserved chord's catalog-row winner, such as a desktop row a browser does not list). →
    reaches the row's buttons Change / Assign another / Reset; each is a real tab stop that follows the tree's
    roving cursor, never `treeRowControlProps`. Rows carry `data-focus-row` in the tree's `data-focus-list`,
    and after an assignment, Replace, Cancel or Reset focus returns to the row.
  - **Writes** go through `transport`'s `updateKeybindings` (one call per edit, Reset all `{}`) and show
    when the `settings.changed` broadcast lands — no optimistic state; a refusal toasts. **Reset all** (in
    the **Import and export** row, beside Export… and Import…) first asks "Reset every shortcut to its
    default?" (`keybinding-reset-all-confirm`). Below `supportsKeybindings` the list is read-only (every
    row `aria-disabled`, no Reset or Import) under one notice, "Update ThinkRail to rebind shortcuts".
  - **Export… / Import…** Export downloads `thinkrail-keybindings.json` (`keybindingsFile`, English titles,
    a Blob through `<a download>`). Import reads a picked `.json` with `planImport` — anything else toasts
    "This is not a ThinkRail keybindings file" — and shows a summary dialog (Will change, Conflicts,
    Skipped with reasons, the unchanged count) whose "Apply n changes" sends the merged map once.
- **Chords in tooltips.** Every icon button whose action a chord also runs shows the chord's caps after
  its tooltip label (`IconTooltip`'s `shortcut`, [[module-ui]]), computed here from the resolved table
  (`keybindingKeys` / `useKeybindingKeys`, never captured once) and injected into the props-driven layout
  as `chromeShortcuts`, and into `ProjectTree` (`newWorkspaceShortcut`) and `ChatView` / `PlanPane` (`landingChord`, the `region.next` label a waiting question
  names in "… to answer") as props (`KeyboardSettings`, shell's own, reads the search chord for its
  description with `useKeybindingLabel`): a pane's Hide shows its side's toggle
  (`Mod+B` / `Mod+J` / `Mod+Shift+J`) only while it is the region's sole expanded pane — with two, Hide
  folds one and the chord hides both — the Projects and Files rail entries show `Mod+0` / `Mod+Shift+E`
  and terminal entries `` Ctrl+` ``; on Project Home the Projects entry and its Hide show `Mod+B`, the
  toggle they are. The location bar's New workspace item takes its label from here, browser-aware, so a
  browser never advertises `Mod+N`.
- `Mod+Shift+F` opens Find in Files ([[submodule-web-find-in-files]]); `files.findInFiles` in the palette's `>` commands is the same action with the chord as its display shortcut, listed while the host serves `search.text` (`supportsTextSearch`) and `selectHasTextSearchScope` holds (an active workspace, or a context project other than the Chats container) — the same scope the window searches, so on the Chats container's Home the chord's window says there is no workspace to search. `FindInFilesHost` mounts the dialog only while its module store says `open` and composes the rest from the shell side: the search context (the active workspace, else the context project, which the host resolves to its Default workspace, provisioning a Default record not listed yet), the scope label (a chat without a project by its displayed title, as the topbar names it), the host state (`ready` / `offline` / `unsupported` from the connection status and `supportsTextSearch`), the welcome generation as `connection` (so a search a reconnect interrupted is asked again), `renderPreview` — a `ResourcePreview` pinned to `SOURCE_RENDERER_ID` with the match as its `reveal` — and `onOpen` (`findInFilesOpen.ts`), which enters the match's workspace through the palette's shared `paletteNavigator` (`paletteNavigation.ts` — the row loaded without diff stats when this client lacks it, a deletion-pending or vanished workspace refused with a toast, a newer pick or any navigation overtaking it) and only then calls `panels/openTabs.openFileAtLine` at the `preview` (`↵`) or `keep` (`⌘↵`) intent; a failed open toasts. Like the other chords it is suppressed behind a modal (so the open window, or the palette, keeps it) and never takes plain `Mod+F` from the browser; the window is a modal other than the search palette, so double Shift does not fire through it.
- **Regions and focus chords** (VS Code's keymap). `regions.ts`, installed once from `Shell`, owns the
  active region: a document `focusin` listener resolves `closest("[data-region]")` and moves the one
  `data-region-active` attribute imperatively, with no React state; focus outside every region (a modal,
  the palette, a menu portal, `<body>`, a rail button) changes nothing, and a `ResizeObserver` on the
  active root drops the mark when that root unmounts, hides or collapses. It also remembers the last
  element focused inside each root (a `WeakMap`; the root itself is never remembered) and the last center
  group focus entered (the Esc ladder's main area, *Esc climbs to the main area*). The regions and
  the landing rule are [[submodule-web-shell-layout]]'s (*Arrangement and accessibility*); the accent
  line and the frame are [COLOR.md](../styles/COLOR.md)'s (*Active region*). **The frame marks keyboard
  arrivals only**: when the active region changes and the last input was a key, the tracker sets
  `data-region-flash` on the new region — so `F6`, the focus chords below, a palette row run from the
  keyboard and a `Tab` across a border flash it, and a click never does. A capture `keydown` /
  `pointerdown` pair on `window` records that last input; it is installed with the tracker, before
  `useGlobalHotkeys` (which stops a chord's propagation at `window`), so a chord that moves focus
  synchronously already counts as a key. The frame shows 1.5 s (≈1 s held, a 0.5 s fade) or 1 s under
  `prefers-reduced-motion`, a newer flash replaces it, and the region losing the active mark drops it.
  `F6` / `Shift+F6` walk the ring of shown regions — top bar, Project Home pane, left groups top to
  bottom, center groups in `Ctrl+F6` order, right groups top to bottom, bottom groups left to right —
  from the active region, in two beats (`regionKeyAction`): with no frame showing and focus inside the
  active region, a press only flashes that region, showing where the keyboard is; a press while the frame
  shows moves and flashes the destination, so a run of presses walks the ring. Focus on `<body>` or
  outside every region moves at once; with none active, `F6` starts at the top bar and `Shift+F6` at the
  last. The palette's Focus next / previous region rows always move. `Mod+1…9` land in center
  group N of that order (no group N: nothing, the chord still swallowed). Every landing prefers a focusable
  `[data-focus-claim]` (`resolveLanding`), so F6 into a chat with a waiting question lands on its current
  option; `Mod+L` still focuses the composer. `Mod+L` focuses the attended
  chat's composer — `selectHistoryTarget`'s chat (the selected tab of the last-focused center group, else
  the workspace's most recent chat tab), opened through `openChatInTab` first when it is not attended —
  by `requestComposerFocus` once it is. The chat's own history overlay does not count as covering it: the
  chord's request carries `dismissHistory`, and `ChatView` closes that overlay before focusing the input
  (waiting for an unobscured chat would never end — the overlay stays open until something closes it).
  With no chat it does nothing but still swallows the browser's address-bar chord. `Mod+0` reveals the Projects tool and focuses inside it; on
  Project Home it expands a collapsed projects pane and lands there. `` Ctrl+` `` from inside a terminal
  returns to the region active before it (else the first center group); elsewhere it focuses the visible
  terminal (the workspace's active one first), else reveals that terminal wherever it is placed — its side
  or bottom shown and its group unfolded, through the `select-terminal` intent and the layout's
  `revealPlacedTab` (the reveal `reveal-tool` uses) — else creates one with `addTerminal`. `Mod+Shift+E` / `Mod+Shift+G` set
  Files to All / Changed (`setFilesMode`), reveal it and focus inside its body once that mode has rendered
  (`data-files-mode`), so a row remembered from the other mode, about to unmount, never takes focus;
  Changes is not bound in a chat without a project. A tool body still showing a loading skeleton
  (`aria-busy="true"`) is waited out for a shorter bounded budget before landing, so a chord that first
  mounts Files lands on its tree's current row rather than the toolbar above the skeleton. Every focus move waits, a bounded number of animation frames, for no modal layer
  and a rendered target, then gives up silently; a newer focus chord cancels an older wait. A chord that
  focuses inside a tool (`Mod+0`, `Mod+Shift+E` / `Mod+Shift+G`, Esc in a file) reveals it with `focus: false`, so
  that wait is its only focus move and a newer chord cancels it: the reveal's tab focus request used to run a frame
  later, outside the wait, and on a slow frame it landed after a quick `Mod+1` and took focus to the rail's Files
  button. That wait is what lets the same moves run as palette rows (Focus next / previous region, Focus chat input,
  Focus Projects, Focus terminal, one Focus center group N per existing group, Show Changes, and Show
  Files with `Mod+Shift+E`), after the palette has closed. These chords are app-owned in xterm and
  Monaco too, except that `Ctrl+L` inside a terminal on Windows/Linux stays the shell's clear-screen, like
  `Ctrl+R` (`⌘L` on a Mac still focuses the composer from a terminal; *Active-tab chords* has the
  rule); they are ignored during
  IME composition, and are suppressed behind a modal like the others; `Ctrl+F6` / `Ctrl+Shift+F6` stay
  the workbench's group cycling. A plain browser tab may keep `F6` for its own address bar; the desktop
  app is the primary surface and the palette rows reach the same moves.
- **Active-tab chords and commands** (VS Code's keymap). `Mod+\` splits the active tab right,
  `Ctrl+Alt+←` / `Ctrl+Alt+→` (`⌃⌘←` / `⌃⌘→` on a Mac) move it to the previous / next group and do
  nothing at the first / last one, and `Mod+Alt+W` closes it — the browser-safe alias of the desktop's
  `Mod+W`, which stays owned by the native menu / `shortcutCommands` and is only shown (each chord has one
  owner; binding `Mod+W` here too would close twice). The *active tab* is the selected tab of the group
  the user was last in: the region tracker's group (`activeWorkbenchGroupId`, so the palette input holding
  DOM focus while a command runs never changes the answer), else the last-focused center group — the
  rule close-item always used. `workbenchCommands.ts` is the channel: the mounted Workbench registers its
  `WorkbenchTabCommands` provider (`registerTabCommands`, injected like the old close-request
  subscription), the chords call `runActiveTabAction(id)`, and the palette lists `activeTabActions()` when
  it opens — every command of the tab's context menu that can run now (close, keep preview, the four
  splits, move to the previous / next group, move to each legal pane, new groups, remove group, hide the
  region, copy path / relative path, rename chat, focus previous / next group), under an *Active tab*
  group, with the chord where one exists — and runs the picked id through the same channel, which
  re-resolves the target and re-checks availability ([[submodule-web-shell-layout]], *Tab actions*).
  `Mod+Alt+W` and the desktop's `Mod+W` share `chordActions.closeActiveItem` (dismiss a layer, else
  close the active tab); it is the one table chord not suppressed behind a modal, because dismissing that
  modal is its first step. Exceptions: `Ctrl+\` inside a terminal on Windows/Linux stays the shell's
  SIGQUIT, like `Ctrl+L` (`⌘\` on a Mac still splits); `⌥⌘W` inside Monaco's find widget stays its
  whole-word toggle. **These guards name chords, not commands:** inside xterm the shell keeps literal
  Control `Ctrl+L`, `Ctrl+\` and `Ctrl+R` (readline's clear-screen, SIGQUIT and reverse search), and the
  find widget keeps `⌥⌘W` on a Mac, whatever is bound there — an app command or chat history rebound
  onto one still yields there, and one rebound elsewhere (`Ctrl+Alt+Y`) acts there as anywhere. An
  extension command is not guarded. The group moves accept GNOME's grab of `Ctrl+Alt+←/→` on Linux, as VS Code does —
  the palette rows reach the same moves. No Alt chord fires while AltGraph is held
  ([[submodule-web-keybindings]]).
- **Extension overlays, their commands and the keyboard claim.** `ExtensionOverlays`, mounted once at the
  tail of `Shell`, renders the `globalOverlay` of every web extension not in the store's
  `disabledExtensions` ([[submodule-web-extensions]]), so switching one off unmounts it and its listeners
  at once. It hands each the host helpers an extension cannot import: `isTextEntry` (`lib`'s
  `isTextEntryTarget`), `activeLayer` (`shortcutLayers.ts`: the last open modal dialog or open menu in
  document order — Radix portals append — else the document), the browser platform, and the command
  channel of `extensionCommands.ts`:
  - **Delivery.** An extension's commands are matched by `useGlobalHotkeys` in the same capture listener
    as the app chords, through the resolved table: a plain chord only outside text entry
    (`composedPath()[0]`), never during IME composition, and **not gated by a modal** — the overlay scopes
    itself with `activeLayer()` (hint mode labels the open dialog or menu). A match is
    `preventDefault` + `stopImmediatePropagation`, so neither Radix (document), Monaco nor another window
    listener sees it, and reaches the extension's `onCommand` listeners once per physical press. Only an
    enabled extension's commands match, and only a mounted overlay listens. A press a focused element's
    local key holds (by physical key, the binder's local yield above: `S` in a tree, `K` in the
    transcript) is left to that element, which is what Settings → Keyboard's warnings promise.
  - **The claim.** `claimKeyboard(true)` says the overlay owns every key (hint mode while labels show; the
    Settings → Keyboard recorder claims it the same way);
    until it releases (or the overlay unmounts, which releases for it), `useGlobalHotkeys` dispatches no
    app chord, no extension command, no `Ctrl+R` and no double Shift, and `useAppShortcuts` no web
    close/quit/settings chord. The claimant's own listener handles every key and recognises its own
    commands with `matchCommand(event)` (its command id the effective bindings give the key, else
    `null`), so its trigger can still exit. An overlay's own key listener acts only while it holds the
    claim, and the press that delivers a command is stopped before a claim it starts could see it, so
    exactly one listener acts on any key and the order the overlay's listener and `useGlobalHotkeys`
    registered in never decides anything.
- Double Shift is detected by the pure `createDoubleShiftDetector` from capture-phase `keydown`/`keyup`; `pointerdown`, window blur and a hidden document reset it, and it does not fire through another open modal. It is off per client through the `doubleShiftSearch` preference (the switch in Settings › Keyboard, shell's `KeyboardSettings`, which shell injects into `SettingsDialog` like Layout and Updates).
- Row and header glyphs reuse the `ProjectTree` vocabulary: a leading `RiChat2Line` (wrapped in `RunningIcon` while running) and a trailing `AttentionDot` for a session that needs attention — no bespoke per-outcome glyphs.

Letter chords match physical `KeyboardEvent.code`, never layout-dependent `key`. The layout and create chords remain app-owned inside xterm, do not repeat, and are suppressed while a modal dialog is open. With no active workspace, right/bottom, hide-all-panels, split and group-move chords neither act nor swallow the browser chord; `Mod+B` toggles the Project Home Projects pane with the focus rules above. With no context project, `Mod+N` likewise neither acts nor swallows. Terminal `Ctrl+R` still belongs to xterm; `Ctrl+Shift+R`, macOS `Cmd+R`, F5, and browser reload remain untouched. All other arrangement operations are exposed by the layout command/menu system in [[submodule-web-shell-layout]].

**Desktop deep links.** `main.tsx` calls `installDeepLinks` once. It reads the optional
`NativeDeepLinkBridge` (`__THINKRAIL_NATIVE_DEEP_LINKS__`, [[module-contracts]]) from the preload; a browser
has none and the installer is a no-op there. Requests run one at a time in arrival order. Each waits for the
first welcome, supersedes a still-pending incoming route (`supersedePendingRoute`, [[submodule-web-navigation]]:
on a cold launch the restored last location would otherwise land later, count as a navigation and drop the
link) and begins a `paletteNavigator.beginPick()` guard, then asks `panels/workspaceForPath.resolveWorkspaceFile`
for the open workspace that holds the absolute path — the host matches real paths, so a `/tmp` or symlinked
spelling of either side resolves. A later pick or any navigation while the path resolves drops the link
silently. Nothing outside the open projects is opened. A path no open workspace contains, or a workspace root
itself, toasts `shell.deepLink.notInProject` and changes nothing. Otherwise the link enters the workspace
through the shared `paletteNavigator` (Find in Files' entry: the row loaded when this client lacks it, a
deleting or vanished workspace refused, a newer navigation overtakes it), then calls
`openFileAtLine(..., "keep")` with the match's workspace-relative path, so opening and revealing name the same tab. Monaco clamps a
line or column past the end of the file. When the host refuses the read (missing, a directory, `.git`, a
symlink escaping the worktree, too large), no tab appears and `shell.deepLink.openFailed` says so. The
workspace has already been entered by then.

**Native shortcuts.** Shell always mounts the `AppShortcuts` leaf. `useAppShortcuts` reads `NativeShortcutsBridge` (`__THINKRAIL_NATIVE_SHORTCUTS__`, [[module-contracts]]; desktop hosts only) once. Without the bridge it adds no listeners and renders nothing. With the bridge, the leaf renders the hint, so hint changes re-render only that leaf. Every app-level close/quit/settings shortcut dispatches through one command table, `shortcutCommands.ts`: a command id (`close-item`, `quit`, `open-settings`) maps to Ctrl chords per shortcut platform, each chord carrying its terminal rule, and the hook supplies the id → handler map. Both native commands from `subscribeCommand` and web keydown chords run the same handler. The shortcut platform is `platformFamily()` (`apple` / `windows` / `linux`) when the bridge exists, else `browser`. A keydown the table owns on this platform (`matchShortcut`, terminal rule included) reaches no app or extension command and no chat history in `useGlobalHotkeys` (`routeHotkey`), whatever chord it resolves to: on AZERTY Ctrl+W is the `KeyZ` key, so `view.toggleLeft: ["Mod+KeyZ"]` would otherwise toggle Projects and close the tab from the two window listeners. The resolver's static desktop-native list ([[submodule-web-keybindings]]) still covers hand-edited configs by US position.

| Platform | Quit | Close item | Open Settings |
| --- | --- | --- | --- |
| apple | native Cmd+Q (host-confirmed) | native Cmd+W | native Cmd+, |
| linux | web Ctrl+Q (web-confirmed) | web Ctrl+W, Ctrl+F4 | web Ctrl+, |
| windows | none (Alt+F4 is the OS window close) | web Ctrl+W, Ctrl+F4 | web Ctrl+, |
| browser | none | none | none |

Web chords are Ctrl only (no Meta/Alt; no Shift except where it produces a punctuation chord's character), handled in the window capture phase, and act once per physical press: a repeat keydown is swallowed but never runs. Inside xterm, Ctrl+W is neither handled nor prevented, so the shell gets it; Ctrl+F4, Ctrl+Q, and Ctrl+, stay app-owned. The table binds nothing on apple (native owns those chords) and nothing in a browser, so the hook adds window key listeners only where `hasWebShortcuts` is true. Letter chords match the typed Latin letter (`key`), falling back to `code` when the layout types a non-Latin letter; Punctuation chords (Ctrl+,) match the typed ASCII character, Shift allowed when it produced it (Russian Windows Shift+/), falling back to `code` without Shift when the layout types a non-ASCII character there — so AZERTY's `Comma` key (`;`) and US Shift+Comma (`<`) do not match; the macOS menu also matches by character. F4 matches `code`. This is the deliberate exception to the physical-`code` rule above: close and quit are destructive, and on AZERTY or Dvorak the W/Q positions type undo or select-all. Modifiers and the chord match first; the xterm check runs only for a matched chord. Web-owned chords do not fire while focus is inside the sandboxed HTML preview iframe: its keydowns never reach the parent window.

`open-settings` (native or web) **toggles** Settings (`settingsToggle`): while Settings is the top layer it closes it; otherwise it opens Settings on its remembered section only when no modal layer is open, so a dialog over Settings (a confirm) or any other dialog keeps the keyboard. The guard lives here, not in the store's `openSettings`, whose callers deep-link sections. The browser deliberately binds no Settings chord: Mac browsers own Cmd+, for their own settings, and the desktop is the primary surface. The Settings gear tooltip advertises the chord (`Settings (⌘,)` / `Settings (Ctrl+,)`) only where it is bound, from the same bridge-and-platform read (`readSettingsShortcutLabel`).

Quit confirmation runs the shared contracts `createQuitConfirmation` rule in both places: the host on macOS, the web on Linux. The web adapter tracks held from the Ctrl+Q keydown until keyup of that same physical `code` or Control, calls `sync()` on keyup, and treats window blur or a hidden document as `cancel()`: an already-confirmed gesture (hint `release`) quits, otherwise it hides. A confirmed quit calls `bridge.quit()` once; if it rejects, the adapter resets the rule so the pill hides and Ctrl+Q works again. Either way the web renders the hint as `QuitHintOverlay`, one centered, `pointer-events-none` `role="status"` pill that fades out on `hidden` and keeps the last text while fading; the text names the platform chord (`⌘Q` / `Ctrl+Q`).

`close-item` is never a window close. While Settings is the top layer or holds focus, it closes Settings at once from anywhere inside it (`closesSettings`; user, 2026-11-17) rather than stepping its Esc ladder ([[submodule-web-panels]]): it blurs the focused element first, so a dirty field commits as on blur, then calls `closeSettings`. Otherwise, if a dismissible layer is open (modal or open Radix dialog/alertdialog/menu anywhere; a chat history overlay only inside the DOM-focused group, or anywhere when no group has focus; selectors and the xterm test shared with `useGlobalHotkeys` in `shortcutLayers.ts`), the hook dispatches `Escape` to the focused element so each layer keeps its own Escape semantics. The Escape is synthetic (untrusted), so each dismissible layer must catch Escape at document/window level or on an ancestor of focus and must not filter on `isTrusted`; Radix `DismissableLayer` (document capture) and `HistoryOverlay` (window capture) do, and e2e `close-quit-shortcuts` guards it. Otherwise it runs the active tab's `tab.close` through `workbenchCommands.ts` (`closeActiveItem`, shared with `Mod+Alt+W`; the provider is registered by the mounted workbench, so no render cascade and no stale request), and the workbench closes the selected tab of the region tracker's group, else of the last-focused center group, through the same `onRequestClose` path as the tab X (terminal confirmation included). Singleton tools, folded groups, and whole regions are never closed; nothing closable is a no-op. With no active workspace only the layer step applies. Each chord has one owner: a chord in the command table is never also bound in `useGlobalHotkeys` (the keybinding table only *shows* `Mod+W`, as a display-only chord of `tab.close`), and a chord the host forwards natively is never in the table for that platform.

**Page zoom.** `nativePageZoom.ts` reads the optional `NativePageZoomBridge` (`__THINKRAIL_NATIVE_PAGE_ZOOM__`,
[[module-contracts]]; desktop only) once per palette mount. Where it exists the palette lists `view.zoomIn` /
`view.zoomOut` / `view.zoomReset` (Zoom in / Zoom out / Reset zoom), each calling `request("in" | "out" |
"reset")`; a browser has no rows. Their shortcuts `Mod+=`, `Mod+-` and `Mod+Numpad0` (key cap `Num 0`, the
Windows key name) are display-only — the desktop preload owns those chords ([[module-desktop]], *Native page zoom*), so they are in no web table, like
the native menu's `Mod+,` on the Settings row. The web keeps no zoom state.

## Esc leaves a text field

Hint mode's `F` and every other plain key do nothing in text entry, so a bare Esc in a field moves focus
out of it (user, 2026-11-16). `escapeLeavesField.ts`, installed once from `Shell` beside the region
tracker, is one window `keydown` listener in the **bubble** phase. It acts only when all of these hold:

- the key is a bare `Escape` (no Alt, Ctrl, Meta or Shift), no IME composes and no keyboard claim is
  held (`keyboardClaimed`, so hint mode and the shortcut recorder keep it);
- the event is not `defaultPrevented`;
- the target (`composedPath()[0]`) is a text field: a `textarea`, a contenteditable or an `input` of a
  text-like type (text, search, url, email, number, password, tel) — never a `select`, a checkbox-like
  input, or anything inside `.monaco-editor` or `.xterm`, which keep their Esc (find widget, suggestions,
  vim modes, shells and TUI apps);
- the target is in no dialog, alertdialog or open menu (`shortcutLayers.isInLayer`), where Esc keeps
  closing the layer. Settings is such a dialog with its own ladder — a field's revert, then the section
  list, then close ([[submodule-web-panels]], *Esc and closing*).

**Why bubble phase:** every element or layer that already owns Esc runs first and calls
`preventDefault`, so one press never both closes something and leaves the field. Radix's
`DismissableLayer` (dialogs, menus, popovers, the Resources inspector) prevents before it dismisses from its
document-capture listener; the composer's mention / slash menus and slot session, tree search, the inline
renames, the palette, Find in Files, the history overlay, the review composer and draft card, the ask
card's note, Other and Discuss fields, the plan page's Add task field, and a running dictation (the first Esc
stops it, from a `document` bubble listener that always precedes this `window` one; [[submodule-web-speech]])
prevent in their own handlers. A
new owner of Esc must call `preventDefault` too.

**Landing** is markup, like focus recovery: inside the field's region (`[data-region]`), the first
rendered, focusable `[data-focus-claim]` — a waiting question's current option, revealed in its scroller
(`focusAndReveal`) — else the first focusable `[data-focus-park]` — the chat marks its message feed
([[submodule-web-chat]]) — else the region root, these two focused with `preventScroll` (`fieldExitTarget`,
the order `resolveEscapeLanding` pins). So Esc in the chat composer goes to a waiting question, draft or
not, and to the feed without one, with no composer code. The listener then prevents the default, so a
search input keeps its text. The workbench group roots are `tabIndex=-1` and draw no ring (`outline-none`): focus
stays in the same region, whose accent line is the indicator, and nothing inside is selected. The top bar
and the Project Home pane have neither a park nor a focusable root, so there focus stays in the field
(their fields all own Esc today: renames and tree search). A root is never remembered by the region tracker, so a later F6,
`Mod+1…9` or recovery safety net into that region lands by the usual rule (the element last focused
there, else the default); focus recovery records a parked root like any focus.

## Esc climbs to the main area

The first Esc in a field lands on its region; the next one, on a panel, climbs to the **main area**
(user, 2026-11-17: the focus home is the chat — its waiting question, else its feed). The same
`escapeLeavesField.ts` listener takes the second step (`climbsToMain`), under the same guards (bare Esc,
no IME, no keyboard claim, not `defaultPrevented`, nothing inside `.monaco-editor`, `.xterm` or a dialog or
open menu), when the target is a **non-text element** — not a text field or a `select` — in a region
that is not the main area: a side or bottom group (its root, a tree or tree row, a tab strip, a rail, a
button, the Files or Changes list), the top bar or the Project Home projects pane — or inside an
auxiliary rail, which sits outside every region and carries `data-esc-ladder` instead (the left, right and
bottom tool rails; their F6 ring is unchanged). The center's own tab
strip and actions climb too, into the tab's content (unconfirmed with the user, the recommended answer);
the center root and anything inside its tabpanel never do, so the parked feed's and an editor's Esc stay
theirs. The terminal and an editable Monaco keep their Esc; from there F6 or Mod+L.

**Esc in a file returns to the Files tree** (user, 2026-11-20). The same listener's third step
(`leavesFile`): a bare Esc no owner took (not `defaultPrevented`, no claim, no layer) whose target is
inside a file tab (`FilePane`'s `[data-file-pane]`) and is a non-text element — a reading surface, the
Markdown block cursor, the toolbar — or the text of a read-only editor (`[data-text-entry="false"]`,
[[module-resource-renderers]]) runs `showFiles("all", { activeRow: true })`: Files in All mode, the active
file revealed (`revealInFiles` reopens its collapsed folders) and focus on its row (`aria-current`) rather
than the row last focused there, so Esc and Enter toggle file ↔ row. `focusToolBody` waits for such a
preferred target within its busy budget (the row mounts a few frames after its folders open), then takes
the tool's usual landing. Element-level steps still win because they prevent first: a Markdown range
clears, a review composer cancels, Monaco closes its find widget or message. A text field in the file
leaves to its region as above.

**The main area** is the last center group focus entered (the region tracker records it), else the
first shown center group in ring order, else Project Home's main pane (`[data-main-area]`, which is no
region). Focus lands in it without switching a tab (`mainAreaTarget`): the first focusable
`[data-focus-claim]` (a waiting question in the visible chat, revealed), else `[data-focus-park]` (the
chat's feed — not the composer that F6 would land on), else the group's tabpanel by the region rule
(remembered there, else its `[data-focus-default]` — an editor's input —, else its first tabbable), else
the region's own landing. With nothing focusable the Esc is left alone. Every element that already uses
Esc keeps calling `preventDefault` and so wins (dialogs, menus and popovers through Radix, tree search,
renames, the palette, Find in Files, the history overlay, the review cursor, composer and card, the
keybinding recorder's claim); an open tooltip closes in window capture without preventing, so its
button's Esc still climbs. A new owner of Esc in a panel must prevent too.

## Focus recovery

An action that removes, replaces or disables the focused control must not drop focus to `<body>`.
Shared dialogs return to their opener in their close-autofocus lifecycle ([[module-ui]]); a removed or
unavailable opener still needs recovery. `focusRecovery.ts`, installed once from `Shell` beside the
region tracker, owns that fallback for every surface; surfaces only emit the markup vocabulary
([[module-web]], *Get right*), never recovery code. On `focusin`
it records the element with its context: for each enclosing `data-focus-list` (innermost first, bounded)
the list key, the enclosing `data-focus-row` id and the ids of the next and previous rows of that logical
list at that moment (refreshed while the element stays mounted and the page mutates), its slot
(`data-focus-slot`, else its `data-testid` outside rows), its region, and its layer (the nearest
dialog / alertdialog / menu). Entering a layer keeps the record focused before it as the layer's
*opener*; focus landing on a layer container itself (Radix moves it there when the focused element inside
is removed) records nothing.

A `MutationObserver` on `<body>` (children, `disabled` / `hidden` / `inert`) and `focusout` schedule one
animation-frame check. Focus is **lost** only when the recorded element is disconnected, disabled, inert or
unrendered **and** focus rests on `<body>`, nothing, the element itself or a container of its layer chain.
A still-focusable element with focus on `<body>` (a click on empty space) is forgotten, so its later
removal never pulls focus anywhere. When the record's layer has closed, recovery resolves from its opener
instead — back on the opener itself when it is still there (a confirm dialog whose opener row will vanish
after the host's push), else the opener's rows. Resolution, first match wins:

1. **Same row or slot** — the same row id under the same list key (rows may sit in several containers
   sharing one key, so a comment moving Drafts → In progress is followed) → its `data-focus-row-primary`,
   else its first own focusable; else a focusable replacement with the same slot in the same region.
2. **Nearest enabled sibling**, for a control still in the page but disabled (or replaced by a disabled
   twin with its slot — a disabled `IconButton` remounts inside its tooltip wrapper): the closest focusable
   among its container's controls, previous first, climbing at most three ancestors and never past its
   region or layer.
3. **Neighbour row**, list by list outward: the containing row again (outer lists only), the next recorded
   row, the previous, the list's `data-focus-fallback`, the list's first focusable; then the outermost
   list's enclosing `data-focus-default`.
4. **Safety net** — the active region's F6 landing target (`regionLandingTarget`, the record's region when
   the active one is gone; a waiting question's `[data-focus-claim]` wins it, as for F6); inside a live dialog, its first focusable. A control that sat in no region and
   no dialog (a field a page or extension injected into `<body>`) gets no safety net: focus stays where the
   browser put it.

A control that was only disabled (still in the page, or replaced by its disabled slot twin) gets focus
back when it re-enables, provided focus still rests where recovery put it and no key or pointer press
happened since — a field that disables while its save is pending keeps the keyboard across the save. A
control that disables and re-enables before the check frame (a save finishing between paints) is already
blurred yet focusable again at the check; the observed `disabled` / `hidden` / `inert` change on it is
remembered, so focus goes straight back to it rather than being written off as a click on empty space.

While nothing matches and the innermost list is not in the page (a Settings page re-fetching behind a
skeleton), it re-resolves every frame for a bounded grace (~3 s) before the safety net, and abandons the
moment focus rests anywhere else. It scrolls only for what the user was looking at: an
`IntersectionObserver` follows the focused element, and when it was on screen as it was lost the target
is focused and brought into view (`block: "nearest"`, a no-op when it already shows); when it was off
screen — a virtualized list unmounting a row the reader scrolled away from — the target is focused with
`preventScroll`, so the scroll is never yanked back. Landing focus off screen for no reason would hide
where it is. It keeps its own ticket, apart from the focus chords' single wait (`focusWhenSettled`), so a recovery
never cancels a chord's pending landing; any focus, a chord's included, ends a recovery. Show and jump
actions do not rely on it: they focus what they revealed themselves. Neither does a virtualized list whose
focused row unmounts: the chat transcript moves focus to its own list container in the row's unmount
cleanup, before the browser drops it, so recovery sees focus held and the list keeps its cursor
([[submodule-web-chat]], *Transcript keyboard model*).
