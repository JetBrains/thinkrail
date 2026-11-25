---
id: submodule-web-panels
type: submodule-design
status: active
title: panels — feature views
parent: module-web
depends-on: [module-contracts, submodule-web-settingskit]
references: [central-integration]
tags: [ui]
---

## Responsibility

The layout-agnostic, store-driven feature views. A panel fills its container and never knows its
arrangement (so the mobile shell is an additive layer, not a rewrite).

Files (both modes) and Review keep their fixed toolbars outside a panel-owned `components/QuietScrollArea`
(Files through `RememberedScrollArea`); Projects and Specs expose content for the shell-owned scroll wrapper
described in `shell/SPEC.md`.
`TerminalInstance` wraps xterm with `QuietScrollFrame`, which skins xterm's descendant custom scroll control
without shrinking its hit target; top/bottom state comes from xterm's public `buffer.active.viewportY/baseY`
and `onScroll`/`onWriteParsed` API rather than pretending its non-native viewport has DOM scroll metrics.
Those edges also authoritatively signal whether vertical scrollback exists, allowing the frame to expose
xterm's otherwise-invisible controller for local intent and accessibility modes without inventing a second
scroll model. The same neutral intent-revealed thumb + directional curtains therefore follow the terminal
wherever it is placed. Feature views never receive or derive left/right/bottom placement to achieve that
treatment.

## Boundary

