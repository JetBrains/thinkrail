---
id: submodule-web-panels
type: submodule-design
status: active
title: panels — feature views
parent: module-web
depends-on: [module-contracts]
references: [central-integration]
tags: [ui]
---

## Responsibility

The layout-agnostic, store-driven feature views. A panel fills its container and never knows its
arrangement (so the mobile shell is an additive layer, not a rewrite).

Changes and Review keep their fixed toolbars outside a panel-owned `components/QuietScrollArea`; Projects,
Files, and Specs expose content for the shell-owned scroll wrapper described in `shell/SPEC.md`.
`TerminalInstance` wraps xterm with `QuietScrollFrame`, which skins xterm's descendant custom scroll control
without shrinking its hit target; top/bottom state comes from xterm's public `buffer.active.viewportY/baseY`
and `onScroll`/`onWriteParsed` API rather than pretending its non-native viewport has DOM scroll metrics.
Those edges also authoritatively signal whether vertical scrollback exists, allowing the frame to expose
xterm's otherwise-invisible controller for local intent and accessibility modes without inventing a second
scroll model. The same neutral intent-revealed thumb + directional curtains therefore follow the terminal
wherever it is placed. Feature views never receive or derive left/right/bottom placement to achieve that
treatment.

## Boundary

- **Owns:** `ProjectTree`. Each top-level project row is a compact 28px IDE-tree row:
  **always-visible chevron** + folder/name + a collapsed-only plain workspace count + an **always-visible Create
  workspace `+` in a fixed right-edge column**. That `+` is the **same control as the Projects-header Add
  project `+`** — both are `Button variant="ghost" size="icon"`, so they render identically and their glyphs
  line up on one vertical axis (both sit at the row's `pr-xs` right edge). The Create workspace `+` carries a
  tooltip and accessible name naming the shell's `Mod+N` chord and its `Mod+Alt+N` browser alias through `lib`'s
  `platformShortcutLabel` (see `submodule-web-shell` global chords); the context-menu item stays plain.
  Long names truncate before the count/action; there is deliberately **no visible Close or overflow icon**.
  Hover highlights the full row and the highlight remains while its **project context menu** is open.
  Right-click opens that PR-#167-styled menu at the pointer without selecting/navigating; a scroll-cancelled
  ~700ms long press is its touch equivalent. With a project-name button focused, the standard Context Menu
  key or Shift+F10 opens the same menu for keyboard-only use; arrow/activate/Escape keys work normally.
  The menu is neutral: **Plus Create workspace**, **FolderOpen Open existing worktree…**, separator,
  **X Close project**. Create is exactly the direct `+` flow. Open existing worktree opens the
  `ExistingWorktreeDialog` chooser fed by `workspace.listExisting` (branch + absolute path per row;
  detached-HEAD rows stay visible but disabled); choosing one calls `workspace.openExisting`, then expands
  the project and activates the attached row without starting a chat. Close
  opens a centered, neutral `ConfirmDialog` titled **“Close {name}?”**, description **“Removes this project
  from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it
  from Add project → Recents.”**, Cancel initially focused, and **Close project**; Cancel, backdrop, and
  Escape dismiss. Confirm fires `project.close` and waits for the full `project.updated` push—no optimistic
  removal; success is the
  row disappearing with no toast, while rejection keeps it and raises an error toast. Menu/dialog dismissal
  restores the source project-name focus; successful close focuses the fallback project name or the Projects
  view's Add project control. `ProjectTree` also owns the `NewWorkspaceDialog` the per-project `+` opens **and** each
  workspace row's hover-revealed **kebab menu** (`MoreVertical`, controlled `DropdownMenu`) — right-clicking
  anywhere on the row opens that exact menu at the kebab without selecting/activating the workspace, while
  the kebab remains the touch and keyboard-focus path. Its actions are a `DropdownMenuSub` **"Open in"**
  (rendered only when at least one editor was detected), **Copy path**, and **Reveal in file manager**. A
  ThinkRail-managed worktree additionally gets **Rename** when the connected host's protocol is at least
  `WORKSPACE_RENAME_PROTOCOL_VERSION`, plus **Remove workspace**; an external row gets only **Remove from
  ThinkRail**, whose confirm promises the checkout and its branch stay untouched.
  The Default gets neither mutation. "Open in" comes from the host-wide `editor.list`; GUI entries call
  `workspace.openIn`, while terminal-kind Vim activates the workspace and runs through `addTerminal`'s
  one-shot `initialCommand`. Copy writes `worktreePath`; Reveal calls `workspace.reveal`. These requests,
  `editor.list`, the project workspace-list load, the remove confirm (`RemoveWorkspaceDialog`), and the
  inline-rename controller below (`createRenameController` / `useWorkspaceRename`) live once in
  `workspaceActions.ts` so the shell's topbar workspace menu ([[submodule-web-shell-location-bar]]) offers
  the same actions — including the capability-aware pending rename — without a second implementation. The
  controller dispatches to the workspace captured when the edit started and resets when the hook's
  workspace identity changes, so a consumer that is not keyed per workspace cannot misdirect a pending
  name. **Settle** / **Keep active** (`workspace.settle` / `workspace.unsettle`, gated on
  `WORKSPACE_SETTLE_PROTOCOL_VERSION`) ride the same file.
  **The Settled shelf.** It renders only when the host advertises
  `WORKSPACE_SETTLE_PROTOCOL_VERSION`; an older host retains the raw flat list and order, with no sort,
  shelf, or settle controls even if rollback persistence carries stale newer fields. On a
  capable host, an expanded project renders a **sort row** (`↕` + a native select: Recent activity
  · Created · Name, the store's `workspaceSort`) above its rows, then the **live** rows from
  `selectWorkspacePartition`, then a **`Settled · N`** disclosure header (collapsed by default, store-held
  per browser) whose body lists the settled rows **slim** — single line, name only, a small **reason chip**
  (`merged` / `closed` / `idle 2w` / `by you`, long form in its tooltip), a hover **↩ Keep active** beside the kebab — ten at
  a time with a *Show 25 more* row. Live rows gain a hover **✓ Settle** beside the kebab (also in the menu
  and on right-click); it is disabled while the row's agent works or a result is unread, absent on Default.
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
  looks the same after reloading; the sibling `workspaceSort` module persists the sort row's choice the
  same way (the shelf's disclosure is deliberately not persisted — collapsed is the right default). Rows whose persisted expansion outlives this client's fetched lists
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
  Home while every client receives `project.updated`; on failure `project.inspect` → either offers to
  bootstrap the folder into a repo — a modal **`ConfirmDialog`**
  (confirm → `project.init`) — when it's `initable`, or surfaces the error in a **`NoticeDialog`** — so a
  non-git folder is never a silent no-op. The native picker remains the local fast path and keeps its raised
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
  leaving a modal for a terminal another client already closed. Also `FileTree`, `SpecsPanel`, `ReviewPanel`,
  `ChangesPanel` (the changed files under a fixed **panel-header row** — `h-panel-header-row`
  (`--panel-header-row-height`, currently 32px), shared structural geometry with workbench Group Headers
  and the chat header, not a value pinned here — that says **what** is being diffed via the
  **`ChangesScopeMenu`** scope pill + the shared **`BranchPicker`** target-branch pill, plus the
  **List | Tree** toggle (`store.changesView`, app-wide) switching a flat list and a folder
  **`ChangesTree`**; clicking a file in either opens/focuses its **center resource diff tab**, and every file
  row carries the shared **`ChangeRowActions`** menu. The row wrapper paints the complete hover/selected
  band, including the trailing menu slot; its inner open-file button remains transparent so that band
  cannot look clipped before the menu),
  `FilePane` and `DiffPane` as resource-registry dispatchers, the bundled lazy renderers under
  `panels/resources`, plus lazy `TerminalInstance`. Monaco's desktop-file plumbing — editor worker, curated
  reader contributions, Shiki adapter/languages, local loader, sole token-driven `EDITOR_THEME`, and
  `[data-theme]` re-theme observer — lives once in `monacoSetup.ts`; Pierre's lazy workbench provider owns its
  shared worker pool and CSS-variable theme.
  The slim header view-toggle segment (the ordered resource
  candidates, `Split|Inline`, `List|Tree`) is the shared `ToggleSegment` — whose active segment reuses the tab
  grammar's `control-bg-selected` (below), never a container surface, so the selected fill survives the
  high-contrast themes where `container-elevated-bg` collapses onto the toolbar surface.
  The `ChangesPanel` secondary toolbar paints **no surface of its own**: like the right-panel tab strip
  it shows the panel's `container-sidebar-bg`, so the two chrome rows read as one continuous surface. The **file-style tree row** (chevron/spacer
  lead, folder/file icon, truncated label, trailing slot; `min-w-0` so a row can shrink when it shares a
  flex line with a trailing control) is the shared **`TreeRow`**, used by both
  `FileTree` and `ChangesTree` so the two trees stay identical. Both trees **compact a single-directory
  run into one slash-joined row** (`apps/web/src`): the run continues only while a directory has exactly
  one child and that child is another directory, and the compact row expands/collapses the deepest
  directory as one unit. `ChangesTree` evaluates this against the changed-file tree; `FileTree` resolves
  only visible compact runs through its existing client-side directory reads, so the wire remains a plain
  immediate-directory listing. The **`+N −M` diff-count badge** is the shared **`DiffStatBadge`**, used
  only inside Changes: the flat list's file rows and the tree's per-file / per-folder counts.
  `ChangesTree`'s tree build + `+/−` aggregation + shared status glyphs live in the pure
  **`changesModel.ts`** (unit-tested; no store/transport — `ChangesTree` is presentational, fed `changes` +
  `onOpen`/`isActive` by `ChangesPanel`), together with the **diff-tab identity + scope vocabulary**:
  `scopeKey` / `diffTabId(workspaceId, scope, path)` / `diffTabName` / `scopeLabel` and the `splitPath`
  used by both the flat list's path rows and the diff header's path chip. The **branch combobox** is the
  shared **`BranchPicker`** (searchable, grouped Remote/Local, current pick check-marked, refreshed on every
  open with an explicit Refresh control as well) — one component for the New-Workspace dialog's *base* branch
  and the Changes header's *target* branch. **Remote is two layers**: one `Remote` parent over a subgroup per
  host-identified remote (`origin`, `upstream`), whose rows show branch names without repeating the remote.
  The full ref remains every row's selection identity, search value, and `data-branch`; the browser never
  splits `remote/branch`, because Git permits `/` in a remote name. Unconfigured tracking refs live under
  `Other` and keep their full ref as the row label. `BranchList.remoteGroups` is additive: against an older
  host that omits it, the picker falls back to one flat Remote group of full refs. The grouped path uses
  nested cmdk groups; the force-mounted parent hides only when cmdk has hidden every child group. A fork
  works two remotes, so a list that shows only `origin` hides the ref it branches from. The whole state
  *around* it — the list, `refreshing`, `refresh()` — is the shared
  **`useBranchList(projectId, onLoaded?)`** (`branches.ts`, over the offline-degrading
  `listBranchesOrEmpty`), so both pickers are identical **by construction**: the list is **keyed to the
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
separate project eyebrow). **No pitch prose in any state** — the marketing paragraph was removed as
unread; the screen is heading → banners → **one-to-three cards** (icon top-left,
label + explainer bottom-left; the primary is a filled-primary card carrying the stable `welcome-cta`
hook, others quiet `welcome-action`s). Welcome is **the mode fork**: with a project shown it always pairs
**"Start building"** (isolated worktree) with **"Work in project folder"** (the Default workspace) so the
two working modes are a visible choice, not a hidden default. The cards by state: **no projects** →
**"Open project"** (one card); **project + `hasSpecs`** → **"Start building"** (primary) + "Work in
project folder"; **project + no specs** → a spec-first **"Set up project"** (primary) + "Start building"
+ "Work in project folder". **"Open project" appears only in the no-projects state** — where it's the
only possible action; once a project is shown, opening another is the projects-rail **"+"** (the same
dropdown), so Welcome stays the *work-in-this-project* surface. That card hangs the shared
**`AddProjectMenu`** dropdown off it (same menu as the projects-rail "+": Open project / Enter host
path… / Open GitHub (soon) / Recents). Recents is the store's `recentProjects`: one last-opened path list
containing open + closed records with no status badge; selecting either runs the shared open flow and lands at Project Home, with a
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
CTA that opens Settings → Providers (`store.openSettings("providers")`). It reads `provider.status` (a
provider is "connected" iff any `configured`) on mount and re-checks whenever the settings dialog toggles, so
it disappears the moment the user connects one; a transport error degrades to *not* nagging (offline ≠ "no
provider"). All provider **management** lives in Settings, not here (the always-on strip is gone).

Beneath it, **`ProjectSkillsNotice`** is the pre-workspace trust surface (so trust is reachable with no
workspace yet): **presence-gated** — renders nothing unless the selected project ships committed skills —
showing a **count** ("ships N skills → *Trust project*"), a "N new → *Review & enable*" state for skills that
appeared after trust (`project.acknowledgeSkills`), else a quiet "N trusted" line. It never renders the
skills' (attacker-controlled) names before trust. The full manager (`chat/SkillsDialog` in **project mode**
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
  the first available model) and the popover's Default row is checked. Any explicit pick (model, level, or
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
  worktree's session is authoritative if the selected base branch differs). When the selected project is **untrusted AND ships
  committed skills** (a count from `project.aliasSkills`, never their names), a **trust notice** shows a
  *Trust project* button — the repo's skills stay withheld until granted (`project.setTrust`, which folds the
  updated project back into the store and re-previews); personal + bundled skills show regardless. When the menu is closed, **Enter submits** (matching the submit button's
  `↵` affordance) and
  **Shift+Enter** inserts a newline. Worktree-mode submit = `workspace.create({ projectId, baseRef })` → set active,
  and the dialog itself expands the project and refreshes its authoritative `workspace.list` (fire-and-forget;
  the `workspace.created` push is not relied on because an unloaded project list drops it) — there is no
  `onCreated` callback, so every mount site (`ProjectTree`, `WelcomePanel`, the shell's keyboard-opened
  instance) gets the same post-create fold → **always open a
  fresh chat** (`session.create({ workspaceId, model?, thinkingLevel? })` — a held model + effort apply even
  without a prompt, and travel together; with no held model the host still applies the saved/fallback
  defaults, explicitly passing the resolved pair whenever a model is available) → the typed
  prompt **and any attached images** are additionally sent as the first message (fire-and-forget `prompt`,
  forwarding `images` alongside `text`, with an optimistic user turn carrying the same attachments). The
  prompt hero accepts **image paste/drop** through the shared `usePromptImages` controller (same
  `imageAttachment` decode/downscale + chip surface as the chat `Composer`); submit is **held while any
  image is still decoding**, and a start with **only images and no text** is a valid kick-off. An **empty
  prompt with no images leaves the just-opened composer ready** — submitting the start-working
  surface always lands the user in a chat, never on a bare receipt (folder mode: the same tail after
  entering Default). A **rejected** kick-off `prompt` (a bad model / missing API key — e.g. picking a
  nonexistent model) surfaces as an `error` turn in the just-opened chat via `store.appendErrorTurn` (with
  `transport`'s `errorText`) rather than vanishing. The two rejections with **no chat to host a turn** raise a
  `store.toast.error` instead: a failed **`workspace.create`** (keeps the dialog open to retry) and a failed
  **`session.create`** (the dialog has already closed, the workspace exists — the toast is the only place left
  to report the dropped kick-off). (`gh` status lives in `SettingsDialog`, not the
  create dialog.) **`SettingsDialog`** is the app-settings surface the shell's topbar gear opens — a
  **store-driven two-pane shell** (left section rail + scrollable content pane; mobile collapses the rail to
  a horizontal segmented strip): `settingsOpen`/`settingsSection` live in the store so the gear AND the
  Welcome banner can open it deep-linked to a section. Live sections: **`ProvidersSettings`** (the in-app
  provider-auth surface — Connected cards each with a **Sign-out only when `canLogout`** (env /
  models.json auth shows a "Managed" tag instead, since the host can't unset it; a `kind: "central"` row
  is labelled "JetBrains AI" and its Managed tag points at the JetBrains AI card, which owns that
  connection); a **"Sign in with a
  subscription"** block of `canOAuth` providers; an **"Add an API key"** group of `canApiKey`-only
  providers (capped with a "Show N more" expander) — **both routes start `provider.loginStart`**
  (`type` `"oauth"` / `"api_key"`, issue #97) into the same store-driven `auth/LoginDialog` (open the
  URL / paste a code / answer the provider's own key prompts, `provider.loginReply` — no inline key
  field); a "configured outside the app" note for rows with neither flag; and
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
  closed reason codes to ThinkRail-authored text. On protocol v59+, the same card always shows the
  synchronized **Show quota in top bar** switch and **Refresh every _ seconds** field, in every Central
  lifecycle state. The flag defaults on; the interval defaults to 30 and accepts whole `1–3600` values.
  Off disables (but retains) the interval. The field edits locally, commits on blur/Enter, reports invalid
  range inline, and waits for `settings.changed` rather than installing optimistic authority. Older hosts get
  neither control. **`GithubSettings`** (the "Local GitHub" block — `github.authStatus()`
  Connected + login / Not connected + Refresh); **`AppearanceSettings`** (the catalog-driven theme
  settings, gated to fixed-only behavior below `THEME_SYSTEM_PROTOCOL_VERSION`. Current hosts explain that
  the mode/pair follow the user while each device reads its own system setting, then show one accessible
  radio group with top-level `Fixed — Use one theme everywhere` / `Match system — Follow this device`
  cards. Mode is deliberately separate from the manifest list: making System another theme row nests configuration in a
  radio-like option, while always showing all three choices gives inactive values equal visual weight. Fixed
  mode shows the existing manifest list and retained fixed choice. System mode shows appearance-filtered
  `Light theme` / `Dark theme` selectors plus a `Current on this device` row reading
  `<device icon> <Light|Dark> → <palette icon> <resolved label>` — the icons carry which half is the device
  appearance and which is the theme, since both halves are often the same word;
  either slot may independently be normal or high contrast. First enable sends mode + the themes-derived
  same-contrast pair atomically; later slot edits replace the complete pair, and returning to fixed changes
  only mode, preserving both choices. Exactly one theme mutation may be in flight from this panel; its
  controls use their real disabled state until the request settles, preventing rapid complete-pair writes
  from overwriting one another with stale sibling slots. Every action fires `settings.update` and
  **converges on the `settings.changed` broadcast** with no optimistic apply; rejection leaves
  controls/theme unchanged and raises a toast. An unavailable or wrong-appearance configured id is
  disclosed beside the effective same-appearance fallback and is never silently written back. The panel never owns a theme list,
  media-query logic, pair derivation, or fallback — all come from `themes`); **`LineWidthSettings`** (the
  live section immediately after Appearance — one page with stacked **Chat** and **Files** groups. Each has
  a 40–240 integer field with visible `symbols` suffix and explicit Save, plus an independent
  host-synchronized **No bigger than pane width** switch; defaults are 120/on. Invalid drafts stay local
  with an accessible range error; Escape restores the host value, Enter saves when valid, and a changed
  authoritative width from `settings.changed` replaces a stale draft. Mutations converge only on that
  broadcast and rejected calls toast without changing geometry); **`ChatSettings`** (the next live section —
  **Message order** radio cards over `store.chatMessageOrder` (Oldest first, the compatibility default /
  Newest first, the opt-in), one **Streaming response movement** two-handle range over
  `store.streamingResponseMovement`, then the three existing composer-growth cards. The movement control's
  copy is “Choose when the chat moves while an answer grows and where its newest edge lands”; one axis runs
  Top → Message box, Settle is 25–90, Trigger is 35–100, both step by 5 with a 10-point minimum gap, and
  the displayed default is 75%→100%. It exposes no runway/tail/lifecycle controls. Message order and
  movement both apply immediately and persist only in this client through the chat preference seam:
  browsers use current-host-qualified keys, while a native shell may inject its stable
  backend-profile/window adapter. Another browser, native window, or host is unaffected. Composer growth
  remains a top-level `AppConfig` field and converges on `settings.changed`, with a toast on rejection.
  Labels use “message box” rather than the internal “composer” name when explaining where the user types.
  The final **Subagents** block pairs the host-wide `subagentsEnabled` switch with a named **This workspace**
  `Use global` / `On` / `Off` control when a workspace is active; no workspace means no local block. The
  whole block requires `protocolVersion >= SUBAGENT_SETTINGS_PROTOCOL_VERSION`, so an independently shipped
  client never offers unsupported mutations against an older host.
  Global mutation converges through `settings.changed`, local mutation through `workspace.updated`, and
  neither is optimistic. `Use global` sends `null`, so later global changes continue to flow through);
  the
  **shell-owned injected Layout
  section** (Balanced/Focus/Review
  plus named custom preset cards. Custom capture/rename/delete updates the host-synchronized catalog and
  converges through `settings.changed`; current/default selection and independent side/bottom limits are
  frontend-local. With an active workspace each preset offers confirmable **Apply now…**, which asks shell
  to replace this window's frame and atomically preserve/reflow open resource identities in every retained
  workspace view; no current layout is published); the optional **shell-owned injected Update section**
  (the Settings shell includes its row only when content is provided; `panels` neither discovers native nor
  host update capabilities. If a later welcome removes injected content while Updates is selected, Appearance
  is rendered and highlighted rather than leaving no active row);
  **`WorkspacesSettings`** (the **Workspaces** section, listed only at
  `protocolVersion >= WORKSPACE_SETTLE_PROTOCOL_VERSION`) — one `SettingsRadioCards` group, **Settle idle
  workspaces after**: 1 / 3 / 7 (default) / 14 days / Never, written as `settings.update { settleIdleDays }`
  (`null` for Never) and converging through `settings.changed`; a valid host-configured non-preset value
  leaves the preset cards unselected rather than falsely displaying the default. The default is a week, not
  a long weekend: merged/closed PRs already settle at once, so the idle rule only catches dormant work and
  errs toward keeping a paused workspace live (a Thursday's work on the shelf by Monday reads as loss, not
  tidying). The copy names the three things
  that count as activity and the three things that never settle, because the setting is only legible
  together with those rules;
  **`TerminalSettings`** — a **Replayed output** size picker (`store.terminalReplayKb`, five presets from
  Off to 1 MB, `settings.update { terminalReplayKb }`, applies to terminals opened from now on) and, on
  Windows hosts at `protocolVersion >= WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION`, a **Windows shell** picker
  (Auto / PowerShell 7 (pwsh) / Windows PowerShell / Command Prompt,
  `settings.update { terminalWindowsShell }` — see `submodule-server-terminal`'s shell-selection decision
  for what each choice spawns). The protocol gate keeps a newer independently shipped client from presenting
  a setting an older host preserves but does not act on. The Windows-shell
  half is split into a **props-driven** `WindowsShellSettings` component rather than reading the store
  inline like the replay picker: zustand's React binding feeds `renderToStaticMarkup` its frozen
  `getInitialState()` snapshot (`useSyncExternalStore`'s `getServerSnapshot` argument), never a test's
  `setState`, so any settings section that must stay assertable under that render path takes its store
  values as props instead — the same shape `ChatSettings` already uses for `SubagentSettings`; and
  **`TemplatesSettings`** — two groups, **Global** and **This
  project** (the project group renders only with an active workspace), each a header with a **New**
  button plus its rows, fetched via **two independent `template.list` calls** (both refetched whenever the
  store's `templatesVersion` bumps, each with its own failure flag so one's success can never clobber the
  other's still-real failure): unscoped (`{}`) for **Global**, and `{ workspaceId }` filtered to
  `scope === "project"` for **This project**. The unscoped call matters specifically because the server's
  `template.list { workspaceId }` response is **shadow-merged** (`templates.ts`'s `listTemplates`: a
  project template wins over a same-named global one) — right for the composer's `/` menu, but if Settings
  used that same workspace-scoped call for its Global group too, a shadowed global template would vanish
  from view entirely with no way to find, edit, or delete it
  (`data-testid="template-row"`: name + description, and — project rows only — an
  **Open as file** action that opens `.pi/prompts/<name>.md` through the exact same `openTabs.ts`
  `openFileInTab` the file tree uses — at the **`keep`** intent, since a deliberate "open in editor" must
  not land in a preview slot a later click would silently replace — then closes Settings, and an
  **Edit** action; a global template has
  no worktree to open a file tab against, so global rows stay dialog-only). **New**/**Edit** open the shared
  `chat/TemplateEditorDialog` (see `chat/SPEC.md`'s Save-as-template bullet — it lives in `chat/` because
  `HistoryOverlay`'s save-as-template action needs the identical form, and `chat/` can't import
  `panels/`). **Delete** is a `ConfirmPopover` anchored to the row's own Delete button, calling
  `template.delete` directly — the dialog itself is never involved in deletion. **R4 — starter-templates
  offer:** when the **Global** group's fetch has
  resolved with zero rows and no error, its empty state swaps the bare "No templates yet." for that same
  hint plus a button (`data-testid="template-starters"`) — clicking it `template.save`s five verbatim
  starter templates (scope `"global"`, body assembled client-side via
  the shared `prompt` module's `assembleTemplate`, the same helper `TemplateEditorDialog` uses) sequentially,
  then bumps `templatesVersion` once, the same invalidation the row list already refetches on — the
  offer disappears on its own next render once the list is non-empty, no dismiss state to track. The five
  (review/explain/tests/commit/rename) are **the same set this repo checks into its own `.pi/prompts/`**:
  those ship at *project* scope, so only a ThinkRail checkout ever sees them, and "the templates ThinkRail
  ships" must mean one thing rather than two — change one, change the other. The composer's `/` menu
  carries the discoverability half (`chat/SPEC.md`: a `slash-templates-empty` footer nudge deep-linking
  here when no template exists anywhere), since this offer is otherwise two clicks deep in a dialog. **This
  project**'s empty state is unchanged (still the bare text) — the offer is Global-only, since it only
  ever seeds global files. No server change. **`NotificationsSettings`** is the single master on/off control
  for out-of-app attention notifications (default on), persisting `{ notificationsEnabled }` through
  `settings.update`. While enabled it also surfaces the live browser permission via the
  [[submodule-web-notifications]] barrel: an **Allow in browser** button when permission is still `default`
  (the click is the user gesture that calls `requestNotificationPermission`), a blocked hint on `denied`, and
  a granted/unsupported line otherwise — the visible, in-app acquisition path that does not depend on an
  out-of-focus event. The notification pipeline, suppression, and away-path permission preface live in
  [[submodule-web-notifications]].
  **`PrivacySettings`** manages the additional-data preference and
  confirmation together; the event contract belongs to [[submodule-server-analytics]].
  **`AnalyticsConsentDialog`** mounts once through shell after a capable host's unconfirmed config hydrates.
  It initializes the draft switch on and immediately persists `{ analyticsEnabled: true }`; persistence and
  broadcast activate the host gate while the dialog stays open. **Done**, Close, Escape, and backdrop persist
  the current draft with `analyticsConsentConfirmed: true`, so the ordinary result is on. Switching off
  immediately persists off/confirmed and the resulting config broadcast closes the dialog. Confirmed on/off
  configurations never mount or prime. Failed persistence leaves the draft and error visible for retry. Saved
  decisions survive restarts and change later through Settings. The dialog keeps only the short
  product-usage copy and shared switch; Settings adds the optional outcomes, report dimensions, and
  excluded content. Older hosts retain their legacy privacy control without the new consent dialog.
  **`FeedbackSettings`** is the final
  live section after Privacy: the same interview copy as the automatic prompt, stating that completing a
  user interview about the participant's ThinkRail experience earns 100 bonus credits in Central
  (JetBrains AI) — credits, never a currency amount — plus a real external anchor to the fixed Google
  Calendar booking page, opened in a new tab with `noopener noreferrer`. ThinkRail communicates the
  incentive only; attendance verification, eligibility, and credit fulfillment stay outside the app. This
  proactive Settings link is always available and deliberately does not call `feedback.respond`, alter
  automatic-popup state, or claim that booking alone earns credits.
  **`ModelsSettings`** is the **Default model** section, visible only at protocol v72 or newer. It re-reads
  `model.default` on open, whenever the live catalog changes (empty included), and after every save — the
  host resolves the saved model and its effort levels against its settled catalog, so a vanished or changed
  model never offers stale levels; only the latest read applies, and a failed read replaces the controls
  with a retry — and writes `defaultModel` / `defaultEffort` through `settings.update`, with an error toast
  if persistence fails. The host's `model.default` result is the displayed effective choice, including the
  first-available fallback when a saved model is missing; supported effort levels and the displayed effort
  come from that same resolved, Pi-clamped model. Both triggers are disabled, and choices in an already-open
  picker are ignored, while a save or re-read is in flight. At v76, **`ModelContextSettings`** adds
  one Default / 1M / Custom selector over every eligible GPT model the host returns as
  `ModelContextSetting[]`; Customize reveals one selector per provider/model pair, so the same model on
  different providers stays independently editable. Selection is keyed on the explicit `override`
  (Default = `null`, the catalog value pi reports). The shared control summarizes only the rows the
  contracts' `isSharedModelContextTarget` admits — it shows "Customized by model" when their overrides
  differ, counts the external rows it leaves alone, and is omitted when it would govern none — and
  choosing a shared preset replaces those rows' overrides in one `model.setContextWindow` call. Custom reveals a whole-number field bounded by the contracts' 272K–1M
  range with explicit Apply; the copy labels it an app policy, not a verified provider limit, and
  external values outside it stay visible but cannot be re-applied. Drafts are UI-local and are dropped
  when their authoritative override changes; inputs are not remounted, and after a disabled save focus
  returns only to the control that initiated it. Pi's shared configuration is authoritative — there is
  no optimistic value or AppConfig field; reads follow catalog/provider invalidation, fence stale
  replies, disable controls while pending, and replace controls with Retry on failure. The props-driven
  `ModelContextControls` owns presentation; older hosts get neither the block nor its requests.
  **`ReviewSettings`** is the
  **plan-review policy** section: the reviewer **model + effort** (`ModelSelector`/`ThinkingSelector` over
  `useModelCatalog`, written as `settings.update { reviewModel | reviewEffort }`; unset ⇒ default). The
  selector carries an **explicit default-model row** (`model-option-default`, labelled with the host's
  `model.default` result) that writes `{ reviewModel: null, reviewEffort: null }` — the null-clears wire
  form, see `submodule-server-settings` — so a chosen reviewer model can be restored to the host's new-chat default
  without hand-editing host state; while unset, the effort control runs on the default model's supported
  levels (fetched once from `model.default`) instead of an empty list. And an
  **auto-fix toggle** (`review-autofix-toggle`, a switch over `store.reviewAutoFix` →
  `settings.update { reviewAutoFix }`) — off means a `request_changes` verdict records findings and waits
  (the host gates its auto-fix cycle on it, see `submodule-server-todos`). And an **agent-review toggle**
  (`agent-review-toggle`, a switch over `store.agentReviewEnabled` → `settings.update { agentReviewEnabled }`)
  — off withholds the worker's in-session `request_review` tool so review happens only via the Review button
  (the host live-toggles the tool's active set on it, see `submodule-server-host-plan-review`). It lives in
  the props-driven `AgentReviewSettings` and is **hidden until the host negotiates v68**
  (`AGENT_REVIEW_SETTING_PROTOCOL_VERSION`): a pre-v68 host can echo/store the unknown field while still
  registering `request_review`, so the switch would misreport the worker's behavior. A single dimmed "General" nav item ("Soon") still signals the shell is
  built to grow. `ProvidersSettings`/`AppearanceSettings`/`LineWidthSettings`/`ChatSettings`/`TemplatesSettings`/
  `PrivacySettings`/`ReviewSettings`/`ModelsSettings`/`FeedbackSettings` and the app-wide **`InterviewPromptDialog`** are the
  panels-owned **integration pieces** (store + transport). The prompt renders the shared incentive copy and
  fixed Calendar anchor with `Schedule an interview`, `Not now`, and `Never show again` actions. Primary and
  middle-button booking activation open Calendar immediately and record `book`; close, Escape, and backdrop record `postpone`; permanent
  dismissal records `never`. The controlled dialog closes only after the host acks, and reports a rejected
  action without discarding the still-open choice. `SettingsDialog` receives the Layout section from the
  shell composition root so no panel reaches sideways into shell, and the `LoginDialog` stays presentational
  (`auth` module).

  Panels compose their own sub-panels
  (e.g. side tools → `FileTree`/`ChangesPanel`, resource panes → registered bundled renderers) — an internal hierarchy.
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
  plan content; another client can explicitly reopen the same host-owned page without inheriting placement. It renders the session's TODO plan document-scale,
  **status-grouped** (`planSections`): a single **`Session` block** (`plan-now-executing`) holds the
  current work — the active group(s)/loose items followed by the pending ones (no separate To-do
  section; item status glyphs distinguish in-progress from pending). Its **live status is a clickable chip
  in the header, right of the `Session` title** (`plan-now-status`, `data-glance`, off `sessionGlance`)
  that **opens the chat** (`openChatInTab`) so you can jump from the plan into the conversation: `working`
  → a `Working…` spinner, `waiting_question` → a `Question` chip. The awaiting question is ALSO
  **answerable in place**: the Session body's **live slot** (`PlanSessionLive`, which subscribes to the
  session runtime so its re-renders stay off the heavy PlanPane) hosts the SAME **`AskUserQuestionCard`**
  as the chat (`plan-ask`, found via `planView.pendingAsk`) inside a minimal `ChatActionsContext` (a real
  `session.answerQuestion`; the chat-only actions — reveal/focus/subagent — are no-ops) plus a derived
  `AskStatesContext`, so an answer submitted from the plan flows through the identical path as the chat.
  When there's no pending question AND no step is in progress, the same slot instead shows the **agent's
  latest message** (`plan-agent-message`, `planView.lastAgentText` rendered Markdown inside a bounded
  scroll area — `max-h-[12rem] overflow-y-auto` so the full message stays readable without pushing
  the plan items down — live while it streams) — so the plan stays transparent about what the agent is doing when it isn't asking or on a
  step; it renders nothing when a step is in progress or there's no message. Below the items the Session ends in a **chat/steer
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
  below). To jump to the chat you click the Session status chip (`Working…` / `Question`) or the
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
  `tr-text-metadata` — a group heading is never smaller than the items it holds. The Session block header carries the plan page's **add-task control**
  (the plan page's only in-page way to add): a `+ Task` button (`plan-add-task`) toggles an inline
  **auto-growing textarea** (`plan-add-input`) — plain **Enter adds**, **Shift+Enter** inserts a newline
  (multi-line like the composer), Esc closes — wired to the SAME `useChatTodos.add` as the popup's
  `TodoAddRow` — a loose **user** item plus the agent nudge — so the two entry points stay one flow.
  Every plan item carries a **hover Remove affordance** (`plan-item-remove` — `useChatTodos.remove`,
  disabled while the row is under review); adopted commits (host-derived) get no remove.
  Items keep a **scan-first item
  anatomy**: the item TITLE is
  the only full-size text (`tr-text-ui font-medium`), every detail is a step down (`tr-text-metadata`,
  subtle/muted) — so titles never blend into prose. Titles **wrap** (`break-words`, never truncated) — a
  long title is revealed in full, not clipped. A **done item carries no leading status glyph**
  (`hideStatusGlyph` — its section already says "done"; only an active review or a `changes_requested`
  warning keeps a leading glyph; the slot holds a ghost spacer so titles stay aligned). A **done item
  collapses to a compact two-line
  block**: line 1 is a LEADING chevron (matching the change-set disclosure's anatomy; non-collapsible
  rows reserve the chevron's width with a ghost spacer so every title in the list aligns) + the title,
  with the **review slot at its right edge**; line 2 is a quiet meta strip UNDER the title (the
  verification glyph — `ShieldCheck`/`CircleAlert` off `verificationStatus`, `N files`, and — hidden
  below `sm` so the title keeps its width on phones — short sha + `DiffStatBadge`), aligned to the
  title via the same ghost-chevron spacer. The meta lives on its own line precisely so the title row's
  right edge is free for the review slot — the reveal-on-hover action never collides with the title or
  the meta. **The whole row is the hover target** (`group` on the `<li>`, ProjectTree's pattern):
  hovering the row tints it and **reveals `Start review` — WITHOUT changing the row's height** (the
  button reserves its slot in-flow and only fades in; hover never resizes the row). **Expansion is a
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
  precedence order, the non-clickable pulsing `Reviewing…` status (`plan-item-reviewing`, off the
  host-derived `review.reviewing` — the review runs as a hidden subagent, so there is no chat to open),
  the warning `Changes requested · N` chip, or the
  primary-filled `Start review` button (`plan-start-review` — the standard **small** action button:
  `h-6`/`tr-text-action`/`control-primary-bg`, the same size as `SendReviewButton`, not an oversized
  `min-h-8` block) for an unsettled reviewable item. The two **status**
  readouts stay always visible (state, not an action); the **`Start review` action reveals on the
  row's hover / keyboard focus**, exactly like the ProjectTree kebab: `[@media(hover:hover)]:opacity-0`
  + `[@media(hover:hover)]:group-hover:opacity-100` + `focus-visible:opacity-100` — so a wall of
  primary buttons never paints across every reviewable row on desktop, yet on a **touch** device (no
  hover) it stays visible, and it never sticks the way `group-focus-within` did. It is an **in-flow**
  button on the title line (the meta on line 2 frees that right edge, so the title simply shrinks for
  it — no overlap, no empty reserved slot). Still one slot, no duplicates — the change-set disclosure
  row carries NO review affordance.
  `Start review` fires the AGENT review (`todo.startReview` — a hidden review subagent) and STAYS on
  the plan page: the row's `Reviewing…` pulse and a toast are the only signals, success AND failure —
  the review runs with no chat of its own, so the toast must carry the error. The verdict lands via the
  `review.changed` broadcast (`useChatTodos` refetches the plan on it), not a `pi.event` for this
  session — the subagent's events are hidden; a post-ack failure lands via the `review.failed` broadcast
  (`useChatTodos` raises it as an error toast, filtered to the owning `sessionId` and deduped across split
  views by the toast body).
  **Plan-review STATE is always derived from the plan; only the ACTIONS are host-version-gated on
  `transport.supportsPlanReview` (v67).** `reviewables`/`unsettledReviewables`/`planReady` come from
  `TodoItem.review` regardless of host version — gating them to empty would let `planReady` read ship-ready
  over an unreviewed step. Against an older host that serves no `todo.startReview`/`reviewAll`, `PlanPane`
  only disables the mutating affordances (per-row `Start review`, both `Review All` triggers), so an
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
  `CircleAlert` (`StatusIcon changesRequested`, `data-changes-requested` — popup row and plan page
  alike), the plan page's title row grows a warning **`Changes requested · N`** chip
  (`plan-item-changes-requested`; N = `planView.itemOpenFindings`, the reviewer's open comments
  matched by `origin` provenance (path-join fallback for provenance-less ones) — the Review tab is
  the truth; the chip
  `requestToolView`s the Review tab) and the verdict's `feedback` note renders inline
  (`plan-item-review-feedback`); approving settles the item — the plan page shows a **`Verified` label**
  in the row's review slot, right of the title (`plan-item-verified`, `CircleCheck` + text, success tone),
  and `data-reviewed` on the row (the popup keeps the circled `StatusIcon reviewed` glyph); `planView.reviewSettled` is the
  one derivation — approved AND no unreviewed delta, so a fresh revision drops the item back out of both
  the label and the reviewed counter. **The header is a title + a lifecycle STEPPER and a kebab menu**. The stepper (`plan-progress`)
  renders the plan's shipping funnel — **Build (`d/t done`) → Review (`r/k reviewed`,
  `plan-review-progress`, only when the plan has reviewable items) → PR (`plan-pr-stage`,
  `data-state`)** — each stage wearing a glyph for its state: done (check), active (the stage the
  plan is currently at), pending (muted). The PR stage reads the same `useOpenBranchReview` lookup
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
  `fix` (N steps carry changes_requested → **Show step** scrolls to the first flagged item and
  auto-expands it via the `focusRequest` token — `{ id, tick }`, tick bumped per click and consumed
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
  Title (`pr-compose-title`) + Description (`pr-compose-body`, prefilled from the plan) fields;
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
  cannot write through after that hook has moved to another branch. The focus-refetch overwrites state.
  Workspace activation explicitly opts into the host's 60-second settled-answer cache with
  `allowCached: true`, while omission on focus preserves the wire's original force-fresh behavior for
  older clients, so a PR closed/merged on GitHub drops out of the chip, label, and stepper on that
  refetch instead of sticking until remount. Focus received while disconnected latches that fresh
  intent and spends it on reconnect rather than falling back to a cache-eligible activation read. The
  workspace's `fsChanged` tick re-reads with `allowCached: true` (`reload`): the host drops its cached
  answer on a `.git` meta nudge, so a PR opened or pushed from a terminal still surfaces, while a fresh
  read would `git fetch`, write `.git`, nudge again, and loop. The
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
  flow — always with the LAST edited title/body (the `lastPrSubmit` ref, set on every submit,
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
  construction, it reads through the same `useChatTodos` hook as the plan popup (per-mount fetch +
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
  Monaco/shiki/xterm stay lazy. Tab strips, group headers, side stacks, and center topology are not panel
  surfaces; the shell layout module wraps these renderers.
- **Allowed deps:** `store`, `transport`, `components` (`SkeletonRows` — every async panel's pending
  state renders content-shaped skeleton rows, never a bare "Loading…" line), `@thinkrail/ui/*` (incl. `popover`/`command`/`textarea` for the
  dialog), `chat` (`ModelEffortPicker` + the `useModelCatalog`/`useModelPreferences` hooks that feed it,
  reused by `NewWorkspaceDialog`; `ModelSelector`/`ThinkingSelector`, still mounted by
  `ReviewSettings`/`ModelsSettings`; `modelPicker`'s `AUTH_KIND_LABEL`, the one connection-kind vocabulary
  `ProvidersSettings` shares with the picker; `Markdown`,
  reused by `MarkdownPreview`; `TemplateEditorDialog`, reused by `TemplatesSettings`), `resources`, `lib`, `themes` (catalog + generic application contract),
  `contracts`; `@remixicon/react`; and the heavy libs each lazy panel owns (`monaco-editor`, `shiki`,
  `@xterm/*`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

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
  Scroll-backed view state goes through the one `useScrollViewState` hook: the offset is saved when the
  scroller detaches and re-applied when a scroller attaches. A renderer may fill its scroller only after
  mount — the Pierre surfaces render nothing until their shared worker pool has initialized — so a
  restore the scroller cannot yet hold stays pending until its
  content grows to fit or the user scrolls, and a pending offset is what gets saved if the tab leaves
  first. Without that hold, a tab switch back to a source diff landed at the top and then persisted 0.
  Two or more candidates become one ordered toggle whose ids are the test hooks. Threads whose selectors
  the selected renderer cannot place for the pane's view or diff intent remain visible in an unplaced
  strip; its action switches to the first candidate that advertises matching anchor geometry for that intent.
  Bundled registration is a workbench-mount side effect, while renderer implementation imports stay lazy.
- The singleton side-tool renderers are **Projects | Specs | Files | Changes | Review**. Their current
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
  whose native tooltip — `reviewModel.outdatedReason`, shared with the thread card's label — says what
  could not be re-found, by the anchor's own selectors: text that was not matched again, a position in
  bytes that changed, or a whole file that is gone. The wire carries no cause, only the state, so the
  text and byte wordings both admit "or the file is gone" rather than claim a precision the client does
  not have; the rule itself is [[submodule-server-reviews]] re-anchoring step 4).
  The locally selected center resource's section **auto-unfolds** when it is a reviewed file, and an
  expansion never auto-collapses (folding is the user's gesture alone — a send opening its chat tab must not
  fold the section the user was reading); **Drafts rows are numbered** (1., 2., …) instead of wearing
  the pending glyph — and the workbench tool router **reveals the Review tool** when such a tab is
  ACTIVATED (keyed on the local selected-resource change, so a draft saved in an already selected resource
  never yanks attention; `selectActiveReviewedPath` is the shared derivation). Each
  comment row is a **navigation gesture**, one rule for every author: a row with a linked chat
  (`comment.sessionId`) opens **the discussion** (its chat tab); one without — every draft, since a
  draft is never sent — opens the file **focused on the comment**. The file stays one hover-action
  away (the `FileText` glyph runs the file+focus navigation; the chat glyph is gone from open rows).
  The file focus works through (the store's
  `reviewFocusRequest`, consumed exactly once by the pane: Monaco reveals the anchor line — including
  on a fresh mount, via `onMount` — the preview scrolls the in-flow card into view). **No editing
  here** — the in-file card is the editor; the row's action icons (their own layer, never triggering
  navigation) are per-row **Send** (→ `review.sendComment`, opens the created chat tab via the same
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
  review pushes. Because Pierre 1.5.1 keys React annotation wrappers by array index, each mount keeps
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

  **Monaco renders desktop files only.** `reviewWidgets.ts` keeps its content-widget selection affordance,
  context-menu action, decorations, and view-zone reconciliation for that one surface. It exposes stable
  zone nodes keyed by comment id; `MonacoReviewZones` portals the shared React `ReviewThreadCard` and
  `ReviewComposer` into them, while `ResizeObserver` feeds their measured heights back to Monaco. An
  unrelated push therefore keeps the same keyed draft textarea, including the shared card's Escape-cancel
  and shortcut-save behavior. Threads without a `lineRange` stay in the same unplaced
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
  passing its anchor-keyed `worktree`/`base` surfaces through the registry props.
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
  moves on must not land in the new workspace's view (reads are generation-stamped — latest wins, abandoned
  ones stay silent). A `null` workspaceId reads nothing, which is also how a component expresses a
  *paused* read. A visible `FileTree` directory probes while collapsed only as far as needed to identify
  its compact single-directory run; descendants below the run's deepest directory mount and read only
  when that compact row is expanded. No tick has to be threaded down as a prop.
  Its users — `FileTree` (root + each visible directory chain), `ChangesPanel` (`git.status`),
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
  above individual rows and is keyed by every directory path a compact row represents, so shortening or
  lengthening a chain cannot hide descendants that were visible before the refetch; vanished dirs drop out
  via their parent. `ChangesPanel` re-reads
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
  the one the user is waiting for. Panels are mounted only for the active workspace,
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
  hint sits above the retained tree; without one, it replaces the loading state. The tree build (`specTree.ts`)
  assumes a well-formed graph — **parent cycles are `spec_validate`'s problem, not the viewer's** (cycle
  members are unreachable from any root and simply don't render) — but the walk is **visited-guarded**,
  so a malformed graph can never hang or loop the UI. Tree only in this slice — no cross-edge display,
  no editing, no validation badges, no graph canvas.
- `SpecsPanel` is a compact **document-first tree**: spec nodes are container **and** document, so the
  controls make both roles explicit. Hierarchy uses fixed per-depth indentation + chevrons, deliberately
  **without connector rails or branch elbows** (persistent lines overloaded the narrow rail). The padded
  **chevron alone** expands/collapses, while the rest of the row is a native document button whose
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
  there.
- **Chat deep-links remain arrangement-agnostic.** A shell-owned **`LayoutIntent`** names the singleton tool;
  the shell resolves its current side/group, reveals it in place, and selects it locally. `changesRequest`
  and `specRequest` add the one path to focus/open without naming a layout destination. A divider chip that
  only reveals a tool therefore needs no fabricated path or fixed-right-panel assumption.
  `ChangesPanel` watches `changesRequest` (set by a chat turn-divider's "files changed" chip),
  **highlights** the requested file's row (resolved with `matchesWorktreePath` against `git.status`) **and
  opens its diff tab** in the destination center group's **preview slot** — the chip/list-row click *is* the
  user's explicit ask to see
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
  content, and the tree row lights up from the local selected-resource identity. That intent is
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
  via `useWorkspaceTurns`, which fetches `workspace.turns` once per workspace and connection on hosts at
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
  never the first click. The review tab has two **view modes**, chosen by a `Stacked | One file` segment
  in its toolbar and held app-wide (`store.changesLayout`, like `changesView`): *Stacked* is the
  continuous list; *One file* shows one section at a time with `Prev / Next` and a `n / N` counter
  (`V` marks viewed and advances, `Alt+↓` / `Alt+↑` step files). Both modes read one model —
  the scope's ordered file list, `viewed`, `activePath`, collapse overrides, `Split | Inline`, ¶ — so
  switching never loses review progress; a second tab kind per mode was rejected for exactly that reason.
  **The Changes sidebar is the review tab's navigator**: its row highlight follows the tab's
  `activePath` (the section whose header has crossed the toolbar's midline, or the single file shown),
  viewed files carry a check glyph, and clicking a row reveals that section (and expands it if it was
  collapsed); `changesView` defaults to **Tree**, and a file row is `change-item` in both views because
  it is the same thing. The list ends in a measured tail the height of the viewport so the last file can
  be scrolled to the top and become active, as on GitHub. The scroll-spy never auto-reveals the Review
  tool: `selectActiveReviewedPath` deliberately ignores the review tab, because a reveal fired by
  scrolling would replace the Changes navigator in its shared side group mid-read.
  **Hunk triage is an overlay on the same tab, not a second mutation model.** In a mutable scope every
  hunk toolbar gains **Keep** beside the existing Revert and Ask-agent actions; a kept hunk is recorded
  on the tab (`kept[path]`) under a **content key** — a hash of the hunk's removed + added text — so
  the decision survives the line shifts a neighbouring revert causes and lapses the moment the agent
  changes that hunk again. A *reverted* hunk needs no state: ThinkRail's revert restores the base text,
  the hunk leaves the diff, and the toast's Undo is the way back. The section header shows `k/n kept`
  and a file whose hunks are all kept is marked **viewed** (one-way), so hunk and file progress are one
  model; the stacked view's bottom bar shows `n of N reviewed`, **Next unreviewed** (`J`, wraps) and
  **Mark all viewed**, and `V` toggles the active section. There is deliberately no *Revert all*: the
  host has no atomic multi-file discard and a bulk destructive action on a review surface earns its
  keystroke only once it exists server-side. The per-file `DiffTab` passes no triage and is unchanged.
  **The reviewer's story is a walk, not a report.** When the workspace review carries a `guide` (the newest
  plan-step verdict's summary and suggested reading order, see [[submodule-server-reviews]]) or any open
  agent finding, the stacked view grows a left **review guide rail** (`ChangesReviewGuide`, toggled from the
  toolbar, never shown in One-file mode): verdict badge + summary, the numbered reading order (steps for
  files outside the scope are disabled rather than hidden, so the order stays legible), and the findings.
  `guideSteps` is the one derivation — reading steps first, then open agent findings by path — and
  **Start / Next / Restart** (`N`, `P` back) walk it: a step reveals its section through the tab's one-shot
  reveal, a finding step also fires the store's `reviewFocusRequest`, so the thread card is scrolled to by
  the same path the Review panel uses. *Fix this one* and *Apply fixes* are the Review panel's send paths
  (`sendReviewComment`, `sendReviewBatch` over the open finding ids), not new mutations. **Scale rules**:
  a section whose file changed more than 400 lines, or whose path is a lock/generated file, mounts
  collapsed behind *Expand* / *Open as tab*; a scope with more than 50 files shows a dismissable notice
  offering *One file*; nothing switches mode on its own, because a review surface that re-arranges
  itself mid-review loses the reader's place. The list is a `react-virtuoso` grouped list (one group per
  file, header sticky); Pierre `CodeView` was evaluated for the container and rejected because its items
  are only `file` / `diff`, so it cannot host the rendered-markdown, image, SVG, CSV, JSON, notebook, and PDF
  renderers that a section must dispatch exactly like `DiffPane` does. **A section holds its shape
  before it has its diff.** Each section reads `git.diffFile` lazily when its body first becomes
  visible, through the pane's `SectionContentCache`: one in-flight read per path is shared by whoever asks,
  and the result is stored even if the section that started it has already scrolled out, so remounting
  never re-reads (a failed read stores nothing, so *Retry* reads again). While loading, a stacked section's
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
  `Split | Inline` controls for every section at once, the scope and target as read-only chips (the scope
  is chosen in the Changes header and is part of the tab's identity), the file / `+ −` totals with the
  viewed count, *Collapse all* / *Expand all*, and `Send review (N)` over the workspace's drafts.

  Bundled candidates are registered once from `panels/resources/register.ts`: `thinkrail/code` renders
  every source diff with Pierre `FileDiff` and supports copy, layout, and whitespace controls;
  `thinkrail/markdown` supplies `RenderedDiff`, and `thinkrail/binary` reports both sides' byte sizes. Rich
  renderers omit those controls, except CSV, JSON, and notebook diffs support modified-source copy.
  `thinkrail/lfs` claims the host's `application/vnd.git-lfs` text (a file that *is* a Git LFS pointer,
  whatever its extension) above the code renderer and shows a card — "Stored in Git LFS", size, object id,
  `git lfs pull` hint — in the view and one card per side in the diff, because three lines of pointer
  protocol in a Monaco editor explain nothing about why a `.png` has no image; Source stays one toggle
  away, and the renderer places no anchors, so a pointer's threads live in the unplaced strip.
  `RenderedDiff` keeps its worker-isolated htmldiff merge,
  loading/error states, and token styling, but advertises no diff anchors: both sides' threads stay in the
  pane's unplaced strip, **Show in Source** selects the code renderer, and diff authoring is available only
  in Source. It is selected by registry match rather than a path branch in the pane. Scopes whose modified
  side is historical receive no review surface or mutation actions.

  **The rendered diff focuses on its changes the way Pierre does.** The merged document is parsed once
  and a prose-root block is *changed* when it is or contains `ins`, `del`, or a `[data-diff-node]`
  element, **or** when its exact rendered HTML differs from the before unit it aligns with
  (`changedUnits`). Alignment is positional: the before and merged unit sequences (blocks, then each
  list's items) are matched one-to-one by an LCS over their attribute-stripped HTML (`shapeKey`), so an
  identical twin elsewhere in the document cannot vouch for a block, swapping `open` between two
  otherwise identical `<details>` flags both, and a unit with no aligned counterpart stays visible. The
  second clause exists because htmldiff keys ordinary tags by tag name alone and emits the *after*
  tokens for equal runs: a ticked task checkbox, `<details>` → `<details open>`, a list's `start`, or
  an image's `alt` never earn a mark, so without it they would collapse as "unchanged" and the empty
  notice would claim an identical preview. Such a block is kept visible in its after state (unmarked,
  since the merge has nothing to highlight). Runs of unchanged
  blocks collapse with git hunk semantics (`renderedDiffFocus.focusSegments`):
  `FOCUS_CONTEXT_BLOCKS` (2) blocks stay visible on each side of a change, a leading or trailing run keeps
  context only on the side that touches one, and a run of a single block is never hidden, because an
  expander that replaces one paragraph saves nothing and costs a click. The same rule applies one level
  down to the items of a changed `ul`/`ol` when at least one item changed — a markdown spec routinely
  carries a thirty-bullet list with one edited bullet — while a list whose only difference is its own
  attributes, and tables, quotes, and nested lists, render whole; ordered items keep their number
  (`start` and an explicit `value` are read with HTML's integer-parsing rules, so the invalid values
  React leaves in the DOM — `start=""`, `value=""` — fall back to `1` / the running count exactly as
  the browser does; a `value` wins, the rest count on) so hiding items never renumbers the rest.
  Each hidden run is one `rendered-diff-collapsed` button naming the count and, for block runs, the last
  heading it hides (the section the visible content below it belongs to — the analogue of Pierre's
  line-info separators).
  Clicking expands the run in place, one-way; expansion is component-local and positional, so a live
  refresh keeps an expansion whose run still starts at the same position and resets the rest. Nothing
  offers the whole merged document at once: Source and the file preview already do. A merge in which no
  block changed — front matter is stripped before rendering, and whitespace or HTML comments don't
  render — shows the `rendered-diff-empty` notice pointing at Source and collapses the document to a
  single expander rather than presenting an unmarked full document as a diff. Visible blocks are
  re-created from the parsed elements (tag, attributes, `innerHTML`), never wrapped, so the DOM the
  prose styles target is unchanged; the boolean attributes the sanitizer lets through (`details[open]`, a
  standalone checkbox's `checked`/`disabled`) are mapped to `true` because React drops an empty-string
  boolean.

  `thinkrail/image` renders host-backed byte URLs with fit, natural-size, button/wheel zoom, intrinsic
  dimensions, and byte size, always on the `.media-backdrop` transparency checkerboard (the view's image
  and both diff frames; the difference blend keeps a flat canvas so the checker cannot leak into the
  subtraction), because on a solid dark canvas a dark logo on a transparent PNG is indistinguishable from
  an image that failed to load. A drag over the rendered intrinsic box produces one normalized `region`
  selector; placed threads project that selector back to outlined rectangles and numbered markers, with
  cards below the image. Its diff defaults to 2-up and also offers swipe, onion-skin, and difference-blend
  modes. Two-up anchors directly to the side drawn on; overlaid modes expose the active old/new anchor space
  explicitly, so base and worktree coordinates are never translated. An absent side is a labelled empty
  frame. Image zoom, rendered intrinsic aspect bounds, region rectangles, swipe clipping/divider position,
  and onion opacity are measured geometry and therefore the bounded exception to the no-inline-style rule:
  those values alone are inline,
  while every colour, border, spacing, and control skin remains a token utility.

  `thinkrail/svg` is the higher-ranked SVG candidate while Source remains available through
  `thinkrail/code`. Its `sandbox=""` iframe receives a minimal `srcdoc` document whose only image is a
  percent-encoded `data:image/svg+xml` URL; SVG source never enters the document's HTML stream. The frame
  has no script or same-origin capability and a CSP of `default-src 'none'; img-src data:; style-src
  'unsafe-inline'`, so SVG scripts and external references remain inert. The document receives only
  resolved workspace/content background and foreground semantic token values and is rebuilt via
  `onThemeSwap` from `@thinkrail/ui/theme`. A drag over the frame authors the same normalized `region`
  selector a raster image does, measured against the intrinsic size parsed from the root's
  `width`/`height`/`viewBox` (the frame is sized to that aspect, so the contained rectangle is the frame).
  It never degrades to a whole-file draft: an earlier revision did (`selectors: []`, label `file`, pending
  a source-span mapping), and a dragged rectangle that reached the agent as "the whole file" read as lost
  coordinates. SVG element source spans are still not mapped, so the anchor is geometry, not a line range;
  the fractions are of the SVG's root viewport, and the send package tells the agent to invert the
  viewport-to-viewBox transform (viewBox origin plus `preserveAspectRatio`) to find the elements under
  them. Its diff uses the same four visual modes and two anchor spaces as raster images; each side's
  overlays project through its own object-contain rectangle, and only measured aspect bounds plus
  swipe/divider/opacity overlay geometry use inline values.

  `thinkrail/csv` parses CSV/TSV locally with an RFC-4180 state machine, including escaped quotes, CRLF, and
  quoted fields spanning source lines. The delimiter is **inferred from the shape of the first twenty
  non-empty records** (`sniffDelimiter`, BOM ignored): a candidate among `,` `;` `\t` `|` qualifies only
  if it splits every sampled record into the same number of fields, at least two; comma wins whenever it
  qualifies, otherwise the single widest qualifier, otherwise comma — so a header value that happens to
  contain semicolons never reclassifies a comma file, while a locale export of `id;name;score` is a table
  and not one column; `.tsv` is always tab. A diff samples the modified side first and falls back to the
  original, so both sides parse with one delimiter. The view keeps the header fixed and virtualizes data rows with
  `react-virtuoso`. A selected cell or shift-extended rectangle emits the selected rows' raw-file
  `lineRange` plus `structural { scheme: "table-cell", ref: "<row>:<column>" }`, with header row zero; a
  missing cell, or a coordinate whose row no longer intersects the host-reanchored line range, is omitted
  from actual placement rather than guessed. The unified diff aligns complete raw-row keys with
  `diffArrays`, pairs equal-length remove/add runs as changed rows, and highlights only differing cells;
  unmatched rows use success/error subtle surfaces. Diff selections use modified source lines except removed
  rows, which remain in the base anchor space.

  `thinkrail/json` matches `*.json` and `*.jsonc` only. Its scanner is **JSONC-tolerant by design** —
  `tsconfig.json`, `.vscode/*.json` and most editor settings files carry comments and trailing commas,
  and a tree that refused them would send exactly those files to Source — but it is honest about it:
  the document records the `dialect` it needed, and a `.json` file that only parsed as JSONC shows a
  `json-dialect` notice above the tree (a `.jsonc` file does not, because there it is the point); a
  file that is not even JSONC renders an explicit `json-invalid` notice pointing to Source instead of a
  blank pane, in both the view and the diff. The scanner builds the parsed value and an RFC-6901
  pointer-to-source-line index in one pass; duplicate object keys resolve to the last occurrence,
  matching JSON value semantics. Selecting a non-root node emits
  its mandatory `lineRange` plus `structural { scheme: "json-pointer", ref }`; a pointer absent after an edit,
  or one now naming a node outside the host-reanchored line range, is reported unplaced. The collapsible
  unified diff comes from a `jsondiffpatch` instance with move detection
  and stable object hashes, tinting added/removed/changed/moved nodes and showing primitive replacements as
  old → new. Removed nodes and comments stay on `review.base` with base scanner lines; all other selections
  use the modified document and `review.worktree`. Invalid source renders no tree, leaving Source as the
  alternate candidate.

  `thinkrail/notebook` accepts nbformat-4 JSON and reuses the tolerant positional JSON scanner to bind every
  rendered cell to its raw cell-object line range. Nbformat 4.5 ids are the `ipynb-cell` structural ref;
  older notebooks use `index:<zero-based>`. Markdown cells use the shared Markdown parser without raw HTML.
  Its notebook component map (`notebookMarkdownComponents(resource)`, built per notebook because image
  resolution is relative to the notebook's own path, as in Jupyter) permits base64 PNG/JPEG/GIF/WebP/AVIF
  images in the app document, routes SVG data images through the empty-sandbox `NotebookFrame`, loads
  **relative** images from the host `/files` route through the same injected byte-URL composer the
  markdown preview uses (a traversal above the worktree is inert text, never a request), and renders
  links plus every remote image URL as inert text — a notebook's `![plot](figures/x.png)` is repository
  content, a third-party URL is not. Notebook language metadata must resolve through the shared Shiki catalog; missing
  metadata defaults to Python and unknown values render as plain text. ANSI is removed from stream and error
  output. MIME bundles choose image (PNG, JPEG, GIF, SVG), HTML, JSON, then plain text. SVG output stays a
  data image inside the inert frame document.
  HTML output uses the same sanitized empty-capability document as the HTML renderer. Cell review emits both
  the raw line range and structural ref, keeps cards below the resolved cell, reports only actual placements,
  and hash-stamps an open composer. Diffs align ids first and exact normalized source second. Remaining runs
  are aligned in order by bounded line-token similarity; no character-level all-pairs diff is used. Changed
  source uses one provider-backed unified Pierre cell diff, image output reuses visual comparison modes, text
  output uses Pierre, and HTML/JSON output stays side-by-side. Original cell selectors remain in `review.base`;
  neither side is translated.

  `thinkrail/pdf` matches byte PDFs and lazy-loads both pdf.js and its Vite-emitted worker. Placement is not
  reported until page-count metadata is known. A page-region thread is placeable exactly when its one-based
  page exists, independent of whether that page currently owns a canvas. A focused page is forced into the
  render window and focus is consumed only after its region card mounts. The render window is the visible
  pages plus two pages on each side. Work leaving it is cancelled; canvases and bitmaps are released, and
  diff object URLs are revoked. Composer identity uses document identity plus page, never zoom. The toolbar's
  current page is the first visible page (the navigation target until any page reports visibility), so it
  follows scrolling as well as navigation; that page and the zoom are written to tab view state when the
  view unmounts, like the other scroll-restoring renderers. PDF diffs use one synchronized page sequence: each page pair
  starts in 2-up and can switch among the shared swipe, onion, and difference modes, with an absent side
  represented by an explicit empty page frame.

  `thinkrail/html` parses source into a document before previewing it in an empty-capability `sandbox=""`
  iframe. The sanitizer removes active, navigational, embedding, and form elements; strips event handlers and
  non-`data:` resource URLs; and turns anchors into inert text-bearing elements. Styles remain. Notebook HTML
  output uses this same sanitizer. The injected CSP is exactly `default-src 'none'; img-src data: blob:;
  style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src
  'none'; child-src 'none'`. The diff is the shared visual frame constrained to 2-up sandboxed documents only.
  It advertises no anchor geometry, so HTML threads remain in the pane-owned unplaced strip and Source is the
  only authoring candidate.

  Pierre parses the two complete text sides (`absent` → `null`) with the current ignore-whitespace value,
  uses the `thinkrail` CSS-variable Shiki theme, word-level inline changes, collapsed unchanged regions with
  line-info hunk separators, and split/unified layout; phone-class viewports force unified and hide the
  Split/Inline segments, so no control promises a layout the viewport refuses. The collapse threshold
  (`COLLAPSED_CONTEXT_THRESHOLD`, 3 lines) is git's own default hunk context (`-U3`), so what Pierre
  keeps visible around a change is what a reviewer already expects from `git diff`, and the same number
  feeds `renderedDiffLineNumbers`, which decides whether a thread's end line is on screen or parked in the
  unplaced strip — one constant, so the two can never disagree. The focus reveal (`usePierreFocus`)
  installs a subtree `MutationObserver` plus a `ResizeObserver` only while a focus request is pending
  and disconnects both the moment the card is revealed; it is not a standing listener, so Pierre
  re-rendering on every annotation change costs nothing once focus has settled. A diff whose
  two sides are identical (a file that left the change set after an out-of-band commit) shows an explicit
  `diff-empty` notice above Pierre's surface instead of a blank pane. The lazy Pierre file/diff modules
  mount `PierreProvider` only when their surface renders; it hands Pierre's `WorkerPoolContext` the module
  singleton (`getOrCreateWorkerPoolSingleton`, four module workers from `@pierre/diffs/worker/worker.js`)
  and **never terminates it**: the pool is created the first time any code surface renders and then lives
  for the page. Pierre's own provider tears the pool down the moment its last instance unmounts, and the
  virtualised review list reaches that moment on every jump or fast scroll into files that have not
  loaded yet; each rebuild spawned the workers again, re-fetched the WASM, theme and grammars, dropped
  every highlighted AST, and painted nothing until initialised — the stacked view's "loading forever".
  Four idle workers are the price of never paying that again; the list mounts a handful of sections at a
  time, so four keep up. The phone code-file implementation is Pierre `File` with the same theme and
  review grammar; desktop files alone load Monaco.

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
  Files tree (shared `TreeRow`); folders **default expanded** (change sets are small), and a
  single-directory run is one slash-joined compact row (based on the changed-file tree, regardless of
  unchanged siblings on disk), matching `FileTree`. **Status is shown on the file name, not a letter glyph**
  (the git-decoration convention — `changesModel.statusNameClass`, shared by both views):
  added / untracked → green, deleted → red + strikethrough, renamed → blue, modified → plain. Each file
  and folder also shows a `+N −M` badge (shared `DiffStatBadge`) — per-file counts come from `git.status`
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
  double click composes preview then promote; `openTabs.ts` single-flights the underlying read and carries
  the leading click's slot claim into one final kept local transition, so no intermediate preview state is
  persisted and network latency cannot reverse the intents. Freshness stamps (`loadedTick`, plus a diff's `loadedTarget`) are
  captured before the read leaves, never from newer state at response time. The local per-group navigation
  clock is captured at request time: a stale preview completion loses to later attention; deliberate keep
  still commits. If the destination group disappeared, the shell reroutes to current last focus, and if a
  a newer local transition already placed the canonical resource, completion selects that placement instead
  of duplicating it. Preview placement and attention commit locally. Unit and E2E tests pin double-click
  coalescing, stale-read rejection, per-group isolation, local identity convergence, and
  promote-by-keyboard/touch.
- **Row actions: one menu, two triggers.** Every **file** row (both views) is wrapped in
  **`ChangeRowActions`**: a hover/focus-revealed `⌄` button *and* right-click on the row open the same
  dropdown. The `⌄` is not garnish — it is the **touch path**, where right-click does not exist (mobile-first).
  Items: **View** (the same action as a plain click) and **Copy path** (worktree-relative). Deliberately
  nothing else: the panel is **read-only** — no discard-file/-folder/-all — and no “Open in ‹external app›”,
  which a host-side `open` would make silently wrong for every remote/phone client (Copy path is the portable
  escape hatch). **Folder rows get no menu** — nothing in that list applies to a folder. Built on the existing
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
- **File tabs use the same renderer dispatch as diffs.** `FilePane` describes the first `fs.readFile`
  metadata (provisionally text before it lands — and permanently text against a host that predates
  `RESOURCE_META_PROTOCOL_VERSION` and never sends `meta`, which is that host's own legacy surface, so no
  protocol gate is needed for byte-only rendering), resolves `view`, and mounts the selected lazy candidate.
  `thinkrail/markdown` remains the higher-ranked match for `.md`/`.mdx`, so documents open in
  `MarkdownPreview`; `thinkrail/code` is the text fallback and uses Monaco on desktop plus Pierre `File`
  on phone-class viewports; `thinkrail/binary` shows identity and a host-backed
  download. The candidate list alone determines whether the resource toggle exists. No format predicate or
  preview/source field remains in the pane or tab.

  `MarkdownPreview` retains the document typography, frontmatter stripping, alerts, Mermaid rendering,
  source-line stamps, review commenting, and bounded reading measure described above. These are renderer
  behavior, not dispatch policy.
- **Rendered markdown navigates.** In the preview, links + images resolve against the file's own path
  (via `markdownLinks`, passed as the `a`/`img` renderers): a **relative link** opens the target file in
  the **preview** tab through the shared **`openFileInTab`** (the same flow `FileTree` uses) — following a
  link is browsing, so the slot is reused rather than promoting the source doc the way VS Code does; an
  accepted file target is a button styled as document-link text, never an anchor with a raw relative
  `href`, because that URL is not a ThinkRail route and native navigation would escape to the Main page;
  URL pathnames are decoded once and both path-separator forms are normalized before resolution, while
  malformed encoding and traversal above the worktree root produce an inert control instead of opening the
  wrong file; the slot is the slot, whatever
  the open came from — an **in-doc `#` link**
  scrolls the preview (headings carry slug ids from the in-repo `remarkHeadingIds` transform), an
  **external** link opens a new tab, and a **relative image** rewrites to the host **`/files/…`** route
  (through `resourcePane.resourceBytesUrl`, injected into `documentComponents` so the markdown layer never
  reaches for the transport itself). A cross-file link's `#fragment` is not yet followed (opens the
  file only).
- **Document markdown renders sanitized raw HTML; chat markdown does not.** READMEs place logos and
  banners with `<p align="center"><img src width>`, float images with `<img align="right">`, fold
  sections in `<details>`, and ship theme-aware logos as `<picture><source media srcset>`; shown as
  literal tags, those documents lose exactly their most visible content. `markdownHtml.documentRehypePlugins`
  runs `rehype-raw` and then `rehype-sanitize` on GitHub's `defaultSchema` with three deltas: the alert
  element the in-repo remark transform emits (`mdalert` + `variant`) is allowed and `<source>` keeps
  `srcset`/`media`/`type`/`sizes`. GitHub's **`user-content-` clobber prefix stays on** every `id`/`name`
  (a document must not be able to mint `window.MonacoEnvironment` or shadow a global by naming an
  element after it), so in-document `#slug` links resolve through `scrollToAnchor`, which tries the
  prefixed id first and the bare slug second. Everything active or stylistic — `script`, `iframe`,
  `style`, event handlers, inline `style`, `javascript:` URLs — is dropped, and `data:` images with it
  (the schema's `src` protocols are http/https/relative). Raw `<img>`/`<source>` go through the same
  relative-URL rewrite as markdown images, so a README logo loads from the worktree; `srcset` is parsed
  with the HTML candidate grammar (`srcsetCandidates`: commas inside URLs, descriptor parentheses) and,
  because neither the sanitizer nor react-markdown protocol-checks `srcset`, every candidate is
  re-admitted only as a worktree URL or an `http(s)`/protocol-relative one — `javascript:`/`data:`
  candidates are dropped, as is a bare `src` of those kinds; `width`/`height` survive, and
  `align="left|right"` maps to a float utility rather than a presentational attribute. The source-line
  stamps for commenting are added **after** sanitizing, so the sanitizer can never strip them. The chat
  `Markdown` primitive is untouched: model output is not a document the user authored.
- **Desktop file source wraps at the synchronized file column.** `MonacoEditor` uses `fileLineWidth` as
  `wordWrapColumn` (40–240, default 120). The independent `fileLineWidthBounded` default maps to Monaco
  `wordWrap: "bounded"`, wrapping sooner at the mounted file pane; off maps to `"wordWrapColumn"`, preserving
  the selected column with horizontal scrolling in a narrower pane. Broadcast changes update a mounted
  desktop file editor. Pierre diffs and phone files own horizontal overflow and do not consume this Monaco
  preference. Rendered Markdown and rendered Markdown diffs retain their separate ~78ch reading measure.
- **The desktop Monaco surface is a reader, not a language workstation.** Its file-only options keep the
  configured wrapping, generated code typography, minimap/overview-ruler removal and 6px shadowless scrollbar,
  and add read-only messaging, the path as its accessible label, an 8px top inset, three-character line-number
  gutter, full active-line paint, smooth scrolling, active bracket-pair + indentation guides, single-file
  occurrence highlighting, and ambiguous-Unicode suppression. Opaque `viewState` is restored only after its
  editor-state shape is validated and is saved on unmount, so tab switches round-trip scroll and folding.
  Monaco is imported from `editor.api` with only the reading contributions (find, folding, bracket matching,
  context menu/copy, links, hover, word highlighting, sticky scroll, go-to-line/command palette, read-only
  messaging and Unicode highlighting); keeping word highlighting preserves F7. The TS/JS/JSON/CSS/HTML
  language-service contributions and their workers are absent, so this viewer emits no language-service
  diagnostics by construction.
- **Code surfaces re-theme from generic tokens, resiliently.** `MonacoEditor` has the sole `EDITOR_THEME`.
  Themes own one TextMate scope definition: chat uses its live CSS-variable form, while Monaco resolves that
  same definition plus its complete editor/widget/menu/input colour map to hex, loads it into a dedicated
  JS-regex Shiki highlighter, and installs `@shikijs/monaco` once per page. Its curated language catalog is
  shared with the chat highlighter and extended for the desktop file formats; missing Monaco language ids are
  registered with their file associations before Shiki installs providers. A theme swap replaces the
  highlighter theme under the same name, redefines Monaco, and selects `EDITOR_THEME`. The normal/high-contrast
  base comes from manifest appearance/contrast metadata—never a known id—and remains inherited for specialist
  colours outside the explicit map. Reads pass through `lib.cssColorToHex`; an absent or unparseable token is
  omitted so the selected base palette wins rather than crashing the panel. Pierre's one registered
  `thinkrail` CSS-variable Shiki theme emits variable references instead of catalog colours; inherited
  `--diffs-*` properties map foreground/syntax to `--code-*`, canvases to the workspace/content roles, and
  addition/deletion paint to feedback roles, so a theme swap needs no re-highlight. `TerminalInstance`
  similarly rebuilds from the complete 16-slot ANSI variable set. Monaco and xterm consume the nullable
  editor selection-foreground override when provided.
- **Terminal renderer + font measurement.** `TerminalInstance` runs xterm's **default DOM renderer** on
  purpose — `addon-webgl` is *not* loaded, and loading it would be a regression (see `architecture.md`
  Decision #11: the DOM renderer is a prerequisite for touch, and `WebglAddon.dispose()` leaks its WebGL2
  context, which our per-worktree terminal churn would hit). Addons are exactly `fit`, `clipboard`,
  `unicode11` and `web-fonts`; anything else pinned but unimported is dead weight and a trap for the next
  reader. `web-fonts` is load-bearing rather than cosmetic: our code font ships as per-alphabet woff2 subsets,
  so the Cyrillic/CJK file lands *after* xterm has measured the character cell (which it does once, at
  construction, and never again — unlike Monaco, which re-measures an untrusted early reading). Without the
  re-measure, non-Latin glyphs render into cells sized for the fallback font and the PTY holds the wrong
  cols/rows. Initial attach therefore waits for `relayout()`, performs a final `fit()`, and only then captures
  the PTY grid. The wait is **bounded by a deadline**, because `relayout()` in the pinned addon awaits
  `document.fonts.ready` plus a `FontFace.load()` per registered face — one stalled font response keeps it
  *pending* (not rejected) indefinitely, and an unbounded wait would leave the pane blank with no shell.
  Relayout failure or deadline expiry falls back to the construction-time measurement rather than stranding
  the pane; on expiry the stale relayout is neutralized first (disposing the addon skips its re-measuring
  `fontFamily` toggle), so a font that finishes loading late cannot re-lay-out an already-attached terminal.
  This ordering also prevents a fallback-width attach followed by a corrective resize from producing
  post-snapshot shell redraws that can erase replayed rows. Its pre-bind output buffer is a bounded waiting
  state: successful bind filters it to the adopted PTY, while creation failure clears it and stops accepting
  page-wide terminal frames. That failure renders the host's stable guidance as escaped DOM text rather than
  executable terminal output, with Terminal Settings and Retry actions. The failed xterm subtree is inert;
  an explicit retry keeps that recovery surface mounted and its actions disabled until the request settles,
  preserving focus without stealing unrelated workbench focus. Initial xterm focus is deferred until a
  successful attach and applies only while the terminal tab that requested it still owns focus; Retry keeps
  its overlay mounted through the successful handoff and restores xterm focus only while focus remains in that
  terminal region. A competing detach invalidates that handoff and clears its retry state before exposing Take
  Back again.
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
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
  A lazy chunk that fails to load (or a render throw) is contained by the `components/ErrorBoundary` the
  **shell** wraps each region in (see `shell/SPEC.md`), so a single panel degrades instead of blanking the
  app; panels themselves don't own the boundary.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