- **Owns:** `ChatsSection` + `chatActions.ts` — the **Chats without a project** home. The section tops the
  Projects panel whenever the host speaks `CHATS_PROTOCOL_VERSION` (the host ensures the container at boot;
  an empty section reads "Chats without a project appear here", and the container never counts as a
  project — not for the first-run wizard either): one row per `kind: "chat"` workspace, newest activity first, labelled by
  `lib`'s `chatLabel` over the host's `SessionStateRecord.title` and the conversation's first prompt
  (`selectChatWorkspaceFirstPrompt`) — an unnamed chat reads as its first prompt, with `data-title-source`
  and the full first line as tooltip, else "Chat" — with the shared attention dot / running icon, the
  active highlight, and a menu of Open in / Copy path / Reveal / the shell's chat actions / Mark read /
  **Delete chat…** — the chat actions (`ProjectTree`'s `chatActions` prop, `lib`'s `ChatAction`, such as
  an extension's *Analyze session*, [[submodule-web-shell]] § Extension panels) are offered for the
  conversation the row stands for (`selectChatWorkspaceSession`: its first chat with a session file), and
  for none while it has none; the
  confirmation (`ChatDeleteDialog`, shared with the topbar's chat menu) names the folder's file count
  from `chat.inspect` ("…with 3 files move to the Trash"), is bound to the chat it was opened for and
  closes when that chat is removed, starts deleting elsewhere, or (topbar) stops being the active chat;
  a chat whose deletion did not finish shows "Deletion incomplete" and offers only Retry, and no
  navigating surface (topbar Chats entry, sibling menu) opens it. `chatActions`
  owns the three host calls: `startProjectlessChat({ text?, images?, model? })` (`chat.create` → put the
  workspace under its container in the store, activate it, open the host-created session, prewarm the
  watcher, send the first prompt, end a first-run wizard still showing; a start already in flight is
  joined, so a double click makes one chat), `deleteProjectlessChat`, `inspectProjectlessChat`;
  `canStartProjectlessChat` is the protocol gate every start surface shares. Start surfaces: the Chats
  `+`, the Welcome's "Chat without a project" card (next to Open project when no repository is open),
  the Create dialog's **Chat without a project** target (`ws-target-chat` — the only target when no
  repository is open; it hides the project and branch pickers and Manage skills — the container is
  never trusted, so only global skills apply — scopes templates to the container and honours the
  dialog's explicit model; the dialog takes its defaults once per opening, so another window opening or
  reordering projects never resets a draft or a creation in flight, choosing a repository target while no
  repository is selected selects the first open one in the same update (so no request asks the
  container), and only a repository target closes when its project does), the palette's `chat.newProjectless` command and start row, and
  New chat inside a chat (`openChat` turns the host's `CHAT_HAS_SESSION` refusal into a sibling chat — one
  chat = one folder; `CHAT_DELETING` / `CHAT_DELETION_PENDING` are reported, never turned into a chat). `FilesPanel` asks no git status in a chat and hides its Changed mode. Settle, and the
  automatic Settled shelf, never apply to a chat (`canSettleWorkspace`, `selectWorkspaceSettledReason`);
  Recently closed and prompt history offer no per-session Trash for a chat (the host refuses
  `session.delete` there — deleting a chat is the whole-chat confirmation, never a silent broadening).
  The topbar's Chats entry loads the container's list before it decides there is no chat to open.
  Repository
  listings and fallbacks (`ProjectTree`, `WelcomePanel`, the dialog's project picker) read
  `selectRepoProjects`, never `s.projects`, so the container is never offered as a project.
  **Continue in workspace:** `ContinueChatDialog` (reached from the Chats row menu and the topbar chat
  segment) picks a repository — the context repository at the moment it opens, kept while the user's pick
  exists, so a project another window opens or reorders never changes it — and calls
  `continueChatInWorkspace(chatId, projectId)` → `chat/continuations`' `requestContinuation`
  (`chat.continue`), closing at once (the agent's turn runs on its own); the store's
  `initiatedContinuations` remembers the operations this client started, and `chat/continuations`
  follows them to the new chat when the host reports `started` — the initiating client alone — or
  toasts the failure. The dialog is bound to the chat that opened it: the topbar segment keys it by that
  chat's id (navigating elsewhere, or a delete elsewhere that moves this window to another chat, closes
  it), it never shows over a chat whose deletion did not finish, and the project picker is named by its
  label and its current value. A first chat loads the container's list through
  `loadProjectWorkspaces` instead of seeding it, so the Chats section never shows a partial list. A chat row reads "Continued in <project>" from the record's
  `continuedTo`.
- **Owns:** `ProjectTree`. Each top-level project row is a compact IDE-tree row at the shared `--panel-row-height` (`web-spacing`):
  **always-visible chevron** + folder/name + a collapsed-only plain workspace count + an **always-visible Create
  workspace `+` in a fixed right-edge column**. That `+` is the **same control as the Projects-header Add
  project `+`** — both are `IconButton` ghost `s`, so they render identically and their glyphs
  line up on one vertical axis (both sit at the row's `pr-xs` right edge). The Create workspace `+`'s tooltip
  shows the one `workspace.new` chord that reaches this client as keycaps — `Mod+N` on the desktop, the
  `Mod+Alt+N` alias in a browser — from `ProjectTree`'s `newWorkspaceShortcut` caps, which the shell
  injects from the resolved table (see `submodule-web-shell` global chords, *Chords in tooltips*); the
  context-menu item stays plain.
  Long names truncate before the count/action; there is deliberately **no visible Close or overflow icon**.
  Hover highlights the full row and the highlight remains while its **project context menu** is open.
  Right-click opens that PR-#167-styled menu at the pointer without selecting/navigating; a scroll-cancelled
  ~700ms long press is its touch equivalent. With a project-name button focused, the standard Context Menu
  key or Shift+F10 opens the same menu for keyboard-only use; arrow/activate/Escape keys work normally.
  The menu is neutral: **Plus Create workspace**, **FolderOpen Open existing worktree…**, separator,
  **ArrowUp Move up** / **ArrowDown Move down** + separator (only when the host's protocol is at least
  `PROJECT_ORDER_PROTOCOL_VERSION`; disabled at either end), **Pencil Rename** (only when the host's protocol is at least `PROJECT_RENAME_PROTOCOL_VERSION`), **X Close
  project**. **Project order is host-owned** (`Project.rank`, architecture Decision 9: projects are domain
  state), so every window and client shows one arrangement and converges on the `project.updated` push;
  `workspaceActions.moveProject` sends `project.move` and toasts a refusal; its reply is never applied as
  state, because a reconnect can replay a cached reply over a newer welcome snapshot, and the host has
  already pushed the moved ranks. Three equivalent gestures place a project before/after a neighbour:
  dragging its name button (not the chevron, `+`, or rename input), the menu's Move up/down, and
  **Alt+Shift+↑/↓** on the focused name (`aria-keyshortcuts`, the workbench's reorder chord); below
  `PROJECT_ORDER_PROTOCOL_VERSION` none of them is offered and the chord passes through untouched. The
  drag is `@dnd-kit/core`'s, like the workbench's tab drag, with a `MouseSensor` (5 px activation, so a
  click still selects and a drag never navigates; touch keeps scrolling and reorders through the
  long-press menu) and `pointerWithin`: each
  project group carries before/after half drop zones that light the workbench's `border-primary`
  insertion line, zones whose move would be a no-op stay disabled, the source dims, and a `DragOverlay`
  chip names the project. Escape or a drop outside a zone changes nothing. The Chats section sits outside
  that drag context, so it is never draggable or a drop target and no project can land above it; the
  host refuses the container at either end anyway. After a keyboard or menu move focus returns to the
  moved name; every completed move fills the rail's polite `role="status"` region ("… moved to position
  2 of 3"), while dnd-kit's own announcements stay silent and its screen-reader instructions are the
  localized keyboard hint the name button is described by. A project opened or reopened lands on top;
  the rest keep their order. Rename swaps the project name for the same inline input as workspace rename (Enter/blur
  commits a changed trimmed name via `project.rename`, Escape cancels) and waits for the `project.updated`
  push — no optimistic label; rejection raises an error toast. Create is exactly the direct `+` flow. Open existing worktree opens the
  `ExistingWorktreeDialog` chooser fed by `workspace.listExisting` (branch + absolute path per row;
  detached-HEAD rows stay visible but disabled); choosing one calls `workspace.openExisting`, then expands
  the project and activates the attached row without starting a chat. Close
  opens a centered, neutral `ConfirmDialog` titled **“Close {name}?”**, description **“Removes this project
  from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it
  from Add project → Recents.”**, Cancel initially focused, and **Close project**; Cancel, backdrop, and
  Escape dismiss. Confirm fires `project.close` and waits for the full `project.updated` push—no optimistic
  removal; success is the
  row disappearing with no toast, while rejection keeps it and raises an error toast. Menu/dialog dismissal
  restores the source project-name focus; a successful close leaves focus to the shell's recovery engine
  (the project rows are a `projects` focus list with Add project as its fallback): the next project's name,
  else the previous, else Add project. `ProjectTree` also owns the `NewWorkspaceDialog` the per-project `+` opens **and** each
  workspace row's hover-revealed **kebab menu** (`MoreVertical`, controlled `DropdownMenu`) — right-clicking
  anywhere on the row opens that exact menu at the kebab without selecting/activating the workspace, while
  the kebab remains the touch path (keyboard users open the menu from the row, see *Sidebar trees*). Its actions are a `DropdownMenuSub` **"Open in"**
  (rendered only when at least one editor was detected), **Copy path**, and **Reveal in file manager**. A
  ThinkRail-managed worktree additionally gets **Rename** when the connected host's protocol is at least
  `WORKSPACE_RENAME_PROTOCOL_VERSION`, plus **Remove workspace**; an external row gets only **Remove from
  ThinkRail**, whose confirm promises the checkout and its branch stay untouched.
  The Default gets neither mutation. "Open in" comes from the host-wide `editor.list`; GUI entries call
  `workspace.openIn`, while terminal-kind Vim activates the workspace and runs through `addTerminal`'s
  one-shot `initialCommand`. Copy writes `worktreePath`; Reveal calls `workspace.reveal`. These requests,
  `editor.list`, the project workspace-list load, the remove confirm (`RemoveWorkspaceDialog`, which for a
  workspace ThinkRail made also says how many artifacts go with it, from the loaded artifacts snapshot), and the
  inline-rename controller below (`createRenameController` / `useInlineRename`, shared with project rename) live once in
  `workspaceActions.ts` so the shell's topbar workspace menu ([[submodule-web-shell-location-bar]]) offers
  the same actions — including the capability-aware pending rename — without a second implementation. The
  controller dispatches to the workspace captured when the edit started and resets when the hook's
  workspace identity changes, so a consumer that is not keyed per workspace cannot misdirect a pending
  name. **Settle** / **Keep active** (`workspace.settle` / `workspace.unsettle`, gated on
  `WORKSPACE_SETTLE_PROTOCOL_VERSION`) ride the same file.
  **The Settled shelf.** It renders only when the host advertises
  `WORKSPACE_SETTLE_PROTOCOL_VERSION`; an older host retains the raw flat list and order, with no
  shelf or settle controls even if rollback persistence carries stale newer fields. On a
  capable host, an expanded project renders its **live** rows from `selectWorkspacePartition` newest
  created first (never re-sorted by activity, so rows stay put while agents work), then a **`Settled · N`** disclosure header (collapsed by default, store-held
  per browser) whose body lists the settled rows **slim** — single line, name only, a small **reason chip**
  (`merged` / `closed` / `idle 2w` / `by you`, long form in its tooltip), a hover **↩ Keep active** beside the kebab (also in the menu) — ten at
  a time with a *Show 25 more* row. Live rows gain a hover **✓ Settle** beside the kebab (also in the menu
  and on right-click); it is disabled while the row's agent works or a result is unread, absent on Default.
  On a v86+ host the same menu section carries one read toggle from `selectWorkspaceReadAction`: **Mark as
  read** while any chat in the workspace has an unread result, else **Mark as unread** when a finished,
  non-cancelled result can be relit, else nothing (`markWorkspaceRead` / `markWorkspaceUnread` in
  `workspaceActions.ts`, shared with the topbar). Unread relights only the most recently active chat, so
  one visit clears it; read never dismisses a needs-input blocker.
  The partition re-evaluates on the shared 30-second `useNow` clock so idle rows cross the window without
  a click and the rail stays in lockstep with the topbar, and
  selecting a settled row expands the shelf and pages far enough to show it. **The first automatic move
  is announced once per browser** (`settledShelfNotice`, a host-qualified localStorage flag like the
  sibling persistence modules): when `selectAutoSettledCounts` first reports rows the shelf took on its
  own — a merged/closed PR or the idle window, never a row parked by hand — and the count has held still
  for two seconds (the upgrade backfill lands as a burst of pushes, and the notice should count the
  burst, not its first row), an info toast reads *Moved N quiet workspaces to Settled*, names the rules,
  and offers **Show**, which expands those projects and their shelves. Without it, the first launch after
  an upgrade empties most of a long rail at once with no explanation. Nothing about settling touches
  disk: the shelf is a list state, and each row's own *Remove* stays the only teardown — there is no bulk
  removal yet, because a safe one needs a non-blocking, crash-safe host teardown first (#688). Why this
  shape (recorded once): an explicit-archive-only rail left
  the housekeeping to the user (48 rows on the author's machine), a pure recency fold had no way to say
  "done", and a hidden Archived tier made rows disappear without a visible home — the shelf keeps every
  automatic move one disclosure away, with the reason spelled out. The reason is an outlined
  `tr-text-caption` badge: merged in the info tone, settled-by-you in the warning tone, closed and idle
  as neutral `border-default` / `text-subtle` metadata.
  Rename replaces the row's name span in place with a chrome-less single-line input carrying the same
  typography, colour, and geometry; it is prefilled, focused, and selected. Enter or blur commits, Escape
  cancels, and blank or text unchanged from the edit-start label exits without a request, so an incoming
  peer snapshot cannot be reverted by closing an untouched editor. A changed commit made while the current
  socket's capability is unknown stays pending and dispatches only after a v55-or-newer welcome restores
  `canRename`; an older host never receives the method. A commit leaves optimistic domain state out of the
  client: the row returns to the prior host-owned label until every surface adopts the full-snapshot
  `workspace.updated` push; rejection keeps that snapshot and raises an error toast. The Git branch and
  worktree folder never change. Remove is styled destructive
  and opens a centered `ConfirmDialog`; confirming fires `workspace.remove` and lets every client react to the
  host's `workspace.removed` push via the store's `applyWorkspaceRemoved`; a rejected request (no event will
  come) surfaces an error toast, leaving the row in place. Each **workspace row** is **two-line**: the display
  `name` on top with the git **branch on a second line beneath it** (muted, monospace), rendered only when
  it differs from the name (so pristine/legacy `workspace-N` rows stay a single compact line) — the display
  name is decoupled from the git branch (see [[submodule-server-workspaces]]).

  Workspace/project session presentation comes only from normalized host state. The rail has exactly two
  visual treatments: a static green/accent **attention dot** for either a concrete needs-input blocker or an
  owner-globally unread result, and the shared `RunningIcon` brand badge **in place of** the workspace/project
  identity icon while a top-level session is genuinely working. Attention is binary: needs-input and unread-result states use the
  same dot, with the accessible label **“Needs attention”** and no question/check/result glyph, spinner,
  count, or status-specific tooltip. Working keeps the row's existing active/inactive colour (the badge wears
  `text-primary` / `text-text-muted` exactly as the glyph it replaces) and exposes **“Agent working”**
  accessibly; it never adds a second marker. Queued, hidden/background, stopped, and quiet sessions show
  their identity glyph; a needs-input session may still show the badge when its orthogonal execution fact
  remains running, so the attention dot and working treatment can coexist. Reduced motion keeps the badge
  static. Collapsed project rollup uses the same selectors as
  workspace rows, while expanded projects show the detail on workspace rows. The components remain
  props-driven over the normalized host-state selectors.

  `ProjectTree` renders the shared dependency-light `AttentionDot` from normalized host-state selectors.
  It is static accent colour, carries no count or state-specific glyph/tooltip, and occupies its own flex
  column between the identity button and the hover-revealed kebab. Workspace and collapsed-project rows
  expose `data-attention` only while positive. Separately, the shared `RunningIcon` replaces the
  identity icon for normalized working state; workspace and collapsed-project rows expose `data-running` only
  while positive. These attributes are test hooks, not a second state model.

  **Project rows carry the workspace count only while collapsed**; expanded, the workspace rows provide the
  detail directly. The **Default workspace**
  (`kind === "default"` — the project folder itself) renders **pinned first** (the server pins it in
  `workspace.list`; `addWorkspace` appends created worktree rows after it), with a **`House` icon** in
  place of the `GitBranch` glyph and **no Rename or Remove item** (non-renamable/non-removable — the server
  enforces both; the menu simply omits them) — it still gets "Open in" / Copy path / Reveal like every
  worktree. Its branch line
  shows the folder's real current branch. When the **selected project's** authoritative workspace list lands,
  `ProjectTree` fire-and-forgets transport's `prewarmWorkspaceSkillLoad` for at most the first eight rows:
  the common visible set begins the conservative watcher-readiness window before a workspace click. The
  per-selection cap bounds the request fan-out; the *global* bound is host-side — prewarm-only watchers live
  in a capped, evictable pool (server `watch` SPEC), so clicking through many projects in one host lifetime
  reuses that pool instead of accumulating watchers. The list never waits for prewarm, failures stay
  silent and retryable by the eventual chat load, and merely expanding a background project does not prewarm
  it (the prewarm is gated on the *selected* project, so the lazy restored-expansion fetch below keeps this
  invariant too). **Rail expansion is store-held, per-browser view state**
  (`store.expandedProjectIds`), not component state: it survives the Project-Home/workspace remount
  boundary and, via the `projectExpansion` persistence module (localStorage under a host-qualified key,
  hydrated at boot from `main.tsx`, best-effort writes, untrusted reads), a page reload — the rail
  looks the same after reloading (the shelf's disclosure is deliberately not persisted — collapsed is the
  right default). Rows whose persisted expansion outlives this client's fetched lists
  (a fresh reload) fetch their missing `workspace.list` lazily; an already-fetched list is refreshed on
  an explicit expand gesture and by transport after a new welcome/reconnect generation, never refetched in
  a loop. The active workspace must
  also stay visible: when `ProjectTree` mounts with an active workspace, or the active workspace's derived
  owning project changes or first becomes resolvable, it expands that parent project — this reveal applies
  *on top of* the persisted baseline (a persisted collapse never hides the active workspace). A manual collapse
  remains respected while the owning project is unchanged; ordinary `workspace.updated` snapshots and
  same-project workspace switches do not force it open again. Navigation restore is neutral: a reload
  re-selects the routed project without touching expansion (the persisted state *is* the view). Workspace
  creation expands its project
  explicitly. Selecting or creating a workspace also selects its owning project, keeping project-home and
  active-workspace context coherent even when the create dialog's project picker targets another project.
  **Opening a project lands on that project's Welcome** — deliberately **no auto-enter** into any
  workspace: Welcome is the fork where the two working modes (isolated worktree vs the project folder's
  Default workspace) are presented as an explicit choice (see `WelcomePanel`), so opening and the
  "project home" gesture converge on the same surface. Opening goes through the shared
  **`useOpenProject`** hook (reused by `ProjectTree` **and**
  `WelcomePanel`, so the flow is identical in the Projects view and the Welcome screen): `project.open` reactivates
  a closed known path under its same id (or opens a new one), then the initiating client selects Project
  Home while every client receives `project.updated`; on failure (except `GIT_TIMEOUT`, which shows its error at once
  rather than run the same hung probe again) `project.inspect` → either offers to
  bootstrap the folder into a repo — a modal **`ConfirmDialog`**
  (confirm → `project.init`) — when it's `initable`, or surfaces the error in a **`NoticeDialog`** — so a
  non-git folder is never a silent no-op. `project.init` waits 13 minutes, the host's longest bootstrap on
  macOS/Linux (two 5-minute index writes plus short probes, [[submodule-server-projects]]) with a minute to
  spare; a Windows bootstrap has no host deadline, so one that outlasts the wait reports a timeout while the
  host finishes and publishes the project. The native picker remains the local fast path and keeps its raised
  timeout because it waits on a human; if the host cannot present it, the rejection instead opens an
  **Open project from host path** dialog carrying the reason and an autofocused path field. The dialog says
  the path belongs to the computer running ThinkRail, accepts a host-absolute path or `~` / `~/…`, and
  submits through this same open/inspect/init flow. **Enter host path…** is also always present beside Open
  project in `AddProjectMenu`: a remote client cannot tell whether a successful native picker opened on an
  unseen host display, so recovery cannot be failure-only. Every open gesture starts one client-wide
  last-intent generation shared by both mounted `useOpenProject` instances. The flow rechecks that generation
  after each picker, open, inspect, init, and adoption await, so a manual path or recent selection from either
  surface supersedes any older flow before it can select a project or raise a stale dialog.
  These are modals on `@thinkrail/ui/dialog` (the init offer has no on-screen anchor, unlike the Remove
  popover); `NoticeDialog` remains the single-button
  surface for failures with no recovery inside that notice. The hook returns a `dialogs` node each consumer
  renders. **Selecting a
  project** (clicking its row — the chevron expands/collapses separately) **deselects any active
  workspace**, so the shell returns to that project's Welcome — a deliberate "project home" gesture. Both
  select-project gestures — the rail row click and adopting a just-opened project (`ProjectTree` *and*
  `WelcomePanel`) — also **reveal the project's workspaces** (`selectProject(id, { reveal: true })`): a
  gesture that enters a project promises its workspace list, so opening from the Welcome screen never
  lands with a collapsed rail row; the
  workspace's frontend-local view survives through shell layout persistence, so re-selecting it restores
  that window's resource tabs inside the unchanged frame. The round trip unmounts the workspace surface, but
  terminals keep no client-side lifetime to lose: the host owns
  each tab and PTY, and unmounting kills nothing. Several distinct terminals may be visible in different
  workbench groups; the shell layout visibility gate mounts one body for each locally selected terminal
  identity and no inactive body. `TerminalWorkbenchBody` receives its New-terminal callback from the shell,
  so it stays arrangement-agnostic while a center placement can capture its owning group. Host attachment
  remains globally exclusive per identity, so selecting the
  same terminal in another client triggers the existing takeover/detached/reclaim flow. Terminal catalog
  hydration is connection-generation stamped, and its full-snapshot push subscription is established before
  `terminal.list`: a push that lands after the read starts wins, while the transport's synchronously replayed
  cached push is correctly treated as the read baseline. Only explicit `terminal.close` kills a PTY, with the existing busy-shell confirmation; confirming a force-close retains
  the active request until it settles (the dialog may close, but a second request cannot orphan it), failures
  surface to the user, and an authoritative catalog removal dismisses a now-stale confirmation instead of
  leaving a modal for a terminal another client already closed. Also `FilesPanel` (the **Files** tool: a
  fixed panel-header row with an **All | Changed** `ToggleSegment` pair — `Changed` carries the changed-file
  count when non-zero — over `FileTree` or `ChangesPanel`; the mode is app-wide, session-only,
  `store.filesMode`, default All, and `requestChangesView` / `revealChanges` reveal Files and select Changed
  in one store write. `FilesPanel` owns the single `git.status` read (`useGitStatus`, scope-keyed, including
  the unknown-commit scope fallback) and feeds `ChangesPanel` and the **All** marks from it, so count, marks
  and the Changed list cannot disagree. Both `git.status` readers — `useGitStatus` and `ChangesReviewPane` —
  read through `gitStatusCache.readGitStatus`, which records each result keyed by *(workspace, scope, target
  ref)*; the review tab starts from that entry, then refreshes it with its own read. That way, opening a scope
  the panel has already read renders its sections on first paint, not after a skeleton round-trip. The cache
  is a bounded LRU (32 entries), a reply never overwrites one from a later request, a removed workspace's
  entries are dropped, and an `UNKNOWN_COMMIT` rejection forgets the entry, so a vanished scope is never
  seeded. A seeded status is provisional until the tab's own read settles: a reveal, the stored active file
  and the Stacked restore whose path the seed lacks wait for that read instead of being dropped or
  overwritten. **All** follows VS Code's Explorer: the plain tree plus marks derived
  once by the pure `changesModel.buildChangeMarks` — a changed file shows its name and a trailing
  `M`/`A`/`U`/`R` letter in the status colour (modified amber, added/untracked green, renamed blue; the one
  `chat/planView.statusLetter`, shared with the Changes review tab and plan rows, so untracked reads `U`
  and added `A` everywhere); every
  ancestor folder, expanded or collapsed, shows its name and a dot in one amber "contains changes" colour
  (a compact row as a whole); deleted files are neither shown nor mark folders, as in VS Code. Git-ignored
  entries (the host's `FileNode.gitignored` — for a compact row, that of the deepest directory it
  represents — and everything inside them) render in `text-subtle`. The
  active file or diff tab (`selectActiveFilePath`) gets the selected row look, and when it changes while All
  is showing its folders expand (and stay expanded) and it scrolls `nearest` into view; on return All
  reveals only if the active file differs from the persisted `seenActivePath`, and then skips the scroll
  restore so the two cannot fight. Auto-reveal never switches the side tab or the mode. Clicks still open
  the editor. Right-clicking a file or folder row (a touch long-press, or the Context Menu key / Shift+F10 on
  a focused row) opens its menu: **Open in browser** first for an HTML file from a host at
  `BROWSER_VIEW_PROTOCOL_VERSION` (v122; `OpenInBrowserMenuItem`, also in the Artifacts row menu after
  Reveal, and `OpenInBrowserButton` in the file tab's toolbar and, through `ResourceHost.OpenInBrowser`, in
  every framed preview), then **Copy path** (absolute, through `joinWorkspacePath`) and **Copy relative
  path** (worktree-relative). "Open in browser" opens the host's `/view/` URL with `window.open(…,
  "noopener,noreferrer")`: a new tab on the web, the system browser on the desktop
  ([[submodule-server-host]] serves it sandboxed, [[module-desktop]] routes it to the OS). A compacted folder copies its deepest path, matching its label, and copying
  neither opens nor selects the row. The row stays highlighted while its menu is open. From a host at
  `FS_MUTATIONS_PROTOCOL_VERSION` (v118) the menu adds the tree's two mutations, both host-owned and
  watcher-refreshed, never patched into the rows (`fileTreeActions`): **Copy** puts the row's entry — file,
  folder or link, a compacted folder's deepest folder — on the session-only in-app clipboard
  (`store.fileClipboard`, not the OS clipboard, cleared with its workspace or when its entry is deleted);
  **Paste** (only while the clipboard holds an entry) asks `fs.copy` for a copy beside a file or inside a
  folder — across workspaces too, a copy unless the entry was cut (below) — under the host's ` copy` /
  ` copy N` name, then expands
  that folder, and an empty tree offers the same Paste as a button next to *Empty*; **Delete** (also the Delete key on a row) asks for
  confirmation and `fs.delete` moves the entry to the OS trash. From `ARTIFACTS_PROTOCOL_VERSION` (v121)
  the menu also has **Cut**: the same clipboard entry marked `cut`, which the next Paste (here or in the
  Artifacts tool) turns into `fs.move` — refused with "already exists" rather than renamed, and with "on
  another disk" across file systems, where the entry stays on the clipboard so the user can copy it — and
  clears once it succeeds.
  The confirmation says when an agent is
  working in the workspace but does not block — the user's explicit action wins, as with a hunk revert —
  and an open tab of a deleted file keeps its stale-content contract. Failures toast; a folder past the
  host's copy bound and an entry that changed under the paste or delete (`ENTRY_CHANGED`) get their own
  messages. A failed first status read shows no marks; a failed refresh keeps the
  last ones, like the Changed list. The tree's look is remembered per workspace across reloads (`store.filesTreeByWorkspace`:
  All expanded folders, Changed-tree collapsed folders shared by every scope, scroll per view through
  `RememberedScrollArea` — a Changed view's scroll belongs to its scope and compare target, so changing
  either starts at the top), persisted by the `filesTreeState` module (native stable preferences, else
  localStorage under a host-qualified key; hydrated from `main.tsx`, debounced writes plus a `pagehide`
  flush; windows share it, last write wins, no live sync). A **Collapse all folders** `HeaderIconButton` at the
  right of the switch row collapses All, or — only in Changed's Tree view with at least one change —
  every changed-tree folder (`changeTreeFolderPaths`)), `FileTree`, `SpecsPanel`, `ReviewPanel`,
  `ChangesPanel` (the changed files under a fixed **panel-header row** — `h-panel-header-row`
  (`--panel-header-row-height`, currently 28px), shared structural geometry with workbench Group Headers
  and the chat header, not a value pinned here — that says **what** is being diffed via the
  **`ChangesScopeMenu`** scope pill + the shared **`BranchPicker`** target-branch pill, plus the
  **List | Tree** toggle (`store.changesView`, app-wide) switching a flat list and a folder
  **`ChangesTree`**; a single click on a file in either opens/reveals it in the scope's **Changes review
  tab** (double-click or *Open as tab*: its own diff tab — the two-presentation rule below), and every file
  row carries the shared **`ChangeRowActions`** menu. The row wrapper paints the complete hover/selected
  band, including the trailing menu slot; its inner open-file button remains transparent so that band
  cannot look clipped before the menu),
  `FilePane` and `DiffPane` as resource-registry dispatchers over [[module-resource-renderers]] (the bundled
  lazy renderers, Monaco's desktop-file plumbing and Pierre's provider live there), plus lazy
  `TerminalInstance`.
  The slim header view-toggle segment (the ordered resource
  candidates, `Split|Inline`, `List|Tree`) is the shared `@thinkrail/ui/toggle-segment` `ToggleSegment` — whose active segment reuses the tab
  grammar's `control-bg-selected` (below), never a container surface, so the selected fill survives the
  high-contrast themes where `container-elevated-bg` collapses onto the toolbar surface.
  The `ChangesPanel` secondary toolbar paints **no surface of its own**: like the right-panel tab strip
  it shows the panel's `container-sidebar-bg`, so the two chrome rows read as one continuous surface. The **file-style tree row** (chevron/spacer
  lead, folder/file icon, truncated label, trailing slot; `min-w-0` so a row can shrink when it shares a
  flex line with a trailing control) is the shared **`TreeRow`** (`@thinkrail/ui/tree-row`; it moved to
  [[module-ui]] with `DiffStatBadge` and `folderChains` when the session-insights heat tree became their
  second consumer), used by `FileTree`, `ChangesTree` and the Artifacts tree so the trees stay identical;
  its optional `icon` replaces the file glyph (the Artifacts tree's type icons). `TreeRow`'s optional `onWarm` reports
  `hover` (pointer enter) or `focus`. `FileTree` file rows warm at once on focus and through
  `warmOnHover` on hover, which keeps one pending row and fires after the pointer rests 150 ms, so a
  sweep across the tree loads nothing. A warm preloads the code view
  through **`useEditorWarm`** (`editorWarm.ts`, also used by the shell's idle preload): it returns
  `usePreloadResourceView`'s callback, or `undefined` on phone-class viewports and `saveData` connections.
  `editorWarm` also owns the boot gate: a `FileTree` holds `holdEditorWarm()` until its first listing
  lands, and **`whenFilesTreeIdle`** runs the shell's preload at idle only while no tree is loading. A
  parked task waits for the release and then a fresh idle, so the Monaco chunk never evaluates in the
  tree's first paint. Both trees **compact a single-directory
  run into one slash-joined row** (`apps/web/src`): the run continues only while a directory has exactly
  one child and that child is another directory, and the compact row expands/collapses the deepest
  directory as one unit. `ChangesTree` evaluates this against the changed-file tree; `FileTree` resolves
  only visible compact runs through its existing client-side directory reads, so the wire remains a plain
  immediate-directory listing (the run logic is `@thinkrail/ui/folder-chains`). The **`+N −M` diff-count
  badge** is the shared **`DiffStatBadge`** (`@thinkrail/ui/diff-stat-badge`), used
  only inside Changes: the flat list's file rows, the tree's file rows, and a tree folder's aggregate only
  while it is collapsed (an expanded folder's children already show those counts).
  `ChangesTree`'s tree build + `+/−` aggregation + shared status glyphs live in the pure
  **`changesModel.ts`** (unit-tested; no store/transport — `ChangesTree` is presentational, fed `changes` +
  `onOpen`/`isActive` by `ChangesPanel`), together with the **diff-tab identity + scope vocabulary**:
  `scopeKey` / `diffTabId(workspaceId, scope, path)` / `diffTabName` / `scopeLabel` and the `splitPath`
  used by both the flat list's path rows and the diff header's path chip. The **branch combobox** is the
  shared **`BranchPicker`** (searchable, grouped Remote/Local, current pick check-marked, refreshed on every
  open with an explicit Refresh control as well; a repo with no remote branches — a fresh **Start a new project**
  repo — marks the trigger "· local" and says in the header that its branches live only on this computer, so a
  bare `main` is not mistaken for a GitHub branch) — one component for the New-Workspace dialog's *base* branch
  and the Changes header's *target* branch. Its trigger is a `Button ghost m` (branch icon, label, chevron)
  unless a caller passes `triggerClassName` for its own pill family (the New-Workspace dialog's
  composer-style pills), so the Changes header's scope and target triggers read as one pair. **Remote is two layers**: one `Remote` parent over a subgroup per
  host-identified remote (`origin`, `upstream`), whose rows show branch names without repeating the remote.
  The full ref remains every row's selection identity, search value, and `data-branch`; the browser never
  splits `remote/branch`, because Git permits `/` in a remote name. Unconfigured tracking refs live under
  `Other` and keep their full ref as the row label. `BranchList.remoteGroups` is additive: against an older
  host that omits it, the picker falls back to one flat Remote group of full refs. The grouped path uses
  nested cmdk groups; the force-mounted parent hides only when cmdk has hidden every child group. A fork
  works two remotes, so a list that shows only `origin` hides the ref it branches from. The whole state
  *around* it — the list, `refreshing`, `refresh()` — is the shared
  **`useBranchList(projectId, onLoaded?)`** (`branches.ts`, over the offline-degrading
  `listBranchesOrEmpty`; it also reports `failed` for a degraded initial read, so the picker never calls an
  unreadable repository "local only"), so both pickers are identical **by construction**: the list is **keyed to the
  project** (it clears on a project change, and both reads are generation-stamped, so a switch can never
  offer or land the previous project's branches), **only the initial read degrades** (a *refresh* keeps its
  last good list instead of blanking the picker on a transient failure), and `refreshing` always drives the
  spinner. Initial-load prefetch always offers the non-empty default to the host, which is the authority on
  whether it names a configured remote; this keeps a stale or missing default tracking ref off create's
  critical path without reading the not-yet-rendered branch state. Manual picks prefetch only rows from the
  loaded remote list. A `null` projectId reads nothing — how a closed dialog pauses. Its degraded default is
  `defaultBranch: ""`, **never the literal `HEAD`**: a sentinel that named a ref would be believed — the
  dialog would preselect it and persist it as the workspace's `baseBranch`, and that worktree would forever
  diff against its own head. Empty means "unknown", so `create` omits `baseRef` and the host resolves the
  real branch. **`WelcomePanel`** is the first-touch surface the shell mounts (centered, left-nav beside it) whenever no
workspace is active. **One hero heading** (`welcome-title`, the topbar's brand styling — accent font,
`text-primary` — enlarged): the **shown project's name**, or `PRODUCT_NAME` when no project is shown —
the wordmark is the empty-state identity, a project's own name is the identity once one is open (so no
separate project eyebrow). The one exception is the post-connect handoff: after a provider connects from
the Welcome banner while no project is shown, the hero reads **"You're set"** over the same one-line
`ConnectedLine` the wizard ends on ("Anthropic connected · the agent can run now"; the toast carries the count), so the screen visibly changes instead of returning the user to the same wall. **No pitch prose
otherwise** — the marketing paragraph was removed as unread; the screen is heading → banners →
**one-to-three cards** (icon top-left,
label + explainer bottom-left; the primary is a filled-primary card carrying the stable `welcome-cta`
hook, others quiet `welcome-action`s). Welcome is **the mode fork**: with a project shown it always pairs
**"Start building"** (isolated worktree) with **"Work in project folder"** (the Default workspace) so the
two working modes are a visible choice, not a hidden default. The cards by state: **no projects** →
**"Start a new project"** (primary, `welcome-cta`) + **"Open project"** — or "Open project" alone as the
primary against a host below `ONBOARDING_PROTOCOL_VERSION`; **project + `hasSpecs`** → **"Start building"** (primary) + "Work in
project folder"; **project + no specs** → a spec-first **"Set up project"** (primary) + "Start building"
+ "Work in project folder". **"Open project" appears only in the no-projects state** — where, with
"Start a new project", it's the only possible action; once a project is shown, opening another is the projects-rail **"+"** (the same
dropdown), so Welcome stays the *work-in-this-project* surface. That card hangs the shared
**`AddProjectMenu`** dropdown off it (same menu as the projects-rail "+": Start a new project… (when the
caller passes `onStartNew`, i.e. the host supports `project.create`) / Open project / Enter host
path… / Clone repository… (from `PROJECT_CLONE_PROTOCOL_VERSION`) / Recents). Recents is the store's `recentProjects`: one last-opened path list
containing open + closed records with no status badge (the server omits closed records
whose folders are gone); selecting either runs the shared open flow and lands at Project Home, with a
closed record retaining its id and workspace state. `Card` is a `forwardRef` usable as a Radix `asChild`
trigger. **"Work in project folder"**
(`House` icon, matching the rail's Default row) **direct-enters** the Default workspace — no dialog: the
shared `enterDefaultWorkspace` helper lists the project's workspaces, stores them, and activates the
`kind === "default"` row; an older host with no Default row degrades to an error toast. **"Start building"** is the
intent-first framing of the create-and-kick-off flow — it opens `NewWorkspaceDialog` preselected to the
**Isolated workspace** target; *workspace* is the mechanism, not the label. **"Set up
project"** opens the same dialog with an `initialPrompt` seed **and a `promptNote`** — the note is the
card's own copy (the dialog stays skill-agnostic), saying what the seeded command does: the agent drafts
the project's specs, starting from its goal, before building — deliberately **not** an enumeration of
artifacts, since the dispatcher's routes differ (starting-a-new-project stops at goal-and-requirements;
only importing-a-codebase drafts architecture + module SPECs) and the card can't know the route up
front. The seed is the
`/skill:setting-up-a-project` command **with a trailing space** — the same insertion format the
slash-command completion writes (`chat`'s `selectedSlashCommandValue`), so the seeded hero reads as a
*completed* command and the completion menu stays closed over it (pi's parser treats the arg tail as
optional). The command **forces** the setting-up-a-project dispatcher skill to load (pi's skill-command
syntax; expanded on the `session.prompt` path) rather than hoping the model auto-matches it; the dispatcher then detects
new-vs-existing and drafts the specs accordingly (see [[module-thinkrail-workflow]]). **Every Welcome entry point preselects the Isolated
workspace target** — setup included, so spec drafting is reviewable on its own branch like any other work
and the mode story stays uniform; the Project-folder alternative stays one click away in the dialog.
(Uniformity made an opener-chosen target dead API — the dialog owns its target state and always opens
on the worktree side; there is no `initialTarget` prop.) Which
project drives the has-specs states = `selectedProjectId ?? projects[0]`, read reactively (so the visible
nav's selection updates it). Its `hasSpecs` is **fetched lazily** via `project.hasSpecs` for that one
project (a full-tree walk, kept off the connect handshake) — pending until it resolves, so the cards wait
on it. The open-project orchestration lives in the shared **`useOpenProject`** hook
(above), so the Welcome "Open project" card gets the same non-git init/notice handling as the rail.
Above the cards, `WelcomePanel` composes **`ProviderWarningBanner`** — a slim gold banner shown **only when
no provider is connected** ("No model provider connected — the agent can't run") with a **Connect a provider**
CTA that opens the focused **`ConnectProviderDialog`** (below), not the full Settings takeover. Welcome passes
it `hasProvider` and does not render it while the wizard gate is still `pending`, so it never flashes ahead of
the wizard. **Provider status has one owner**: the store's `providerStatus` snapshot, stamped with the
`providerStatusVersion` it answers. The store bumps that version on every `provider.changed`, every welcome
(a login that finished while disconnected is picked up on reconnect), and every successful untargeted login
frame — another client's too, even while this client's own login keeps the dialog (hosts that predate a push
still refresh); a local sign-out or Retry bumps it too. `useProviderStatus`
re-reads whenever the snapshot is behind, single-flight per version, and `useHasProvider` (connected iff
`reportHasModelSource`: any standard provider `configured` **or** JetBrains Central connected, so Central
alone does not trip the warning) derives from it, so the banner, the wizard gate, the connect surfaces and
Settings never disagree. `useHasProvider` also invalidates once on mount, so returning to Welcome sees a
credential change the host never pushes (a `pi` CLI login or logout). The banner stays hidden until the first
answer lands, and a transport error degrades to *not* nagging (unknown or offline ≠ "no provider"). All
provider **management** lives in Settings, not here (the always-on strip is gone).

**First connection.** `ConnectProviderDialog` is an onboarding overlay over `ConnectProviderOptions` — the
same body the onboarding wizard embeds: one bordered surface holding a **Detected** block — only when account
detection found something (below) — above the search, then **one
searchable list** of every other unconfigured provider in a scroll area 240px tall, capped by the viewport
down to a 160px floor so a short window loses list height before the page scrolls (~40 providers never grow
the overlay, and filtering never resizes it): subscription (OAuth-capable) providers, then key-only ones, each row the Settings `ProviderRow` with the same
buttons as Settings: Sign in where the provider supports it and API key where it accepts one, so the copy's
"or add an API key" holds for every provider. JetBrains AI is not a pi provider but the `central` CLI that configures several, so it keeps the real
`JetBrainsAiCard` (its Central state machine is never duplicated) — placed like any other option: in **Detected**
whenever `central` is installed (Connect, sign-in, start-proxy or update, by state), otherwise a plain
**JetBrains AI** row at the end of the list whose **Set up** expands the card's install guidance. The unfiltered list skips detected providers; a search covers every provider,
them included. One list rather than separate subscription / API-key buckets, because users look for a provider
by name, not by auth method. **Detected is earned, never hardcoded.** The surface first asks the host `provider.detect`
(`detectAccounts`; an older host or a failure counts as nothing found) — the wizard on **Get started**, the
overlay on open — and keeps its skeleton until it answers, so nothing jumps. Every detected account whose pi
provider is unconfigured and OAuth-capable becomes a Detected sign-in (e.g. "Sign in with Claude" when
Claude Code is signed in, with the tool's plan as a badge) that starts that provider's ordinary OAuth flow,
and those providers leave the list. When nothing usable is found there is no Detected block at all —
naming a provider we know nothing about would be a guess dressed as advice. It is a suggestion, never a
silent sign-in: the host reports which tools are signed in, and the user still authorises ThinkRail through
pi's own flow. There is no link out to Settings — the surface already lists every connectable provider. No quota or other global
settings appear here; the full `ProvidersSettings` stays the power-user surface. Data and login wiring are
the shared **`useProviderAuth`** hook, which `ProvidersSettings` uses too: the store's provider status snapshot
(above), re-read once whenever one of them opens — Central's install state and similar host-local facts change
without a push — `startLogin` / `logout`, and the store-driven
`LoginDialog` node. For an `anthropic` login started as `oauth` (`LoginState.method`), the node carries the sign-in
`chat/ExtraUsageNotice` while the report's `warnings.anthropicExtraUsage` is not `false`
(`warnsExtraUsageOnSignIn`; an older host's report has no `warnings`, so the notice shows). Exactly one surface mounts that node: Settings → Providers while Settings is open, otherwise the
connect surface (`ownsLoginDialog`), so a login never renders two stacked dialogs. **Post-connect handoff:**
when a provider that was not configured when the surface opened becomes configured — an OAuth / API-key
login or a Central connect alike; the surface's first report is that baseline, even one whose re-read is still
in flight (waiting for a current one would absorb a sign-in that lands first), unless it passes
`configuredAtStart`, which the wizard does as empty (a cold start has no provider), so one connected through
Settings during the intro or privacy step is still verified on reaching Connect — `ConnectProviderOptions` reports it once through `onConnected`, and only from a current, successful snapshot (never while a re-read is
in flight or after a failed one, so a provider signed out a moment before Get started is not verified), and the host
surface decides: `ConnectProviderDialog` clears that provider's finished login (never a newer one), closes itself, and raises one success
toast naming the provider and the `model.list` count ("JetBrains AI connected — 23 models available"), then
lets Welcome switch its hero to the `ConnectedLine`; the wizard neither toasts nor closes — it verifies in place
(below). Settings keeps its own behavior (no auto-close),
because a power user there may be adding a second provider.

**Starting from nothing.** "Start a new project" opens **`CreateProjectDialog`** (driven by `useOpenProject`'s
`startNewProject`, so the rail "+" and Welcome share it): a project name, its derived folder name, and a
**Location** — the parent folder, default `~/thinkrail`, editable as a host path or picked with the native
directory picker — previewed as the final path, then `project.create` (folder + `git init` + initial commit
+ open; there is no "skip git" choice because a non-repo cannot be a project). A **Draft the
specs with the agent** switch (default **on**) makes the caller (`startProjectSetupChat`) enter the new
project's **Default workspace** and open a fresh chat whose composer is pre-filled — not sent — with
`/skill:setting-up-a-project`: a brand-new repo has nothing to isolate, so a second Create-workspace dialog would
only add clicks before anything exists. The continuation is fenced on navigation: it proceeds only while the
new project's home is still what the user is looking at (selected, no workspace active) and starts the chat only
while that Default workspace is still the active one, so wandering off during `workspace.list` drops it; a
failed list read toasts instead of rejecting. The "Set up project" card on an existing repo still goes through
`NewWorkspaceDialog`. A failure stays inline in the dialog.

**Cloning a repository.** `CloneProjectDialog`, opened by `useOpenProject` from either add-project menu,
accepts a Git URL, an editable URL-derived folder name, a host parent path (default `~`, editable or chosen
with Browse), and optional positive history depth (empty = full history). `project.cloneDestination`
provides the absolute path preview and rejects existing destinations; only a preview matching the current
fields enables submission, and clone validates again before writing. The dialog uses host Git credentials,
not GitHub login. During cloning fields are locked, status is announced, and Cancel requests
`project.cancelClone`; the original request settles only after process exit and cleanup. Cancel returns to
the editable form, with values retained. Errors stay inline; cleanup failures explicitly require manual
removal. Closing an idle dialog dismisses it, while Escape/backdrop cannot dismiss an active clone. Unmount
requests cancellation. A reconnect replays the pending operation. Success adopts Project Home through the
same last-intent fence as opening a local project, without starting a chat. A late result cannot steal a
newer open-project selection.

**Cold-start onboarding wizard.** `OnboardingWizard` replaces the Welcome cards only on a true cold start:
the host supports `ONBOARDING_PROTOCOL_VERSION`, `AppConfig.onboardingDismissed` is false, there are no
open or recent projects, and the provider status snapshot reports none. The decision is **latched in the store gate** (it survives remounts) so
connecting a provider mid-wizard does not tear it down. It opens on an **intro**
(the brand title, the landing page's tagline and its three "why" beats — worktrees, specs, pi as the
engine — as small cards, and **Get started**; the copy follows thinkrail.ai so first run and landing say the same thing) — a first-time user meets the
product before a wall of providers. Then, only while analytics consent is unconfirmed, a **privacy** step (below,
under `AnalyticsConsentDialog`); then **Connect** (`ConnectProviderOptions`); once a provider becomes
configured, the login dialog closes and a loading **verification** covers the options in place (same box, no resize) — no
tokens spent, a `model.list` plus `model.default` read. `model.list` serves a cached snapshot while it refreshes the
catalogs in the background, so an empty first read falls back to an awaited `model.refresh` (the same refresh, now
waited on) before deciding — a just-connected provider whose catalog is still warming verifies instead of warning.
A non-empty list (or an unreadable one: the connection
itself succeeded) moves the wizard to **done** with no Done button, as a screen change rather than a resize: the
whole connect screen (title, options, Skip) fades out in place over 200 ms, then the done screen fades in — the
"You're set" hero, one `ConnectedLine` ("Anthropic connected · Claude Fable 5 is the default model") and Welcome's
own two cards (Start a new project / Open project, passed in as `projectCards` so their menus and dialogs stay
Welcome's). Nothing animates height, so no list is clipped mid-collapse and the centered column only re-centers
while it is invisible; under reduced motion the swap is instant. Reaching done persists
`onboardingDismissed`; the wizard (and with it the hidden rail and held prompts) stays until a project opens. A still-empty
refresh warns and offers **Check again**
(re-runs both reads, e.g. after fixing the account elsewhere) and Back to the choices — Back alone could not
return, since the provider is configured and so no longer listed. Each step that replaces another moves
focus to its title (`tabIndex=-1`), so the keyboard never rests on a vanished button; Back focuses the
picked provider's option when it is still listed, else the options' first control. The wizard owns no project step of its own and shows no progress strip.
**Skip setup** is on every screen before done except privacy, whose Continue is the only way on; skipping also cancels any
target-less login still pending in the dialog (`cancelUnownedLogin`, shared with `ConnectProviderDialog`).
A login is owned by the start that requested it (`startReservedLogin`): when the surface closes before
`provider.loginStart` answers, the late `loginId` is cancelled and cleared instead of running hidden.
The gate lives in the store (`onboardingWizard`: pending → shown | hidden) so shell can hold first-run
prompts while it is undecided. Finishing or skipping writes `onboardingDismissed: true`, so a returning user — even one who later removes
every project and provider — gets the regular Welcome; a failed write still closes the wizard locally.

Beneath it, **`ProjectTrustNotice`** is the pre-workspace trust surface (so trust is reachable with no
workspace yet): **presence-gated** — renders nothing unless the selected project ships something a trust
grant would load. Presence comes from `chat/useProjectTrustSummary` (`project.trustSummary` on hosts at
`PROJECT_TRUST_PROTOCOL_VERSION`, gated by the store's `selectSupportsProjectTrust`: alias skill names and
the kinds of pi's own trust-requiring resources and project subagent definitions, and the count of
`.pi/mcp.json` entries; older hosts answer
`project.aliasSkills` only, read as "aliases only"), and the
pure `chat/projectTrust` derivation — shared with `chat/SkillsDialog`'s trust banner and New Workspace, so
the three surfaces cannot disagree about what a grant loads — `deriveProjectTrustNotice` evaluates the alias grant (`Project.trusted`) and pi-level trust
(`Project.piResourceTrust`) **separately**, so the notice names only what is still off: "ships N skills and
its own Pi resources → *Trust project*", plus — when pi-level resources are gated — exactly the kinds a
grant loads (the summary's `piResources`: skills, prompts, themes, system prompt, subagent definitions) and,
only when `extensions` or `settings` are among them, that those run code on this machine, and that its N MCP
servers still need approval one by one (a repository whose only gated content is `.pi/mcp.json` still shows the
notice and its grant asks for pi-level trust). *Trust project* sends
`project.setTrust` built by `trustGrantParams`: `resources: true` only when the notice names pi-level
resources (and so said what they load and run); an alias-only notice grants alias trust only. After trust
it shows a "N new → *Review & enable*" state for skills that appeared later (`project.acknowledgeSkills`),
else a quiet "trusted" line. *Stop trusting* (behind a destructive `ConfirmDialog`) shows in every state
where either grant is held (`canStopTrusting`), not only the fully trusted one — a project pi already
trusted when it was added, or one trusted only partly, keeps a revoke path — and sends
`project.setTrust({ trusted: false })`, revoking both grants; its confirmation (`stopTrustingText`) says pi
resources stop loading, running subagents stop and open chats reload only when `piResourceTrust` is
`granted` and the host supports project trust, otherwise that project skills stop loading in new chats. It never renders the skills'
(attacker-controlled) names before trust. The full manager (`chat/SkillsDialog` in **project mode**
— trust + group/skill toggles, no session yet) is reached from **New Workspace**, whose opener is the shared
`chat/SkillsButton` primitive (so it cannot drift from the chat header's Skills trigger). This is the
pre-session half of the user's skill settings; the chat header opens the same dialog in workspace mode
(with Reload).

**`NewWorkspaceDialog`** is the start-working surface: **a target control** (a two-option segment — a
native radio group, `fieldset` + sr-only `legend` over visually-hidden radio inputs, so assistive tech
hears one mutually-exclusive choice — both always visible: the two-mode model in one glance) chooses **where** the work runs, and the header is
**mode-aware** so it always names the operation truthfully: **Isolated workspace** → title **“Create
workspace”**, description **“A separate checkout on its own new branch. Files, chats, changes, and
terminals stay scoped to it.”**; **Project folder** → title **“Work in project folder”**, description
**“Runs directly in your project folder — no isolation. Changes land on the current branch.”** In folder
mode the base-branch picker and the naming hint are hidden (nothing is created — submit **enters** the
project's Default workspace via the shared **`enterDefaultWorkspace`** helper (`defaultWorkspace.ts`:
`workspace.list` → fold into the store → activate the `kind === "default"` row, one atomic entry — the
rail's auto-expand follows activation; error toast + `null` if an older host has none — the same helper
behind the Welcome fork card, so the enter + degrade path lives once; **`onCreated` does not fire** —
nothing was created and the helper's list is already fresh))
and the submit button reads **Start** instead of **Create**; the branch-list fetch + background base
prefetch still run (fire-and-forget, keeps a toggle back to worktree instant); the chat
kick-off tail is identical in both modes. An optional **`promptNote`** renders as a small info strip above
the prompt (used by "Set up project" to say what the seeded skill command does). The worktree mode's
base-branch trigger reads **“From
{base}”**, not an unexplained ref. An optional **`initialPrompt`** seeds the prompt hero (still editable;
empty by default); while the prompt is non-empty (worktree mode), a secondary hint says ThinkRail will name the workspace
and branch from the request. The rest stays compact: the base-branch combobox (`git.listBranches`,
degrading to local branches offline; a Refresh re-lists; `origin/HEAD` is filtered so no stray `origin`),
a project picker, the prompt hero, and the reused
  `chat/ModelEffortPicker` in **pre-session** mode. It opens **following the host default**: the pill reads
  `Default · ‹model› · ‹level›` from the host's `model.default` result (the saved default when available or
  the host's preferred available model) and the popover's Default row is checked. Any explicit pick (model, level, or
  both) flips the dialog to an **explicit pair**; the Default row — and the unavailable-model reconcile below
  — return it to following **synchronously**, so a Create pressed right after choosing Default already
  omits the pair; the `model.default` read that follows only refreshes the displayed pair. Every such
  read in flight is cancelled by an explicit pick, so a reply that lands after the user chose never
  overwrites the choice (it still refreshes what the Default row displays). Create sends `{model, thinkingLevel}` only for an explicit pair and **omits both
  while following**, so the host resolver decides at creation time and the display can never snapshot a
  default that Settings changed in between. When no model is available the host returns `model: null` and
  the pill shows a bare Default. The dialog does not choose a competing default: its display and
  newly-created session share the host resolver (see `submodule-server-agent`). Favorites/recents arrive
  through `chat/useModelPreferences`, the same seam the composer uses.
  The picker's popover portals into the dialog node (so its list scrolls under the Dialog scroll
  lock). Their catalog is the shared one — `chat/useModelCatalog`, so the dialog and the chat composer
  cannot drift — which means it is **live**: the picker's Refresh row can replace the list underneath a
  held selection. The dialog therefore reconciles the held model against it on every change via the pure
  **`reconcileModel`** (model only — effort is decided by the host's clamp, below): re-point to the same
  `{provider,id}` (the refreshed object, whose `thinkingLevels` may differ). What it does when the catalog
  has no such model turns on **`catalogFresh`** — the store's `modelsFresh`, true only for the installed
  result of an awaited forced refresh the host reported **`complete`** (a capped wait can answer with a
  current-but-unsettled list, which is no basis for a verdict), dropped by the next `model.list` install from any consumer (whose
  handler answers from before the detached refresh it starts) *and* dropped up front by any consumer
  activating. On a fresh catalog it returns **`"unavailable"`** — a verdict, not a replacement: the dialog
  then asks **`model.default`** (the host's saved default or first-available fallback, plus its consistent
  effort) exactly as it does for the preselect, through **one** `applyHostDefault` — so no client-side copy
  of the host's default policy exists here. Asked at most once per opening, so a still-missing model can't spin the effect. Effort is a separate concern: one effect keeps the held level
  runnable by the held model by asking the host for pi's clamp (**`model.clampThinking`**) rather than
  deciding locally, so an explicit switch and a refresh that shrank a model's set resolve the same way
  pi would. `model.default` needs no adjustment: the host already returns a self-consistent pair.
  On open and project-picker changes, the dialog reads **`skill.list({projectId})`**; whenever a leading
  slash token becomes active it also reads **`template.list({projectId})`**. It feeds both into the shared
  `prompt` module, so Create Workspace and live chat use the same filtering, menu, keyboard navigation,
  race-safe template pick, and Tab-through placeholder state machine. Skills come from the selected project's
  **current checkout** plus personal/bundled sources; templates merge global + current-checkout project scope
  with project precedence. Selecting a skill inserts `/skill:<name> `; selecting a template reads
  `template.get({projectId, name})`, replaces the complete draft with its body, and activates its placeholders.
  Up/Down navigate, Enter/Tab select, Escape dismisses the menu; outside an open menu Tab/Shift+Tab cycle active
  template slots and Escape ends that session. Submission mirrors edited repeated slots and removes untouched
  markers before the finalized text becomes the first prompt. While a selected template body is loading,
  submission is held but the prompt remains editable; editing cancels the delayed apply. Changing projects also
  invalidates an in-flight pick, so a response from the previous checkout cannot populate the next project's
  prompt. The first prompt is snapshotted before asynchronous workspace creation begins.
  Listing/get failures preserve the draft and degrade to whichever source remains available. Extension commands and `/compact` stay absent because no live
  session exists. A caption under the prompt marks the catalog as **from the current checkout** (the created
  worktree's session is authoritative if the selected base branch differs). When the selected project ships anything
  still **untrusted** (the same `useProjectTrustSummary` + `deriveProjectTrustNotice` pair as the Welcome
  notice — counts and kinds, never names), a **trust notice** shows a *Trust project* button — the repo's
  skills and pi resources stay withheld until granted (`project.setTrust` from the same `trustGrantParams`,
  so `resources: true` travels only when the notice named pi-level resources; it folds the updated project
  back into the store and re-previews); personal + bundled skills show regardless. When the menu is closed, **Enter submits** (matching the submit button's
  `↵` affordance) and
  **Shift+Enter** inserts a newline. **Worktree-mode submit on a v103+ host** = `workspace.startCreate({
  projectId, baseRef, kickoff })`, where the kickoff always travels — text, any attached images, and the held
  model + effort only when picked explicitly — so the host can start the chat even if this window closes. The
  dialog folds the returned creation (keeping the full prompt locally, see [[submodule-web-store]]), expands
  the project and refreshes its `workspace.list` (fire-and-forget), **selects the creation and closes at
  once**: the checkout runs in the background ([[submodule-server-workspaces]]) and the user may keep working
  anywhere. A rejected `startCreate` (an invalid ref, an unknown project) keeps the dialog open with a
  `store.toast.error`. Against an **older host** the dialog falls back to `workspace.create` → set active →
  `session.create({ workspaceId, model?, thinkingLevel? })` → fire-and-forget `prompt` with an optimistic user
  turn, as before. That legacy path shows only the dialog's own *Creating…* button state — the old sidebar
  pending-row counter was removed with the host-owned creations, a deliberate gap for the transition window
  in which a newer web meets an older host. The prompt hero accepts **any file** — the paperclip beside the model pill, paste and
  drop — through the shared `usePromptImages` controller (same classification, image decode/downscale and
  chip strip as the chat `Composer`, [[submodule-web-chat]]); with no worktree yet, Create first copies the
  file attachments into the host data dir (`uploadPromptFiles(null, …)`; a failure toasts and keeps the
  dialog, and files already copied keep their paths so the next Create skips them). That copy holds the
  controller as the composer's send does (`holdForUpload`: the "Copying files…" chip, additions, paste and
  drop refused), and Esc or the chip's × stops it, leaving the dialog as it was without a toast; the chips
  stay locked (`PromptImageChips` `locked`: × and Delete inert) until Create settles, so the start carries
  exactly the chips on screen. The file chips name
  ThinkRail's attachments folder rather than the workspace, and the kick-off text lists their absolute paths; submit is
  **held while any image is still decoding**, and a start with **only images and no text** is a valid
  kick-off. An **empty prompt with no images still lands the user in a chat** — the host starts it without a
  prompt (folder mode: the same tail after entering Default). A **rejected** kick-off prompt (a bad model /
  missing API key) surfaces as an `error` turn, after the user's message, in the chat the handoff opens; a
  failed chat start toasts instead. `retryDraft` (Edit & retry) reopens the dialog prefilled with the failed
  creation's prompt, images, model + effort and base branch.
  **`WorkspaceCreation.tsx`** renders a creation in the two places the user waits: `WorkspaceCreationRow`
  under its project in `ProjectTree` — inside the live list right after the Default row(s), newest first,
  i.e. exactly where its workspace lands, so the handoff never moves the row (spinner + `Creating… N%` + a `<progress>` bar while running; failed:
  `Couldn't create` in the error colour, interrupted: `Interrupted at N%` in the warning colour, the reason in a
  tooltip, with Retry, Edit & retry (failed only) and Dismiss/Discard; **a running creation has no
  actions** — there is no cancel), and `WorkspaceCreationView`, the shell's main pane for the selected creation
  (phase title, `x of y files · from <base>`, the held prompt, git's reason and the same actions; it says the
  partial folder and branch were removed only when the host reports `cleanedUp`). `ProjectTree` hides a
  workspace row while a creation with its id still exists, so the row becomes the workspace only once the
  host has handed it off. `useCreationChatHandoff` (mounted by the shell) opens the chat the host started
  through `openChatInTab` and appends the rejected-kickoff error. The two rejections with **no chat to host
  a turn** raise a `store.toast.error`: a failed create (the creation row stays) and a failed chat start (the
  workspace exists — the toast is the only place left
  to report the dropped kick-off). (`gh` status lives in `SettingsDialog`, not the
  create dialog.) **`SettingsDialog`** is the app-settings surface the shell's topbar gear opens — a
  **store-driven two-pane frame**: a nav column (title, search field, section tabs) beside one scrollable
  content pane. It stands near full height (the window less a `--space-24` margin) but grows no wider than
  the 220px nav plus the content column (`max-w-760`), since a wider page only stretches rows (user,
  2026-11-17). At `md`+ the tabs are a rail grouped **Agent** (Models, Providers, Subagents — the global
  settings, this workspace's override and the available agent roles —, Extensions & skills, MCP servers, Prompt templates, Environment) ·
  **Interface** (Appearance, Text & fonts — fonts, custom fonts and both line widths —, Chat, Layout,
  Keyboard, Language, Voice input, Terminal) · **System** (Workspaces, Integrations, Notifications, Privacy,
  Updates). Integrations keeps section id `github`: today it is the GitHub CLI page
  and it is the home for further integrations. Below `md` the same list is a horizontal scrolling strip without group labels. The
  Feedback tab (`settings-nav-feedback`, “Share feedback”) belongs to that list at
  every width, pinned to the rail's bottom at `md`+. There is no Artifacts section (its one switch, Smart
  view, moved to Layout and was later removed for the Artifacts view dropdown). The pure nav data — groups, protocol and
  injected-content gating, and resolving a requested section to an available one (a retired id opens where
  its settings moved — the store's `RETIRED_SETTINGS_SECTIONS`: `artifacts` → Layout, `line-width` → Text &
  fonts, `review` → Models; a gated one falls back to Appearance) — lives in `panels/settingsNav.ts`,
  so the dialog only renders it. `settingsOpen`/`settingsSection` live in the store so the gear AND the
  Welcome banner can open it deep-linked to a section; without a section `openSettings()` reopens the one
  last shown (kept in memory, so a page load starts on Providers).
  **Nav keys.** The tabs are one `role=tablist` (`SettingsTabs`, key scope `settings.nav`) with a single
  roving tab stop; they keep `settings-nav-<id>` and `data-active`. Opening focuses the current tab. ↑/↓
  (j/k) and Home/End **open** the section at once; → (l), Enter and Space enter its content on the row
  focused there last — a per-section map the dialog keeps for the page's life, keyed by the resolved
  section, so a retired id shares its successor's entry — else on its first; ← on a row comes back
  to the tab. Besides the arrow twins, only S and `/` act in the nav (they start a search), so F stays
  hint mode's. Each section mounts in its own keyed scroller, so it opens scrolled to the top. Inside the
  content the kit's tree of rows takes over ([[submodule-web-settingskit]], *The model*, *The walk*): focus
  rests on whole rows, ↑/↓ never change a value, Enter or Space enters a row's control (or presses its
  button), → walks the row's buttons, Esc comes back to the row.
  **Search over individual settings.** The field above the tabs searches `panels/settingsCatalog.ts`, one
  declarative entry per setting (id, section, label and description keys, keywords, and protocol / `when`
  gates over `useSettingsCatalogContext`: the protocol, an active workspace, the host platform, and the
  states without which a row does not render at all — a signed-in provider, voice files on disk, a launched
  survey), kept to the sections the nav shows (`availableSettings`), plus the `searchEntries` shell
  injects (one per shortcut, [[submodule-web-shell]]) and the dialog's own entries for each installed
  extension and the settings it declares (`installedExtensionSearchEntries`, from the store's catalog). `settingsSearch.ts` ranks them with contracts' tiered matcher over label, description, section name and
  keywords. While a query is active its results replace the content pane: a listbox whose options name
  their section and highlight the matched ranges (`components/highlightRanges`); ↓ enters it from the field,
  ↑/↓ (j/k) and Home/End walk it, ↑ on the first returns to the field, ← goes to the tabs, Enter, Space or →
  jumps (Enter in the field jumps to the first), and Esc clears the query back in the field. **The catalog is the
  one source of a setting's id and words:** rows take their label, description and `data-setting-id` from
  it (`settingProps`), the palette lists the same entries ([[submodule-web-shell]]), and e2e's drift check
  jumps to every entry ([[module-browser-e2e]]). Indexing the rendered DOM was rejected: only one section is mounted, and the palette
  needs the index while Settings is closed.
  **Jump.** A result opens its section and jumps there ([[submodule-web-settingskit]], *Jump and flash*):
  the row's disclosure or tree group opens itself, the row takes focus and flashes, and when nothing took
  focus the section's tab does. A section change, a new query or a newer jump abandons a jump. After a jump
  the query stays: Esc in that section's content returns to the results on the same hit. From outside,
  `openSettings(section, settingId)` leaves a target the dialog consumes once (`consumeSettingsTarget`, on
  open or while open) and jumps to the same way — the palette's setting rows and Voice's "Change…" use it.
  **Esc and closing.** One Esc is one step back: the focused element's own step first (a dirty draft
  reverts, a filter clears, a recording cancels), then from a control or a button back to its row (a
  pending choice cancels and returns in one step), then the results after a jump, then the section's tab,
  then close; in the search, Esc clears the query, then goes to the tab. The kit's
  `holdSettingsEscape` keeps Radix from dismissing meanwhile (*Esc and Radix* there); on a tab, the Close
  button or the dialog itself Esc closes, and Radix returns focus to the opener. `Mod+,` toggles Settings
  and `close-item` (Mod+W) closes it at once from anywhere inside, a dirty field committing as on blur
  ([[submodule-web-shell]], *Native shortcuts*).
  **Building blocks.** Every section — shell's Layout and Keyboard and `updates`' Updates included — is
  made of `settingsKit` blocks ([[submodule-web-settingskit]]): page, groups with a scope tag, rows with
  Changed/Reset, choices, sliders, number fields, disclosures, lists, the draft, and the markup the walk and
  the jump read. What knows which settings exist stays here: the catalog (above); `settingDefaults.ts`, every
  Reset against contracts' `DEFAULT_CONFIG` or the store's `CLIENT_PREFERENCE_DEFAULTS` (the four model
  fields clear with `null`), as `useConfigReset` / `useClientPreferenceReset` / `useLayoutLimitReset`; `saveSettings`, the one `settings.update` call that toasts its failure;
  `SettingsFolder`, a data folder's row (`SettingsFolderRow`: the path as visible text, Copy path and Open
  folder as its buttons after any link in its description; `useFolderActions` binds a `*.reveal` method)
  and its per-file issue notices, shared by Language, Custom themes and Custom fonts. A control that needs the full width under
  its label (the theme lists, the interface language, the Windows shell) uses the kit's `SettingsRow
  layout="stacked"` (`"card"` for System mode's two theme lists). Every section keeps these rules:
  - **Shape:** a `SettingsPage` titled with its nav name over a one-line description, then groups of rows;
    a group whose settings are not global carries its scope tag (This workspace, This project, All
    projects, This computer).
  - **Reset:** every setting with a default shows Changed and Reset while it differs, and Delete on its row
    resets it. **Skills from other agents** has no Reset: hosts send `true` for a config that predates the
    key while `DEFAULT_CONFIG` says `false`, so a Reset would switch it off for users who never chose.
  - **Cheap and expensive choices,** both entered with Enter (walking past a choice never applies it): a
    cheap choice applies on each arrow inside it (theme mode, the theme lists,
    contrast, message order, composer size, scrollback, Markdown outline position, the context-window and
    cache-warming presets, a workspace's subagents); an expensive or disruptive one only moves a pending
    option marked "Press Enter to apply" and applies on Enter or Space (the UI and voice languages, which
    download; the Windows shell; the settle period). Enter, or Esc keeping a cheap value, returns to the row.
    A click applies at once either way.
  - **Deletions confirm through `ConfirmDialog`** (MCP servers, custom servers, templates, layout presets,
    packages, installed extensions, voice files), from the row's Delete key and its button alike — never a `ConfirmPopover`,
    never unasked; focus recovery then lands on the neighbouring row, else on the list's
    `data-focus-fallback` (the empty state's add button).
  - **Nothing is said only on hover:** what a `title=` tooltip or a "?" icon carried is visible text (the
    Providers "Managed" lock, Environment's launch override, MCP names and reasons, endpoint addresses,
    the Layout limit and default help, Notifications' How to enable).
  - **No control disables itself under focus,** which would drop focus to the dialog: writes queue instead
    (themes, model context; the latest wins), busy pickers read `aria-disabled` and ignore presses (the
    Models pickers, `FontPicker`), and starting a voice download moves focus to its Cancel. A failed load
    offers Retry.
  - **Every tab stop has an explicit `tabIndex`,** and hint mode can label and press every control; nothing
    in Settings binds F.
  - **Every focusable thing is a row or a row's part,** reachable with the arrows and Enter: a failed
    load's Retry, a notice's action ("Add starter templates", Allow in browser), an empty state's actions
    (each MCP preset is its own row), a group description's link (`descriptionRowId`: Language's
    `en.json`) and Keyboard's Search by keys (the filter row's button). New custom markup uses
    `SettingsLine`, `SettingsNotice rowId` or `useSettingsRowStop`; the kit's and e2e's drift checks catch
    the rest.

  Popovers inside the dialog render into the dialog element (`SettingsDialogContainer`), because Radix's
  scroll lock cancels wheel and touch scrolling anywhere outside it (the Models pickers missed this, so
  their lists ignored the wheel: #607). The dialog clips overflow, so these popovers also take it as their
  collision boundary and cap their height at Radix's available height; the model popover caps its width
  too (`fitContainer`; without that cap, arrow keys scrolled a narrow dialog sideways). A modal
  `DropdownMenu` holds its own scroll lock and may stay on `body`.
  Free-text and number settings and the font weight slider save through the kit's draft (`useSettingsDraft`):
  no Save/Apply button, Enter or blur saves (Enter also returns to the row), Esc reverts only a dirty draft. Environment alone keeps an
  explicit Save (below). **`McpSettings`** is the **MCP servers** section (hidden below
  `MCP_PROTOCOL_VERSION`), a `SettingsPage`: one info `SettingsNotice` (`mcp-confirm-banner`: the host
  notice — servers run on the host and inherit its environment — and, in a workspace, the in-chat confirm
  sentence, `mcp-confirm-text`), the `handledElsewhere` warning notice, one error notice per unreadable
  `mcp.json`, the save status line and, once any server exists, an **Add MCP servers** row (catalog
  `mcp-add`, button `mcp-add`); then two groups, **User servers** (scope tag *All projects*,
  `mcp-user-servers`, list `mcp:user`) and **Project servers** (scope tag *This project*,
  `mcp-project-servers`, list `mcp:project`; the untrusted line, or "No servers in this repository's
  .pi/mcp.json…" when it lists none). In a workspace it reads `mcp.list` through
  `transport`'s `watchMcpWorkspace` — on mount, every welcome, a project-trust change, and with bounded
  backoff while a live chat still reports a server `starting`, because the host pushes no connected edge.
  Rows come from the store's `deriveMcpServerRows`. Its row `effective` flag gates name-only Sign in,
  Sign out and Test connection actions, in both the status actions and overflow menu: the host's optional
  `summary.effective` is authoritative even when a valid user server carries an invalid folded repository
  override diagnostic. Only that admitted definition takes live session status. For older hosts, status
  retains the scope/approval heuristic, but name-only actions are allowed only for a unique valid user or
  approved project definition, never ambiguous same-name rows. Review, Edit and Remove remain
  scope-specific. While the project is untrusted, project-scope rows are
  dropped client-side at once, so a revoke never leaves the cached repository rows actionable until the
  refresh lands (the host omits them anyway, and the Project servers group says so); the revoke also closes an open Edit,
  Review & approve or project-scope Remove dialog, drops an Edit / Review read that was still in flight,
  and an open Add dialog falls back to User scope — including a review step it had reached for Project
  scope (the host refuses repository writes for an untrusted project regardless). In a workspace a user-server
  enable/exposure change sends only the changed field (`mcp.setProjectOverride` merges), and Remove (at
  either scope) and Edit carry the rendered `summary.fingerprint` (`mcpRenderedTarget`, built from the row
  the dialog opened with, never a re-read), so a stale row refuses instead of rewriting or deleting
  changed content — a repository entry a checkout changed, or a user entry another client or editor
  replaced while the Remove dialog was open; both refresh the list on failure, so the user sees the
  current entry and can retry from it. Each row is a `SettingsList` row (`McpServerRowView`,
  `data-focus-row` = `<scope>:<name>`). Its primary button (`mcp-server-details`, Enter) opens **Details**
  and holds the name, the HTTP/stdio and effective-exposure chips and the status dot + label + one reason
  line, all wrapping — no truncation and no hover-only title (stdio's "runs on host" is screen-reader text;
  the page notice says it visibly). Its buttons (→) are the secondary and primary status actions and the ⋯
  menu; Enter on the row opens Details, Space toggles the enable switch, Shift+F10 opens the menu, and Delete asks
  to **Remove** through `ConfirmDialog` (`mcp-remove-confirm`), after which focus recovery lands on the
  neighbouring row, else on the empty state's `mcp-empty-add` (fallback `mcp:user`) or the Add
  button (fallback `mcp:project`). The exposure choice (`deferred | direct | hidden`; configured codemode
  reads "treated as deferred (codemode not available yet)") is a submenu of the ⋯ menu, which also always
  offers Details and Show log. A row has at most one primary and one secondary action — the status table `mcpRowView`
  encodes: Sign in (needs sign-in) · Review & approve (pending approval, or a pending repo override)
  · Edit (an invalid repo entry) · **Reconnect** (failed, with **Show log** beside it; disconnected) ·
  **Reload now** (pending reload) · **Open a chat** (not running, with Test connection beside it for HTTP)
  — and an overflow menu (Exposure, Sign in / Sign out for OAuth servers, Test connection
  for HTTP, Show log, Edit or Review & approve, Share with repo when a user server has a project setting, Details,
  Remove behind a confirm). Reconnect and Reload now act per chat: they run, one chat after another,
  for the live chats that report the row's state (`McpServerRow.sessions.reporting`) — `mcp.reconnect`, and
  `session.reloadResources` through the skills baseline (so the chat's skills badge clears too). Failures
  stay on the row as the host's text (pi's reconnect failure masked by the host; a busy chat's "Can't
  reload while the chat is busy", which stays pending and reloads by itself once idle), one line per chat
  named by its tab title when several were targeted, shown only while the row keeps that state — never a
  toast. Open a chat closes Settings and starts a chat in the workspace through `openChat`'s
  `startChatInTab`, the same path as the workbench's New chat. Show log opens `McpLogDialog`: pi's last
  report for the server (`detail`, with a stdio server's stderr tail) and its lines from pi's `mcp.log`
  (`mcp.readLog`, masked by the host). Details lists no tools: apart from always-allowed ones, no payload
  carries tool names yet (pi's `/mcp` text and `SessionResources` report a count). Attention
  rows sort first and disabled rows stay listed last; `handledElsewhere` makes the section read-only with a
  notice (`mcpHandledElsewhereText`): "MCP is handled by <path> in this workspace; ThinkRail's MCP
  management is read-only." for a replacing extension, and for the host's `by: "pi settings
  (-builtin:mcp)"` "MCP is turned off in pi settings (-builtin:mcp); remove that entry to manage servers
  here." A problem with a whole `mcp.json` (`McpListResult.configErrors`: unparsable
  JSON, `mcpServers` not an object, a mistyped key) renders as one error notice per file
  (`McpConfigFileErrors`) naming its path, pi's message and "Edit the file directly to fix it", above the
  list or the empty state alike — so a file pi cannot read never passes for "no servers". Status details
  (pi's report) arrive already redacted by the host.
  **Enablement and exposure follow one routing rule (`mcpSettingWrite`):** inside a workspace a user-level
  server changes for this project only, through `mcp.setProjectOverride` (the host merges fields
  atomically, so only the changed field travels), and a toggle there never writes the global `mcp.json`;
  with no workspace open (a host at `MCP_USER_SERVERS_PROTOCOL_VERSION`, `supportsUserMcp`) the switch and
  exposure write the user entry's own `enabled` / `exposure` in `~/.pi/agent/mcp.json` through
  `mcp.setUserServer` (`mcpUserServerWrite`), carrying the row's `summary.fingerprint` as
  `expectedFingerprint` — the change applies to every project without its own override and to the pi CLI
  (user, 2026-11-17), and a stale fingerprint is refused and re-read like an update; a repo-defined server is
  rewritten in `.pi/mcp.json` with `mcp.update`, whose whole-entry replacement starts from the entry as
  written, read through `fs.readFile`. Every `mcp.update` (toggle, exposure, Edit) is built by
  `mcpEntryUpdate` and carries the fingerprint the row was rendered with as `expectedFingerprint`
  (`summary.fingerprint`, the same identity Remove sends at either scope), so the host refuses a write
  rebuilt from an entry that changed on disk since; the host carries approval forward
  only from an entry approved as it is on disk. A refused update or share shows the host's error on the row
  (or in the Edit dialog) and re-reads `mcp.list`. Pending-approval, invalid and replaced rows lock both
  controls, so a toggle can never approve a repo entry by the back door. Reading the raw entry is for
  updates and fingerprints only: no dialog shows a plain env, header or OAuth client-secret value from it
  (`<literal value hidden>` stands in; `${VAR}` / `!command` references are shown, since they are what
  runs). **Review & approve** lists what will run — the host-masked command line or URL
  (`summary.endpoint`, credential-looking arguments read `***`), working directory, every `!command`, and
  the env/header names with their references or the hidden marker — then approves with the summary's
  fingerprint (the host refuses a file that changed since). A refused approval also refreshes `mcp.list`;
  the open review retains its original fingerprint and never retries changed content automatically.
  Closing and reopening review reads the refreshed summary and re-reads the entry before a new confirmation.
  **Edit** is for repo entries: the raw entry as
  JSON with plain values hidden; a marker left in place keeps the file's value under that name
  (`mcpEditedEntry`), and a new value must be a reference. A user-level server's Edit is a disabled menu
  item naming its source file (`McpServerSummary.source`): `mcp.update` replaces the whole entry and the
  host returns no raw user entry, so Settings could only rebuild it lossily — users edit
  `~/.pi/agent/mcp.json` directly, and the switch and exposure keep writing this project's record
  override (with no workspace, the user entry itself). **Add** has three tiers: presets from
  `mcpPresets.ts` — five, verified and pinned (no `@latest`): Context7 and DeepWiki (`direct`, authless),
  Linear through its vendor read-only endpoint (`/mcp/readonly`) and Sentry (both OAuth — sign in after
  adding), and Playwright (`npx -y @playwright/mcp@<pinned>`), which is added as a disabled user entry plus
  this project's record override (`optInPerProject`), so it runs only where the user opted in and never
  touches the repository; `modifiesData` (Sentry, Playwright) adds the "this server can modify data in
  <service>" acknowledgement, and a preset whose name is already configured reads **Added**. GitHub stays a
  recipe, not a preset (`gh auth token` scopes are unverified): below the presets, *Use recipe* fills the
  Paste JSON tier with `GITHUB_MCP_RECIPE_JSON` — GitHub's read-only endpoint (`/mcp/readonly`) and an
  `Authorization` header from `!t=$(gh auth token) && echo "Bearer $t"`, which fails rather than sending an
  empty token while gh is logged out (the `managing-mcp-servers` skill carries the same entry); a short form (pi's name charset, per-file
  duplicates and `-`/`_` twins, a stdio command with one argument per line or an http(s) URL, env/header
  rows, exposure, description, and a scope where Project needs a trusted project); and pasted `mcpServers`
  JSON (wrapper or bare map, previewed per server; valid entries are added, SSE and malformed ones are
  flagged). **Settings stores references only** (`mcpSecretIssues`: secret values from the form are never
  stored): every env/header value of the form must be a `${VAR}` / `$VAR` template or a `!command`
  (pi's grammar, `isConfigReference`: `$$` / `$!` escape the next character, a complete malformed
  `${...}` is consumed as a literal without rescanning dollars inside it, and later references still count)
  — anything else, empty included, is a validation error with the
  rewrite hint, and a row added and left wholly blank is reported as an unnamed row rather than dropped — and its URL may carry no user info or credential-named query value (pi sends URLs as
  written, so the advice is a header); a pasted entry with a plain env, header or OAuth client-secret value
  or such a URL is flagged with the same hints and not added. There is no plain-text confirm. Any save
  that runs something first shows a review step listing every command and `!` value; when a `!command` is
  among them, it and Review & approve add one line: "!commands run on the host each time a chat connects;
  keep them fast (e.g. read a cached token)." (pi resolves them synchronously on every connect). `mcp.add` runs per
  server; add failures stay in the dialog and a paste keeps only the failed adds. A successful add is
  committed independently of the preset's subsequent project opt-in: only successful adds call
  `onEnableInProject`, whose `Promise<void>` contract leaves enable-failure presentation with Settings.
  Add waits for that callback to settle (even on rejection), never converts a committed add to an add
  failure, and never retries that add. If the opt-in cannot be confirmed, Add closes (unless other adds
  failed) and Settings' existing `user:<name>` row error says
  "Added, couldn't confirm enabling for this project; use its switch to retry." It does not assert that
  the server is disabled after an ambiguous response. Retrying the row switch sends only
  `mcp.setProjectOverride`; no new flow or state owner is introduced. After each mutation a status line
  says where the change applies:
  "when a chat starts in this workspace" with no chat open, else "to open chats as they reload; a busy chat
  waits until it is idle" — the host answers before it reloads them, so the returned snapshots cannot say
  which already did; the rows' live statuses do. Sign in / Test connection start
  `mcp.login` / `mcp.testConnection` and reuse `auth/LoginDialog` as Providers does: the login state keeps
  the push's `target`, so only an MCP login started from this workspace — or, on the no-workspace page,
  from none — opens this section's dialog (`mcpLoginFor`; Providers ignores it, and so does the section
  shown for another workspace), and the sign-in page opens only from the dialog's button. The page notice
  reads "ThinkRail asks in the chat before MCP calls that may change data.
  Always allow trusts a tool in every chat of this project; those tools are listed on their server
  below." A row whose summary carries `alwaysAllowed` shows an **Always allowed in this project:** line
  of tool chips (the host's `label`) — the scope is spelled out because the row's group describes the
  server, not the grant; each chip's × ("Ask again before <tool> in this
  project") sends `mcp.revokeToolGrant` through `requestMcpList` and is
  disabled while the row is read-only or busy. This is the only place grants are revoked. An empty **User
  servers** group offers presets, the form and JSON import (the host notice is the page's).
  **Without a workspace**, a host at `MCP_USER_SERVERS_PROTOCOL_VERSION` gets the same page through the
  props-driven `McpServersPanel`, fed by `panels/useUserMcpList`: transport's `requestUserMcpList`
  (`mcp.list` on mount, on every welcome and connection generation and after Retry; each mutation's
  returned list replaces the hook's state and a failed one re-reads), never installed in `mcpByWorkspace`.
  There are no live statuses, so rows show configuration only (`mcpUserRowView`: **On** — "Starts in the
  chats of every project that doesn't turn it off." — or pi's "Turned off." for a disabled entry, with
  Sign in for an OAuth server, Test connection for HTTP and Show log; never Open a chat, Reconnect or Reload
  now). Only **User servers** shows, followed by the muted line "Project servers appear when a workspace is
  open."; Add offers User scope only (a line replaces the dialog's scope picker, and a preset's per-project
  opt-in is skipped, so the Playwright preset stays off until switched on); Remove (`mcp.remove { scope:
  "user", expectedFingerprint }`), Sign in/out, Test connection and Show log work as in a workspace (the
  probes and `mcp.readLog` without `workspaceId`; the sign-in dialog shows a login whose target names no
  workspace); Share with repo, Review & approve and per-chat actions are absent; the save line reads "Saved
  — applies to every project that doesn't override it, and to the pi CLI." An older host keeps "Open a
  workspace to manage its MCP servers" (`McpNoWorkspace`). **`ProvidersSettings`** (the in-app
  provider-auth surface) is a `SettingsPage` ("Providers", the intro line with the in-page **Refresh**,
  `providers-refresh`, as a walk row) over these groups in order: **Signed in** — a `SettingsList`
  (`providers:signed-in`) of every configured provider; a row with `canLogout` offers **Sign out** as its
  primary (`provider-signout`, Enter), and a row the host can't unset shows a visible note in place of the
  old hover-only "Managed" lock — "Connected through JetBrains AI" for `kind: "central"`, "Configured
  outside the app (environment / models.json)" otherwise — and is not a walk row; **JetBrains AI**
  (`JetBrainsAiSettings`, below; always shown once the status loads, whatever Central's state);
  **Subscriptions** (unconfigured `canOAuth` providers); **Custom servers** (below); and **Available (N)**
  (the `canApiKey`-only rest, folded behind one "Providers with an API key" row that names five of them and
  offers **Show all N**, `providers-show-more`, which moves focus to the first listed row), the two
  provider lists' rows wrapping the shared `ProviderRow` — its additive `actions` prop puts the list's
  primary/button markup on Sign in / API key, so `ConnectProviderOptions` keeps the plain row; then the "N
  more configured outside the app" note. A failed status read with nothing loaded shows the error with a
  **Retry** (`providers-retry`). Every unconfigured provider is one row offering **Sign in** when `canOAuth` and **API key** when
  `canApiKey` — **both routes start `provider.loginStart`**
  (`type` `"oauth"` / `"api_key"`, issue #97) into the same store-driven `auth/LoginDialog` (open the
  URL / paste a code / answer the provider's own key prompts, `provider.loginReply` — no inline key
  field); a provider with neither flag is named only in the closing note; **`CustomEndpointsSettings`**
  (v101, hidden below `CUSTOM_ENDPOINTS_PROTOCOL_VERSION`; re-read on `providerVersion`) — the **Custom
  servers** group: a `SettingsList` (`custom-servers`) whose row primary is the server itself (name, then
  the address and model count as visible wrapping text; Enter or a click edits, `custom-endpoints-edit`)
  with **Remove** as its button (`custom-endpoints-remove`); Delete on a row asks through `ConfirmDialog`
  (`custom-endpoints-remove-confirm`) like Remove does. **Add server** follows the list; with no server the
  group shows an empty state ("No custom servers yet." and the dialog's one-line description) whose Add
  server is the list's `data-focus-fallback`, so removing the last server lands there. A failed list shows
  **Retry**. The page's **Refresh** reloads the list together with
  `provider.status`. Providers the group lists are filtered out of the
  generic provider rows so each appears once (only listed ids: an unlisted `custom-*` provider, or any on
  a host without the group, stays a generic row); hand-written `models.json` providers stay in Signed in
  with the outside-the-app note, not repeated here. The dialog is one form for a company gateway and a local server: name,
  address with local preset chips (Ollama, LM Studio, vLLM, llama.cpp — they only fill the address and an
  empty or preset name; there is no server-kind choice), a password key field (blank keeps a saved key on
  edit; an edit that changes the address's origin shows a warning and disables Save, since a different
  server is added as a new one; **Remove key** sends `apiKey: ""` and keeps Detect from reusing it), **Find models**
  (`customEndpoints.probe`, only on click — never on open, since gateways can list thousands), a manual
  model-id field above the list, a filter field and 50-row paging once the list exceeds a page, and a per-model use switch. **A model row's only editable parameter is its context
  window** (decision: the other facts describe the server rather than configure it, but a gateway's
  listing rarely reports the window whoever runs the server set, and pi's 128K default then sizes
  compaction and budgets for the wrong model). The row shows only the facts the server reported
  (context, thinking, images, tools; "No tools" in warning tone), and an unreported fact is simply absent
  and left to pi's default. From `CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION` (v116) it also carries a
  compact **context window** field (`custom-endpoints-context`) that is not part of the draft: it reads
  and writes the model's `modelOverrides` value through the same `useModelContextSettings` hook as
  `ModelContextSettings` (`model.contextSettings` / a targeted `model.setContextWindow`), so a re-Detect
  or Save never touches it. Empty means the detected window (placeholder "Detected", or "Unknown" when
  the server reported none); a whole number in the contracts' custom range saves on Enter or blur through
  the kit's draft, an emptied field or the reset icon returns to the detected window,
  and Escape reverts a dirty draft without closing the dialog (the dialog's `onEscapeKeyDown` holds the
  press only while the focused field differs from its saved value, `data-draft-dirty`); a clean field lets
  Escape close it. The field is disabled while the dialog is
  busy, for an unused row, and for a model pi doesn't serve yet (an unsaved server or newly found model —
  its title asks to save the server first). A failed context read or write is not an unsaved model: every
  field locks with the load-failure title, and the list is headed by the same `ModelContextLoadFailed`
  line and Retry that `ModelContextControls` shows. Re-detecting keeps selections and saved facts the
  server doesn't report, takes reported ones, keeps models the server no longer lists, and keeps
  existing rows first with newly found ones appended; an unchanged saved address stays as written.
  Re-detecting drops a saved max output only when a context was saved and the server now reports a
  different one: that value may be derived from the old context, and the draft can't tell a derived
  value from a hand-set one. The pure draft rules live in `customEndpointDraft`; probe failures render
  as localized inline status and host save errors render inline; and
  the **`JetBrainsAiCard`** — route Central-supported models through the user's JetBrains subscription while
  keeping ThinkRail's embedded PI — a state machine over the typed `JbcentralStatus` +
  `provider.jbcentral*`: absent (official host-OS install guidance + Recheck), outdated — below the host's
  minimum supported Central (guided Update), invalid/unverifiable version (safe guidance, no native action;
  a version *above* the minimum is simply ready, never gated), **signed out** — the card
  **states it and offers only Sign in**: the primary action *replaces* Connect rather than sitting beside it,
  and on `supported` the signed-out line replaces the "Central is ready" claim instead of annotating it. The
  rule is that the card never advertises an action that cannot succeed — connecting without credentials
  fails — so the prerequisite becomes the offer, and Connect returns once the host reports credentials.
  **Signed out renders as one state, whatever the configuration underneath:** the body says only that Central
  is signed out — never paired with a "Connected" line that would contradict it — and **Sign in is the only
  action**, Disconnect withheld along with Connect. Once authenticated, a configured status whose proxy is
  positively observed stopped likewise replaces the success claim with “Central's proxy is not running” and
  offers only **Start proxy**; after it starts, Connected + Disconnect return. The prerequisite order is
  therefore Sign in → Start proxy → ordinary connected controls, never competing actions. Unknown proxy
  health does not manufacture a demand. A broken session asks for the one thing that resolves its current
  prerequisite rather than pairing a fix with an unrelated choice or success message.
  **Signing in is one button, never a menu:** ThinkRail launches Central's flow on the host, and the
  `central login` command appears *only* where that launch failed — printing it beside a working button makes
  the user choose between two routes to the same place. Because the flow opens on the **host's** browser, the
  launched confirmation says so and names Refresh as the next step, since Connect is not on screen yet. The
  *reactive* guidance survives for the case the probe cannot see: credentials present, action refused
  anyway —, sign-in required (launch Central sign-in +
  Retry), ready (Connect), configuring (a Central action or watched candidate rebuild is in flight),
  connected (the current runtime for new work applied Central; Disconnect), load-failed (the last runtime or
  boot-time plain fallback remains usable; Retry or Disconnect), and generic action error (Retry/Recheck).
  There is no restart prompt, affected-chat list, blocked state, or recovery mode. Existing live chats may
  retain an older runtime—including Central after Disconnect—and the card says its state applies to new chats.
  Update/connect/disconnect state is host-authoritative and shared across clients; every mutation re-reads
  `provider.status`, while `provider.changed` invalidations from watched external changes trigger the same
  re-read plus model-list invalidation. Status reads are request-sequenced so an older response cannot replace
  a newer watched/action result. Copy never promises only Claude/GPT, never asks for standalone PI,
  never renders child output/diagnostics/artifact content/paths/proxy data/secrets/raw models, and maps only
  closed reason codes to ThinkRail-authored text. In Settings the same state machine
  (`useJetBrainsCentral`, shared with the connect surfaces' unchanged `JetBrainsAiCard`) renders as
  **`JetBrainsAiSettings`**, one **JetBrains AI** group: the Central status line with its action (Start
  proxy / Update / Connect / Disconnect / Sign in / Retry; Recheck joins them when Central is absent) as
  one walk row (`jetbrains-central`, the card itself; every action and inline copy button is its button,
  in screen order), then, from `JBCENTRAL_QUOTA_PROTOCOL_VERSION` and in every Central lifecycle state,
  **Show quota in top bar** (switch, `jbcentral-quota-toggle`, default on) and **Quota refresh interval**
  (`SettingsNumberField`, whole `1–3600` seconds, default 30, disabled but kept while the quota is hidden,
  `jbcentral-quota-interval`), each with Changed/Reset to `DEFAULT_CONFIG`. Both wait for
  `settings.changed` rather than installing optimistic authority, and save failures toast through
  `saveSettings`. The connect surfaces' card shows no quota settings. **`GithubSettings`** (the Integrations section's **Local GitHub** group, one
  **GitHub CLI** row — `github.authStatus()` as its visible description, `settings-gh-status[data-connected]`:
  Connected + login, or Not connected naming `gh auth login`; its control, Refresh (`github.refresh`), is
  offered in both states and stays enabled while busy (`aria-busy`, clicks ignored), as Providers' Refresh
  does, because disabling the focused button dropped focus and the next Esc closed Settings. Only an answered
  probe is a status, and only the latest request's: reopening the section shows the last answer while it
  re-probes, and a failed request never reads as signed out — it keeps the answer, or with none shows a
  could-not-check notice. Before any answer the block is a skeleton; `data-connected` exists only once
  gh has answered);
  **`LanguageSettings`** (gated by `LOCALES_PROTOCOL_VERSION`; a store-integrating container over the
  props-driven `LanguagePage`, whose derivations come from [[submodule-web-i18n]]): the **Interface
  language** is an **expensive** list choice — arrows only move a pending pick, Enter or Space applies it,
  Esc or leaving the list cancels, a click applies at once — so browsing never downloads a translation.
  **System** comes first (default; names the language System resolves to), then every available language
  by its own-language name with a source hint (*Built-in*, *Local file*, *Built-in, customized by local
  file*), then disabled entries for a selected-but-missing file (*File not found*; English renders, the
  choice is kept) and for each broken file (its translated error plus the untranslated parser detail). The
  row resets to System. Selecting writes `settings.update { locale }` and converges on the broadcast. *Add a
  language* gives the steps (with a link to `packages/locales/en.json` at `v<appVersion>` for released
  versions, `main` otherwise) as its description, the **Language files folder** row (Copy path / Open
  folder, `locales.reveal`, offered in every client like workspace reveal — a remote browser uses the path)
  and a **How to contribute** link to CONTRIBUTING's Translations section;
  **`AppearanceSettings`** holds only themes. **Theme mode** is a cheap segmented choice, **System / Light
  / Dark**, System only from `THEME_SYSTEM_PROTOCOL_VERSION` (older hosts keep fixed-only behavior). Light
  or Dark shows **one always-open list of that mode's themes** (`theme-list-light|dark`, options
  `theme-option-<id>`); System shows **the Light theme and Dark theme lists side by side** as two cards, like
  the line widths, under a `Current on this device` row (`system-theme-current`) reading `<device icon>
  <Light|Dark> → <palette icon> <resolved label>` — the icons carry which half is the device appearance and
  which is the theme, since both halves are often the same word; mode and pair follow the user while each
  device reads its own system setting. Mode stays separate from the lists: making System another theme row
  would nest configuration inside an option. The lists are cheap: ↑/↓ apply a theme at once; past a list's
  first or last theme the press is left to the walk, so it continues to the next setting — in System from
  the Light list into the Dark list — and entering a list lands on its current theme without changing it.
  **Contrast level** (Default / High) is cheap too. Light/Dark write a fixed theme: from System they adopt
  the pair's half for that appearance — what the list showed — never a stale retained fixed theme; in fixed
  mode they move to the current family's counterpart. Contrast swaps to the same family's other-contrast
  theme (in System both halves at once), so the family survives either switch; an option with no target
  in the catalog is disabled rather than mapped to an unrelated theme. First enable of System sends mode +
  the derived same-contrast pair atomically; list edits replace the complete pair; returning to fixed
  changes only mode, preserving both choices. **Resets:** Theme mode is Changed while the mode differs
  from Dark and resets the `DEFAULT_CONFIG` pair (`fixed`/`dark`); each list is Changed while its
  theme differs from the default pair's half and resets that half; Contrast resets to Default. A list whose
  configured id is unavailable selects nothing, so picking the fallback writes it; the warning notice under
  the mode names the effective same-appearance fallback, and nothing is written back silently. While a mode
  hides a list, its catalog id (`light-theme` / `dark-theme`) sits on the Theme mode row, so a search jump
  lands one arrow away from it. **Writes:** one `settings.update` is in flight at a time; a press during it
  is queued (the latest wins) and computed from the store when it is sent, so rapid arrows never write a
  stale sibling half, and no control is disabled under focus. Every write **converges on the
  `settings.changed` broadcast** with no optimistic apply; rejection toasts. The panel never owns a theme
  list, media-query logic, pair derivation or fallback — all come from `themes`; it derives only the
  family/contrast counterpart the controls move to. A **Custom themes** group
  (`CustomThemesSettings.tsx`, props-driven like `LanguagePage`, hidden below
  `USER_THEMES_PROTOCOL_VERSION`) gives the copy-a-bundled-file steps (version-pinned `dark.theme.json` link)
  as the description of the **Theme files folder** row (`theme-folder`; Copy path / Open folder,
  `themes.reveal`) and one warning notice per unusable file (`themes`' issue list). The page reads the
  catalog and issues through `onThemesChange`, so a dropped file appears in the lists without reopening.
  **`TextFontsSettings`** (**Text & fonts**) composes, from `FONTS_PROTOCOL_VERSION`
  ([[submodule-web-fonts]] applies what they save), an **Interface** group (`InterfaceFontsGroup`: the
  Interface font picker; **Text weight**, a cheap `SettingsSlider` −70…+130 in steps of 10 that shifts code
  weights too, previewed through the fonts runtime while it moves and saved once on release — when a chosen
  named family does not change between the range's ends on this device, a static face with only regular
  and bold, an info notice under it says so and points at variable fonts, and one that changes only one way
  says it moves in steps; Interface fallback fonts), a **Code** group (`CodeFontsGroup`: the Code font
  picker, monospaced only; **Code size**, a 10–24 `SettingsNumberField`; **Ligatures**; Code fallback fonts;
  then an inert preview on the chat canvas — a chat message in the chat prose system, buttons, an editor
  sample in `.tr-code-editor` and a terminal sample in `.tr-code-block`), the **Line width** group (below;
  any protocol) and **Custom fonts**. Every row with a default carries the kit's Changed/Reset: a font
  resets its family (fallbacks kept), a fallback row clears its chips. Fallback chips are added through
  the same picker, never typed (a free-text CSS stack proved unclear in review); in their row the chip
  removes and **Add** are its buttons, left to right, and Enter on the row with no chips opens Add. Fonts and both line widths have this page of their own (user,
  2026-11-17), which overturned the earlier choice of one page with the theme. The props-driven picker
  (`FontPicker.tsx`) groups Built-in / Custom / Installed, draws each name
  in its own face through `FamilyName` (typography's one token exception: picker rows, the trigger label,
  fallback chips and the Custom fonts family list), badges Default / Mono / Not on this device, asks the
  host for `fonts.installed` on every open — keeping the last list while it re-reads, and through a failed
  re-read, and dropping a stale answer; a skeleton and a warning with Retry show only until a first list
  arrives — and offers a
  typed name that matches nothing as **Use “X”**; merging, shadowing and the monospace/renders filters are
  the pure `fontCatalog.ts`. A named family that does not render on this device puts a warning icon on the
  trigger and a notice under the row while the choice is kept. Choices go through `settings.update` and
  converge on `settings.changed`; one role's choice saves at a time, and while it does its trigger,
  fallback **Add** and chip removes read `aria-disabled` and ignore presses. **Custom fonts**
  (`CustomFontsSettings.tsx`): the drop zone is the `custom-fonts` row — "No custom fonts yet." with the
  accepted types while the folder is empty — whose button is **Choose files…** (each file a `PUT
  /fonts/<name>` through `transport`'s `uploadUserFont`; outcomes land in one polite live region, and
  overlapping drops add to the same list; it only sets `aria-busy` while uploading), then the families as a
  list with Mono / In use badges, the **Fonts folder** row (`fonts-folder`, Copy path / Open folder,
  `fonts.reveal`) with the rule that fonts are removed in the folder, and one warning per unusable file.
  Whether an OS file drop reaches the page in WKWebView, WebKitGTK and WebView2 is unconfirmed; **Choose
  files…** is the path that never depends on it. **Line width** (`LineWidthSettings.tsx`, in Text & fonts):
  **Chat** and **Files & diffs** side by side (stacked when the group is narrow), each a card
  (`<kind>-line-width-control`, a labelled region) with a 40–240 **Line width** `SettingsNumberField`
  (`<kind>-line-width-input`) and an independent host-synchronized **Fit to pane** switch
  (`<kind>-line-width-bounded`). Each of the four rows has **its own Reset**, so the chat and code widths
  reset independently; defaults are 80 (chat) / 120 (file), Fit to pane on. `LineWidthCard` is
  props-driven, `LineWidthControl({kind})` binds it to the store. A changed authoritative width from
  `settings.changed` replaces a stale draft; mutations converge only on that broadcast and rejected calls
  toast without changing geometry. **`ChatSettings`** (props-driven `ChatPage` + a store container): one
  **Messages** group — **Message order**, a cheap segmented choice over `store.chatMessageOrder` (Oldest
  first, the compatibility default / Newest first), **Composer size**, a cheap segmented choice over the
  composer-growth limit (Compact / Roomy / Half chat), and **Question panel height**
  (`QuestionPanelHeightControl`, a 40–100 `SettingsNumberField` over `questionPanelHeight`, hidden below
  `QUESTION_PANEL_PROTOCOL_VERSION`); each resets to its default. It exposes no scroll-follow controls: streaming follow is
  fixed (see `apps/web/src/chat/SPEC.md`). Message order applies immediately and persists only in this
  client through the chat preference seam: browsers use current-host-qualified keys, while a native shell
  may inject its stable backend-profile/window adapter. Another browser, native window, or host is unaffected. Composer growth
  remains a top-level `AppConfig` field and converges on `settings.changed`, with a toast on rejection.
  Explanatory copy says “message box” rather than the internal “composer” name for where the user types.
  **`SubagentsSettings`** (the **Subagents** section in Agent, listed from
  `SUBAGENT_SETTINGS_PROTOCOL_VERSION`, so an independently shipped client never offers unsupported
  mutations against an older host) composes the props-driven `SubagentSettings`: the global settings and
  this workspace's override on one page (user, 2026-11-17). A **Global** group holds **Allow subagents**
  (switch, Reset to on) and, from `SUBAGENT_CONCURRENCY_PROTOCOL_VERSION`, **Per chat at once**
  (`SettingsNumberField`, 1–16, Reset to 4), both reset from `DEFAULT_CONFIG` through `useConfigReset`. With
  an active workspace a **Workspace override** group follows, with the *This workspace* scope tag and the
  workspace named in its description: **Subagents in this workspace** is a cheap `SettingsChoice` (Use
  global / On / Off — while it follows global, the row's description states the global value) writing
  `workspace.setSubagentsOverride` (`on` / `off` / `null`), and **Subagents per chat in this workspace** is
  a `SettingsNumberField` with `value={null}` while it inherits (placeholder = the global limit; clearing a
  set value commits through `onClear`, which sends `null`). Each override row is Changed while set, and its
  Reset (or Delete) sends `null`, so later global changes keep flowing through. The workspace limit is
  disabled while that workspace's subagents are effectively off; the global limit stays editable when
  global is off, because workspaces forced on still inherit it. Without a workspace the Global group ends
  with the muted line "Workspace overrides appear when a workspace is open." Limits follow the kit's draft
  (an invalid draft shows its range and is never sent, no clamping), validated against
  `SUBAGENT_MAX_CONCURRENT`. Global mutations converge through `settings.changed`, workspace ones through
  `workspace.updated`; none is optimistic.
  From `SUBAGENT_CATALOG_PROTOCOL_VERSION` the page ends with **Available agents** (`AvailableAgents.tsx`,
  `SubagentSettings`' gated `roster`; scope *All projects*, catalog id `subagent-roles`, Refresh as the
  group action): one row per definition `subagent.list` returns for the active repository workspace — name,
  translated source, description, pinned raw model reference or parent/invocation inheritance, explicit
  thinking effort — and a global per-name switch (Changed while off; Reset re-enables). Disabled
  definitions stay listed and new names default enabled; no prompt, path or editor is exposed. Copy states
  global scope, new-launch-only enforcement (ongoing work continues), trusted-project scope and manual
  Refresh after file edits. `useSubagentCatalog` reads `subagent.list` on mount, Refresh, workspace/trust
  change and each welcome; a context-keyed lifetime shows loading at once and discards superseded
  responses. Loading, empty and retryable failure are explicit. A role switch sends one
  `subagent.setEnabled({ name, enabled })` request, like the page's other switches: it renders only the
  authoritative `settings.changed` state and toasts a rejection.
  The **shell-owned injected Layout section** (`shell/LayoutSettings`) has three groups. **Presets** is
  one `SettingsList` (`layout-presets`) of Balanced/Focus/Review and the named custom presets. A row's
  primary applies it on Enter or a click, through one "Apply this layout?" confirm (`layout-apply-confirm`),
  and only with an active workspace; otherwise the group says "Open a workspace to apply a layout to its
  window." The row whose preset matches the live frame carries a visible **Current** tag and can't be
  applied again — derived by comparing geometry, since no current layout is published. → reaches the buttons
  **Set default** (every preset but the stored default), **Rename** (inline; Enter saves, Esc cancels) and
  **Delete…** (custom only); Delete on a custom row, or Delete…, asks through `ConfirmDialog`
  (`layout-delete-confirm`). The effective default carries **Default** (**Fallback** when the stored default
  no longer exists) and, below it as visible text, what Reset to default does and that the default is
  remembered per window. **Add new layout** opens a popover (name + Save preset) that captures the live
  frame, and states its limit as text ("Up to 32 custom layouts; N used."). **Reset to default**
  (`layout-reset-default`) goes through the same confirm. **Advanced** (a `SettingsDisclosure`) holds the
  independent side and bottom group limits (1–32, each with Reset). Custom capture/rename/delete update the
  host-synchronized catalog and converge through `settings.changed`; the default and the limits are
  window-local. **Documents** (This computer) holds the **Markdown outline position** (Left / Right, a
  cheap choice, `markdown-outline-side-control`, moved from Appearance), applied at once with no host round
  trip, with Reset to its client default. The **Smart view** switch that the retired Artifacts section
  passed to Layout is gone: the Artifacts view dropdown remembers the choice and offers every view. With an active workspace, Apply and Reset ask shell to replace this
  window's frame and atomically preserve/reflow open
  resource identities in every retained workspace view; the optional **shell-owned injected Update section**
  (its page is [[submodule-web-updates]]'s; the Settings shell includes its row only when content is
  provided; `panels` neither discovers native nor host update capabilities. If a later welcome removes injected content while Updates is selected, Appearance
  is rendered and highlighted rather than leaving no active row);
  **`WorkspacesSettings`** (the **Workspaces** section, listed only at
  `protocolVersion >= WORKSPACE_SETTLE_PROTOCOL_VERSION`) — one row, **Settle idle workspaces after**, an
  **expensive** choice of 1 / 3 / 7 (default) / 14 days / Never (a stray arrow must not settle workspaces),
  written as `settings.update { settleIdleDays }` (`null` for Never) and converging through
  `settings.changed`, with Reset to 7; a valid host-configured non-preset value selects no option rather
  than falsely displaying the default. The row describes the applied option, and the pending option while it
  waits for Enter (`SettingsChoice onPendingChange`). The default is a week, not
  a long weekend: merged/closed PRs already settle at once, so the idle rule only catches dormant work and
  errs toward keeping a paused workspace live (a Thursday's work on the shelf by Monday reads as loss, not
  tidying). The page description names the three things
  that count as activity and the three things that never settle, because the setting is only legible
  together with those rules;
  **`VoiceSettings`** (from `SPEECH_PROTOCOL_VERSION`, in the Interface group after Language) shows the
  store's `speech` status ([[submodule-web-speech]]). An unsupported platform gets a warning notice and
  nothing else; the switch row renders even when the host could not read the voice state. Otherwise its
  rows say what the user can do, never how voice is built: no engine,
  version, backend or PATH text, which an earlier version showed and users found unreadable (the
  speech SPECs carry those details).
  - **Voice input:** a switch for `AppConfig.voiceInputEnabled` (`settings.update`), with Reset. While it
    is off, only this row and Delete voice files remain, plus Status while a download is still running, so
    its progress and Cancel never disappear. While it is off the Language and Shortcut catalog ids sit on wrappers around this row,
    so a search jump to them lands on the switch.
  - **Status:** not set up (with the download size), downloading with a percentage, ready, or the
    failure in error colour. Its action is Download, Try again, or Cancel download.
  - **Language:** All languages / English only, an **expensive** choice: selecting the other one sends
    `speech.install {model}`, which downloads that model and deletes the current one, so arrows only move a
    pending pick and Enter applies (a click applies at once). Disabled while installing; starting a
    download moves focus to Cancel download, since the focused option becomes disabled.
  - **Shortcut:** the current chord as visible text and **Change…**, which opens Settings › Keyboard at
    `shortcut:dictation` (`openSettings("keyboard", "shortcut:dictation")`; Keyboard reveals the row).
  - **Delete voice files:** shown only while ThinkRail's speech files use disk. **Delete…** asks through
    `ConfirmDialog` (it states the space it frees), then sends `speech.remove`, which never touches a
    `nemo-speech` on PATH; focus returns to the Delete button on cancel and to the Voice input switch
    after deleting.
  The mic itself is not here: the page-level dictation layer ([[submodule-web-speech]]) shows it on
  whichever text field has focus;
  **`TerminalSettings`** — **Scrollback**, a cheap segmented choice (`store.terminalReplayKb`, five presets
  from Off to 1 MB; a valid non-preset host value selects none rather than a wrong preset;
  `settings.update { terminalReplayKb }`, applies to terminals opened from now on) and, on
  Windows hosts at `protocolVersion >= WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION`, a **Windows shell** group
  (This computer) whose **Shell for new terminal tabs** is an **expensive** list (Auto / PowerShell 7
  (pwsh) / Windows PowerShell / Command Prompt, `settings.update { terminalWindowsShell }` — see
  `submodule-server-terminal`'s shell-selection decision for what each choice spawns): arrows move a
  pending pick, Enter applies, a click applies at once; open tabs keep their shell. Both reset to their
  defaults. The protocol gate keeps a newer independently shipped client from presenting
  a setting an older host preserves but does not act on. The Windows-shell
  half is split into a **props-driven** `WindowsShellSettings` component rather than reading the store
  inline like the replay picker: zustand's React binding feeds `renderToStaticMarkup` its frozen
  `getInitialState()` snapshot (`useSyncExternalStore`'s `getServerSnapshot` argument), never a test's
  `setState`, so any settings section that must stay assertable under that render path takes its store
  values as props instead — the same shape `SubagentsSettings` uses for `SubagentSettings` and
  `TemplatesSettings` for `TemplatesPage`; and
  **`TemplatesSettings`** — a `SettingsPage` (props-driven body `TemplatesPage`) with two groups, **Project
  templates** (scope tag *This project*, stored in `.pi/prompts/`) then **Global templates** (scope tag
  *All projects*). Each group's header action is its own **New template** (`template-new-project` /
  `template-new-global`, also its list's `data-focus-fallback`) over a `SettingsList` (`templates:project` /
  `templates:global`) whose rows (`data-testid="template-row"`) have the name and description, wrapping, as
  the primary (`template-edit`: Enter opens the editor), then **Open as file** (project rows only) and
  **Delete** as its buttons. Delete — the key or the button — asks through `ConfirmDialog`
  (`template-confirm-delete`) and then calls `template.delete`, and focus recovery lands on the
  neighbouring row, else the group's New. There are no per-row scope chips. Without an active workspace
  only Global templates shows, followed by the muted line "Project templates appear when a workspace is
  open." The lists come from **two independent `template.list` calls** run together and re-run whenever
  the store's `templatesVersion` bumps (a failure of either shows the read error with **Retry**, each with
  its own failure flag so one's success can never clobber the other's still-real failure): unscoped (`{}`)
  for **Global**, and `{ workspaceId }` filtered to `scope === "project"` for the project group. The
  unscoped call matters specifically because the server's
  `template.list { workspaceId }` response is **shadow-merged** (`templates.ts`'s `listTemplates`: a
  project template wins over a same-named global one) — right for the composer's `/` menu, but if Settings
  used that same workspace-scoped call for its Global group too, a shadowed global template would vanish
  from view entirely with no way to find, edit, or delete it. **Open as file** opens
  `.pi/prompts/<name>.md` through the exact same `openTabs.ts`
  `openFileInTab` the file tree uses — at the **`keep`** intent, since a deliberate "open in editor" must
  not land in a preview slot a later click would silently replace — then closes Settings; a global
  template has no worktree to open a file tab against, so global rows stay dialog-only. **New**/**Edit**
  open the shared
  `chat/TemplateEditorDialog` (see `chat/SPEC.md`'s Save-as-template bullet — it lives in `chat/` because
  `HistoryOverlay`'s save-as-template action needs the identical form, and `chat/` can't import
  `panels/`). **R4 — starter-templates
  offer:** when the **Global** group's fetch has
  resolved with zero rows and no error, its empty state is a notice with an **Add starter templates**
  button (`data-testid="template-starters"`) — clicking it `template.save`s five verbatim
  starter templates (scope `"global"`, body assembled client-side via
  the shared `prompt` module's `assembleTemplate`, the same helper `TemplateEditorDialog` uses) sequentially,
  then bumps `templatesVersion` once, the same invalidation the row list already refetches on — the
  offer disappears on its own next render once the list is non-empty, no dismiss state to track. The five
  (review/explain/tests/commit/rename) are **the same set this repo checks into its own `.pi/prompts/`**:
  those ship at *project* scope, so only a ThinkRail checkout ever sees them, and "the templates ThinkRail
  ships" must mean one thing rather than two — change one, change the other. The composer's `/` menu
  carries the discoverability half (`chat/SPEC.md`: a `slash-templates-empty` footer nudge deep-linking
  here when no template exists anywhere), since this offer is otherwise two clicks deep in a dialog. The
  project group's empty state is a plain, icon-less notice naming the project's `.pi/prompts/` — the offer is
  Global-only, since it only ever seeds global files. No server change. **`NotificationsSettings`** is the single master on/off control
  for out-of-app attention notifications (default on, with Reset; its description names the delivering
  channel, browser or operating system), persisting `{ notificationsEnabled }` through
  `settings.update`. While enabled it also surfaces the live browser permission via the
  [[submodule-web-notifications]] barrel: an **Allow in browser** notice while permission is still
  `default` (the click is the user gesture that calls the channel's `requestPermission`; switching the
  master on from `default` asks too), a warning on `denied` with the **How to enable** steps as visible
  text, a warning without steps when the browser has no Notification API, and nothing once granted or on the OS
  channel — the visible, in-app acquisition path that does not depend on an
  out-of-focus event. The notification pipeline, suppression, and away-path permission preface live in
  [[submodule-web-notifications]].
  **`PrivacySettings`** manages the additional-data preference and
  confirmation together: one **Usage analytics** group with the **Share additional usage data** switch
  (Reset to `DEFAULT_CONFIG`'s off) over the report details as visible text; the event contract belongs to
  [[submodule-server-analytics]].
  **`AnalyticsConsentDialog`** mounts once through shell after a capable host's unconfirmed config hydrates,
  held back (with the survey invitation) while the cold-start onboarding wizard may still show or is
  showing (`selectOnboardingActive`): a new user meets the product before a privacy question, and sharing
  stays off until the dialog mounts, so holding it never collects without asking. The wizard itself asks at
  its natural seam — **Get started** leads to its own **privacy** step (same `AnalyticsConsentChoice` body,
  priming and saving through `useAnalyticsConsent`; **Continue** confirms and advances only once that save
  lands, so a failed write keeps the step with its draft and error instead of moving on with sharing still
  primed on) before the model list, and only
  while consent is unconfirmed — so neither the intro nor the first project opens on a privacy prompt;
  skipping on the intro hands the question back to the shell's dialog. The cost is that the intro carries
  only basic events.
  It initializes the draft switch on and immediately persists `{ analyticsEnabled: true }`; persistence and
  broadcast activate the host gate while the dialog stays open. **Done**, Close, Escape, and backdrop persist
  the current draft with `analyticsConsentConfirmed: true`, so the ordinary result is on. Switching off
  immediately persists off/confirmed and the resulting config broadcast closes the dialog. Confirmed on/off
  configurations never mount or prime. Failed persistence leaves the draft and error visible for retry.
  Until the user flips the switch on this surface, a decision confirmed elsewhere meanwhile (Settings →
  Privacy, another window) is adopted, not overwritten: the switch shows the saved value and Continue / Done
  advances without a write — only a choice made here is persisted. Saved
  decisions survive restarts and change later through Settings. The dialog keeps only the short
  product-usage copy and shared switch; Settings adds the optional outcomes, report dimensions, and
  excluded content. Older hosts retain their legacy privacy control without the new consent dialog.
  **`FeedbackSettings`** is the always-present Feedback pane: **Take the survey** (only while a survey is
  launched and unfinished) opens the survey window, beside the Discord link and `info@thinkrail.ai`. Settings
  never draws the questions itself and never calls `feedback.respond`.
  **`SurveyInvitationDialog`** is the automatic invitation: **Never show again** records `never`, **Not
  now** and closing record `postpone`, and **Take the survey** opens the window and records `postpone`, so
  leaving the survey unsent re-invites later. Each action closes the dialog at once; a failed response is a
  toast, never a trapped modal.
  **`SurveyWindow`** is the one survey UI. Its first page carries the data notice (what is sent, linked
  to a random installation ID, no secrets/code/personal data, deletion via `info@thinkrail.ai`; no links)
  above the first question; `SurveyForm` then draws one question per step (rating points are real radio
  inputs; selecting Other focuses its text field) with **Continue**, and **Send** on the last. Nothing is sent before Send, closing never calls the
  host, and the analytics setting plays no part. `SURVEY_CHANGED` reloads the survey and restarts it with a
  short notice; other refusals stay inline; success shows PostHog's thank-you header or the app's. The form
  is keyed by survey id, iteration and `language`, so a reload in another language restarts it rather than
  mixing languages, and Send echoes `survey.language`. A pre-v98 host gets the older submission shape (Other text
  inline, no `language`) through `surveyDraft`'s `inlineOthers`; while no host is welcomed (disconnected) Send is
  disabled, so no request is queued and replayed in a shape chosen without knowing the host.
  **`ModelsSettings`** is the **Models** section (from protocol v72), a `SettingsPage` with five groups:
  **Default model**, **Review** (`models-review-group` — everything that configures review in one place,
  because users look for it by that word; there is no separate Review section), the GPT context window,
  **Prompt cache** and **Visible models**.

  **Chat model** (`default-model-row`) and **Review model** (`review-model-row`) are the chat's own
  **`chat/ModelEffortPicker`** — model and effort in one control, the same picker as the chat (user,
  2026-11-17) — with `canSetDefault={false}`, `tabIndex={0}` and `fitContainer` (the popover stays inside
  the dialog's clipped root). The chat row re-reads `model.default` on open, whenever the live catalog or
  the saved pair changes, and after every save; the host's resolved pair (with the first-available fallback
  and the Pi-clamped level) is what it shows, so a vanished or changed model never offers stale levels. A
  pick shows at once (an optimistic pair until the save's re-read lands; saves run one after another),
  writes `defaultModel` / `defaultEffort` through `settings.update`, and keeps the popover open for the
  effort; a failed save toasts and the re-read restores the host's pair; a failed read shows Retry. The
  pair is Changed while either field is saved; Reset (or Delete) clears both with `null`, back to the first
  available model. The review picker carries the **Default** row (`defaultOption`: the resolved chat pair,
  active while `reviewModel` and `reviewEffort` are both unset), so a chosen reviewer model can be restored
  to the host's new-chat default (`{ reviewModel: null, reviewEffort: null }`, the null-clears wire form,
  see `submodule-server-settings`), and shows the effective reviewer model and level (`reviewEffort ?? the
  default level`); its Reset clears both. The Review group's switches, each with Reset: **Agent-triggered
  review** (`agent-review-toggle`, `agent-review-row`, over `store.agentReviewEnabled`) — off withholds the
  worker's in-session `request_review` tool so review happens only via the Review button (the host
  live-toggles the tool's active set on it, see `submodule-server-host-plan-review`); the row is hidden
  below `AGENT_REVIEW_SETTING_PROTOCOL_VERSION` (v68), where a host could store the field while still
  registering the tool — and **Automatic fix cycle** (`review-autofix-toggle`, `review-autofix-row`, over
  `store.reviewAutoFix`) — off means a `request_changes` verdict records findings and waits (the host
  gates its auto-fix cycle on it, see `submodule-server-todos`).

  At v76, **`ModelContextSettings`** adds the **GPT context window** group (the pi CLI / restart note as its
  description): **All GPT models**, one cheap Default / 1M / Custom choice over the rows the contracts'
  `isSharedModelContextTarget` admits (summary, "Customized by model" when their overrides differ and the
  count of external rows it leaves alone as its description; omitted when it would govern none;
  Changed/Reset while any is overridden; one `model.setContextWindow` call), then a `Tree leaveAtEdges` of
  every row grouped by provider, so the same model on different providers stays independently editable.
  Rows of a server the **Custom servers** group lists are left to that server's dialog: `ModelsSettings`
  passes the same `useCustomEndpoints` state, and the block stays on its loading line until that list
  answers, so rows never flash in and out (a failed list, or a host without the group, hides none); any
  other `custom-*` provider — say a hand-written `openai-responses` one the dialog can't represent — keeps
  its row, bounded by `modelContextWindowLimits` (the GPT range on a host older than
  `CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION`, which still enforces it), and never joins the shared choice.
  Provider rows show the model count and "N of M customized" / "All Default" and expand like the file tree;
  a model row (`context-limit-<provider>-<id>`) holds its own cheap choice, keyed on the explicit
  `override` (Default = `null`, the catalog value pi reports), entered with Enter like every control — ←/→
  on the row are the tree's (← to the provider, → to the row's Reset), so walking never changes a window;
  inside the choice → past Custom moves into the Custom field (`…-input`; empty is neutral, a whole number in the row's range saves on Enter or blur, an outside value stays
  visible but never re-applies; the copy labels the range an app policy, not a verified provider limit)
  and Reset (`model.setContextWindow { contextWindow: null }`). ↑/↓/Home/End pressed on a control inside a
  tree row move to the neighbouring row, as on the row itself. Choices are never disabled while a write is
  in flight — writes queue one after another, and the authoritative reply redraws. Each control
  (`useContextLimit`) sends a pick unless both the saved value and the latest value it requested already
  match it (its Custom field's save and Reset are requests too), so a pick made before an earlier save
  answers is never dropped; a UI-local Custom pick survives the replies to writes it requested before the
  pick, and any other change of the authoritative override drops it and its draft. Pi's shared configuration is authoritative — there is
  no AppConfig field; reads follow catalog/provider invalidation and fence stale replies, and a failed read
  or write shows Retry. The props-driven `ModelContextControls` owns presentation and
  `useModelContextSettings` the reads and writes, shared with the custom server dialog; older hosts get
  neither the group nor its requests.

  At v111, **`CacheWarmingSettings`** adds **Prompt cache**: **Keep the prompt cache warm**, a cheap
  segmented choice (Off / While a run is active / Also between runs) over pi's `cacheWarming` setting
  (`cacheWarming.get` / `.set`; pi's `settings.json` is the only state, there is no AppConfig field). The
  description follows the chosen mode, with the **ThinkRail default** hint while pi's file names no mode
  (ThinkRail's default differs from pi's `idle`; `data-cache-warming-source` on `cache-warming`); a pick
  shows at once and a failed write toasts and re-reads. Changed/Reset against contracts'
  `DEFAULT_CACHE_WARMING_MODE`. The props-driven `CacheWarmingControls` owns presentation; older hosts get
  neither the group nor its requests.

  **`VisibleModelsSettings`** is a `Tree leaveAtEdges` grouped by provider (every list of models is, user
  2026-11-17) inside the section's own scroll (no nested scroller): a provider row shows its connection
  detail, "N of M shown" and a tri-state toggle (`aria-pressed` true / mixed / false) that shows every model
  unless all are shown, then hides them all; model rows are indented, each with its own switch
  (`model-visibility-<provider>-<id>`). Space toggles the focused row, Enter expands a provider or toggles a
  model, Delete shows a hidden model again (all of a provider's on its row), and the arrows, twins,
  Home/End and S follow the app's trees. Hidden models leave every model picker (pinned, recent, provider
  groups, search) through `store`'s `selectPickerModels`, which always keeps the caller's current selection
  even when hidden, and new models are shown by default. Hiding is a **client-local** preference, not host
  config: `chat/modelVisibility`'s `initModelVisibilityPersistence` (called once from `main.tsx`)
  hydrates `store.hiddenModels` and writes changes back — through the native shell's stable
  `clientPreferences` adapter under key `hidden-models` when one is injected, else browser localStorage
  `${STORAGE_PREFIX}hidden-models:<httpBase>`, whose `storage` events sync other tabs. The full catalog
  remains available here for configuration.
  **`ExtensionsSettings`** (the **Extensions & skills** section in Agent, next to MCP servers and Prompt
  templates; nav `settings-nav-extensions`, listed only at
  `protocolVersion >= EXTENSION_CATALOG_PROTOCOL_VERSION`) is one `SettingsPage` of rows, not cards, in up
  to six groups. Its description carries the page's only statement about chats — "Changes apply to open
  chats when their current turn ends."; there is no dynamic notice about which chats are pending.
  **Install** (titled for its action: "Packages" did not cover the extensions it installs) is the
  **Install an extension or pi package** row (`packages-install`, with two
  buttons from `GalleryLinks`: **Browse ThinkRail extensions** (`extensions-gallery-link`, the website's
  showcase, only when the host supports installed extensions) first, then **Browse the pi package
  gallery**; the install dialog's form repeats both in that order). **Built into ThinkRail** is the host-registry catalog, read from the store's
  `extensionCatalog` (`selectBuiltinExtensions`: every row of an older host, `kind: "builtin"` from v131) —
  `transport`'s `refreshExtensionCatalog` re-lists on each mount and each welcome while the page is open, so
  an older host or a page opened while disconnected still lands its rows, and a failure shows **Retry**,
  which re-lists and shows its busy state until the reply lands (a failure that repeats would otherwise
  look like a click that did nothing) — rendered by
  the props-driven `ExtensionsCatalog` as one `SettingsRow` per entry — title (the web half's translated
  `title` when it declares one, `extensions`' `webExtensionTitle`, else the host's), description and its
  tools as visible text ("Tools: a, b", each `extension-tool-<tool>`) with a `@thinkrail/ui/switch`
  (`extension-toggle-<name>`) whose state is **`store.disabledExtensions`**, not the catalog's snapshot; a
  row switched off is Changed and its Reset turns it back on. A toggle writes the whole list through
  `settings.update { disabledExtensions }` and converges on the broadcast. Unknown names already in the list are carried through. Once the catalog has loaded, the group
  also lists the **web-only extensions** it lacks (`withWebOnlyEntries` over `extensions`'
  `webOnlyExtensions`: titled registry entries, today Hint mode) after the host's rows, with their locale
  title and description, no tool chips and the same switch; the switch applies at once (the shell
  unmounts the extension), which the row's own description says, since the page's "when their current
  turn ends" is about the agent's extensions. A catalog entry's declared `settings`
  render as nested switch rows under its row (`extension-setting-<name>-<key>`; Rich previews is catalog
  `rich-previews`, Reset to the declared default; copy from a static
  `MessageKey` map — a setting without copy is not shown), valued from **`store.extensionSettings`** else the
  declared default, disabled while the extension is off, and written one key at a time through
  `settings.update { extensionSettings: { name: { key: value } } }` (the host merges); they appear only
  while `supportsExtensionSettings(protocolVersion)` holds. **Skills** (only at
  `protocolVersion >= OTHER_AGENT_SKILLS_PROTOCOL_VERSION`) is **Skills from other agents**,
  `other-agent-skills-toggle`, over `store.otherAgentSkills`, writing `settings.update { otherAgentSkills }`,
  with no Reset (see the rules above); per-project choices made in the Skills dialog still win over it.
  **Installed** and **pi built-in**
  (`PiPackagesSettings.tsx`, props-driven; every `packages.*` request and the row state live in the
  **`usePiPackages`** hook, `usePiPackages.ts`, so the page component only composes) exist only while
  `supportsPiPackages(protocolVersion)` holds — against an older host the page is the bundled group
  alone with its former description, no Packages row and no package request — and list
  `packages.list` for the active workspace (user scope alone without one, or for a chat without a project —
  `selectActiveRepoWorkspaceId`) through **one** request path
  (`listPackages`, generation-guarded so a slow older response never overwrites a newer one), re-run on
  mount, on a workspace change and on the store's `packagesVersion` (the `packages.changed` push, which
  the host also sends after a package switch so a re-enabled row regains its chips). The mount and
  workspace-change reads pass `force`, so the host rebuilds its catalog: an extension file dropped into a
  scanned folder by hand changes nothing the host watches, and a cached list would hide it for minutes. The update check
  is guarded the same way: a check started later (a workspace switch, a manual check, the re-check
  after an update) wins, and only the latest clears "Checking…" or re-flags rows. **Installed**
  opens with an **Updates** row (Check for updates; Update all as a button while the last check flagged rows;
  that check's error as visible text) over one `SettingsList` (`packages`) of installed ThinkRail extension
  rows, then package rows, then loose-file rows. A **package row** (`PackageRow`, row id `<scope>:<source>`) has as its primary (Enter) the expand
  control — name · a **pi package** type tag ·
  kind / scope tags (`npm` / `git` / `local`, Global / Repository) · an **Update available** or **Not
  installed** tag · one provenance line (declared source · "<version> installed" · description) ·
  tool and `/command` chips of its extensions as a chat's loader last recorded them (a file no chat has
  loaded since it changed has none — the host never runs extension code to list; the install dialog
  probes its new package once, so a fresh install shows chips at once) — with the **switch** (Space on the
  row) and a ⋯ menu (Update, Open folder, Remove…; Shift+F10) as its buttons; names, sources and paths wrap. Delete asks to remove
  the package through `ConfirmDialog` (`package-remove-confirm`). A package missing on disk and a loose
  file have nothing to expand, so their primary opens the menu; a loose file has no uninstall, so Delete
  does nothing on it. A failed `packages.list` shows **Retry**. **pi built-in** is one row per built-in
  with its `builtin:<name>` key as visible text. The group's one-line description says the switch affects ThinkRail chats only (the pi CLI
  still loads the package — `disabledPackages` is a ThinkRail setting). The switch is the only state
  control; it renders the host's `enabled` (closed over pi's package equivalence) and writes
  `settings.update { disabledPackages }` — on removes every key in the row's `switchKeys`, off adds its
  `identity` (`nextDisabledPackages`); an off row dims
  its text and chips; a user declaration the repository shadows says so under its provenance line, and a
  row the host marks `supersededBy` says "Replaced by {extension} while it is on." there
  (`package-superseded`, the extension named by its web `title` when it has one), so a package a
  ThinkRail extension leaves out of chats never reads as merely enabled. There is no status column and no "installing" row. A declaration with no install
  on disk (`installedPath` absent) is a **Not installed** row: a warning tag, the source and one hint
  line ("pi retries when a chat starts; remove it if that keeps failing"), no switch, no expand, a menu
  with Remove only. The one row-level problem of an installed package is an extension that failed to
  load — one attention line, `Failed to load: <pi's error>` → **Open folder**. Expanding a row lists its
  extensions, skills and prompts **read-only** (a resource pi's settings switch off says "off in pi
  settings"; the package switch is the only control — in-package toggles are deferred until pi exposes
  an API, see [[submodule-server-agent-packages]]) plus Open folder and Remove…; themes are never shown. A **loose file** row (`LooseRow`:
  `<agentDir>/extensions/*`, `.pi/extensions/*`, explicit `extensions[]` entries) is the file name with a
  `local file` tag, its path, chips, a switch and Open folder — no Update or Remove, since ThinkRail did
  not install it. **pi built-in** lists the two built-ins the host runs (MCP client, Tool search) with a
  switch each, written as `±builtin:<name>` in the **scope the catalog reports** (a repository entry
  overrides the user file in pi, so flipping a project-decided row writes `.pi/settings.json`); the
  group's description names the settings file that decides. Every
  row action — switch, resource toggle, Update, Open folder, Remove — carries `{ source, scope,
  workspaceId? }` and a `rowKey` the page keys busy and error state on (an error renders inline on the
  row, never a toast; the bundled group's switch keeps its older toast); Remove goes through
  `ConfirmDialog`; Update and Remove run with a ten-minute `timeoutMs`. Updates are checked once on mount
  (`packages.checkUpdates`, cached by the host) and on **Check for updates** (`force: true`); **Update
  all** sends the flagged rows as **one** `packages.update` request and marks them busy together. An empty
  list says so (installing is the Packages row's); an untrusted project shows one info notice; a failed
  list renders `packages-failed`. The **`InstallPackageDialog`** (`InstallPackageDialog.tsx`; its `InstallPackageBody` is
  props-driven so each step renders without a portal, `installStepHeader` supplies the Radix title per
  step) is source (an info icon beside the label opens a tooltip listing what can be pasted — gallery
  or npm link, `pi install` line, npm name, git URL, local folder — in place of a permanent hint; there
  is no trust warning in the dialog, the list's untrusted notice and pi's own trust prompt cover it) → scope
  (a cheap kit `SettingsChoice`, `install-package-scope-user` / `-project`: **Global** / **This repository
  only**; there is no per-workspace choice, a
  package is on wherever its declaration loads) → one confirm → **Installing…** (indeterminate, no
  progress log, no Cancel — pi has none) → **Installed** (name · version · description, chips for every
  tool / command / skill / prompt it added, and one line: "Installed globally — new chats have it now;
  open chats pick it up when idle"; no switch here — the row in the list is the only state control) or
  **Failed** (`installFailureText`: for `PACKAGE_NOT_FOUND`, `PACKAGE_REGISTRY_UNREACHABLE` and
  `PACKAGE_INSTALL_FAILED` one plain sentence — npm found no such package or dependency / the registry
  could not be reached / the install stopped with an error — with the host's raw text, npm's own output
  included, behind a closed **Details** toggle; for any other code the host's message as it is;
  "Nothing was added to your settings" only for the codes the host raises before it writes
  (`installFailureOutcome`), "It may have been added anyway — check the list" for any other error, Back /
  Retry; a `RequestTimeoutError` instead says to check the list, since the install may still complete). A package that installs but contributes nothing loadable
  is a success with an empty chip list — it has a row, so it can be removed. The field is forgiving: `parsePiPackageInput`
  ([[module-contracts]]) turns a pi.dev or npmjs.com package link, a pasted `pi install …` line and a
  bare `@scope/name[@version]` into the `npm:` source pi accepts for the echo and the display name; a
  pasted `-l` selects the repository scope when it is available. The request carries the raw text and
  the host applies the same function (plus its folder-first rule for a bare name), so what the echo
  says is what installs.
  `describeSource` is a light client-side echo only — the host validates; **This repository only** is
  offered only with an active workspace whose project is pi-trusted,
  with the reason shown otherwise, and the hints show the real settings paths from the catalog. Disabling
  never unregisters a tool renderer ([[submodule-web-extensions]]), so past transcripts still render.

  **Installed ThinkRail extensions** (from `INSTALLED_EXTENSIONS_PROTOCOL_VERSION`, v131) are the first rows of
  the **Installed** list (`PiPackagesGroup`'s `extensionRows`: each a list row id `extension:<source>`, its
  markup and its Delete; they also keep showing, as the list alone, while `packages.list` loads or fails), from
  `selectInstalledExtensions` in host order; every extension row carries a **ThinkRail extension** tag and every
  pi package row a **pi package** tag, so each row is marked with its kind. **`InstalledExtensionRow`**
  (`InstalledExtensionRow.tsx`, props-driven) is a list row like a loose file's: its primary (nothing to expand)
  opens its ⋯ menu and shows title · kind tag · source tag (`npm` / `git` / `local`, read from the declaration) ·
  **Update available** (from `extensions.checkUpdates`) · one provenance line (package name · source ·
  "<version> installed" · description) · what it brings (tool-name chips and a **Chat cards** mark when the
  host lists a `web` half); its **switch** (Space on the row; `extension-toggle-<name>`, the same
  `disabledExtensions` key as a built-in, by package name), then as its buttons the menu (**Update** — always:
  a folder source reloads in place — and **Remove…**; Shift+F10) and its declared boolean settings' switches,
  nested underneath with the descriptor's own
  `title` / `description` (shown as is, never locale keys; disabled while the extension is off;
  `extension-setting-<name>-<key>`; no Reset — Delete on the row is its Remove). Delete asks to remove it
  through `ConfirmDialog` (`installed-extension-remove-confirm`: removing drops it for every project, and past
  calls show as plain rows — the follower unloads its web half). No switch disables itself while a request is
  in flight (the writes converge on the broadcast); Update and Remove wait. States, each with no switch where
  it cannot work: **failed** — a "Failed to load" tag and the host's error verbatim with a fix-or-remove hint,
  nothing listed as running; **incompatible** — a tag and a notice saying "Needs a newer ThinkRail" or "Built
  for an older ThinkRail" (`extensionApiFit` over the entry's `api`; an unreadable `api` reads as needing a
  newer app), the host's reason and an update hint; and a **web half that failed in this window**
  (`useWebExtensionLoads`) — a warning that its cards could not load here: its tools still run and their
  calls show as plain rows, but a tool that waits for an answer cannot be answered in this window until the
  cards load (interactivity comes from the renderer registration, which failed), so it says to reload the
  window or choose Update; the switch is kept. One sentence for every extension: the row cannot tell which
  tools are interactive without the web half that failed. **Search** finds them as the pi packages are found (the catalog's `installed-packages`, whose
  keywords name ThinkRail extensions too) and, beyond the static catalog, each installed extension and each
  setting it declares by its own words: `SettingsDialog` injects `installedExtensionSearchEntries`
  (`settingsSearch.ts`) from the store's catalog, jumping to the row (`installed-extension-<name>`) or to the
  setting (`extension-setting-<name>-<key>`, landing on its row). **`useInstalledExtensions`**
  (`useInstalledExtensions.ts`) owns every `extensions.*` and switch/setting request of these rows, keyed
  `extension\0<source>` for busy and inline errors (never a toast), runs the update check on mount and with the
  **Updates** row's Check for updates (its count and Update all include flagged extensions), joins **Update
  all** (sequential `extensions.update`), and re-lists the store catalog after each mutation; its requests
  outwait the transport's default (ten minutes for a mutation, two for the update check), since an npm or
  git reinstall outlasts it, and the host still finishes a run the page stopped waiting for; the
  `extensions.changed` push does the same for changes made elsewhere (the agent skill editing
  `extensions.json`). The page's one statement that changes reach open chats when their current turn ends
  covers extensions too.

  **The install dialog installs extensions too.** Its result step reads `PackageInstallResult`: the kind line
  (`install-package-kind`) says whether a ThinkRail extension or a pi package landed — decided by
  `installed`, the attached `extension` entry feeding only the chips — and an extension shows its title ·
  version, tool chips, **Chat cards** and its declared settings, with "open chats pick it up when their
  current turn ends". An extension is always global: when **This repository only** was chosen and the host
  answers `EXTENSION_SCOPE_UNSUPPORTED`, the dialog moves to a `scopeUnsupported` step explaining that and
  offering **Install globally** (one click, re-submitted at user scope) or Back. A `preset` (`InstallPreset`:
  source, title, version, author, description) opens the dialog at a **confirm** step — the source, the
  catalog metadata, the trust statement and Install, with no scope choice — read on mount, so the page
  remounts the dialog (`key`) per opening.

  **Browse** (`ExtensionBrowse.tsx`, props-driven; `useExtensionBrowse.ts` owns the request; catalog
  `extension-browse`) is a group shown from `EXTENSION_BROWSE_PROTOCOL_VERSION` (v132), after Installed. The
  host fetches the catalog (`extensions.browse`, [[submodule-server-extension-catalog]]); the browser never
  contacts thinkrail.ai. The hook reads on mount and again, from the host's cache, whenever the store catalog
  changes (so the **Installed** marks follow installs and removals); **Retry** forces a refetch; the latest read
  wins. Its own 30 s request bound only catches a host that stopped answering: the host's fetch has a shorter
  timeout of its own. The group's description states plainly that listings are automatic and unreviewed and that an extension
  runs code on this machine and in the app. A search field row (Enter enters the field, ↓ leaves it for the
  listings, Esc clears a query and then returns to the row) narrows by title, name,
  description and author ("No extensions match …") over one `SettingsList` (`extension-browse`) of listing
  rows — no preview image: an author-chosen image URL would expose every user's IP to its host, so Browse
  never reads a listing's `image` and no catalog entry makes the app request another origin (pinned by
  `e2e/extension-browse.spec.ts`). A row shows, as plain text: title, version, **Agent tools** /
  **Chat cards** from `halves`, package name · author, description, and an **Installed** mark or an
  incompatible mark (`extensionApiFit`) with its reason. It has no primary; its buttons, in the row's →
  walk, are the npm and repository links and **Install**, which opens the install dialog's confirm step
  with the listing's `npm:<name>` (absent when the listing cannot be installed). Rejected: a content-wide
  primary that also opened the dialog (a second tab stop and click target for the same action as
  Install), and Install as the primary (the walk keeps a primary out of → / ←, so the button would be
  unreachable by arrows). An empty catalog is a row linking to the
  authoring guide (`https://thinkrail.ai/docs/build-an-extension/`); an unreachable, offline or invalid
  catalog — or a host that does not answer — is a notice row saying it cannot reach the catalog, that
  installed extensions keep working, with Retry as its button, while the rest of the page is unaffected.
  **`EnvironmentSettings`** (the **Environment** section, nav `settings-nav-environment`, listed only at
  `protocolVersion >= HOST_ENVIRONMENT_PROTOCOL_VERSION`) edits the stored host environment
  ([[submodule-server-environment]]) as a `SettingsPage`: a **Pi configuration** group (scope tag *This
  computer*) with the **Pi config folder** row — its hint, the folder in use (`effectiveAgentDir`) and the
  launch-override warning, all visible text — and an **Environment variables** group (*This computer*) of
  ordered name/value rows (one walk row each; values masked until revealed per row; a "Set at launch"
  badge followed by its explanation as visible text), then **Discard** / **Save**. It fetches
  `environment.get` on mount into section-local state — never a store slice, because values may be
  secrets — and keeps an explicit draft (Save / Discard, not per-field writes), since nothing applies before
  a restart. **Esc in a field reverts that one field** to the value the form last loaded or saved
  (`revertDraftField`; a new row's field reverts to empty) and is consumed only when it changed something,
  so the next Esc returns to the variable's row and the one after it to the section list. The form is one `<fieldset disabled>` while a save is in flight, so a
  response can never overwrite edits made after it was sent, nor attach its issues to rows it never saw. Save sends
  the whole record through `environment.update`; `{ ok: false }` maps each issue back to its field or row
  (blank rows are dropped client-side first so server indexes line up). After a save,
  `settings-environment-restart` ("Saved changes apply after you restart ThinkRail.") stays at the top for
  as long as the host reports `restartRequired`; a failed load shows **Retry**. Pure draft helpers
  live in `panels/environmentDraft.ts`; the props-driven `EnvironmentForm` is what tests render. No folder
  picker: `dialog.selectDirectory` is the project-setup picker and records setup analytics.
  `ProvidersSettings`/`McpSettings`/`AppearanceSettings`/`LineWidthControl`/`ChatSettings`/`SubagentsSettings`/`TemplatesSettings`/
  `WorkspacesSettings`/`PrivacySettings`/`ModelsSettings`/`FeedbackSettings`/`ExtensionsSettings`/`EnvironmentSettings`, the onboarding
  `ConnectProviderDialog`/`CreateProjectDialog`/`OnboardingWizard`, and the app-wide **`SurveyInvitationDialog`** /
  **`SurveyWindow`** are the panels-owned **integration pieces** (store + transport).
  `SettingsDialog` receives the Layout and Keyboard sections, the optional Updates section and the
  shortcuts' search entries from the shell composition root so no panel reaches sideways into shell, and the `LoginDialog` stays presentational
  (`auth` module).

  Panels compose their own sub-panels
  (e.g. side tools → `FilesPanel` → `FileTree`/`ChangesPanel`, resource panes → registered bundled renderers) — an internal hierarchy.
  When a center group has no resource tab, the workbench asks panels for the empty surface as a persistent
  creation/orientation receipt rather than a generic placeholder: **“Workspace ready”**, the display name,
  `branch · from baseBranch`, and **“Files, chats, changes, and terminals are scoped to this workspace,”**
  followed by the existing **New chat** action. For the **Default workspace** the receipt tells the truth
  instead of promising isolation: **“Default workspace”**, the project name, `on <branch>`, and “Chats,
  changes, and terminals run directly in your project folder.” An **external workspace** reads
  **“Existing worktree”** with `on <branch>` for the same reason — ThinkRail did not cut it, so there is no
  `from <base>` to claim. It is neither one-time nor dismissible, so it also helps
  after the last tab closes without introducing onboarding state. The workbench resource renderer handles
  registered **`plan`** tabs (`PlanTab`) via the lazy **`PlanPane`** — the chat plan's **live review-map
  page**. Frontend-local placement stores only the `todo-plan` resolver kind + session identity, never inline
  plan content; another client can explicitly reopen the same host-owned page without inheriting placement.

  **TODO list is a right-rail tool.** `LAYOUT_TOOLS` carries `"plan"`;
  `WorkspaceWorkbench.toolBodies.plan` renders the lazy **`PlanRailPane`** (new file,
  `apps/web/src/panels/PlanRailPane.tsx`) which is **not** `PlanPane` — it imports the SAME compact
  `TodoAddRow` + `TodoRows` the chat view relies on (`apps/web/src/chat/TodoList.tsx`), so visual
  changes to one surface land on the other. `data-testid="plan-rail-pane"` on its outer div
  (distinct from the center-tab `plan-pane`) so e2e can address either surface unambiguously. The
  rail picks the workspace's currently-active chat via `selectRailPlanSessionId` and shows that
  chat's TODOs; when the workspace has no chat tab at all, the `plan-rail-empty` placeholder invites
  "Open a chat to see its plan here." The `todo-open-plan` button inside `TodoAddRow` opens the
  document-scale **center-tab Plan** (`openPlan` → `openDoc({kind:"plan", ...})`); the rail is the
  always-on glance surface, the center-tab Plan is the deep-review surface (`PlanSessionLive`, PR
  actions, next-action banners, adopted commits, unattributed). They complement each other — rail for
  the task list, page for the review trail. No layout migration: existing center-tab Plans keep
  working alongside the new rail tool.

  **Not-yet-done rail items carry a hover Remove button.** The user can cancel a queued or
  in-progress step from the rail via a `data-testid="todo-remove"` × button that appears on the
  row's hover state; the click calls `plan.remove(id)` which fires the host's `todo.remove` wire
  call. The host's `removeTodo` rejects a `done` item with an explanatory error (completed steps
  are the plan's audit trail), so the button is also hidden client-side on done rows. The failure
  path is owned by `useChatTodos.remove` itself: a rejecting host throws, the hook rolls back the
  optimistic patch and toasts "Couldn't remove the step" via the store's error channel, so a stale
  click (row just became done between render and click) never surfaces as an unhandled rejection.
  The center-tab Plan page does NOT expose this affordance — it is a review-trail surface, and
  queue manipulation lives on the rail. The agent still manages its own removal through pi-todos'
  `todo_remove` tool, which bypasses the host guard.

  Center-tab Plan renders the session's TODO plan document-scale,
  **status-grouped** (`planSections`): a single **`Now` block** (`plan-now-executing`) holds the
  current work — the active group(s)/loose items followed by the pending ones (no separate To-do
  section; item status glyphs distinguish in-progress from pending). Its **live status is a clickable chip
  in the header, right of the `Session` title** (`plan-now-status`, `data-glance`, off `sessionGlance`)
  that **opens the chat** (`openChatInTab`) so you can jump from the plan into the conversation: `working`
  → a `Working on this` spinner, `waiting_question` → a `Question` chip. The awaiting question is ALSO
  **answerable in place**: the Session body's **live slot** (`PlanSessionLive`, which subscribes to the
  session runtime so its re-renders stay off the heavy PlanPane) hosts the SAME card as the chat
  (`plan-ask`, found via `planView.pendingInteraction` and rendered through the tool registry's
  `getToolRenderer(toolName)` — any interactive tool, not only the questionnaire; the pane imports no
  extension). It sits inside a minimal `ChatActionsContext` and a derived `InteractionStatesContext`:
  - the actions carry a real `session.respondToTool`;
  - the chat-only actions (reveal, focus, subagent) are no-ops.

  `PlanInteractionCard` turns these into the card's `interaction` through the same `useToolInteraction`
  adapter the chat uses, so a response submitted from the plan flows through the identical path as the
  chat. It also gives the card the session's `ResourceScopeProvider` and an `onOpenFile` that opens a
  preview tab, so a card's file previews render on the plan page as in the chat.
  When there's no pending question, the same slot instead shows the **agent's
  latest message** (`plan-agent-message`, `planView.lastAgentText` rendered Markdown inside a bounded
  scroll area — `max-h-[12rem] overflow-y-auto` so the full message stays readable without pushing
  the plan items down — live while it streams) — **always, including while a step is in progress**,
  so the plan stays honest about what the agent is doing right now; it renders nothing only when the pending-ask case takes the slot or there is
  no agent message yet. Below the items the Session ends in a **chat/steer
  composer** (`plan-session-chat`, a `PlanComposer` textarea that works like the chat composer — Enter
  sends, Shift+Enter newlines) whose send adapts to the run: while the agent is streaming it **steers**
  (`session.steer`, "Steer the agent…"), otherwise it **starts a turn** (`session.prompt`, "Message the
  agent…"). A Plan tab restored without its Chat has no local runtime, and chat reconciliation only
  hydrates placed Chat tabs, so `PlanPane` itself calls `hydrateSessionRuntime` (background, no tab
  placement) whenever it is connected without one — the live slot, status, and in-plan ask card need it.
  The composer keeps `ChatView.performSend`'s semantics: it first awaits `hydrateSessionRuntime`, so the
  mode comes from the **hydrated** runtime. A **prompt** is recorded before it is sent (`appendUserMessage`)
  and not awaited — `session.prompt` resolves only when the run ends — so a rejection surfaces as an
  `appendErrorTurn` in that chat and nothing is lost. A **steer** is not recorded (it arrives with the
  delivered message), so it is awaited: a failed hydration or a rejected steer toasts and rethrows, and the
  draft stays in the plan. **A send from the plan stays on the plan** — it never auto-switches to the
  chat tab (an earlier version did via `openChatInTab` on the success path; dropped because the plan is
  itself a working surface and the agent's reply streams into the live `plan-agent-message` block right
  below). To jump to the chat you click the Now status chip (`Working on this` / `Question`) or the
  explicit Open-chat affordances — those are the only `openChatInTab` call sites in the plan now.
  `PlanComposer` ignores a submit while the previous one is in flight,
  so a repeated Enter can't add or send the same draft twice. So a completed
  plan (no open steps) turns its Session into a chat entry point rather than a dead "all steps done" line,
  and a running plan gets an in-place steering field. The one exception is a **truly empty** plan (no items,
  idle): there the body shows the `plan-now-idle` line (`No steps yet…`), itself a click target that opens
  the add-task input (a hover `+ Add a task` hint) to bootstrap the plan. A **`Done` section**
  (`plan-done-section`, always expanded — the page is the review trail) holds the completed groups then
  done loose. Both blocks share ONE `PLAN_CARD_CLASS` card shape with a `glyph + title` header — Session
  (`CircleDot`), Done (`CircleCheck`, via `PlanCardSection`) — so the plan reads as one consistent card
  stack. **Heading scale (top-down, no inversion):** page title `tr-heading-sm` → card + group-task
  headings `tr-title-dialog` (14/600) → item titles `tr-title-section` (14/500) → metadata
  `tr-text-metadata` — a group heading is never smaller than the items it holds. The Now block header carries the plan page's **add-task control**
  (the plan page's only in-page way to add): a `+ Task` button (`plan-add-task`) toggles an inline
  **auto-growing textarea** (`plan-add-input`) — plain **Enter adds**, **Shift+Enter** inserts a newline
  (multi-line like the composer), Esc closes — wired to the SAME `useChatTodos.add` as the rail's
  `TodoAddRow` — a loose **user** item plus the agent nudge — so the two entry points stay one flow.
  Items keep a **scan-first item
  anatomy**: the item TITLE is
  the only full-size text (`tr-text-ui font-medium`), every detail is a step down (`tr-text-metadata`,
  subtle/muted) — so titles never blend into prose. Titles **wrap** (`break-words`, never truncated) — a
  long title is revealed in full, not clipped. A **done item carries no leading status glyph**
  (`hideStatusGlyph` — its section already says "done"; only an active review or a `changes_requested`
  warning keeps a leading glyph; the slot holds a ghost spacer so titles stay aligned). A **done item
  collapses to a compact block that always carries a `summary` preview inline when the agent wrote one**
  (`plan-item-meta` / `plan-item-summary-preview`): line 1 is a LEADING chevron (matching the
  change-set disclosure's anatomy; non-collapsible rows reserve the chevron's width with a ghost
  spacer so every title in the list aligns) + the title, with the **review slot at its right edge**;
  line 2 (when the item has a `summary`) is the summary's first line rendered as Markdown and
  `line-clamp-1`'d so a scan reveals what was done without clicking; line 3 (when a `verification`
  and/or change set exists) is the quiet meta strip — the verification glyph (`ShieldCheck` /
  `CircleAlert` off `verificationStatus`, with the full verification text as its native hover tooltip
  so a mouse-over reads the exact checks — the in-page tooltip component would trap focus and fight
  the row's click-to-expand), `N files`, and — hidden below `sm` so the title keeps its width on
  phones — short sha + `DiffStatBadge`. The two meta rows are both aligned to the title via the same
  ghost-chevron spacer. The meta lives on its own line(s) precisely so the title row's right edge is
  free for the review slot — the reveal-on-hover action never collides with the title, the summary
  preview, or the meta. The always-on preview + hoverable verification removes the cost of expanding every done item to see what shipped. **Expansion is a
  click, not a hover** (`plan-item-toggle` → `data-expanded`): the detail block is always mounted but
  CSS-hidden (`hidden` → `group-data-[expanded=true]:flex`), so a click persists it (and it works on
  touch, which has no hover) and the meta line yields to it (`group-data-[expanded=true]:hidden`);
  the chevron rotates the same way. No JS hover state — a static `<div>` with mouse/focus handlers is
  an a11y smell the lint rightly rejects. The detail block is an indented
  left-rail (`border-l`) block holding the note, the agent's `summary` (Markdown), the full
  `VerificationBadge` (glyph + the verification as Markdown, so multiple checks read as bullet points),
  a changes_requested `feedback` note, the change set, **and — when the item accumulated 2+ commits
  (fix cycles) — a REVISIONS mini-timeline** (`plan-revisions`/`plan-revision`, off
  `planView.itemRevisions`): one row per commit in order (`#n` + sha chip routing the Changes panel +
  `DiffStatBadge` when the sha still resolves), the last marked *current*, and any sha in the
  review's `unreviewedShas` delta marked *unreviewed* (`data-unreviewed`) — the honest
  how-the-agent-got-here story (commit → review → fix → commit) no final-diff view can tell.
  Any item that carries details is collapsible — including a **non-done item with only a `note`**: the note is agent-facing working detail, so it stays behind the disclosure and the default human view is titles + status, never the agent's inline notes. Inside the details, the change set stays its own **collapsible**
  disclosure — a summary line (sha chip + `N files` + `DiffStatBadge`) toggling the commit's
  `GitFileChange[]` rows; the chevron/summary is the
  toggle while the sha chip stays a separate button (routing the Changes panel, never toggling). Expanded,
  file rows open registry-dispatched diff tabs at the item's `commit:{sha}` scope (`openDiffInTab`, preview intent; the
  path-list fallback opens at branch scope, no counts because they would drift), **and the review verdict
  ON the item row itself**: the row's right edge is ONE review slot rendering exactly one of, in
  precedence order, the non-clickable pulsing `Checking…` status (`plan-item-reviewing`, off the
  host-derived `review.reviewing` — the review runs as a hidden subagent, so there is no chat to open),
  the warning `Needs a fix · N` chip, or the
  primary-filled `Check it` button (`plan-start-review` — the standard **small** action button:
  `h-6`/`tr-text-action`/`control-primary-bg`, the same size as `SendReviewButton`, not an oversized
  `min-h-8` block) for an unsettled reviewable item. The two **status**
  readouts stay always visible (state, not an action); the **`Check it` action reveals on the
  row's hover / keyboard focus**, exactly like the ProjectTree kebab: `[@media(hover:hover)]:opacity-0`
  + `[@media(hover:hover)]:group-hover:opacity-100` + `focus-visible:opacity-100` — so a wall of
  primary buttons never paints across every reviewable row on desktop, yet on a **touch** device (no
  hover) it stays visible, and it never sticks the way `group-focus-within` did. It is an **in-flow**
  button on the title line (the meta on line 2 frees that right edge, so the title simply shrinks for
  it — no overlap, no empty reserved slot). Still one slot, no duplicates — the change-set disclosure
  row carries NO review affordance.
  `Check it` fires the AGENT review (`todo.startReview` — a hidden review subagent) and STAYS on
  the plan page: the row's `Checking…` pulse and a toast are the only signals, success AND failure —
  the review runs with no chat of its own, so the toast must carry the error. The verdict lands via the
  `review.changed` broadcast (`useChatTodos` refetches the plan on it), not a `pi.event` for this
  session — the subagent's events are hidden; a post-ack failure lands via the `review.failed` broadcast
  (`useChatTodos` raises it as an error toast, filtered to the owning `sessionId` and deduped across split
  views by the toast body).
  **Plan-review STATE is always derived from the plan; only the ACTIONS are host-version-gated on
  `transport.supportsPlanReview` (v67).** `reviewables`/`unsettledReviewables`/`planReady` come from
  `TodoItem.review` regardless of host version — gating them to empty would let `planReady` read ship-ready
  over an unreviewed step. Against an older host that serves no `todo.startReview`/`reviewAll`, `PlanPane`
  only disables the mutating affordances (per-row `Check it`, both `Check All` triggers), so an
  independently-shipped newer client never *calls* a capability the host cannot honour while still reflecting
  the review state the host does report.
  Row controls (`plan-item-toggle`, the change-set toggle, the sha chip, the review slot, `FileRow`)
  wear `min-h-8` — the dense metadata rows stay tappable on touch. `planView.changeSetCounts` is the
  one count/stat derivation (paths → count only; commit → `changeSetStat`), shared by the row's meta
  strip and the disclosure line. There is **no in-page manual verdict UI** — the former `manually` toggle
  + `ReviewActions` pair (Approve / Ask to fix) was removed with `PlanReview.tsx`; the `todo.review` /
  `todo.requestFix` wire methods and host handlers stay, so a manual-override surface can return without
  protocol work; agent-authored findings appear in the Review
  panel badged `agent` (`review-comment-agent`), and an agent-settled card reads `Reviewed · agent`;
  a **changes_requested** verdict marks the item loudly: the status glyph flips to the warning
  `CircleAlert` (`StatusIcon changesRequested`, `data-changes-requested` — rail row and plan page
  alike), the plan page's title row grows a warning **`Needs a fix · N`** chip
  (`plan-item-changes-requested`; N = `planView.itemOpenFindings`, the reviewer's open comments
  matched by `origin` provenance (path-join fallback for provenance-less ones) — the Review tab is
  the truth; the chip
  `requestToolView`s the Review tab) and the verdict's `feedback` note renders inline
  (`plan-item-review-feedback`); approving settles the item — the plan page shows a **`Checked` label**
  in the row's review slot, right of the title (`plan-item-verified`, `CircleCheck` + text, success tone),
  and `data-reviewed` on the row (the rail keeps the circled `StatusIcon reviewed` glyph); `planView.reviewSettled` is the
  one derivation — approved AND no unreviewed delta, so a fresh revision drops the item back out of both
  the label and the reviewed counter. **The header is a title + a lifecycle STEPPER and a kebab menu**. The stepper (`plan-progress`)
  renders the plan's shipping funnel — **Build (`d/t done`) → Review (`r/k reviewed`,
  `plan-review-progress`, only when the plan has reviewable items) → PR (`plan-pr-stage`,
  `data-state`)** — each stage wearing a glyph for its state: done (check), active (the stage the
  plan is currently at), pending (muted). The PR stage reads the same `useBranchStatus` lookup
  as the button and shows `PR #N` once one is open; "merged" is unknowable (the lookup only
  sees OPEN reviews), so the funnel honestly ends at PR-open. Under the stepper sits the **work
  CONTEXT line** (`plan-context`): `baseBranch ← branch · N commits · +A −R` — the arrow points at the
  merge TARGET (base ← head, the GitHub PR convention: changes flow from the workspace branch into
  its base). `N commits` is the **`PlanCommitsMenu`** (`plan-commits-trigger`) — a dropdown mirroring
  the Changes scope menu's commit list: `git.listCommits` (eager-loaded, reloaded whenever the plan's
  commit count ticks) is the ONE source for both the count and the list, so they never diverge — and,
  being the `base..HEAD` enumeration, it already spans the adopted commits (branch commits no step
  owns) alongside the per-step ones; each
  row (`plan-commits-item`, `data-sha`) opens that commit's diff in the Changes panel via the same
  `openChanges({ sha })` the per-step commit chip uses. The chip self-hides while loading and when the
  branch has no commits. The total diff comes from the workspace record's `diffStats`; each piece
  hides when unknown. Between header and summary lives the **NEXT-ACTION banner** (`plan-next-action`,
  `data-kind`) — the report's one "what now", rendering the FIRST matching state by urgency:
  `fix` (N steps carry changes_requested → **Show step** scrolls to the first flagged item, focuses its
  toggle (`preventScroll`, the scroll is already smooth) and auto-expands it via the `focusRequest` token — `{ id, tick }`, tick bumped per click and consumed
  once per tick by the target `ItemBlock`, so a re-click re-expands a manually collapsed row and a
  stale request can't reopen it later) → `review`
  (N unsettled reviewables → an inline **Review All** button, same `todo.reviewAll` flow as the
  kebab item, which stays) → `ship` (all done + reviewed, no open PR → an inline **Open PR**,
  same `pr.open` flow as the header button) → hidden when nothing demands action. The plan-level
  completion note wears a `Summary` eyebrow so the report reads in labeled sections; when the note is
  long it clamps to two lines and its **expand/collapse toggle lives in the card header** (a right-aligned
  chevron on the clickable `plan-overall-summary-toggle` header, rotating on `open`) — not a trailing
  button — so collapsing never requires scrolling past the expanded prose. The next-action
  banner, the Summary block, and the Now-executing block share ONE card shape (`PLAN_CARD_CLASS` — same
  elevated bg, border, radius, and padding) so the top of the plan reads as one consistent stack. After the item
sections the page renders **`Committed outside the plan`** (`plan-adopted-commits`, only when
`TodoPlan.adoptedCommits` is non-empty — including on an otherwise empty plan): the host-derived
`base..HEAD` commits no item owns (derivation: [[submodule-server-todos]]), each rendered with the same
**`ItemBlock`** as a planned step so it carries the identical change set, Start-review, and revisions
affordances — they are reviewable exactly like an item's commit. **Review stage only:** they are
*excluded* from the build `d/t done` count and never gate `ship`, but `planView.reviewableItems`
includes them so the Review stepper, the `review` next-action, and Review All cover them. Then the page
renders **`Outside the plan`** (`plan-unattributed`, only when
`TodoPlan.unattributed` is non-empty — including on an otherwise empty plan): the host-derived
uncommitted rows no item claims (derivation: [[submodule-server-todos]]), rendered as `FileRow`s
opening the **uncommitted-scope** diff — the honesty section that keeps un-planned work visible in
the review map instead of reading as "nothing else changed"; `chat/planMarkdown` exports it as its
own section. The kebab menu (`plan-menu`, a
  `DropdownMenu`) holding **Copy** (clipboard) / **Save .md** (browser download) — both compiling through
  `chat/planMarkdown` — and, when the plan has reviewable items, **Review All** (`plan-review-all`): fires
  `todo.reviewAll`, which agent-reviews every *unsettled* reviewable item on the plan's serial chain, one
  at a time (disabled when none are unsettled; a toast reports how many started, the per-row `Reviewing…`
  pulses track progress), plus **Open draft PR** (`plan-open-draft-pr`, hidden once a PR exists). **The header
  also owns the plan's finish line — Open PR** (`plan-open-pr`, task-open-pr): a deterministic
  host-side flow (push + `gh`, NEVER an agent prompt) that, **for first-time creation only**
  (`openReview` absent), goes through the **compose dialog** (`PrComposeDialog.tsx`,
  `pr-compose-dialog`): the click fetches `pr.preview` and opens editable
  Title (`pr-compose-title`, prefilled from the chat's **real** name — never its first-prompt display label;
  an unnamed chat leaves the host's branch fallback) + Description (`pr-compose-body`, prefilled from the plan) fields;
  only the submit (`pr-compose-submit`, label follows the action — Open PR / Open draft PR) runs
  `pr.open` with the edited `title`/`body`. The dialog closes on success, stays open
  on a generic failure (edits survive the toast), and hands off to `PrSetupDialog` on
  `PUSH_AUTH_FAILED` — whose Try again re-submits the LAST edited title/body (kept in a ref), never
  a re-rendered draft. The header button is primary-filled when the plan is
  *ready* (all done + all reviews settled) and quiet otherwise; once an open PR exists (on v78 the
  host-kept snapshot owns identity/state and a matching `workspace.openReview` answer overlays live details;
  older hosts use the lookup alone, all through panels-owned `resolveBranchReview` so shell and Plan cannot
  disagree) the label flips to
  **Push updates**
  and the button **bypasses the compose dialog entirely** — pressing it (or the next-action `push`
  arm) calls `pr.open` directly with no `title`/`body`, so the host pushes to the SAME branch/PR and
  silently refreshes its body from the plan (`renderPrBody`) while leaving the PR title untouched
  (no `titleEdited`). Re-editing a PR's description each push read as "set up the PR again"; the modal
  is only the creation affordance. When the lookup reports **`unpushedCommits`** the label appends the
  count (`Push updates (N)`), the button turns
  primary-filled, and the next-action banner grows a `push` arm ("N new commits aren't in PR #N
  yet" + Push updates) so new work after the PR never sits silently local — a successful push
  re-reads the authoritative state and clears both when the remote-tracking branch caught up. When the
  lookup instead reports **`behindCommits`** (origin has commits HEAD lacks — the branch **diverged**, so a
  plain push is non-fast-forward and would fail), a distinct **diverged** state takes precedence over the push
  arm and treats it as a **sync conflict, not a force-push cue**: the header button reads **Branch diverged**
  (`data-diverged`) and the next-action banner (`data-kind="diverged"`) explain that origin has commits the
  checkout lacks and must be integrated first — a plain push can't land, and force-pushing would **drop the
  remote's commits**. Both copy the safe `git pull --rebase origin <branch>` (`plan-integrate-command`), NOT a
  force command — it names the exact ref divergence was measured against, not whatever upstream is
  configured. The branch is interpolated only when it is shell-inert in every supported shell (POSIX,
  PowerShell, cmd: `[A-Za-z0-9][A-Za-z0-9._/-]*`); any other name gets a plain-text instruction and no
  copyable command, since no single quoting is safe across those shells. This is deliberate: `behind > 0` only proves divergence, **not** that this checkout rewrote
  history (another checkout may have simply pushed), and the host's own fresh fetch has already moved the
  `--force-with-lease` baseline — so inferring a force-push from divergence could silently delete another
  checkout's work. A genuine rewrite stays an explicit terminal action the app never initiates nor hands a
  loaded command for. `behind` is trusted only on a fresh lookup (the host fetches origin then; see
  [[submodule-server-git]]); the field is additive and backward-compatible (an older host omits it → prior
  behavior). Divergence logic is unit-covered at `countPushDivergence`; the diverged UI state isn't exercised
  by the browser E2E harness, which can't fabricate a detected open PR (real `gh` lookup). Also a **`PR #N` chip**
  (`plan-pr-chip`) links out when the URL is known — which is now every read, since `workspace.openReview`
  carries the review's own `url` ([[submodule-server-branch-review]]); the keyed state prefers it and falls
  back to a url carried over from an earlier answer for the same review, so a chip never loses its link on
  a refresh that reports none. The hook owns the ONE keyed PR state:
  `noteOpenReview(review, url?)` seeds it right after `pr.open` (no separate shadow state in the
  page) and supersedes any read already in flight for the same key, so a pre-mutation answer cannot
  overwrite the mutation result. The keyed state and request generation are shared by every mounted
  hook consumer, keeping the plan and shell scope label on one mutation result. A stale mutation closure
  cannot write through after that hook has moved to another branch.
  Workspace activation explicitly opts into the host's 60-second settled-answer cache with
  `allowCached: true`, while omission on focus preserves the wire's original force-fresh behavior for
  older clients, so a PR closed/merged on GitHub drops out of the chip, label, and stepper on that
  refetch instead of sticking until remount. Focus received while disconnected latches that fresh
  intent and spends it on reconnect rather than falling back to a cache-eligible activation read. The
  workspace's `fsChanged` tick re-reads with `allowCached: true` (`reload`): the host drops its cached
  answer on a `.git` meta nudge, so a PR opened or pushed from a terminal still surfaces, while a fresh
  read would `git fetch`, write `.git`, nudge again, and loop. Cache-eligible reads (activation,
  reconnect, fs tick) are **single-flight** per mount: ticks during one fold into one follow-up, sent only
  while still connected. A stalled host otherwise collected one read per tick until the transport's replay
  cap refused every request. Fresh reads (focus, explicit refresh, CI poll) skip that lane, so a cached
  reload never waits behind a 55s `git fetch` and a refresh is never queued behind an older cached
  answer. Only a fresh read or `noteOpenReview` bumps the generation (`beginRequest(key, { supersede })`):
  a cached read joins the current one, so it cannot void a refresh or poll already in flight, while a
  fresh read voids any cached answer begun before it. Each read also carries a sequence number: a fresh
  answer landing after a cached one requested later keeps that cached answer's branch facts and ahead /
  behind counts, and adds only its review (the fresh PR state and checks). Otherwise a refresh measured
  before a commit would overwrite the newer `aheadOfBase`. A *cached* answer landing after a newer one is
  dropped whole: the shell and the plan pane run separate cached lanes for one key, and a slow cached "open"
  must not restore itself over a newer "merged". Since a cached and a fresh read can share a
  generation, a failed read clears the key (`failRequest`) only when no answer has landed at that
  generation, so a refresh that times out cannot wipe the cached answer that arrived while it ran. The
  URL is kept across refetches while the review number matches. A `compare` result opens the prefilled
  GitHub
  compare page (`window.open`); every outcome toasts, uncommitted files get a separate info toast.
  The `pr.open` request runs with a **180s timeout** (push + gh mutation can outlast the transport's
  60s default) and the header button wears a spinner while any PR work is in flight — the
  **Pushing…** label only during the actual submit (a preview fetch is not a push, and its failure
  toasts "Couldn't prepare the PR", never "Open PR failed"). The uncommitted-files info toast fires
  once, before the outcome branches. Every successful submit starts a fresh shared open-review read
  after seeding any review returned by `pr.open`. It never treats the mutation payload as the final
  unpushed count: the post-push read decides whether the count cleared or newer local commits already
  made it nonzero again. The compose submit also reports whether the title was touched
  (`titleEdited`) so the host never rewrites a GitHub-side rename with the regenerated prefill.
  **Failures that name a fixable setup gap open `PrSetupDialog` (`PrSetupDialog.tsx`,
  `pr-setup-dialog`) instead of a toast**: a `PUSH_AUTH_FAILED` rejection (matched via the
  transport's `wsErrorCode`) explains that the host pushes without a terminal and shows git's
  stderr (`pr-setup-detail`) plus copyable fixes (`ssh-add --apple-use-keychain …` for SSH,
  `gh auth login` for HTTPS); a `compare` result carrying `ghProblem` explains the missing/
  unauthenticated GitHub CLI with install/sign-in commands and offers the compare page as an
  in-dialog link (`pr-setup-compare` — a real anchor, so no popup-blocker risk) instead of the
  blind `window.open`. Both variants keep a **Try again** (`pr-setup-retry`) that re-runs the same
  flow — always with the LAST edited title/body (the runner's `lastSubmit` ref, set on every submit,
  cleared only when the flow fully succeeded, when the user explicitly cancels the compose dialog,
  or when they take the compare-page hand-off (external completion the client can't observe) — a
  `ghProblem` outcome otherwise keeps it, so the gh dialog's Try again actually re-submits;
  reopening Open PR after a failure reuses those edits (including the edited-title baseline, so a
  reopened draft doesn't lose its `titleEdited` flag) instead of refetching a regenerated draft); command rows copy via
  `copyText` (`pr-setup-copy`) and carry a **Run** (`pr-setup-run`) that closes the dialog and
  executes the command in a fresh workspace terminal via the store's
  `addTerminal(workspaceId, initialCommand)` — the pty is a real interactive shell, so
  passphrase/login prompts are answered right there instead of asking the user to find an external
  terminal. Command sets are **host-platform-aware** (the welcome's `hostPlatform`, validated on
  intake and RESET on every welcome so switching hosts can't leave a stale platform; there is **no
  darwin fallback** — a null/unknown platform gets the generic commands: plain `ssh-add`, no
  package-manager guess, a cli.github.com install hint): `ssh-add --apple-use-keychain` / `brew` on
  macOS, plain `ssh-add` + the distro hint on Linux, `$env:USERPROFILE` + winget on Windows — the
  commands run on the HOST, so the browser's own platform is never consulted. A push-auth detail
  matching `Host key verification failed` adds an approve-the-host-key row (`ssh -T git@github.com`
  run interactively) — the ssh-add/gh remedies don't fix known_hosts. A `compare`
  *without* `ghProblem` (offline seam, transient gh failure) keeps the window.open + toast path.
  This dialog is unit/e2e-pinned on the server side (`isPushAuthFailure`, `ghSetupProblem`); the
  browser-side arms need a real broken push / missing gh, so they stay convention-held.
  The **`Summary` card** (`plan-overall-summary`) shows ONLY the agent's plan-level note — fresh via
  `planCompletionSummary` when every step is done, or the stale note via `planStaleSummary` while the plan
  is being redone. It carries **no step/file/review facts** (those live in the header stepper + context
  line, so repeating them here was noise), and it is **omitted entirely when there is no prose** (a
  completed plan whose agent wrote no note renders no empty card). The agent's note still ships to the
  Copy / Save-.md export via `planCompletionSummary`. There is **no in-page "Review mode"** — findings live in the right-panel **Review** tab;
  when the reviewer agent has open comments (`selectAgentReviewCommentCount` — open, `author: "agent"`) the
  header shows a **`N comments`** chip (`plan-review-comments`) that `requestToolView(ws, "review")` to
  focus that tab. Once an item re-opens after a completion the Summary note
  stays visible via `planStaleSummary`, marked stale with an `Updating…` badge (`plan-summary-stale`)
  instead of disappearing, until the agent rewrites it at the next completion — exports stay gated on
  `planCompletionSummary`. `FileRow` (`planFileRow.tsx`, its own module so plan surfaces
  share one row without cycles) is the shared change-set row. Live by
  construction, it reads through the same `useChatTodos` hook as the TODO rail (per-mount fetch +
  `pi.event` refetch), so it cannot show a stale snapshot.
  `TerminalWorkbench` owns one visibility-gated terminal body per semantic terminal identity and
  the host-atomic close flow. A busy close remains one correlated request through confirmation and forced
  retry; dialog auto-close cannot release that request, authoritative catalog removal dismisses stale
  confirmation, and a rejected force clears exactly that request with an error so a later close can start
  cleanly. The workbench close command for a chat routes to `store.closeChatToHistory` (keeps the session
  alive) and shows a
  **chat-history** dropdown (recently-closed + disk-only chats, shown only when non-empty); each row has
  a one-click trash action (`session.delete` → idempotent `store.deleteChat`, no confirm); the
  `session.deleted` broadcast drives the same fold in every connected client. On workspace activation and
  every reconnect, `session.list` first reconciles the client membership snapshot (runtime/cache identities
  plus placed chat/TODO-document references) captured when the read began, so a baseline session now absent
  from the authoritative result goes through the normal tombstone and local-placement prune while a chat
  created during the read survives. Chats referenced by this surface's local workspace view hydrate through
  `session.getMessages` → `messagesToRuntime` → `store.hydrateSession`. Every remaining session enters local
  history without opening or selecting a tab: another frontend creating or using a chat is domain activity,
  not a placement instruction. A failed transcript read raises an error toast and leaves that summary
  retryable in history; a failed `session.list` also raises an error instead of presenting an unexplained
  empty workspace. Both toasts fall silent once reconciliation is cancelled, disconnected, or archived.
  Live hydration deliberately carries no current-disk skill baseline; only disk-only attachment receives its
  captured `syncedTick`. `session.deleted` drives the same idempotent runtime/history/local-placement fold in
  every client; no current-layout push exists. Reopening a
  history row adds its existing session identity to the request-time center destination captured from that
  Group Header (including an empty group); a rejected read leaves the row in history and raises an error
  toast. The workbench shell integration also resolves the history-search **`chatLocationRequest`** deep link
  (see `store/SPEC.md`):
  once its workspace is active, it focuses an already-open tab, `reopenChat`s a live-but-closed one, or
  fetches + hydrates a disk-only one — the reopen flow's two cases above, plus a third case for an
  already-open tab — leaving `ChatView` to consume the request for the scroll + flash (`chat/SPEC.md`'s
  Jump-to-message bullet). **`Toaster`** is the app-wide toast host the shell mounts once: it subscribes to `store.toasts` and
  renders each via the `@thinkrail/ui/toast` primitives, letting Radix own the auto-timeout + swipe/hover-pause
  and routing every close back through `store.dismissToast` (so the store stays the single source of truth).
  Errors persist until dismissed; success/info time out. The **integration piece** — the primitives stay
  presentational.
- **Public surface:** layout-agnostic feature renderers (`ProjectTree`, `WelcomePanel`, file/diff/doc/chat
  panes, singleton side tools, terminal bodies, Settings, and `Toaster`), imported **per-file** so
  Monaco/xterm stay lazy. Tab strips, group headers, side stacks, and center topology are not panel
  surfaces; the shell layout module wraps these renderers.
- **Allowed deps:** `store`, `transport`, `settingsKit` (every Settings block, the walk and the jump),
  `components` (`SkeletonRows` — every async panel's pending
  state renders content-shaped skeleton rows, never a bare "Loading…" line; `highlightRanges` for Settings
  search results), `@thinkrail/ui/*` (incl. `popover`/`command`/`textarea` for the
  dialog), `chat` (`ModelEffortPicker` + the `useModelCatalog`/`useModelPreferences` hooks that feed it,
  reused by `NewWorkspaceDialog` and `ModelsSettings`; `modelPicker`'s `AUTH_KIND_LABEL`, the one
  connection-kind vocabulary (catalog keys) `ProvidersSettings` shares with the picker, and its
  `formatContext` / `groupByProvider`, reused by `VisibleModelsSettings` (`formatContext` by the custom
  server dialog too); `ProviderGlyph`, reused by `ModelProviderTree`, the provider tree of Visible models
  and the context window; `chatPreferences`' message-order default, read by `settingDefaults`; `TemplateEditorDialog`, reused by `TemplatesSettings`; `ExtraUsageNotice`, the
  sign-in notice `useProviderAuth` passes to `LoginDialog`), `auth` (`LoginDialog`, mounted through
  `useProviderAuth` and by `McpSettings`), `@thinkrail/resource-renderers`, `lib`, `themes` (catalog + generic application contract),
  `contracts`; `@remixicon/react`; and the heavy libs each lazy panel owns (`@xterm/*`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

- **Ship — the branch's delivery state and actions, one implementation for topbar and Plan pane.**
  `useBranchStatus(workspace, status)` (the keyed `branchStatusState`, request
  generation, `noteOpenReview`, focus/fs/reconnect freshness rules above carry over unchanged) reads
  `workspace.branchStatus` on a v87 host and falls back to `workspace.openReview` below it. It counts as
  connected only once the welcome has named the protocol, so a reconnect never asks the old method of a
  new host. It exposes the lookup's review — callers resolve it against the snapshot with
  `resolveBranchReview` — with v87's ahead/behind folded onto it, plus the review-free `BranchFacts`.
  `shipActions(t, context)` is the pure derivation of each segment's `{ primary, secondary }` (labels
  rendered with the caller's `useT()` translator) —
  remote arm (Publish / Push N / Sync…) and review arm (Open PR / Create MR / Open draft PR / the
  disabled Merge-locally stub / Settle; on a v88 host Fix with agent / Ready / Merge PR for an open GitHub
  PR and Reopen / Delete remote branch after it) — unit-tested over the full scenario table, as are the
  agent prompt texts it builds (`fixChecksPrompt`, `integratePrompt`). `useShipRunner`
  executes them and owns their dialogs: the shared `PrComposeDialog` (now also used for first-time
  creation from the topbar), `PrSetupDialog`, the diverged Sync dialog, the base-push confirmation,
  `MergePrDialog`, and the remote-branch deletion confirmation. The merge dialog and its toasts name the
  PR's current base from `details.base`, never the workspace's base (a PR can be retargeted on GitHub),
  and make no target claim when it is unknown. Review actions act on the `review` the
  caller shows (its number) and the branch the runner is bound to. **Merge PR** offers only the methods
  the repository allows (every method when the host could not tell) and defaults to the last method used
  for the project — `mergePrefs`, client-side per host + project (a project is one repository), falling back
  to squash → merge → rebase; *delete the branch on GitHub* is remembered with it and starts on, and hides
  when GitHub deletes merged branches itself. **Fix with agent** and the Sync dialog's **Ask agent to
  integrate** hand a prompt to the runner's chat through `openChat`'s `promptWorkspaceChat` — a follow-up
  while that chat streams, otherwise a prompt; with no chat, a new one starts with it — and show the chat.
  Integration may rebase or merge but never force-push or drop commits, and leaves the push to the user.
  The Plan pane's Open PR / *Push updates* / diverged handling runs through the same runner, so the
  `lastSubmit` reuse, `PUSH_AUTH_FAILED`, `ghProblem`, and compare hand-off rules above have one home.
  **Try again** re-runs the mutation that actually failed — a PR submit or a push, recorded when it fails
  and dropped when the setup dialog closes — never whichever PR the user last composed; `lastSubmit`
  only restores the compose dialog's edits, including its description sources, and only on the branch they
  were composed for. Every mutation carries the branch it was made for — the compose dialog's branch at
  preview time, the base-push confirmation's named branch, the failed attempt's branch on retry — and the
  host refuses it once the checkout has moved, so neither a terminal switch nor a retry can push a branch
  the user didn't see or confirm.
  The Plan pane alone asks for its plan body explicitly (`bodySource: "plan"`, so a plan of adopted commits
  only still opens on it) and keeps its plan-specific emphasis and its body-refreshing *Push updates*
  (`pr.open` without a body); the topbar's Push is `workspace.push` and never touches a PR description.
  **Compose sources:** the dialog's *Description from* switch re-fetches `pr.preview` with `source` —
  *Chat plan* (default when the session has a plan; the active chat's session from the topbar), *Commits*,
  *Template* (the host's discovered PR/MR templates, one picker), *Empty* — and **Generate with agent** /
  **Fill template with agent** (`pr.generate`) replaces the field's text with the host's one-shot draft;
  nothing is pushed until submit, and a `null` draft toasts instead of clearing the field.

## Get right

- **Workbench tab chrome is not a feature panel.** The shell layout module supplies one selected-tab
  grammar to every group: `control-bg-selected` behind the whole selectable tab, `text-default`, and a
  **2px `primary` marker spanning the tab's full width** on the bottom edge (`after:inset-x-0`, flush
  with the selected fill — no horizontal inset). Inactive tabs stay transparent with muted text; hover
  uses `control-bg-hovered`; keyboard focus keeps its separate focus ring. The marker is a shape cue, not
  merely a text-colour change, so selection remains obvious when a high-contrast theme makes neighbouring
  surfaces equal. The grammar also supplies bounded one-row overflow and the complete WAI-ARIA tabs
  pattern with roving focus and labelled tabpanels. Panel renderers provide title/icon/status/close
  metadata and fill the selected tabpanel; they never read group order or draw their own docking strip.
  The shared `ToggleSegment` (List|Tree, Split|Inline, and the resolved resource candidates) borrows the same
  `control-bg-selected` fill + `text-default` for its active segment (no bottom marker — a slim toggle,
  not a tab), so "selected" reads the same everywhere and never derives a parallel surface token.
- **File and diff panes dispatch; they do not classify formats.** Each describes the host metadata,
  resolves the registry for its intent and phone class, lazily mounts the selected candidate, and keeps
  `rendererId` plus opaque view state on the tab. The lazy implementation identity includes renderer id and
  phone class, so crossing the breakpoint swaps the code implementation and discards incompatible state.
  Scroll-backed view state goes through the renderers' one `useScrollViewState` hook ([[module-resource-renderers]]): the offset is saved when the
  scroller detaches and re-applied when a scroller attaches. A renderer may fill its scroller only after
  mount — the Pierre surfaces render nothing until their shared worker pool has initialized — so a
  restore the scroller cannot yet hold stays pending until its
  content grows to fit or the user scrolls, and a pending offset is what gets saved if the tab leaves
  first. Without that hold, a tab switch back to a source diff landed at the top and then persisted 0.
  Two or more candidates become one ordered toggle whose ids are the test hooks. Threads whose selectors
  the selected renderer cannot place for the pane's view or diff intent remain visible in an unplaced
  strip; its action switches to the first candidate that advertises matching anchor geometry for that intent.
  Bundled registration happens once in the shell's `AppResourceHost`, while renderer implementation imports
  stay lazy.
- The singleton side-tool renderers are **Projects | Specs | Files | Review** (the changed-files list is
  Files' **Changed** mode, not a tool of its own). Their current
  location and local selection are supplied by the shell; Review exposes its store-derived pending-draft
  count as tab metadata. A renderer remains the same when its singleton moves to the opposite side.
- **`ReviewPanel`** is the review sidebar (see [[submodule-server-reviews]] for the model) — **ONE screen, a per-file ACCORDION**: each row a path +
  draft/sent/resolved counts with a fold chevron; **clicking a row unfolds its comments in place AND
  opens the file's tab** (folding is a second click and navigates nowhere — the row is the only
  toggle; the one other row action is below). A file whose comments are ALL resolved **stays listed**
  until the user finishes it explicitly: the ROW itself grows a **Done check glyph** (inline after
  the counts — visible folded or not; a strip below holding one glyph read as stray space), which
  calls `review.fileDone`, and only that removes the file (`Review.doneFiles`; a new comment
  re-opens it). An unfolded section shows the file's comments in
  the TODO plan's exact section flow, built from the SHARED plan atoms (`chat/planKit`:
  `SectionLabel` + `PlanStatusIcon` — the same pieces `TodoList` renders with). **The reviewer
  agent's comments and the user's ride ONE lifecycle** — the only difference an author badge
  (`review-comment-agent`: a `Bot` + "ThinkRail" chip): they share the same sections, glyphs,
  navigation, per-row send/delete/resolve, and draft counts (`fileDraftIds`/`allDraftIds` and the
  host's implicit `sendableComments` are all author-agnostic; the verdict's fix package still sweeps
  any agent draft the user hasn't already sent). Sections, by status — **Drafts** first (the
  user's actionable, unsent remarks; the call-to-action sits under the file's `Send review (N)`
  strip, not buried below sent rows) → **In
  progress** (the sent — the chat took them; the glyph is GLANCE-AWARE exactly like a TODO's
  in-progress item, via `sessionGlance` + `TodoList.glanceIcon`: working dot / **(?)** while the
  session waits on an `ask_user_question` / pause when it's idle on the user — no loaded runtime reads
  as waiting) → **Resolved** (muted Done styling: primary check + struck hint text;
  the chat action reveals on hover — resolved is final, no reopen). No per-row status words — the section names the status; rows carry
  only the glyph, the clamped text, and the `L3` ref (+ an `outdated` eyebrow when the anchor died,
  whose native tooltip — `outdatedReason` from [[module-resource-renderers]], shared with the thread card's label — says what
  could not be re-found, by the anchor's own selectors: text that was not matched again, a position in
  bytes that changed, or a whole file that is gone. The wire carries no cause, only the state, so the
  text and byte wordings both admit "or the file is gone" rather than claim a precision the client does
  not have; the rule itself is [[submodule-server-reviews]] re-anchoring step 4).
  The locally selected center resource's section **auto-unfolds** when it is a reviewed file, and an
  expansion never auto-collapses (folding is the user's gesture alone — a send opening its chat tab must not
  fold the section the user was reading); **Drafts rows are numbered** (1., 2., …) instead of wearing
  the pending glyph — and the workbench tool router **reveals the Review tool** when such a tab is
  ACTIVATED (keyed on the local selected-resource change, so a draft saved in an already selected resource
  never yanks attention; `selectActiveReviewedPath` is the shared derivation). The reveal never takes
  keyboard focus (`focus: false`): a file's first draft also makes its tab "reviewed", and a reveal that
  focused the Review rail pulled a just-saved keyboard comment away from its line. Each
  comment row is a **navigation gesture**, one rule for every author: a row with a linked chat
  (`comment.sessionId`) opens **the discussion** (its chat tab); one without — every draft, since a
  draft is never sent — opens the file **focused on the comment**. The file stays one hover-action
  away (the `FileText` glyph runs the file+focus navigation; the chat glyph is gone from open rows).
  The file focus works through the store's `reviewFocusRequest`, which names the surface the row opens
  (`inline` file, or `diff` with its scope) so an already-mounted pane of the other kind or another base
  cannot consume it. The pane consumes it exactly once: Monaco reveals the anchor line, including on a
  fresh mount (immediate scroll from the mount's layout effect; see the resource-renderers SPEC mount
  rule), and the preview scrolls the in-flow card into view. **No editing here** — the in-file card is the editor;
  the row's action icons (their own layer, never triggering navigation) are per-row **Send** (→
  `review.sendComment`, opens the created chat tab via the same
  `openChatSession` tail as New Workspace), **Delete for DRAFT rows** (ConfirmPopover →
  `review.commentDelete` — an unsent remark is the user's own scratch), **Open chat** for sent rows
  (reuses the history-reopen flow), and the manual Resolve override (`review.commentUpdate`). **Once
  sent, a comment is a record — no delete, no rollback, no reopen** and resolved is final
  (server-enforced): pushing back on a change is said in a comment, and a fresh remark is a fresh
  comment. **A plain list — no footer**: batch send lives in
  the pane toolbars (`SendReviewButton`) and in the panel itself — each unfolded section's strip
  carries the same per-file `Send review (N)` (`testid: review-panel-send`; `path: null` covers the
  anchorless whole-change-set bucket), the panel header a **`Send all (N)`** across every file
  (`SendAllReviewsButton`, `testid: review-send-all`, over `allDraftIds`; no ids passed — the host's
  "all drafts" is the batch, so the count can't race a concurrent edit). **The header (and its Clear)
  follows the review's RECORDS, not its file rows**: it shows whenever the review holds ANY comment, so
  finishing every reviewed file — which empties the accordion while resolved/sent records live on — still
  leaves a way to close the review (the earlier files-gated header stranded a fully-finished review with
  no Clear). `Send all` stays gated on drafts; **Clear** (`testid: review-clear`) is a destructive
  `ConfirmPopover` that calls the server-atomic `review.close` Clear; the host archives non-draft records,
  discards drafts, replaces the active review, and publishes the fresh empty snapshot, so the initiating
  and sibling clients all converge through `review.changed`. The empty body distinguishes the two empties:
  **records remain but every file is done** ("…finished — Clear to archive…") vs a **truly empty** review
  ("No review comments yet…"). There is no archive browser. The review-level
  (overall-note) composer was removed for
  now (the `review` comment kind stays in the model, UI-less). The `review.get` hydration read is **owned by
  the workbench tool integration**, outside the conditionally mounted Review body (`useWorkspaceReview`, the
  `useWorkspaceSpecs` pattern — the read also re-anchors server-side): tab flags and the Review badge need
  the snapshot even while the panel body is unmounted.
  Every client converges on `review.changed` pushes folded into the store; nothing here
  mutates optimistically. Comment authoring is **selection-triggered, no mode toggle**. Renderer
  implementations project `SurfaceReview` anchors and never rewrite them. The shared React
  `ReviewComposer` owns the textarea, Save draft / Send now / Cancel actions, busy state, focus, and
  cursor placement; `PreviewCommenting`, Pierre `FileDiff`, and Pierre `File` place that same component
  in their own geometry. A saved draft carries a raw-file `lineRange`; an unlocatable rendered-preview
  selection produces an empty selector set and therefore a whole-file comment. `useFileReview` combines
  the draft with path, scope, and the surface's **side** (the host fills `contentHash` and the
  drift-tolerant `textQuote`); Send now additionally fires `review.sendComment` and opens the created
  chat.

  **Pierre owns every diff and every phone-class code file.** Threads with a `lineRange` become
  `lineAnnotations` at the range's end line (`base` → `deletions`, `worktree` → `additions`) and render
  `ReviewThreadCard`; annotation metadata and arrays preserve comment-id identity across unrelated
  review pushes. Because Pierre keys React annotation wrappers by array index, each mount keeps
  append-only comment-id slots with tombstones and reserves the always-present first slot for the composer.
  Line-number selection and the gutter utility open a composer on that exact side. A
  selection crossing both side spaces (unified view, a drag from a deleted line into an added one) opens
  **no composer**: the composer slot shows `review-selection-blocked` — "a comment anchors to one side
  of the diff" — with the user's own selection still highlighted and a Dismiss, because an anchor on a
  side the user did not choose would be a silent re-pointing, and a coordinate translation between the
  two side spaces does not exist. Focus requests scroll the matching
  annotation into view before `onFocusHandled`; a thread without `lineRange`, or whose endpoint is hidden
  in Pierre's initially collapsed unchanged context, never enters Pierre and remains in the pane-level
  unplaced strip, which consumes any focus request for it. Pierre `File` applies the same annotation, selection, focus,
  and unplaced rules on phones, reporting as placed exactly the threads whose end line exists in the
  current text (`filePlacedThreadIds`) — Pierre emits annotation rows only for existing lines, so a thread
  pointing past a shortened file would otherwise vanish from both the surface and the strip. Review attaches only where the modified side is the worktree (`branch`,
  `uncommitted`, or `pinned`); commit scopes are historical and receive neither review authoring nor hunk
  mutations. A diff's deletion and addition columns remain two authoritative anchor spaces: original-side
  selections create `side: "base"`, modified-side selections create `side: "worktree"`, and neither is
  remapped to the other side's line numbers.

  **Pierre diff text-selection crash (WebKit) — a vendored `@pierre/diffs` patch.** Drag-selecting code
  in a review diff crashed WebKit's web-content process (Electrobun desktop: "A problem repeatedly
  occurred"; `EXC_BREAKPOINT` in `WebCore::EventHandler::handleMouseDraggedEvent`). The root cause is a
  WebKit regression from 307588@main (WebKit bug 307875): `handleMouseDraggedEvent` holds a `CheckedPtr`
  to the drag target's renderer across `hitTest()` / `updateStyleIfNeeded()`. A `<slot>` moved
  synchronously from `pointermove` invalidates the shadow host's style, that update destroys the
  renderer, and the `CheckedPtr` crashes. A Pierre-free page reproduces it; a moved plain element or the
  same slot move deferred to a frame does not. Pierre's `InteractionManager` moves the gutter utility
  into the hovered line's number cell whenever the hovered line changes and removes it on
  `pointerleave`. Only a custom `renderGutterUtility`, which we use, puts a `<slot>` in that node; the
  default gutter button does not crash, and the crash does not depend on diff size. Invariant: a Pierre
  surface never inserts, removes, or moves a `<slot>` synchronously from a pointer or mouse handler; the
  keyboard line cursor, whose `selectedLines` move the gutter utility too, applies them a frame later.
  `patches/@pierre%2Fdiffs@1.6.4.patch` (root `patchedDependencies`) makes placement a no-op while a
  mouse button is held outside Pierre's own selection session — armed by `pointermove` and by
  `pointerleave`, so a drag whose first move already exits the diff cannot remove the slot — and the
  first button-free move re-places the utility, even on the row where the drag ended. Upstream tracking:
  pierrecomputer/pierre#1184 and WebKit bug 330739. Removal gate: a Pierre release stops moving the slot synchronously during a
  pointer drag. A WebKit fix alone is not enough: the desktop app uses the system WebKit, and users update
  macOS late. The same patch also fixes `FileDiff.trimColumnRows`: when a virtualized window's end
  shrinks, Pierre trims the annotation and no-newline rows trailing the last kept line along with the
  dropped lines, and later appended chunks never re-emit them, so a composer, thread, or toolbar on that
  line stays hidden while the line is still rendered. Rows trailing a kept line now stay; separators,
  which precede their line, still go. Removal gate: a Pierre release that keeps those rows. Bun applies
  a patch only to its exact version and skips a mismatched one silently (install succeeds and the
  lockfile drops the entry), so Chromium e2e tests that fail without the patch are the guards. Crash
  half: "a text-selection drag leaves the comment button on the line it started from" and "… that leaves
  the diff on its first move keeps the comment button" in `e2e/review.spec.ts`. `trimColumnRows` half:
  "a diff composer stays shown while a scroll-up shrinks the virtual window to its line" in
  `e2e/changes-review-drafts.spec.ts`. A Pierre bump keeps them green; delete the patch file and its
  `patchedDependencies` entry only when both removal gates hold. Turbo hashes `patches/**`, so an edited
  patch rebuilds the web bundle instead of restoring a stale one from cache. The crash tests' controls
  (the utility sat on the start line; the selection holds the dragged text) keep an emptied layout from
  passing — earlier `display:grid` bisections "fixed" the crash only that way. The crash itself
  reproduces only in WebKit (a temporary Playwright `webkit` project). Tracked in #683.

  **Monaco renders desktop files only.** `reviewWidgets.ts` keeps its content-widget selection affordance,
  context-menu action, decorations, and view-zone reconciliation for that one surface. It exposes stable
  zone nodes keyed by comment id; `MonacoReviewZones` portals the shared React `ReviewThreadCard` and
  `ReviewComposer` into them, while `ResizeObserver` feeds their measured heights back to Monaco. An
  unrelated push therefore keeps the same keyed draft textarea, including the shared card's Escape-cancel
  and shortcut-save behavior. `Mod+Shift+M` comments on the selection, or on the caret's line when nothing
  is selected; the context-menu entry still needs a selection. A closed composer or a card's save,
  discard, Send or Delete returns focus to the editor (at the card's line). Threads without a `lineRange` stay in the same unplaced
  strip. `monacoMenuIcons.ts` decorates Monaco's standalone file-editor menu; no diff editor or diff-side
  branch remains. **Rendered preview**:
  `MarkdownPreview` splits the stripped document at each insert's
  anchor and splices it between the markdown segments (`splicedSegments` — the inline-edit split
  pattern; a cut **never divides a multi-line construct**: an anchor inside a fenced code block or a
  GFM table snaps to that construct's last line (`sourceLines`' `indivisibleSpans` + `snapSplitLine`),
  so the card lands *after* the block it comments on and both halves stay whole documents — half a
  fence is not a document, its unclosed opener rendered the whole remainder of the file as code for as
  long as the comment lived; lists and blockquotes divide into two well-formed constructs, which is
  what a card between two items should be; an unlocatable line appends after the document, never
  lost) — the inserts being the saved
  cards AND the open composer (in-flow under the selected block, via `PreviewCommenting`'s
  children-as-function contract; only the transient icon stays floating). **Region parity with
  Monaco**: the blocks under every unresolved comment — and under the composer's target while open —
  wear `.review-region` (`markReviewRegions` — a thin LEFT RAIL only, the gutter-rail half of
  Monaco's decoration; **never a background wash**: a full-block wash read as a broken text
  selection — picking three words in a bullet painted the whole bullet wall-to-wall; leaf-most BLOCK
  elements only). Preview anchoring is **exact**: `sourceLines.ts` (adopted from
  inline-edit) stamps elements with remark source positions in RAW-file coordinates
  (`sourceLineRehype` tuple-form takes each segment's offset — segments re-parse from line 1; via
  `chat/Markdown`'s `rehypePlugins` prop) and the composer resolves selections through the stamps (a
  boundary-only end block is replaced by its previous stamped sibling), falling back to
  `previewAnchor`'s phrase search for unstamped content. The sidebar remains the full-detail surface. **Review presence is self-announcing and
  PER-FILE**: a center resource tab (file or diff) whose path is still in review wears a `Review` flag with
  **two states** (`ReviewTabFlag`, over the one `reviewFlags` derivation) — accent
  (`tr-text-eyebrow text-primary`) while the file holds an **unsent draft**, muted (`text-text-subtle`)
  once only **sent** comments remain; resolved/dismissed drop it entirely. Two states, not
  present-or-absent, because *"in review"* and *"there is something to send"* are different facts, and
  the rest of the review vocabulary already counts draft-**or**-sent as in review (`fileSummaries`,
  `selectActiveReviewedPath`, `fileThreads`) — a drafts-only flag made a file the chat was actively
  working through look identical in the tab strip to one never reviewed, while the rail insisted it
  was in review. **`Send review (N)` stays strictly drafts-only and PER-FILE** — the file or diff pane's
  resource toolbar carries the text button (`SendReviewButton`, over the one `fileDraftIds` derivation): the count and the send are
  exactly THIS file's drafts, batched into the file's own review chat (one chat per file — the host
  pins it in `Review.fileSessions` and later sends `followUp` there), which **opens immediately** (the
  host fires the package into the session detached — see the reviews SPEC's send-latency note). Other
  files' drafts stay put; each pane carries its own button, and the Review panel shows the same
  button in each unfolded section's strip (the panel header adds the cross-file `Send all (N)` —
  see above). Offering it with nothing left to send
  would be a lie, so an in-progress file keeps its muted flag and grows no toolbar. A pane over an
  uncommented file shows neither. There is no manual review mode to enter. Every send affordance (composer Send now, thread cards, sidebar rows/footer, tab
  Send all) goes through the one `reviewSend.ts` pair (`sendReviewComment`/`sendReviewBatch`: request
  → show the chat tab → toast on failure), and the panes integrate via the one **`useFileReview`** hook,
  passing its anchor-keyed `worktree`/`base` surfaces through the registry props. The hook keeps a file's thread
  arrays, and with them both surfaces, while their threads are unchanged (`sameThreads`): every review push
  replaces the workspace's comment list, and rebuilding each open file's threads from it handed every mounted
  renderer a new `review`. Monaco, which the compiler skips, re-rendered twice for one comment on another
  file (`e2e/perf/reviewThreadIsolation.perf.ts` pins it at zero). The pair, the hook and
  `SendReviewButton` take an optional chat session id: without it the host routes each file to its pinned
  review chat, creating one on its first send. Open tabs never supply an implicit override: a sidebar or
  file-pane send must not move an existing discussion into an unrelated chat, and Send all must preserve
  per-file routing. With an explicit id — a file shown in a chat tool card, whose `ResourcePreview` reads
  the chat's scope — that `sessionId` wins over the pinned chat, so feedback lands in the chat that showed
  the file. This does not infer file authorship from turn snapshots, which cover the whole workspace's
  interval rather than exclusive writes. The shell's `AppResourceHost` exposes exactly these (bound per call) as the
  renderers' `FileReview` / `ReviewSend` host capabilities.
  A batch answers with EVERY session it touched (one per group), so a multi-file batch opens every chat
  it started and focuses the first — a chat the user never saw would still be an agent working on their
  comments. **Showing each chat forks on the result's `reused` flag:** a chat this send CREATED opens straight
  from the result (`openChatSession` — no round-trip, and its runtime exists before the first streamed
  event), while a **reused** one goes through `openChatInTab`'s tab→runtime→disk escalation, because it
  may be a chat this client has never seen (a second client, or this one after a reload — review state
  and pi transcripts both outlive the host); opening that as new would show a blank conversation for
  comments already marked sent.
  **Sidebar navigation goes to the surface the anchor is READABLE on** (one derivation,
  `reviewModel`'s `ReviewSurface`: `commentSurface` for a row, `reviewFileSurface` for a file row —
  which picks the diff only when *every* unresolved comment on that file is base-side): a `base`
  anchor's lines index the pre-change blob, which only Pierre's deletion side renders and only it
  mounts `base` threads, so it reopens a **pinned diff on the anchor's own `baseRef`**
  (`GitDiffScope.kind: "pinned"`, wire v30: worktree vs one immutable commit) — never the scope it was
  captured in, which re-resolves against the current fork point/`HEAD` and moves out from under the
  comment when the worktree commits or the review target is re-pointed (the old card would mount on a
  different blob at stale line numbers). A comment saved before `baseRef` was stamped falls back to
  its captured scope, then to the workspace's current one. Routing every row to the file
  tab put base remarks on worktree lines that say something else, with no card and a focus request
  nothing consumes.
- **Live refresh (the worktree panels follow the disk).** Every workspace-scoped read goes through one
  hook — **`useWorkspaceRead(workspaceId, read, handlers, readKey?) → { reload }`** — which owns *when* to read
  (workspace change, that workspace's `fsChangesByWorkspace` tick, a **`readKey`** change, or `reload()` for a manual Refresh) while
  the caller owns *what to do* with the outcome (`onResult` / `onFailure` / `onSwitch`). Centralized because
  each site was otherwise re-implementing the **stale-response guard**: an answer in flight when the caller
  moves on must not land in the new workspace's view. Reads are **single-flight** (`createSingleFlight`,
  unit-tested): one read in flight per mount, and ticks or `reload()` that arrive during it fold into one
  follow-up with the latest inputs. Each tick otherwise started its own request, and a slow host (a stalled
  `git`) let them pile up until the transport's per-client replay cap refused every request. A read whose
  identity (workspace, `readKey`) is unchanged still delivers its result or failure even with a follow-up
  queued; dropping it would starve the view whenever ticks arrive faster than the read. An identity change
  or unmount silences it. A `null` workspaceId reads nothing, which is also how a component expresses a
  *paused* read. A visible `FileTree` directory probes while collapsed only as far as needed to identify
  its compact single-directory run; descendants below the run's deepest directory mount and read only
  when that compact row is expanded. No tick has to be threaded down as a prop.
  The wiring of this hook and `useLiveTabContent` (ticks during a slow read, a workspace or file switch
  mid-read) is tested in `liveReads.test.tsx` by mounting real hooks through
  `react-dom/client` on a headless container: a tree that renders no host elements needs only a stub
  `window`, so the web package needs no DOM library or testing dependency.
  Its users — `FileTree` (root + each visible directory chain), `FilesPanel` (`git.status`, via
  `useGitStatus`, feeding both modes),
  `useWorkspaceSpecs` (`spec.graph`) — plus `FilePane`/`DiffPane`, which follow the same tick contract per
  open tab. Agent edits,
  terminal commands, and Finder changes all land without a manual step.
  Three shapes keep its effect's dependency list **honest** (no exhaustive-deps exemption anywhere in it):
  the fs tick is consumed as an **event** (`useAppStore.subscribe`) rather than selected into the component —
  so it triggers a re-read without being a render input, and consumers stop re-rendering on unrelated
  worktree churn; the **reset is the effect's cleanup**, which closes over the workspace being *left* (the id
  a reset actually needs — a plain effect keyed on `workspaceId` runs with the *new* id already in scope);
  and a manual refresh is an **imperative `reload()`**, not a nonce dependency. `readKey` is the read's
  **second identity dimension**, for a read parameterized by more than the workspace — `ChangesPanel` passes
  `${scopeKey}:${targetRef}`, so switching the diff scope or re-pointing the target branch resets and
  re-reads exactly like a workspace switch, and one scope's list can never linger under another. `onFailure`
  receives **the rejection**, not just the workspace id: a caller that reacts to one *named* failure (see the
  vanished-commit rule below) must be able to tell it from a timeout or an unnamed host failure.
  The one read that deliberately does **not** go through this hook is `ChangesScopeMenu`'s lazy pair — they
  are *open*-triggered, not tick-triggered — so the menu is instead **keyed by its full identity,
  `(workspaceId, targetRef)`**: its commit rows are `git log <base>..HEAD`, so re-pointing the target changes
  which commits exist, and the remount clears rows that belonged to the previous pair while neutralizing any
  response still in flight for it. Within one mount the pair is **generation-stamped** as well, so two opens
  in a row can't let the earlier answer overwrite the later one. It is
  **identity only** — what makes a re-read happen, never what the read reads *with* (the parameter lives in the
  caller's `read` closure, which the hook re-captures every render, so the value a re-read uses is by
  construction the one the key names). It is threaded to `read` (and `reload`) as an argument for a caller that
  would rather branch on it than close over the parameter; ignoring it — as `ChangesPanel` does, its `scope`
  being an object the key merely names — is expected. Refetches **preserve view state**: `FileTree` re-reads
  the root + the directory probes backing each visible compact row and expanded branch. Expansion lives
  above individual rows (in the store, so it also survives remounts and reloads) and is keyed by every
  directory path a compact row represents, so shortening or
  lengthening a chain cannot hide descendants that were visible before the refetch; vanished dirs drop out
  via their parent. `FilesPanel` re-reads
  `git.status` (list-only — the diff renders as a center resource, not under the list), `SpecsPanel`
  refetches without remounting (expansion survives), and `FilePane`/`DiffPane` re-read an
  open resource's content when the workspace ticked past its loaded tick (live while visible;
  background tabs catch up on local selection — only each group's selected body is mounted; a failed re-read — file
  deleted — keeps the last content, no auto-close; a diff tab whose file left the change set likewise
  keeps its last contents — the Changes list is where the disappearance shows). `FilePane` and `DiffPane`
  run the **one** tab-content live-refresh contract — the shared **`useLiveTabContent(tab, {read, applyFresh,
  keepCurrent}, reloadKey?)`** hook — differing only in the read method (`fs.readFile` vs `git.diffFile`) and the store
  workspace-qualified write (`updateFileTabContent` vs `updateDiffTabContent`, each receiving the captured
  workspace because opaque cache ids may repeat across workspaces). Its one-batch skip ("this file isn't in it—just
  advance the tick") requires the batch to have **named** files: a **pathless** frame (`paths: []`, the host's
  ref-move nudge) always re-reads, since path membership says nothing about a change that touched no file —
  that is what keeps an open `uncommitted`-scope diff honest when a terminal `git commit` moves `HEAD`.
  `reloadKey` is the hook's **second live dimension**,
  for a tab whose content depends on something besides the files: `DiffPane` passes `selectDiffTabTargetRef`,
  so re-pointing the review target re-reads a **branch-scope** tab at once instead of lagging until the next
  fs tick (a commit scope has no such dimension — its sides can't move). The re-read keeps the tab's existing
  tick: it answers "what does this tab mean now", it does not observe a file change. The two dimensions are
  two effects, so **two reads can be in flight at once** (a slow tick re-read, then a re-point); both take a
  turn from **one per-tab sequencer** (`createReadSequencer`, unit-tested) and a response is written **only
  while no later read has started**. Otherwise the network picks the winner: resolving out of order, the
  older read lands last and overwrites the newer target's content while carrying its own honest — but now
  stale — stamp, so neither effect sees any drift and the pane keeps the old target's diff under the new
  target's label indefinitely. Dropping the superseded read costs nothing: the read that superseded it is
  the one the user is waiting for. Tick reads are single-flight per tab: a tick that lands while the
  same path is being read waits, the read applies at the tick it started for, and a newer tick re-reads once
  after it settles. A read superseded before it applied (a remount, `reload()`, or a re-point) also
  re-checks the tick, so the tab never stays below it with nothing in flight. `reload()` is a tracked
  read too: it supersedes the tick read, makes later ticks wait, and applies at the workspace tick it
  started at. Stamping the tick at settle time would mark content read before a waiting tick as current,
  and the tab would stay stale. The read logic lives in `createTabReader`, unit-tested without React. Cancelling the slow read on every tick kept `loadedTick` from ever advancing, so each
  tick refetched. The re-point read takes the tick from the tab when it settles, so a tick landing mid-read
  does not cancel it. Panels are mounted only for the active workspace,
  so scoping is natural. A degraded host watcher pauses automatic invalidations until the next workspace
  read re-establishes it; editable-file conflict handling waits for `fs.writeFile` (the viewer is read-only today).
- **`useWorkspaceSpecs` owns the `spec.graph` read** (one fetcher, one definition of "this file is a spec"):
  the snapshot lands in the store (`specsByWorkspace`), not panel state, because the chat's turn divider
  needs the same answer to route its chips. It is called by **the workbench tool integration**, not by `SpecsPanel` — the
  panel body only exists while its tab is showing, so owning the read there would mean a user sitting on
  Changes stops the graph tracking the worktree, and every spec the agent writes gets counted as a changed
  file (the split silently undone by a tab selection). Being keyed per workspace, a switch shows that
  workspace's last known tree while the re-read is in flight (there is nothing to reset), and the failed-read
  flag is workspace-scoped so it can't leak a hint over a sibling's good tree. It returns `{ failed, reload }`
  — `SpecsPanel`'s error-only Retry calls `reload` directly, so no retry counter has to be held in panel state.
- `SpecsPanel` is the read-only spec-graph viewer — a pure reader of that snapshot. One fetch per
  workspace activation, refetched automatically on the fs tick, rendered as the **`parent` tree** (roots =
  no/dangling parent; default-expanded). There is **no persistent Refresh control or panel toolbar row**:
  routine synchronization is automatic. A fetch **failure renders a distinct inline error hint with Retry**,
  never the "No specs" empty state — offline and empty are different answers. With a previous snapshot, the
  hint sits above the retained tree; without one, it replaces the loading state. A **finished task-spec**
  (`type: task-spec`, `status: done`) is left out of the tree, as the spec tools leave it out of search
  ([[submodule-spec-graph-core]]); the host still reports it, and the Artifacts tool lists its file. The tree build (`specTree.ts`)
  assumes a well-formed graph — **parent cycles are `spec_validate`'s problem, not the viewer's** (cycle
  members are unreachable from any root and simply don't render) — but the walk is **visited-guarded**,
  so a malformed graph can never hang or loop the UI. Tree only in this slice — no cross-edge display,
  no editing, no validation badges, no graph canvas.
- `SpecsPanel` is a compact **document-first tree**: spec nodes are container **and** document, so the
  controls make both roles explicit. Hierarchy uses fixed per-depth indentation + chevrons, deliberately
  **without connector rails or branch elbows** (persistent lines overloaded the narrow rail). The padded
  **chevron alone** expands/collapses (→ / ← from the keyboard), while the rest of the row is a native document button whose
  **single click previews** the rendered spec — and whose **double click keeps** it — through the same
  `fs.readFile` → `openTab` flow as `FileTree` (see the Preview tabs bullet; reading down a spec graph is
  the case the reusable slot exists for). Every row stays on one line: indentation → chevron →
  shape-coded role icon → truncated title → trailing role (`ARCH` / `MODULE` / `SUBMODULE` / `TASK`;
  unknown types degrade compactly). The role is **revealed on row hover/focus**, untruncated, and the
  `aria-label` carries it unconditionally. Titles render through `specDisplayTitle`, which collapses a
  title's ` — ` / ` – ` separator to **` · `**. The top-level `goal-and-requirements` row
  instead carries the exact **`Main spec`** label and distinct root icon; a locally selected file resource's row has a persistent selected
  treatment. **Lifecycle status is not presented at all** — future lint health arrives with a real linter
  feature, not speculative dots or reused status chrome. This remains a restrained hierarchy — no hero,
  duplicate root, preview pane, or graph canvas. `FileTree` shares the same file gesture model
  (preview/keep) but keeps its own directory behaviour — a whole-row click toggles dirs, no collision
  there. File and folder rows also carry the copy-path, Copy / Paste and Delete context menu described with
  `FilesPanel`.
- **`ArtifactsPanel` is the Artifacts tool's body** — a reader of the host's artifact index
  ([[submodule-server-artifacts]]). Like specs, the `artifacts.list` snapshot lands in the store
  (`artifactsByWorkspace`) through **`useWorkspaceArtifacts`**, which the workbench calls for every
  workspace (chats included) so the rail can show new arrivals while the tool is hidden; it re-reads on the
  host's `workspace.artifactsChanged` nudge and on reconnect (`selectArtifactsTick`, passed to
  `useWorkspaceRead` instead of the fs tick, because the host already reconciles on file changes and an fs
  tick per agent edit would re-list for nothing). The panel is two sections: **Artifacts**
  (files under `.thinkrail/context/`) and **Other agent files · ignored** (one row per ignored output,
  newest first, a folder lazily expandable through `fs.readDir`, with its file count), hidden by the
  header's eye toggle. Artifacts shows as **Outputs**, **Smart**, a **List** or a **Tree**, picked from one
  dropdown on the toolbar's right (four views outgrew segments); `selectArtifactsView` resolves the
  per-client `artifactsView`: the user's explicit choice while it is offered, else Outputs while it is
  offered (host v128 and the `outputs` extension not switched off, `selectArtifactOutputsOffered`), else
  Smart (host v124), else List. A stored Outputs choice survives the extension being off and returns
  with it. The toolbar (`ArtifactsToolbar`, which takes the views it offers) stays one row at any sidebar
  width: when its content overflows it folds the secondary actions (Collapse all, the ignored toggle,
  Paste) into a **More** menu — the dropdown itself never folds — and unfolds once the width it needed is
  back (measured with a `ResizeObserver`, refolded from scratch when the actions or the current view
  change) — a fixed breakpoint cannot, because the actions come and go.
  **Outputs** answers *what did the agent hand me*, the literal shape of Claude's Outputs list: the live
  artifacts the host flags `published` ([[module-ext-outputs]]), one flat list newest first, no folders,
  counts or marks; a row is a 16px type icon, the display name and the type (`outputFileLabel`: a known
  type drops its extension and reads `_` as a space, anything else keeps its name and reads "File"), the
  folder appearing only when that name and type repeat (`artifactsModel.outputEntries`); the name is muted
  until hovered or open. The heading "Outputs" is the panel's stronger section title, without a count.
  Rows keep the shared menu, open gestures, inline rename, hover title (path and change time) and focus
  markup; a deleted output leaves the list (List and Tree keep it with Restore). With none published it
  reads "No outputs yet" and offers **Show all N files**, which switches to List; an extension panel's
  *Open in Artifacts* (`artifactActions.revealArtifactsListing`) leaves Outputs for List the same way,
  since what an extension writes is not published.
  List answers *what is
  new*: newest first, a two-line row — the name, then the folder inside the artifacts folder — or
  `Task spec · <status>` joined from the spec snapshot by path — and a chip naming the writing chat that
  opens it; no relative age, since the order already says what is newest. Tree answers *where is it*: it
  is built by `artifactsModel.artifactTree` from the same filtered rows, never from `fs.readDir`, so deleted
  rows, attribution, the new-dot and task-spec status survive (a real artifacts folder reached 1 700
  records in 114 folders, which the flat list renders as 1 700 two-line rows). Folders come first, A→Z
  like Files; single-folder chains compact (`folderChains`); a folder shows its file count, the new-dot while collapsed and holding a new file, and,
  when no live artifact of any chat remains inside, a struck name reading "Deleted" with a menu of only
  the Copy paths (liveness comes from the whole snapshot, so This chat never strikes a folder another
  chat still fills; no per-folder deleted counts — in real folders nearly every one has some). A file
  row is one line: type icon, name (struck when deleted), task-spec status, the new-dot, Restore — whose
  hover title is the "Deleted, not by you" phrase — and the chat chip only under All chats (under This
  chat every chip would name the same chat). A folder's row id is its path plus `/`, since the index
  keeps deleted rows and a deleted file can share a path with a live folder. The tree starts collapsed;
  expansion is kept per workspace (`artifactsTreeExpandedByWorkspace`) and toggling a compacted chain sets every folder in it, so a filter
  that reshapes the chain keeps it open. Collapse all shows while a shown top-level folder is open. The
  exact change time is a file row's hover title in both views, and the file open in the center
  (`selectActiveFilePath`) is highlighted in both. A List row the host marks `deleted` reads "Deleted, not
  by you" with Restore. **Smart** answers *what did the agent make for me*, from the implicit signals too:
  `artifactsModel.smartGroups` arranges the host's roles ([[submodule-server-artifacts]]) — published,
  picked, shown or linked; an unmarked document is a working file — — results grouped by their folder, nested under
  the nearest folder that holds results itself (sibling groups with no common result folder share one
  for their top folder), collapsed and newest first, each group row reading "N results · M groups"; a
  working file folds under the nearest group as one soft-primary **"N working files"** chip (the chat
  divider's chip, a tree toggle) that expands a Tree of them relative to the group, and working files of no
  group sit under one chip at the bottom. A result row is the Tree's file row (`ArtifactFileRow`) whose
  hover title says why it counts (picked, shown in the chat, linked in the reply, a document) and whose
  user's pick carries a ★ picked badge and an accent stripe. Grouping lives on the web because it depends
  on the This-chat filter; the role does not, so the host owns it. Opening it — a click or a double click on its
  name — restores it silently first (`artifactActions.openArtifact`): opening a file asks for its contents, so
  the restore is implied. The click's center navigation is stamped before the restore, as any async open
  stamps it at request time, so a click elsewhere while the restore runs keeps its tab. A row's restore (`restoreDeletedArtifact`, kept per workspace and path for the page's
  life and shared by a click, `Mod+Enter` and both Restore controls) is reused, in flight or done, for as long
  as the row shows the same deletion — a deleted row's `changedAt` is
  when the host saw it gone, while a list refresh only replaces the object: a double click, a click in the
  gap before the live snapshot, or a refresh in between never asks again (the host would refuse a row that
  is already live), while a row deleted again right after its restore shows a newer deletion and gets a
  fresh one. A failed restore is dropped at
  once and opens nothing — not even a new file that has since taken the path — and Restore's error toast
  says why. The panel
  **opens on This chat**: the attended chat's artifacts (`selectArtifactMentionTarget`), following it as the
  center switches chats; with no chat attended it shows all, and All chats is a click away but not
  remembered across mounts. Unattributed artifacts belong to no chat. Whenever the filter hides rows, a
  line under the list counts them ("N more from other chats") with **Show all chats**, so the default never
  makes a workspace look emptier than it is; in Tree the filter prunes to the folders holding the chat's
  files. Paste puts the Files clipboard into the artifacts folder. Every row has one context menu
  (`artifactRowParts.ArtifactEntryMenu`, shared by both views): Mention in chat
  (pastes `@<path> ` into the attended chat's composer through `pasteIntoComposer` and focuses it, closing the chat's history overlay as `Mod+L` does — run once the row
menu has closed, because a closing menu returns focus to its row; disabled
  without one), Reveal in Files, Open ‹chat› for an attributed row (the chip's action), the two Copy paths,
  Copy / Cut (the shared Files clipboard; a cut pastes
  through `fs.move`), Rename (inline, `fs.rename`), Restore for a deleted row, and Delete — `fs.delete` for a
  live file, `artifacts.discard` for a kept copy, both behind a confirmation. A Tree folder's menu is
  Mention in chat (`@<folder>/ `), Reveal in Files, the two Copy paths, Copy / Cut, Paste here (with a
  clipboard) and Rename — no Delete or Restore: removing or restoring a folder of kept copies one
  request per file would mean hundreds of reconciles and trash calls, and a host batch was not worth it
  yet. Each section is its own sidebar
  tree (see *Sidebar trees*; the heading stays outside it) and emits the shell's
  focus-recovery markup (lists `artifacts[:<folder>]` and `artifacts-outputs[:<folder>]`, the path as row
  id, the name as the row's landing control), so a delete, restore or rename moves focus to the row or
  its neighbour instead of `<body>`. **New** means newer than this
  client's per-workspace seen watermark (`artifactsSeenByWorkspace`, the newest `firstSeenAt` / output
  `changedAt`, so only host timestamps are compared): the first snapshot of a workspace is taken as seen, a
  showing panel advances the watermark, rows newer than the watermark it opened with stay highlighted while
  it shows, and `selectArtifactsUnseen` drives the rail dot. While the eye toggle hides ignored outputs,
  their changes neither advance the watermark nor light the dot. The watermarks, the ignored toggle, the
  view and the Tree's expanded folders persist per client (`shell/artifactsPreference.ts`, bounded at
  5 000 folders per workspace like the Files tree). "Update the ThinkRail host" shows only once a welcome reports
  a host older than v121; between sockets the panel keeps its last snapshot.
- **Chat deep-links remain arrangement-agnostic.** A shell-owned **`LayoutIntent`** names the singleton tool;
  the shell resolves its current side/group, reveals it in place, and selects it locally. `changesRequest`
  and `specRequest` add the one path to focus/open without naming a layout destination. A divider chip that
  only reveals a tool therefore needs no fabricated path or fixed-right-panel assumption.
  `ChangesPanel` watches `changesRequest` (set by a chat turn-divider's "files changed" chip),
  **highlights** the requested file's row (resolved with `matchesWorktreePath` against `git.status`) **and
  opens the review tab at that file** in the destination center group's **preview slot** (a request with
  `path: null` opens the tab without a reveal and without waiting for the panel's own `git.status`, so a
  just-mounted panel's fallback off a pruned turn cannot redirect it; a request carrying a scope opens that
  scope's tab) — the
  chip/list-row click *is* the user's explicit ask to see
  that change, so stopping at a highlight read as broken, and following a chip is browsing, same as clicking
  the row it points at, so it reuses the slot rather than accumulating a kept tab per chip. A path no longer
  in the current diff (a round from days ago) degrades to highlight-only: there is no diff to show. **So does
  a deep link the user has already navigated past** — this open is the one that *cannot* mark its own
  navigation when it happens, because the path is only resolvable once `git.status` lands and the chip is
  normally what reveals this view (a fresh mount, a full round trip). The destination group id and local
  navigation clock stamped at the click are what it compares against, so a tab the user picked while
  the list was loading is the later navigation and keeps focus. The
  intent is **consumed** (`clearChangesRequest`) once handled — it opens a center resource, so a git-status
  re-read replaying it would yank the user's tab back. `SpecsPanel` watches **`specRequest`** (the "N specs"
  chip) and **opens the rendered spec**, likewise in the destination group's preview slot
  (`openFileInTab`, which canonicalizes the reported path — pi may report it absolute or `./`-prefixed — to
  the worktree-relative **tab identity**, so a deep link can never open a second tab for a file already open
  under its relative path; that lives in the choke point, not in each caller, and it means a spec created
  seconds ago and not yet in the graph opens just the same) — a spec has nothing to preview short of its
  content, and the tree row lights up from the local selected-resource identity. A request that carries
  a `line` (a palette section hit) then reveals it with `revealFileTab` and no renderer override, so the
  rendered spec scrolls to that heading instead of switching to source. That intent is
  **consumed** (`clearSpecRequest`) once handled: like the Changes link, it opens a center tab, so
  replaying it on a remount or a graph refetch would yank the user's tab back mid-edit. Two intents, two
  effects: a spec chip must never land in the git-derived Changes view, which structurally cannot show a
  gitignored `.thinkrail/context/` scratch spec — the empty-Changes bug that motivated the split.
  Both intents carry **exactly one path**: a round that wrote several artifacts resolves the ambiguity in the
  chat (the chip expands into a list there — see chat/SPEC.md), so no panel ever has to mark a *set*. That is
  deliberate — a second, round-scoped marking vocabulary over these workspace-scoped trees would reintroduce
  the two-rows-read-as-selected ambiguity the single-selection rule above exists to prevent.
- **The diff scope is chosen in the Changes header, and enters the tab's identity.** Two header controls say
  what is being diffed: the **`ChangesScopeMenu`** pill — *All
  changes* (the workspace's work since diverging from the target branch — measured from the merge-base,
  so upstream commits landing on the target are never phantom rows here; the default) / *Uncommitted changes* / one **commit** from the
  branch's list — and the shared **`BranchPicker`** pill for the **target branch** (`workspace.setDiffBase`;
  the panel converges on the broadcast `workspace.updated`, never optimistically). Below the two fixed rows
  the menu offers **Last turn · N files** — the newest host-recorded agent run (`store.turnsByWorkspace`
  read through `useWorkspaceTurns`; the shell loads it per connection on hosts at
  `TURN_CHANGES_PROTOCOL_VERSION`; disabled with "No agent turn changed files yet" until a run changed
  something) and, when more than one run exists, an **Agent turns** list (newest first, time · files ·
  relative settle time). Choosing one sets the `turn` scope `{ id, baseTree, headTree, startedAt }`; the
  review tab and per-file tabs read both sides from the snapshots (`/blob` serves tree-qualified paths),
  so the scope stays frozen while the worktree moves on, and because its modified side is historical it
  offers no revert or keep controls. A pruned snapshot is rejected like a rewritten commit. The menu's other
  contents load
  **lazily on each open**, never on panel mount: `git.listCommits` for the commit rows (subject +
  `shortSha · author · relative time`) and a `git.status` probe under the uncommitted scope, which is what
  lets the *Uncommitted* row say “No uncommitted changes” (disabled) instead of opening an unexplained empty
  list; each degrades on its own. The menu content is **height-bounded and scrollable** (on the shared
  `DropdownMenuContent` primitive, since any long menu has the problem) — 200 commit rows must not run past
  the viewport edge where they are unreachable. The pill names a commit scope by its **short sha**, never its subject
  (`scopeLabel`; the subject is the trigger's `title` via `scopeTitle`, and the menu row shows it in full) —
  a sentence in a rail header squeezes the sibling target-branch pill down to an ellipsis. A scope naming a commit the repo no longer has (rebase, branch reset) makes
  the host reject `git.status` with the **named** code `UNKNOWN_COMMIT` (`wsErrorCode`), and *that* rejection —
  and only that one — **resets to the branch scope with a toast** rather than staying wedged on a dead sha.
  A review tab's scope is its identity, so the same code on *its* read never repoints the tab: it drops the
  stale list, names what is gone (commit or turn snapshot) and offers *Review all changes*, which goes
  through `requestChangesView` to the branch tab the sidebar reset lands on — never a useless *Retry*.
  Every other failure (timeout, prolonged network outage, git error) leaves the user's chosen scope alone, keeps the
  last good list, and says so once per failing streak: silently swapping the scope on a network blip is a
  worse lie than a stale list. The code exists precisely because "the read failed" cannot distinguish the two.
- **"Never answered", "failed", and "answered empty" are three states, never two.** The panel holds the
  `GitStatus` *and* a failure separately: no status yet reads as **Loading…**, a failure with no list to keep
  renders the error plus a **Retry** (`changes-error` / `changes-retry`, `reload()`), and only a landed answer
  whose `changes` are empty may say “No changes in this scope.” (`changes-empty`). A failed first read must
  never take the empty-state branch — “clean” is a *claim about the worktree*, and a read that didn't land
  made no claim; a review surface that shows clean when it isn't is this product's worst failure. Same rule
  on the host side: a non-zero `git diff` exit **throws** instead of yielding an empty change set (see
  `server/src/git/SPEC.md`). The **target branch lives beside the scope menu, not inside it**
  (as first designed): a searchable list belongs in a combobox, and a nested Radix submenu closes itself when
  the menu re-renders as those lazy reads land.
- **The diff is a center resource tab, not an inset inside the Changes tool, and Changes has two
  presentations.** A single click on a Changes row opens (or reveals inside) the workspace's **review
  tab** for the panel's scope — `ChangesReviewPane`, one `ChangesTab` per *(workspace, scope)*
  (`changesTabId`), preview intent — with every changed file of the scope as a **section** in one
  scrolling surface: sticky section headers (status, path, `+N −M`, the renderer segment when the
  registry returns more than one candidate, *Open as tab*, *Revert file*, *Viewed*), bodies that read
  `git.diffFile` lazily as they scroll into view and refresh under the same live-refresh contract as a
  `DiffTab`. A double click, or a section's *Open as tab*, opens the per-file **`DiffTab`** *(path,
  scope)* through `openDiffInTab` at the `keep` intent — the deep single-file surface is a promotion,
  never the first click. Double-click carries its leading click's preview-slot claim; explicit *Open as
  tab* preserves an existing preview instead. The review tab has two **view modes**, chosen by a `Stacked | One file` segment
  in its toolbar and held app-wide (`store.changesLayout`, like `changesView`): *Stacked* is the
  continuous list; *One file* shows one section at a time with `Prev / Next` and a `n / N` counter
  (`V` toggles viewed and advances when it marks, `Alt+↓` / `Alt+↑` step files). Both modes read one model —
  the scope's ordered file list, `viewed`, `activePath`, collapse overrides, `Split | Inline`, ¶ — so
  switching never loses review progress; a second tab kind per mode was rejected for exactly that reason.
  A switch reuses the pane's section-content cache and the renderers' render caches, so the new mode
  paints finished diffs on its first frame. Returning to Stacked is double-buffered: the freshly mounted
  list measures its viewport and scrolls to the active file while `invisible` beneath the still-shown
  One-file view, which is dropped only once that file's header has held the list's top for two frames
  (capped at 30). Shown directly, the list painted its first file and footer at scroll 0 and then
  visibly scrolled to the active one.
  **Transient authoring belongs to the tab section, not its mounted renderer.** An optional scoped
  review-draft context retains the stamped selection, composer text/caret, pending submission, and
  unsaved thread edits across virtualization, collapse, renderer and Stacked/One-file switches. The
  shared `useStampedComposer` and thread card use this policy for code and rich surfaces; renderer,
  side/page, file, scope and workspace identities isolate their scratch state. Notebook selections retain
  a stamped side and cell index, never a parsed cell object's identity. Cancel and successful
  Save/Send retire it; late completions cannot close a newer selection. Restoring scratch never focuses
  the textarea or sends a host mutation. Existing thread edits retain blur-save and shortcut-save;
  sending waits for any edited body to be saved, and Escape discards only the local edit. The thread card
  has one edit-state path on every surface — without a scratch context it falls back to local state, so
  the per-file tab cannot drift from the review tab.
  Content-stamp changes still invalidate stale selections.
  Scratch remains tab-lifetime only, not reload-persistent, and its first write keeps the preview.
  **The Changes sidebar is the review tab's navigator**: its row highlight follows the tab's
  `activePath` (the section whose header has crossed the toolbar's midline, or the single file shown),
  viewed files carry a check glyph, and clicking a row reveals that section (and expands it if it was
  collapsed) — the reveal remains anchored by path while asynchronous sections determine their heights,
  until a view-mode change or user wheel, touch, pointer, or keyboard input takes over. A timeout cannot bound remote reads.
  Virtuoso re-issues a `scrollToIndex` for as long as item sizes keep changing, so the list's scroller
  applies `scrollTo` only while a reveal is settling; otherwise a late-loading section would scroll a wheel
  or a focused composer straight back to the revealed file.
  Finding navigation hands scrolling to the thread only after the section reveal, and disables further
  header corrections so the thread cannot be scrolled back out of view. The pane brings the **section**
  into view; the within-section reveal of a **comment** is a `reviewFocusRequest` that
  `consumeChangesTabReveal` raises and the target section's `usePierreFocus` consumes
  (`virtualizer.revealLine`) — the one path that can surface a line, and its thread card, not yet rendered
  in a bounded, virtualized section. A reveal the user takes over, a
  newer reveal, or the pane unmounting withdraws its pending `reviewFocusRequest`, so a thread that mounts
  later never yanks the viewport to a finding nobody is waiting for. Each section receives only its own
  path's slice of the tab (scratch, kept keys, flags) behind `memo`, so a keystroke in one section's
  composer re-renders that section, not its siblings — and inside it only the composer, because the renderer
  surface and its annotations read scratch per slot ([[module-resource-renderers]]); a stacked section whose body has natural height saves
  no view state — only One-file and bounded renderers own a scroller; `changesView` defaults to **Tree**, and a
  file row is `change-item` in both views because it is the same thing. When the shown file leaves the
  scope (reverted, or the agent removed its change), One-file mode stays at that position rather than
  jumping back to the first file. The list ends in a measured tail the height of the viewport so the last file can
  be scrolled to the top and become active, as on GitHub. The scroll-spy never auto-reveals the Review
  tool: `selectActiveReviewedPath` deliberately ignores the review tab, because a reveal fired by
  scrolling would replace the Changes navigator in its shared side group mid-read.
  **Hunk triage is an overlay on the same tab, not a second mutation model.** In a mutable scope every
  hunk toolbar gains **Keep** beside the existing Revert and Ask-agent actions; a kept hunk is recorded
  on the tab (`kept[path]`) under a **content key** — a hash of the hunk's removed + added text, with the
  duplicate-group size and original-side position when content is identical, so reverting an earlier
  twin cannot transfer its decision to an unreviewed twin. Ambiguous groups conservatively lose their
  decisions when their size changes. Unique keys survive the line shifts a neighbouring revert causes and lapse the moment the
  agent changes that hunk again. A *reverted* hunk needs no state: ThinkRail's revert restores the base
  text, the hunk leaves the diff, and the toast's Undo is the way back. The section header shows `k/n
  kept` and keeping a file's last hunk atomically marks it **viewed** — an action edge, not a standing
  render rule, so an explicitly un-viewed file stays un-viewed through virtualization and mode changes.
  Hunk and file progress are one model; the stacked view's bottom bar shows `n of N reviewed`, **Next unreviewed** (`J`, wraps) and
  **Mark all viewed**, and `V` toggles the active section. There is deliberately no *Revert all*: the
  host has no atomic multi-file discard and a bulk destructive action on a review surface earns its
  keystroke only once it exists server-side. The per-file `DiffTab` passes no triage and is unchanged.
  **The reviewer's story is a walk, not a report.** When the workspace review carries a `guide` (the newest
  plan-step verdict's summary and suggested reading order, see [[submodule-server-reviews]]) or any open
  agent finding, the stacked view grows a left **review guide rail** (`ChangesReviewGuide`, toggled from the
  toolbar, never shown in One-file mode): verdict badge + summary, the numbered reading order (steps for
  files outside the scope are disabled rather than hidden, so the order stays legible), and the findings.
  `guideSteps` is the one derivation — reading steps first, then open agent findings by path — and
  **Start / Next / Restart** (`N`, `P` back) walk it, skipping steps whose file is not in this scope
  (`nextGuideStep`; a disabled step is shown for context, never landed on): a step reveals its section
  through the tab's one-shot reveal, a finding step also fires the store's `reviewFocusRequest`, so the
  thread card is scrolled to by the same path the Review panel uses. *Fix this one* and *Apply fixes* are
  the Review panel's send paths (`sendReviewComment`, `sendReviewBatch` over the open finding ids) behind
  one busy flag, not new mutations. The cursor is the step's identity (a reading step's position in the order — the contract allows one file twice — or a finding id), so a
  finding resolved from under it yields to its successor instead of skipping one. The rail never renders
  on phone-class viewports — 280px of a 390px
  screen would leave no diff to guide through. A keyboard step (`Alt+↑` / `Alt+↓`, `V` advancing, `J`, `N`,
  `P`) and a click on a reading step or finding move focus to what it revealed — the section's collapse
  toggle (stacked layout) or its header itself (single-file layout, `tabIndex=-1` and the section's
  `data-focus-row-primary`, so a diff cursor's Esc and focus recovery land there too; never the header's
  first control, which there is Revert file, so a following Enter or Space cannot revert), or the finding card
  once `useReviewReveal` scrolls it into view (a draft's text, a sent card itself); the
  `Prev / Next`, guide and bottom-bar buttons keep focus, so they can be pressed again (the reveal reaches
  the renderer as a review focus with `moveFocus: false`: it scrolls to a finding without focusing it), and
  one that disables at the end hands focus to its nearest enabled sibling through the shell's recovery
  engine.
  Plain-letter shortcuts (`V`, `J`, `N`, `P`) belong to the
  review tab the center is looking at (`ownsReviewShortcut`: the attention group's selected tab, no
  modal or menu layer open, no text-entry target, and no earlier handler consumed the event), so two review scopes split side by side cannot both answer
  one keystroke. Inside a diff's **line cursor** ([[module-resource-renderers]], *Keyboard review
  surfaces*) `j`/`k` move lines and are consumed there, so `J` means next unreviewed only outside it;
  `V`, `N`, `P` and `Alt+↑/↓` pass through the cursor. A comment authored from the cursor returns focus to
  its line on save, send or cancel, and so do a draft card's `Mod+Enter`, Esc, Send and Delete — never to
  `<body>`, another card or another file; Esc on a cursor without a range lands on the section header.
  **Show in file** and the guide's keyboard steps land in a draft's text (caret at the end), not on its
  Send button, and on a sent card itself. These keys are the rebindable local keys of scope `review`
  ([[submodule-web-keybindings]], *Local keys*): the pane and the guide match them through
  `useLocalKeys("review", LOCAL_KEY_DEFAULTS.review)` by physical `code`, and every cap they show (the
  `V` / `J` / `N` keycaps, the guide's previous-step label, the Prev / Next file tooltip caps — `Alt+↓` /
  `Alt+↑`, `⌥↓` / `⌥↑` on a Mac — rather than in their label) is that hook's `caps` / `label`, so a rebind
  shows everywhere it acts and an unbound key shows no cap. **Scale rules**:
  a section whose file changed more than 400 lines, or whose path is a lock/generated file, mounts
  collapsed behind *Expand* / *Open as tab*; a scope with more than 50 files shows a dismissable notice
  offering *One file*; nothing switches mode on its own, because a review surface that re-arranges
  itself mid-review loses the reader's place. The list is a flat `react-virtuoso` list, one item per file
  with the header sticky inside its item (no `GroupedVirtuoso`: a group header that outlives its item's
  content could not host the per-file controls); Pierre `CodeView` was evaluated for the container and rejected because its items
  are only `file` / `diff`, so it cannot host the rendered-markdown, image, SVG, CSV, JSON, notebook, and PDF
  renderers that a section must dispatch exactly like `DiffPane` does. **A section holds its shape
  before it has its diff.** Each section reads `git.diffFile` lazily when its body first becomes
  visible, through the pane's `SectionContentCache`: in-flight reads are shared only for the same path,
  diff target, and filesystem generation. The latest request may populate the cache after its section
  scrolls out, but an older initial read cannot overwrite a newer target or a live refresh. A failed
  read stores nothing, so *Retry* reads again. While loading, a stacked section's
  placeholder reserves `estimatedSectionHeight(change)` — `232 + 40 × changed lines` px, capped at
  20 000 — which sits within about 2× of what Pierre renders for the same stats. Without that reservation
  a skeleton a tenth the size of its diff made Virtuoso mount a dozen-plus sections at once (that many
  concurrent reads), then re-estimate the whole list as each one grew, so a jump to a far file landed
  tens of files away. Both `DiffPane` and a section
  render the shared **`DiffSurface`**: it describes the returned `ResourceMeta`, resolves the registry
  for `diff`, lazily mounts the selected renderer, hosts that file's review threads and hunk actions,
  and shows the unplaced strip. Byte-only
  original sides use the response's resolved original oid with `/blob`; an absent side is explicit, never a
  bytes value with a fabricated URL. The fixed toolbar keeps path and per-file review send, then exposes ¶
  whitespace, modified-side copy, and **Split | Inline** only when the selected renderer advertises the
  corresponding capability. It renders one `view-toggle-<renderer suffix>` segment per candidate when the
  registry returns more than one. Renderer choice replaces the old markdown-only `rendered` state; layout
  and whitespace remain independent diff state. The review tab's toolbar carries the same whitespace and
  `Split | Inline` controls for every section at once — but, because that toggle is pane-level across every
  section rather than per-renderer, they follow `DiffPane`'s capability gates collectively: each control
  shows only when at least one file in the scope resolves (by path, through `diffRendererCapabilities`) to a
  renderer advertising it, so an all-Markdown/image/PDF/rich scope hides them instead of offering inert
  controls. The gate reads only the per-path renderer selections (`selectChangesTabRendererIds`), so draft
  and view-state writes to a section do not re-resolve the scope. Resolution runs before content loads, so the gate infers the text/binary split from the
  path's MIME — known binary types (images, PDF) resolve to their layout-less renderers; an
  unknown-extension binary with no inferable MIME still reads as text until its bytes load.
  It also carries the scope and target as read-only chips (the scope
  is chosen in the Changes header and is part of the tab's identity), the file / `+ −` totals with the
  viewed count, *Collapse all* / *Expand all*, and `Send review (N)` over the workspace's drafts.

  **Wide rewrites wait behind a notice.** `DiffSurfaceBody` mounts its renderer through
  [[module-resource-renderers]]' `GuardedRendererDiff` (the policy and its thresholds live there), adding
  **Open file** into the desktop editor to the notice when a worktree-backed modified side exists.

  The bundled candidates and their behavior (code, markdown, binary, LFS, image, SVG, CSV, JSON, notebook,
  PDF, HTML, Pierre virtualization) are owned by [[module-resource-renderers]]; the panes only dispatch,
  persist view state, own the unplaced strip, and supply `hunkActions`.

  Mutable scopes (`branch`, `uncommitted`, `pinned`) receive `hunkActions` only after the current welcome
  advertises `CHANGE_MUTATIONS_PROTOCOL_VERSION` and the diff metadata carrying both hashes has landed.
  Change blocks are independent of
  Pierre's hunk model: `diff@8` `structuredPatch` with zero context and the same whitespace policy produces
  the original/modified `LineSpan` pair sent to `change.revert`. Each block gets a slim annotation toolbar
  above its first changed line with **Revert** (`hunk-revert`) and **Ask agent** (`hunk-ask-agent`); pure deletions anchor that toolbar on the
  deletion side, while an absent modified side suppresses every block toolbar and leaves only header-level
  Revert file. A running session adds the quiet “the agent is working in this workspace” notice but CAS,
  not disabling, protects the action. Ask agent opens the worktree composer with the modified `lineRange`,
  an exact `diffHunk` header, and `Please revise this change: ` at the cursor; a pure deletion anchors to the
  preceding existing worktree line (line 1 at the top) and says it refers to removed lines, while an empty
  worktree emits only `diffHunk` and therefore a whole-file comment. It then uses ordinary
  `review.worktree.commenting.onSend`. The fixed header adds **Revert file** (`diff-revert-file`).

  `DiffPane` sends both rendered hashes with every range/file revert. Success raises an eight-second toast
  whose **Undo** action sends `change.undo` with the receipt id and `receipt.after.hash`; a trashed whole file
  says it moved to the trash. `STALE_VIEW` immediately uses `useLiveTabContent.reload()` and says “This file
  changed since you opened it — review the new diff”; `RECEIPT_UNKNOWN` (the receipt was evicted, its
  workspace forgotten, or the host restarted behind a toast that is still on screen) reloads the same way
  and says “This change can no longer be undone — the host no longer holds it” as information, not an
  error; every other named or unnamed failure uses `errorText`. Commit scopes never receive `hunkActions`, so neither the toolbar nor Revert file can render.
- **Changes: List | Tree.** A header toggle (`store.changesView`, app-wide — persisted in the store, not
  per workspace, so it survives workspace switches) switches the flat **List** and a folder **Tree**
  (`ChangesTree`), both built from the same `git.status` list. The Tree is styled exactly like the
  Files tree (shared `TreeRow`); folders **default expanded** (change sets are small) and the ones you
  collapse are remembered per workspace for every scope (`filesTreeByWorkspace.changedCollapsed`), and a
  single-directory run is one slash-joined compact row (based on the changed-file tree, regardless of
  unchanged siblings on disk), matching `FileTree`. **Status is shown on the file name, not a letter glyph**
  (the git-decoration convention — `changesModel.statusNameClass`, shared by both views):
  added / untracked → green, deleted → red + strikethrough, renamed → blue, modified → plain. Each file
  shows a `+N −M` badge (shared `DiffStatBadge`), and a folder shows its aggregate badge **only while
  collapsed** — expanded, its children already carry the counts — per-file counts come from `git.status`
  (`GitFileChange.added/removed`, from `git diff --numstat`; untracked files count their whole content as
  added — but a binary or oversized untracked file gets no count, mirroring how tracked binaries drop out
  of `--numstat`), folder counts are summed client-side. Both views share `ChangesPanel`'s `openDiff` + `isActive`.
  The **List shows the full worktree-relative path** — muted directory prefix (which yields first when the
  row overflows) + the status-colored basename, so the name a user scans stays visible.
- **Browsing reuses one tab per center group: preview versus keep.** Each workspace view has one local
  preview identity per frame group; its label is italic and carries `data-preview="true"`. Single-clicking a file/spec/change row or
  following a rendered-document/chat artifact link opens into the browser's last-focused destination group
  as preview. Double-click keeps; clicking an already active preview keeps as the touch path. An explicit
  Settings/open-as-file action starts kept. Chat and registered plan/document tabs never enter preview.
  The strip and
  context/command surfaces also expose a keyboard-operable Keep Preview command.

  A preview replaces only that group's slot at the same index, so browsing never reshuffles the strip. A
  single click opens its preview at once, from the open-tab cache or the read, with no settle wait. A
  double click composes preview then promote: the row's second click (`event.detail > 1`) sends no
  preview (every browse row wraps its preview open in `lib`'s `firstClickOnly`), so only the leading
  preview and the `dblclick` keep go out. If the read already landed, that is two local transitions: the
  preview, then an in-place keep of the same placement. If the read is still in flight, `openTabs.ts`
  single-flights it and carries the leading click's slot claim into one final kept transition. Either way
  network latency cannot reverse the intents. The Changes review-tab preview is the one row open that
  still waits the settle window: its double click opens a different resource (the kept per-file diff), so
  an instant review tab would flash and then be replaced. Freshness stamps (`loadedTick`, plus a diff's
  `loadedTarget`) are captured before the read leaves, never from newer state at response time. The local
  per-group navigation clock is captured at request time: a stale preview completion loses to later
  attention; deliberate keep still commits. If the destination group disappeared, the shell reroutes to
  current last focus, and if a newer local transition already placed the canonical resource, completion
  selects that placement instead of duplicating it. Preview placement and attention commit locally. Unit
  and E2E tests pin double-click coalescing, stale-read rejection, per-group isolation, local identity
  convergence, and promote-by-keyboard/touch.
- **Sidebar trees share one keyboard model (`treeNavigation.tsx`).** Files, Changes (both views), Specs,
  Chats, Projects and the Artifacts tool's two sections are each a `Tree` — a `div role=tree` with **one Tab stop** (roving tabindex) — whose
  rows' focusable controls are `useTreeItem` treeitems (`@thinkrail/ui/tree-item`, the item half `TreeRow`
  needs in [[module-ui]]; it reads the roving cursor and search marks `Tree` provides through
  `TreeItemScopeContext`) (`aria-level`, `aria-expanded` on expandables,
  `aria-current` for the selected row) under `li role=none`; the tree is a `div role=tree` and every
  list inside it is `role=none`, so the hierarchy is the explicit `aria-level` (VS Code's flat-tree
  markup) rather than nested `group`s, which Biome's semantic-element rules reject on lists. Chats and
  Projects are two trees (Projects: project → workspaces and creations → the Settled header as an
  expandable item → settled rows and *Show more*); so are Artifacts (List: flat, the name is the
  treeitem; Tree: a folder row is its own toggle) and Other agent files (an output folder is its own
  toggle), their headings outside the trees. No tree is
  virtualized, so the model is DOM-driven: the visible rows are the tree's treeitems in DOM order, parent and first child come from `aria-level`
  (the pure move rule is `lib`'s `resolveTreeMove`, which the virtualized chat transcript applies to rows it derives from data),
  and →/← click the row's `[data-tree-toggle]` (a Files/Changes folder row is its own toggle; Specs,
  projects and the Settled header use their chevron), so every tree keeps its own expansion state and
  markup.
  - **The tab stop is the current row:** the last focused row (focus-in, so clicks and focus recovery move
    it); a row that becomes selected while focus is elsewhere (a file opened from the palette) takes it
    over; else the last selected row, else the first. A `MutationObserver` re-elects when the current row
    leaves the DOM, because rows load per directory and per project asynchronously. Only the current row
    carries `data-focus-default`, so F6, `Mod+0` and `Mod+Shift+E/G` land on it ([[submodule-web-shell]]
    prefers the innermost default; its focusable test counts `tabIndex=-1` buttons, so without the marker
    landing took the first row). Of Chats and Projects only the tree holding the active workspace marks
    its default (Projects when none is active); of the Artifacts tool's, Artifacts when it has rows, else
    Other agent files.
  - **Keys** are the tree's own, not global chords: ↑/↓ and the arrow twins (`j`/`k` by default),
    Home/End; → / `l` expands, else enters the first child; ← / `h` collapses, else goes to the parent. The
    twins and `trees.search` are rebindable local keys of scope `trees` ([[submodule-web-keybindings]],
    *Local keys*): `Tree` asks `useLocalKeys("trees", LOCAL_KEY_DEFAULTS.trees)` at event time, matched by
    physical `code` (a Russian layout's `ы` is `S`), and a matched twin maps onto its arrow before
    `resolveTreeMove`; the arrows themselves are locked and always work, never during IME composition.
    `trees.openKept` (`Mod+Enter`), `trees.rename` (`F2`), `trees.delete` (`Delete`) and
    `trees.reorderUp` / `trees.reorderDown` (`Alt+Shift+↑/↓`) are local keys of the same scope; rows read
    them through `useTreeKeys()`, and the project row's `aria-keyshortcuts` is that hook's `aria`.
    Letters belong to a focused tree, so the Changes review's `V`/`J`/`N` do not fire from a focused Changes
    row: every other printable key is swallowed, except Space (the button's activation) and `F` (by
    `code`, unmodified), which belongs to hint mode ([[module-ext-hint-mode]]). Letter type-ahead was
    removed when F became hint mode's (2026-11-15); search moved to `S`.
  - **`S` (`trees.search`, rebindable) searches the visible rows** (isearch). `Tree` renders a labelled field ("Search Files") as a
    sticky sibling *before* its `role="tree"` element — outside it, so the tree's `MutationObserver` and
    roving model never see it — and focuses it. Typing matches the query as a case-insensitive substring of
    each rendered row's `data-tree-label` (collapsed children are not rendered, so not searched); the
    cursor (tab stop, `data-focus-default`) moves to the first match at or after the current match, else
    the row the search started from, wrapping, and is scrolled into view (re-centred if the sticky field
    covers it). Matches carry `data-tree-match="match"`, the current one `"current"` (`primary-subtle` /
    `primary-soft` fills through the tree's arbitrary variants); the field shows "n of m" or "No match".
    ↓ / ↑ step to the next / previous match, wrapping; Enter keeps the current match (or the start row)
    and Esc returns to the start row — both focus that row **before** the field unmounts, so focus never
    drops to `<body>`; blur (Tab lands on the current match, the tree's tab stop) keeps the match. Plain
    `S` types into the field, so `S`-again-as-next (the product brief) is not bound: a query must be able
    to contain an s. The pure model is `treeSearchMatches` / `treeSearchTarget` / `treeSearchStep`.
    Enter is the button's own click; `Mod+Enter` is the row's double-click — Files, Specs and Artifacts open
    kept (a deleted artifact restores first), Changes opens its kept diff with `claimPreview`; rows without a double-click treat it as Enter.
  - **Row keys live in each row**, through `treeRowKey(event, keys)` (names the matched `trees.*`
    command: `menu`, `delete`, `rename`, `reorderUp`, `reorderDown`): Shift+F10 / the Menu key open the row's menu
    (context-menu rows through `openContextMenuFromKeyboard`, dropdown rows through `isContextMenuKey`,
    after which the menu returns focus to the row); **Delete** opens the menu's own confirmation (file,
    Remove workspace except on Default, Delete chat — a pending deletion retries directly —, Close project,
    an artifact's or ignored output's Delete — a deleted artifact discards its kept copy; nothing on Changes
    and Specs rows); **F2** renames a project, managed workspace or artifact where the
    menu offers Rename (chats and ignored outputs have no rename). A pending chat stays
    focusable (`aria-disabled`) so its Retry is reachable; a deleted artifact's name is enabled, since opening
    it restores it.
  - **Inner row buttons leave the Tab order and the accessibility tree** (`treeRowControlProps`:
    `tabIndex=-1` and `aria-hidden` — a `tree` may own only treeitems, and these are pointer duplicates:
    chevrons, kebabs, Settle / Keep active, the project's Create workspace `+`, a creation's retry /
    dismiss, an artifact's chat chip and Restore); each action stays reachable — arrows expand, the row's
    menu carries the rest (Create workspace, Settle, Keep active, Open ‹chat›, Restore), a creation's
    actions are in the creation view its row opens; hint mode labels none of them, by the same markup. dnd-kit's draggable `attributes` stay unspread on the project name
    (they would add a second tab stop); dragging needs only its listeners.
- **Row actions: one menu, two triggers.** Every **file** row (both views) is wrapped in
  **`ChangeRowActions`**: a hover-revealed `⌄` button *and* right-click on the row (Shift+F10 / Menu key on it) open the same
  dropdown. The `⌄` is not garnish — it is the **touch path**, where right-click does not exist (mobile-first).
  Items: **View** (the same action as a plain click) and **Copy relative path**. Deliberately
  nothing else: the panel is **read-only** — no discard-file/-folder/-all — and no “Open in ‹external app›”,
  which a host-side `open` would make silently wrong for every remote/phone client (Copy relative path is the
  portable escape hatch). **Folder rows get no menu** — nothing in that list applies to a folder. Built on the existing
  `@thinkrail/ui/dropdown-menu` (no new `context-menu` primitive); the right-click handler is handed back
  through a render prop so it lands on the row's real interactive element rather than a bare div, and the `⌄`
  trigger is a *sibling* of the row's button (a button inside a button is invalid).
  Three layout rules make that wrapper invisible rather than a seam — each pinned by a geometric e2e
  assertion, because each was a real bug the first draft shipped:
  **(1) the wrapper owns the row's highlight** (hover / selected / menu-open), since the band has to span the
  trailing slot too or a row reads as cut off before its own menu — the inner element paints **no** background
  at all (the flat list's button carries no `hover:`/selected class, and `TreeRow` takes
  `highlight="wrapper"`, its `"self"` default being what the Files tree wants). Exactly one painter,
  always: two hide the case where the wrapper stopped painting, which is why the e2e pin compares the *wrapper's*
  computed band against the *inner button's* (transparent) one, not a wrapper against a wrapper;
  **(2) rows *without* a menu reserve the same gutter** (`ROW_MENU_SLOT`, exported from `ChangeRowActions`
  and worn by the tree's folder rows), or the `+N −M` column sits 24px further right on folders than on
  files; and **(3) a row shares its flex line with that slot, so it must be able to shrink below its label**
  — `TreeRow` carries `min-w-0`, and every path is rendered as *two truncatable halves* (dir + basename), so
  a long basename can never push the counts (or, in `DiffPane`'s twin chip, the ¶/copy/layout controls) out
  of the box. The halves are **not** equally truncatable: the dir prefix yields **completely** before the
  basename gives up a pixel, because the name is what a user scans. That ordering is *structural* — the dir
  is the only shrinkable item (`shrink`), the basename is `shrink-0` — not a shrink *ratio*. A ratio (this
  was `shrink-[20]` vs `shrink`) only approximates it: flex splits the deficit in proportion to factor ×
  basis, so the basename always loses a slice, sub-pixel at a small type scale and ~2px at 14px — which is
  how a 12-character `shortName.ts` picked up an ellipsis when the UI scale rose. The e2e pin measures the
  two spans separately, so "the dir yields first" stays a claim a test can falsify. `shrink-0` **alone**
  would overflow the chip **invisibly to the layout** while spilling over the buttons on screen, so the
  basename pairs it with `max-w-full`: flex never steals the name's width, but max-width still clamps it to
  the row, which is also why the e2e pin measures the *chip's* `scrollWidth`, not the header's.
- **A diff tab can compare two workspace files.** `DiffTab` is a union — `GitDiffTab` (a git scope with its
  loaded sides) or `FileComparisonTab` (a `before` path and no git fields at all) — and so is its persisted
  `LayoutDiffTab`; `isFileComparison(tab)` is the one predicate. `openFileComparisonInTab` opens a comparison
  (identity `compare:<before>:<path>`, named `before → after`), and `DiffPane` forks on it: a comparison renders
  [[module-resource-renderers]]' `ResourcePreview` (both files read live from disk, no revert/hunk actions,
  comments on the two files' worktree anchors, Split/Inline, renderer and view state on the tab) instead of the
  git-backed `DiffSurface`. A comparison has no scope to misread, so the compiler finds every git-only reader
  (`GitDiffPane`, the Changes panel's active-diff match, `updateDiffTabContent`, whitespace, reload hydration
  — which installs a comparison without a `git.diffFile` read); an earlier revision gave it a placeholder
  `uncommitted` scope and left each reader to remember a `before` check. Its review flag and the Review
  panel's active path cover both files (`tabReviewPaths`).
- **File tabs use the same renderer dispatch as diffs.** `FilePane` describes the first `fs.readFile`
  metadata (provisionally text before it lands — and permanently text against a host that predates
  `RESOURCE_META_PROTOCOL_VERSION` and never sends `meta`, which is that host's own legacy surface, so no
  protocol gate is needed for byte-only rendering), resolves `view`, and mounts the selected lazy candidate. Its Suspense fallback is `file-pane-loading`; a
  preloaded implementation never shows it.
  `thinkrail/markdown` remains the higher-ranked match for `.md`/`.mdx`, so documents open in
  `MarkdownPreview`; `thinkrail/code` is the text fallback and uses Monaco on desktop plus Pierre `File`
  on phone-class viewports; `thinkrail/binary` shows identity and a host-backed
  download. The candidate list alone determines whether the resource toggle exists. No format predicate or
  preview/source field remains in the pane or tab. A tab's `reveal` (the store's `FileReveal`) is passed
  through to the mounted view as the renderer contract's `reveal`, so the code renderer scrolls to and marks
  that line, and the view's `onRevealHandled` clears it (`clearFileTabReveal`) so a later remount keeps the
  reading position; `openTabs.ts`' **`openFileAtLine(workspaceId, path, at, intent)`** is Find in Files'
  open-at-a-line entry (`↵` / `⌘↵`): the ordinary `openFileInTab` at the caller's intent, then
  `revealFileTab` naming `SOURCE_RENDERER_ID`, so a Markdown or HTML file opens as source at the line
  rather than as its rendered document (a spec section opened through `specRequest`, below, names no
  renderer, so the rendered spec scrolls to its heading). An open that finds a read of the same file in flight joins it —
  `openReadTab` hands every caller that read's completion — so each caller reveals after the tab is
  installed, in call order, and the latest hit wins.
  **`workspaceForPath.resolveWorkspaceFile(path)`** is the client's one entry to "which open workspace holds
  this absolute path" for any caller that holds a path from outside the app's own trees (desktop deep links
  now; terminal path links reuse it rather than match roots themselves). From
  `WORKSPACE_PATH_RESOLVE_PROTOCOL_VERSION` (v119) it asks the host's `workspace.resolvePath`, which matches
  real paths ([[submodule-server-workspaces]]): the browser cannot see a symlink, so `/tmp/x` against
  `/private/tmp/x`, or a project opened through a symlinked folder, only matches there. Against an older host
  it falls back to the loaded roots' spelling: it lists the workspaces of unlisted open projects whose folder
  encloses the path first, so a nested project is never shadowed by an already loaded parent, then the
  remaining unlisted open projects (a worktree usually lives outside its project folder), and picks by
  `pathWithinRoot` the most specific root, the active workspace between equal roots, never a deleting or
  removed workspace, a closed project's cached rows or a root itself; it never overwrites a list that loaded
  meanwhile. Either way it answers a `WorkspacePathMatch` (`workspaceId`, `projectId`, POSIX `relativePath`)
  or `null`; entering the workspace, which loads its project's list when this client lacks the row, is the
  caller's.

  `MarkdownPreview` retains the document typography, frontmatter stripping, alerts, Mermaid rendering,
  source-line stamps, review commenting, and bounded reading measure described above. These are renderer
  behavior, not dispatch policy.
- **Terminal renderer + font measurement.** `TerminalInstance` runs xterm's **default DOM renderer** on
  purpose — `addon-webgl` is *not* loaded, and loading it would be a regression (see `architecture.md`
  Decision #11: the DOM renderer is a prerequisite for touch, and `WebglAddon.dispose()` leaks its WebGL2
  context, which our per-worktree terminal churn would hit). Addons are exactly `fit`, `clipboard`,
  `unicode11` and `web-fonts`; anything else pinned but unimported is dead weight and a trap for the next
  reader. `web-fonts` is load-bearing rather than cosmetic: our code font ships as per-alphabet woff2 subsets,
  so the Cyrillic/CJK file lands *after* xterm has measured the character cell (which it does at
  construction and again only when a font option changes — unlike Monaco, which re-measures an untrusted
  early reading). Without the
  re-measure, non-Latin glyphs render into cells sized for the fallback font and the PTY holds the wrong
  cols/rows. Initial attach therefore waits for `relayout()`, performs a final `fit()`, and only then captures
  the PTY grid. The wait is **bounded by a deadline**, because `relayout()` in the pinned addon awaits
  `document.fonts.ready` plus a `FontFace.load()` per registered face — one stalled font response keeps it
  *pending* (not rejected) indefinitely, and an unbounded wait would leave the pane blank with no shell.
  Relayout failure or deadline expiry falls back to the construction-time measurement rather than stranding
  the pane; on expiry the stale relayout is neutralized first (disposing the addon skips its re-measuring
  `fontFamily` toggle), so a font that finishes loading late cannot re-lay-out an already-attached terminal.
  A **font settings change** is the one later re-measure: through `@thinkrail/ui/fonts`' `watchFont` the
  terminal resolves the generated `.tr-code-block` style (family, code size, weight), waits for that face to
  load, sets the three options and re-fits, which resyncs the PTY grid. Only the latest change applies; one
  that leaves family, size and weight alone is skipped unless the custom face set changed (a replaced file
  keeps its family name but not its metrics), and a ligatures-only change never re-measures. Each apply sets
  `fontFamily` to `monospace` and back, because xterm re-measures its cell only when that option's value
  changes. The relayout start callback applies the latest resolved font before its first fit, so a change
  that lands while the initial relayout is pending is not lost. It never draws ligatures: the DOM renderer merges a run of
  same-styled cells into one text node, so `index.css` pins `.xterm .xterm-rows` to
  `font-variant-ligatures: none` whatever the Ligatures switch says.
  This ordering also prevents a fallback-width attach followed by a corrective resize from producing
  post-snapshot shell redraws that can erase replayed rows. Its pre-bind output buffer is a bounded waiting
  state: successful bind filters it to the adopted PTY, while creation failure clears it and stops accepting
  page-wide terminal frames. That failure renders the host's stable guidance as escaped DOM text rather than
  executable terminal output, with Terminal Settings and Retry actions. The failed xterm subtree is inert;
  an explicit retry keeps that recovery surface mounted and its actions disabled until the request settles,
  preserving focus without stealing unrelated workbench focus. Initial xterm focus is deferred until a
  successful attach and applies only while the terminal tab that requested it still owns focus; Retry keeps
  its overlay mounted through the successful handoff and restores xterm focus only while focus remains in that
  terminal region. A focusing handoff commits the attached state synchronously before `focus()`: the failed
  frame stays inert until that commit and an inert subtree silently refuses focus, so frame timing (a next
  animation frame can precede React's commit on a loaded machine) must never be what lifts it. A competing
  detach invalidates that handoff and clears its retry state before exposing Take Back again.
  **Historical replay is input-inert:** the PTY id
  remains unadopted until xterm's replay callback, which rechecks attach freshness before binding and draining
  genuinely live frames; replies xterm synthesizes for recorded terminal queries can therefore never enter the
  live shell. PTY sizing distinguishes desired, in-flight, and
  host-acknowledged grids; only a successful `terminal.resize` advances the acknowledgement, so reconnect
  replay cannot leave a full-screen app permanently sized to a request the host never applied. The 16 ANSI
  slots come from the theme's `--ansi-*` domain palette (never the semantic UI text tokens); on top of it
  xterm runs a **`minimumContrastRatio` legibility floor** driven by the theme's contrast metadata (normal
  `4.5`, high `7`, in `panels/terminalContrast.ts`). xterm's default of `1` disables correction, which
  left colours close to the terminal background (`black` on the near-black dark canvas) with no floor; the
  ratio lifts the resolved foreground against the live background without editing the palette — all 16 HC
  ANSI colours render ≥ 7:1 with hue preserved. The floor **cannot** fix ANSI **dim** (SGR 2): xterm renders
  dim as the foreground at 50% opacity, correction never fires for the already-high-contrast default
  foreground (Vite's `(client)` tag is dim over the *default foreground*, not an ansi colour), and 50%
  over a light canvas caps ≈ 3.3:1. So in **high-contrast themes the dim attribute is stripped from
  terminal output** (`stripAnsiDim`), rendering that text at full foreground contrast (≥ AA). The
  `terminalContrast.test.ts` gate reproduces xterm's colour maths to hold both HC themes at the threshold. The **12px
  content inset** lives on the xterm **mount host's own box** (absolutely positioned, `inset-12` on every
  side) rather than as padding on it — FitAddon derives cols/rows from that host's measured size, so
  padding would overcount the grid and clip the last row/column; insetting the box keeps the measured
  area equal to the visible content area.
- **IME control-chord rescue.** xterm 6.0.0 drops `Ctrl+<letter>` and `Escape` outright while a CJK
  input method is active (upstream #6065): its chord table switches on `keyCode`, and an active IME
  reports the sentinel 229 for every key, so nothing matches and *no byte is emitted* — a
  Chinese/Japanese/Korean user cannot interrupt a runaway process or leave vim. `TerminalInstance`'s
  key handler intercepts keydown at `keyCode === 229` and derives the control bytes from `event.code`
  (which stays accurate under an IME) via `imeControlBytes`, writing them to the PTY itself; anything
  that isn't a rescued chord is left to normal text input.
- **Terminal copy chord.** xterm allows one custom key handler, so `TerminalInstance` asks the pure
  `terminalKeys.terminalKeyDecision(event, platform, hasSelection)`: nothing while an IME is composing, then
  the copy chord, and only then the keyCode-229 rescue above (`imeControlBytes` lives beside it). The chord
  comes first because an IME that reports 229 without composing would otherwise turn Ctrl+Shift+C into the
  rescue's `^C`. Off Apple platforms (where Cmd+C already copies) **Ctrl+Shift+C** copies
  `term.getSelection()` through `copyText`, as GNOME Terminal, Konsole and Windows Terminal do; without a
  selection it does nothing. Either way the keydown is swallowed and `preventDefault`ed (Chromium would
  otherwise open inspect-element), so it never writes `^C`; xterm itself encodes Ctrl+letter only without
  Shift. Plain Ctrl+C stays xterm's SIGINT, and macOS keeps xterm's defaults. Ctrl+Shift+V needs no handler:
  xterm leaves it unencoded, so Chromium's paste-as-plain-text reaches xterm's own paste listener.
- **Korean IME replacement bridge (WebKit).** WebKit — Safari and the desktop app's WKWebView — drives
  the macOS Korean input method without `composition*` events: a syllable's first jamo lands as an
  `insertText` input, every re-composition of it (`ㄱ`→`가`→`간`) as `insertReplacementText`, the next
  syllable as a fresh `insertText`, and the `keyCode` 229 keydown *follows* the input it produced.
  xterm 6.0.0 writes the bare `insertText` to the PTY at once and ignores `insertReplacementText`
  (upstream #5704, #6144), so `가` reached the shell as `ㄱ`, finals never arrived (`간` → `ㄱ`), and a
  syllable whose input landed before the previous key's keyup was dropped outright. `TerminalInstance`
  captures `input`/`keydown` on the mount host — ahead of xterm's own textarea listeners — and routes
  them through `terminalImeBridge`: a single Hangul `insertText` is held instead of forwarded, each
  `insertReplacementText` replaces the held syllable, and the held syllable reaches the PTY through
  `term.input` when the next syllable starts, on any non-IME keydown (Enter, Space, chords, arrows,
  digits), on a 229 chord or Escape — ahead of the bytes the rescue above writes, so Ctrl+U/Ctrl+C
  discard the syllable with the line instead of leaving it for the next command — on `compositionstart`
  (a real composition taking over), on `paste` (xterm hands the clipboard straight to `onData`, with no
  input or keydown to commit on) or on focus-out; modifier-only keydowns never commit. An unmodified
  Backspace the input method passes through while a syllable is held drops the held syllable instead of
  emitting DEL, since nothing reached the PTY; a modified one (Option/Alt+Backspace word-delete) commits
  it and stays xterm's. Once the replacement model has been seen, bare 229 keydowns are kept from
  xterm so its deferred textarea diff cannot echo a syllable twice under load; the rescued chords above
  still pass. Chrome and Firefox never emit `insertReplacementText` for an IME, so the bridge is inert
  there. Known gap: the held syllable has no on-screen preview until it commits (xterm draws one only
  for `composition*` input); upstream's #5704 adds that inside xterm — revisit when it ships.
- Heavy deps (Monaco / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
  A lazy chunk that fails to load (or a render throw) is contained by the `components/ErrorBoundary` the
  **shell** wraps each region in (see `shell/SPEC.md`), so a single panel degrades instead of blanking the
  app; panels themselves don't own the boundary.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
