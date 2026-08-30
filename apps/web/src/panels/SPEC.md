---
id: submodule-web-panels
type: submodule-design
status: active
title: panels — feature views
parent: module-web
depends-on: [module-contracts]
references: [central-integration]
tags: [v1, ui]
---

## Responsibility

The layout-agnostic, store-driven feature views. A panel fills its container and never knows its
arrangement (so the mobile shell is an additive layer, not a rewrite).

## Boundary

- **Owns:** `ProjectTree`. Each top-level project row is a compact 28px IDE-tree row:
  **always-visible chevron** + folder/name + a collapsed-only plain workspace count + an **always-visible Create
  workspace `+` in a fixed right-edge column**. That `+` is the **same control as the Projects-header Add
  project `+`** — both are `Button variant="ghost" size="icon"`, so they render identically and their glyphs
  line up on one vertical axis (both sit at the row's `pr-xs` right edge).
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
  (rendered only when at least one editor was detected), **Copy path**, **Reveal in file manager**, and
  (worktrees only) **Remove workspace** — worded **Remove from ThinkRail** on an external row, whose
  confirm promises the checkout and its branch stay untouched. "Open in" comes from the
  host-wide `editor.list`;
  GUI entries call `workspace.openIn`, while terminal-kind Vim activates the workspace and runs through
  `addTerminal`'s one-shot `initialCommand`. Copy writes `worktreePath`; Reveal calls `workspace.reveal`.
  Remove is styled destructive and opens a centered `ConfirmDialog`; confirming fires
  `workspace.remove` and lets every client react to the host's `workspace.removed` push via the store's
  `applyWorkspaceRemoved`; a rejected request (no event will come) surfaces an error toast, leaving the row
  in place. Each **workspace row** is **two-line**: the display
  `name` on top with the git **branch on a second line beneath it** (muted, monospace), rendered only when
  it differs from the name (so pristine/legacy `workspace-N` rows stay a single compact line) — the display
  name is decoupled from the git branch (see [[submodule-server-workspaces]]). Workspace rows deliberately
  show **no `+N −M` change badge**: the Projects view is for navigation and identity; change detail stays in
  the dedicated Changes views. The **Default workspace**
  (`kind === "default"` — the project folder itself) renders **pinned first** (the server pins it in
  `workspace.list`; `addWorkspace` appends created worktree rows after it), with a **`House` icon** in
  place of the `GitBranch` glyph and **no Remove item** (non-removable — the server enforces it; the menu
  simply omits it) — it still gets "Open in" / Copy path / Reveal, same as any worktree. Its branch line
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
  looks the same after reloading. Rows whose persisted expansion outlives this client's fetched lists
  (a fresh reload) fetch their missing `workspace.list` lazily; an already-fetched list is refreshed on
  an explicit expand gesture, never refetched in a loop. The active workspace must
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
  non-git folder is never a silent no-op — and neither is a host that couldn't *show* a folder dialog (that
  throws; the notice carries the reason, and the request runs on a raised `timeoutMs` since the picker waits
  on a human). Both are modals on `components/ui/dialog` (the init offer has no
  on-screen anchor, unlike the Remove popover); `NoticeDialog` is a single-button info modal for failures
  with no yes/no follow-up. The hook returns a `dialogs` node each consumer renders. **Selecting a
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
  **`ChangesTree`**; clicking a file in either opens/focuses its **center Monaco diff tab**, and every file
  row carries the shared **`ChangeRowActions`** menu. The row wrapper paints the complete hover/selected
  band, including the trailing menu slot; its inner open-file button remains transparent so that band
  cannot look clipped before the menu),
  `FilePane` (+ its lazy `MonacoEditor` / `MarkdownPreview`) + `DiffPane` (+ its lazy
  `MonacoDiff`), plus lazy `TerminalInstance`. The Monaco plumbing both editors share —
  worker wiring, the local loader, the token-driven `thinkrail` theme + the `[data-theme]` re-theme
  observer — lives once in `monacoSetup.ts`; the slim header view-toggle segment (`Preview|Source`,
  `Split|Inline`, `List|Tree`) is the shared `ToggleSegment` — whose active segment reuses the tab
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
  and the Changes header's *target* branch; the whole state *around* it — the list, `refreshing`, `refresh()` —
  is the shared
  **`useBranchList(projectId, onLoaded?)`** (`branches.ts`, over the offline-degrading
  `listBranchesOrEmpty`), so both pickers are identical **by construction**: the list is **keyed to the
  project** (it clears on a project change, and both reads are generation-stamped, so a switch can never
  offer or land the previous project's branches), **only the initial read degrades** (a *refresh* keeps its
  last good list instead of blanking the picker on a transient failure), and `refreshing` always drives the
  spinner. A `null` projectId reads nothing — how a closed dialog pauses. Its degraded default is
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
**`AddProjectMenu`** dropdown off it (same menu as the projects-rail "+": Open project / Open GitHub (soon)
/ Recents). Recents is the store's `recentProjects`: one last-opened path list containing open + closed
records with no status badge; selecting either runs the shared open flow and lands at Project Home, with a
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
  `chat/ModelSelector`+`ThinkingSelector` in **pre-session** mode — preselected to the host's resolved
  default via `model.default` so the exact model shows (values held in dialog state, applied at create
  time). The pickers' popovers portal into the dialog node (so their lists scroll under the Dialog scroll
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
  then asks **`model.default`** (pi's own `pinned ?? available[0]`, plus a consistent effort) exactly as it
  does for the preselect, through **one** `applyHostDefault` — so no client-side copy of the host's default
  policy exists here. Asked at most once per opening, so a still-missing model can't spin the effect. Effort is a separate concern: one effect keeps the held level
  runnable by the held model by asking the host for pi's clamp (**`model.clampThinking`**) rather than
  deciding locally, so an explicit switch and a refresh that shrank a model's set resolve the same way
  pi would. `model.default` needs no adjustment: the host already returns a self-consistent pair.
  On open and project-picker changes, the dialog reads **`skill.list({projectId})`** and feeds the
  result to chat's shared slash-completion primitive: a leading `/` autocompletes skills from the selected
  project's **current checkout** plus personal/bundled sources, selecting one inserts `/skill:<name> `;
  failure degrades silently to no menu. Up/Down navigate, Enter/Tab select, Escape dismisses. A caption under
  the prompt marks the preview as **from the current checkout** (the created worktree's session catalog is
  authoritative if the selected base branch differs). When the selected project is **untrusted AND ships
  committed skills** (a count from `project.aliasSkills`, never their names), a **trust notice** shows a
  *Trust project* button — the repo's skills stay withheld until granted (`project.setTrust`, which folds the
  updated project back into the store and re-previews); personal + bundled skills show regardless. When the menu is closed, **Enter submits** (matching the submit button's
  `↵` affordance) and
  **Shift+Enter** inserts a newline. Worktree-mode submit = `workspace.create({ projectId, baseRef })` → set active → **always open a
  fresh chat** (`session.create({ model, thinkingLevel })` — the picked model + effort apply even
  without a prompt) → a typed prompt is additionally sent as the first message (fire-and-forget
  `prompt`); an **empty prompt leaves the just-opened composer ready** — submitting the start-working
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
  models.json auth shows a "Managed" tag instead, since the host can't unset it); a **"Sign in with a
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
  closed reason codes to ThinkRail-authored text. **`GithubSettings`** (the "Local GitHub" block — `github.authStatus()`
  Connected + login / Not connected + Refresh); **`AppearanceSettings`** (the **theme picker** — the
  bundled catalog from `themes`, with the resolved active selection from `store.theme` marked; clicking
  one fires `settings.update` and the UI **converges on the `settings.changed` broadcast** (no optimistic
  apply), a rejected update raising a toast; the picker never owns a theme list — it renders the catalog
  the glob discovered at build time); **`ChatSettings`** (the live section immediately after Appearance —
  three radio cards over `store.composerGrowthLimit`, updating `AppConfig.composerGrowthLimit` with the same
  converge-on-`settings.changed`, toast-on-rejection pattern; the labels explain when the one-line composer
  stops growing, while `contracts` owns the closed preset ids/default); the **shell-owned injected Layout
  section** (Balanced/Focus/Review
  plus named custom preset cards. Custom capture/rename/delete updates the host-synchronized catalog and
  converges through `settings.changed`; current/default selection and independent side/bottom limits are
  frontend-local. With an active workspace each preset offers confirmable **Apply now…**, which asks shell
  to replace this window's frame and atomically preserve/reflow open resource identities in every retained
  workspace view; no current layout is published); and
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
  `chat/templateText.ts`'s `assembleTemplate`, the same helper `TemplateEditorDialog` uses) sequentially,
  then bumps `templatesVersion` once, the same invalidation the row list already refetches on — the
  offer disappears on its own next render once the list is non-empty, no dismiss state to track. The five
  (review/explain/tests/commit/rename) are **the same set this repo checks into its own `.pi/prompts/`**:
  those ship at *project* scope, so only a ThinkRail checkout ever sees them, and "the templates ThinkRail
  ships" must mean one thing rather than two — change one, change the other. The composer's `/` menu
  carries the discoverability half (`chat/SPEC.md`: a `slash-templates-empty` footer nudge deep-linking
  here when no template exists anywhere), since this offer is otherwise two clicks deep in a dialog. **This
  project**'s empty state is unchanged (still the bare text) — the offer is Global-only, since it only
  ever seeds global files. No server change. **`PrivacySettings`** is the **anonymous-usage-analytics
  toggle** — a switch over `store.analyticsEnabled`, fired via `settings.update { analyticsEnabled }`
  with the same converge-on-broadcast pattern as the theme, plus the what-is/isn't-collected copy; only
  the boolean ever crosses the wire, see `submodule-server-analytics`. **`ReviewSettings`** is the
  **plan-review policy** section: the reviewer **model + effort** (`ModelSelector`/`ThinkingSelector` over
  `useModelCatalog`, written as `settings.update { reviewModel | reviewEffort }`; unset ⇒ default). The
  selector carries an **explicit default-model row** (`model-option-default`, labelled with the host's
  `model.default` result) that writes `{ reviewModel: null, reviewEffort: null }` — the null-clears wire
  form, see `submodule-server-settings` — so a chosen reviewer model can be restored to the pi default
  without hand-editing host state; while unset, the effort control runs on the default model's supported
  levels (fetched once from `model.default`) instead of an empty list. And an
  **auto-fix toggle** (`review-autofix-toggle`, a switch over `store.reviewAutoFix` →
  `settings.update { reviewAutoFix }`) — off means a `request_changes` verdict records findings and waits
  (the host gates its auto-fix cycle on it, see `submodule-server-todos`). A single dimmed "General" nav item ("Soon") still signals the shell is
  built to grow. `ProvidersSettings`/`AppearanceSettings`/`ChatSettings`/`TemplatesSettings`/
  `PrivacySettings`/`ReviewSettings` are the panels-owned **integration pieces** (store + transport);
  `SettingsDialog` receives the Layout section
  from the shell composition root so no panel reaches sideways into shell, and the `LoginDialog` stays
  presentational (`auth` module).

  Panels compose their own sub-panels
  (e.g. side tools → `FileTree`/`ChangesPanel`, workbench resource renderers → `FilePane`→`MonacoEditor`) — an internal hierarchy.
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
  plan content; another client can explicitly reopen the same host-owned page without inheriting placement. It renders the session's TODO plan document-scale
  (groups as sections, items with status glyphs) with a **scan-first item anatomy**: the item TITLE is
  the only full-size text (`tr-text-ui font-medium`), every detail is a step down (`tr-text-metadata`,
  subtle/muted) — so titles never blend into prose. A **done item collapses to a compact two-line
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
  left-rail (`border-l`) block holding the note, the agent's `summary`, the full `VerificationBadge`,
  a changes_requested `feedback` note, the change set, **and — when the item accumulated 2+ commits
  (fix cycles) — a REVISIONS mini-timeline** (`plan-revisions`/`plan-revision`, off
  `planView.itemRevisions`): one row per commit in order (`#n` + sha chip routing the Changes panel +
  `DiffStatBadge` when the sha still resolves), the last marked *current*, and any sha in the
  review's `unreviewedShas` delta marked *unreviewed* (`data-unreviewed`) — the honest
  how-the-agent-got-here story (commit → review → fix → commit) no final-diff view can tell.
  Non-done items keep their note inline (no toggle — they rarely carry details). Inside the details, the change set stays its own **collapsible**
  disclosure — a summary line (sha chip + `N files` + `DiffStatBadge`) toggling the commit's
  `GitFileChange[]` rows; the chevron/summary is the
  toggle while the sha chip stays a separate button (routing the Changes panel, never toggling). Expanded,
  file rows open Monaco diff tabs at the item's `commit:{sha}` scope (`openDiffInTab`, preview intent; the
  path-list fallback opens at branch scope, no counts because they would drift), **and the review verdict
  ON the item row itself**: the row's right edge is ONE review slot rendering exactly one of, in
  precedence order, the clickable `Reviewing…` label (`plan-item-reviewing`, off the host-derived
  `review.reviewing`, opens the reviewer chat), the warning `Changes requested · N` chip, or the
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
  `Start review` fires the AGENT review (`todo.startReview` — the plan's reviewer chat) and STAYS on
  the plan page: the row's `Reviewing…` pulse and a toast are the only signals, success AND failure —
  the detached error notice lands in a reviewer chat nobody has open, so the toast must carry it.
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
  (`plan-item-review-feedback`); approving settles the item — its status glyph upgrades to the **circled Verified check**
  (`StatusIcon reviewed`, hover "Verified", `data-reviewed` on the row; `planView.reviewSettled` is the
  one derivation — approved AND no unreviewed delta, so a fresh revision drops the item back out of both
  the glyph and the reviewed counter). **The header is a title + a lifecycle STEPPER and a kebab menu**. The stepper (`plan-progress`)
  renders the plan's shipping funnel — **Build (`d/t done`) → Review (`r/k reviewed`,
  `plan-review-progress`, only when the plan has reviewable items) → PR (`plan-pr-stage`,
  `data-state`)** — each stage wearing a glyph for its state: done (check), active (the stage the
  plan is currently at), pending (muted). The PR stage reads the same `useOpenBranchReview` lookup
  as the button and shows `PR #N` once one is open; "merged" is unknowable in V1 (the lookup only
  sees OPEN reviews), so the funnel honestly ends at PR-open. Under the stepper sits the **work
  CONTEXT line** (`plan-context`): `branch ← baseBranch · N commits · +A −R` — commits summed over
  `itemRevisions`, the total diff from the workspace record's `diffStats`; each piece hides when
  unknown. Between header and summary lives the **NEXT-ACTION banner** (`plan-next-action`,
  `data-kind`) — the report's one "what now", rendering the FIRST matching state by urgency:
  `fix` (N steps carry changes_requested → **Show step** scrolls to the first flagged item and
  auto-expands it via the `focusRequest` token — `{ id, tick }`, tick bumped per click and consumed
  once per tick by the target `ItemBlock`, so a re-click re-expands a manually collapsed row and a
  stale request can't reopen it later) → `review`
  (N unsettled reviewables → an inline **Review All** button, same `todo.reviewAll` flow as the
  kebab item, which stays) → `ship` (all done + reviewed, no open PR → an inline **Open PR**,
  same `pr.open` flow as the header button) → hidden when nothing demands action. The plan-level
  completion note wears a `Summary` eyebrow so the report reads in labeled sections. After the item
sections the page renders **`Outside the plan`** (`plan-unattributed`, only when
`TodoPlan.unattributed` is non-empty — including on an otherwise empty plan): the host-derived
uncommitted rows no item claims (derivation: [[submodule-server-todos]]), rendered as `FileRow`s
opening the **uncommitted-scope** diff — the honesty section that keeps un-planned work visible in
the review map instead of reading as "nothing else changed"; `chat/planMarkdown` exports it as its
own section. The kebab menu (`plan-menu`, a
  `DropdownMenu`) holding **Copy** (clipboard) / **Save .md** (browser download) — both compiling through
  `chat/planMarkdown` — and, when the plan has reviewable items, **Review All** (`plan-review-all`): fires
  `todo.reviewAll`, the host-side queue that agent-reviews every *unsettled* reviewable item one at a time
  (disabled when none are unsettled; a toast reports how many were queued, the per-row `Reviewing…` pulses
  track progress), plus **Open draft PR** (`plan-open-draft-pr`, hidden once a PR exists). **The header
  also owns the plan's finish line — Open PR** (`plan-open-pr`, task-open-pr): a deterministic
  host-side flow (push + `gh`, NEVER an agent prompt) that goes through the **compose dialog**
  (`PrComposeDialog.tsx`, `pr-compose-dialog`): the click fetches `pr.preview` and opens editable
  Title (`pr-compose-title`) + Description (`pr-compose-body`, prefilled from the plan) fields;
  only the submit (`pr-compose-submit`, label follows the action — Open PR / Open draft PR / Push
  updates) runs `pr.open` with the edited `title`/`body`. The dialog closes on success, stays open
  on a generic failure (edits survive the toast), and hands off to `PrSetupDialog` on
  `PUSH_AUTH_FAILED` — whose Try again re-submits the LAST edited title/body (kept in a ref), never
  a re-rendered draft. The header button is primary-filled when the plan is
  *ready* (all done + all reviews settled) and quiet otherwise; once an open PR exists (the same
  `workspace.openReview` lookup the shell's scope label uses, via `useOpenBranchReview` — the hook
  lives in `panels` because nothing may import `shell`) the label flips to **Push updates**
  (same call — the host pushes to the SAME branch/PR and refreshes its body); when the lookup reports
  **`unpushedCommits`** the label appends the count (`Push updates (N)`), the button turns
  primary-filled, and the next-action banner grows a `push` arm ("N new commits aren't in PR #N
  yet" + Push updates) so new work after the PR never sits silently local — a successful push
  reseeds the state without the count, clearing both. Also a **`PR #N` chip**
  (`plan-pr-chip`) links out when the URL is known. The hook owns the ONE keyed PR state:
  `noteOpenReview(review, url?)` seeds it right after `pr.open` (no separate shadow state in the
  page), and the focus-refetch overwrites it — a PR closed/merged on GitHub drops out of the chip,
  the label, and the stepper on the next refetch instead of sticking until remount (the url is kept
  across refetches while the review number matches). A `compare` result opens the prefilled GitHub
  compare page (`window.open`); every outcome toasts, uncommitted files get a separate info toast.
  The `pr.open` request runs with a **180s timeout** (push + gh mutation can outlast the transport's
  60s default) and the header button wears a spinner while any PR work is in flight — the
  **Pushing…** label only during the actual submit (a preview fetch is not a push, and its failure
  toasts "Couldn't prepare the PR", never "Open PR failed"). The uncommitted-files info toast fires
  once, before the outcome branches. A successful submit with no `review` in the result (gh broken
  or non-GitHub remote) reseeds the open-review state WITHOUT `unpushedCommits` — the push
  succeeded, so the count and the push banner must clear even when the PR lookup payload is absent —
  but only when a count was actually showing, so the render-time closure can't overwrite a fresher
  focus-refetch in the no-count case. The compose submit also reports whether the title was touched
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
  The agent's plan-level completion note (`plan-overall-summary`) renders **clamped to
  3 lines** with a `Show more`/`Show less` toggle (`plan-overall-summary-toggle`, shown only for long
  notes) — the page opens on the plan, not on a wall of prose. There is **no in-page "Review mode"** — findings live in the right-panel **Review** tab;
  when the reviewer agent has open comments (`selectAgentReviewCommentCount` — open, `author: "agent"`) the
  header shows a **`N comments`** chip (`plan-review-comments`) that `requestToolView(ws, "review")` to
  focus that tab. The header also shows the agent's plan-level completion note
  (`planCompletionSummary`-gated `plan-overall-summary`). `FileRow` (`planFileRow.tsx`, its own module so plan surfaces
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
  renders each via the `components/ui/toast` primitives, letting Radix own the auto-timeout + swipe/hover-pause
  and routing every close back through `store.dismissToast` (so the store stays the single source of truth).
  Errors persist until dismissed; success/info time out. The **integration piece** — the primitives stay
  presentational.
- **Public surface:** layout-agnostic feature renderers (`ProjectTree`, `WelcomePanel`, file/diff/doc/chat
  panes, singleton side tools, terminal bodies, Settings, and `Toaster`), imported **per-file** so
  Monaco/shiki/xterm stay lazy. Tab strips, group headers, side stacks, and center topology are not panel
  surfaces; the shell layout module wraps these renderers.
- **Allowed deps:** `store`, `transport`, `components/ui` (incl. `popover`/`command`/`textarea` for the
  dialog), `chat` (`ModelSelector`/`ThinkingSelector` + the `useModelCatalog` hook that feeds them,
  reused by `NewWorkspaceDialog`; `Markdown`,
  reused by `MarkdownPreview`; `TemplateEditorDialog`, reused by `TemplatesSettings`), `lib`, `themes` (catalog + generic application contract),
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
  The shared `ToggleSegment` (List|Tree, Split|Inline, Preview|Source) borrows the same
  `control-bg-selected` fill + `text-default` for its active segment (no bottom marker — a slim toggle,
  not a tab), so "selected" reads the same everywhere and never derives a parallel surface token.
- The singleton side-tool renderers are **Projects | Specs | Files | Changes | Review**. Their current
  location and local selection are supplied by the shell; Review exposes its store-derived pending-draft
  count as tab metadata. A renderer remains the same when its singleton moves to the opposite side.
- **`ReviewPanel`** is the review sidebar (see [[submodule-server-reviews]] +
  [[task-review-comments]] for the model) — **ONE screen, a per-file ACCORDION**: each row a path +
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
  only the glyph, the clamped text, and the `L3` ref (+ an `outdated` eyebrow when the anchor died).
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
  ("No review comments yet…"). V1 has no archive browser. The review-level
  (overall-note) composer was removed for
  now (the `review` comment kind stays in the model, UI-less). The `review.get` hydration read is **owned by
  the workbench tool integration**, outside the conditionally mounted Review body (`useWorkspaceReview`, the
  `useWorkspaceSpecs` pattern — the read also re-anchors server-side): tab flags and the Review badge need
  the snapshot even while the panel body is unmounted.
  Every client converges on `review.changed` pushes folded into the store; nothing here
  mutates optimistically. Comment *authoring* is **selection-triggered, no mode toggle** (`reviewWidgets.ts`,
  shared by `FilePane`/`DiffPane` through the Monaco components): selecting text shows a floating
  **comment icon right of the selection** (a Monaco content widget; the rendered preview's icon
  follows the selection live but stays mouse-transparent until the drag ends — a clickable node under
  the moving cursor is one the native selection extends into, repainting the document tail). The
  preview icon's position/visibility are **imperative DOM (refs + custom properties + `data-visible`),
  never React state**: the markdown components are per-render-typed, so a state flip mid-drag remounts
  the text nodes under the LIVE selection, which Chrome "restores" by flooding whole blocks — a few
  selected words painted the entire bullet. Outside React, these widgets cannot reach the root
  `TooltipProvider`, so their buttons keep native `title`. Clicking it opens an **inline
  composer under the selection** (a view zone: textarea + Save draft / Send now / Esc cancels). In
  Monaco surfaces the same action also sits in the editor's **right-click context menu** ("Comment on
  selection", right after Copy, `Cmd/Ctrl+Shift+M`; `editorHasSelection` precondition) — the «+» and
  the menu entry are one action pair into one composer (which is why `attachReviewCommenting` takes
  an `IStandaloneCodeEditor` — `addAction` lives only there). The menu's rows wear the app's Remix Icon
  icons via `monacoMenuIcons.ts`: Monaco's standalone menu is label-only (`action.class` icons are a
  workbench feature `addAction` can't reach), so `decorateEditorContextMenus` — installed on EVERY
  Monaco surface, review or not (`MonacoEditor` + both of `MonacoDiff`'s inner editors) — decorates
  the open menu's DOM: each row gets a fixed-width `.editor-menu-icon` slot (labels stay aligned), known
  English labels get their glyph, unknown/restructured rows stay label-only (a Monaco bump can only
  lose icons, never break the menu); submenu popups (Peek ▸) stay undecorated. The rendered preview's
  context menu is the browser's own and stays unextended. Save →
  `review.commentAdd` with only the `lineRange` + the anchor's **side** (the host reads that side's own
  content to fill `contentHash` + the drift-tolerant `textQuote`); Send now additionally fires
  `review.sendComment` and opens the created chat. Commented
  lines render as decorations (`review-comment-line`). Review attaches only for scopes whose modified
  side IS the worktree (branch / uncommitted — never a `commit` scope, whose content is historical).
  **A diff's two editors are two anchor spaces, each carrying the full surface** (decorations,
  in-flow cards, composer): the modified editor holds `side: "worktree"` comments, the original editor
  holds `side: "base"` ones (`useFileReview`'s `base` slice; `MonacoDiff` wires both through one
  `wireSide`, and the tab's `scope` rides along so the host resolves the very blob the original editor
  shows). An original-side selection is **never remapped onto modified line numbers** — the two sides
  say different things at the same numbers, so a remark on a deleted or rewritten line would silently
  re-point at whatever now sits there, and that is what the send package would hand the agent. A focus
  deep link likewise resolves **per side** (`SideReview.focus`), so a surface only ever reveals a line
  it actually renders. The **rendered markdown view comments too**
  (`PreviewCommenting` — the React sibling of `reviewWidgets`, same icon/composer skin, overlays
  positioned in the scroller's content coordinates so they travel with the document): the rendered
  selection is mapped back to SOURCE lines by the pure `previewAnchor` (head/tail phrase search over
  marker-stripped source lines, shrinking phrases at line straddles, never a lone-word fallback for a
  longer selection); an unmappable selection degrades to a **whole-file** comment — the composer says
  so — never to wrong lines. **Saved comments sit IN the document flow, directly below their anchor**
  (the inline-edit-v0 branch's presentation principle, worn in OUR chat-input-family skin —
  `ReviewThreadCard` / its Monaco DOM twin: **the composer's component minus the buttons row** — the
  same card chrome (`border2`/`radius-md`/`bg-dark`, same paddings), no accent bars of its own. A
  DRAFT's body is **editable in place** until it's sent — the same input surface as the composer's
  field (`--input-bg`, primary focus ring; blur / Cmd+Enter saves via `review.commentUpdate`, Esc
  reverts, empty reverts — never deletes) — and carries Send + Delete (draft-only); sent/outdated cards are
  passive read-only markers (plain text, no field). Status shows as the head dot (primary draft / info
  sent).
  **Monaco**: `attachReviewThreads` view zones below the anchor lines — Monaco pushes the following
  lines apart; zone heights track the rendered card via a **ResizeObserver**, not a one-shot measure:
  Monaco keeps an off-viewport zone's node at `display:none`, so a card below the fold at `setThreads`
  time (the markdown tab's rendered→source switch mounts exactly this way) measures 0 and a one-shot
  measure would leave its zone at the placeholder height — the card then paints OVER the following
  lines when scrolled in. The observer re-measures when a card gains real geometry or grows (in-card
  editing), so long comments never overflow. `setThreads` **reconciles zones by comment id** rather
  than tearing every one down and back up on each snapshot: a card whose rendered content is unchanged
  (a `status`/`anchorState`/line-range/`body` signature) keeps its exact DOM, so a draft the user is
  mid-edit survives an unrelated push (another client's comment, a re-anchor/resolve elsewhere) with
  its textarea value, focus and selection intact — only changed cards rebuild, gone ones drop, new ones
  add. **Rendered preview**: `MarkdownPreview` splits the stripped document at each insert's
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
  was in review. **`Send review (N)` stays strictly drafts-only and PER-FILE** — that file's PANE
  TOOLBAR (DiffPane's header,
  FilePane's markdown header — a non-markdown file grows a slim header just for it) carries the text
  button (`SendReviewButton`, over the one `fileDraftIds` derivation): the count and the send are
  exactly THIS file's drafts, batched into the file's own review chat (one chat per file — the host
  pins it in `Review.fileSessions` and later sends `followUp` there), which **opens immediately** (the
  host fires the package into the session detached — see the reviews SPEC's send-latency note). Other
  files' drafts stay put; each pane carries its own button, and the Review panel shows the same
  button in each unfolded section's strip (the panel header adds the cross-file `Send all (N)` —
  see above). Offering it with nothing left to send
  would be a lie, so an in-progress file keeps its muted flag and grows no toolbar. A pane over an
  uncommented file shows neither. There is no manual review mode to enter. Every send affordance (composer Send now, thread cards, sidebar rows/footer, tab
  Send all) goes through the one `reviewSend.ts` pair (`sendReviewComment`/`sendReviewBatch`: request
  → show the chat tab → toast on failure), and the panes integrate via the one **`useFileReview`**
  hook (threads + composer callbacks + card actions in a single `review` prop on
  `MonacoEditor`/`MonacoDiff`).
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
  anchor's lines index the pre-change blob, which only the diff's ORIGINAL editor renders and only it
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
  so scoping is natural; a degraded watcher just means back to read-on-demand. Editable-file conflict
  handling waits for `fs.writeFile` (the viewer is read-only today).
- **`useWorkspaceSpecs` owns the `spec.graph` read** (one fetcher, one definition of "this file is a spec"):
  the snapshot lands in the store (`specsByWorkspace`), not panel state, because the chat's turn divider
  needs the same answer to route its chips. It is called by **the workbench tool integration**, not by `SpecsPanel` — the
  panel body only exists while its tab is showing, so owning the read there would mean a user sitting on
  Changes stops the graph tracking the worktree, and every spec the agent writes gets counted as a changed
  file (the split silently undone by a tab selection). Being keyed per workspace, a switch shows that
  workspace's last known tree while the re-read is in flight (there is nothing to reset), and the failed-read
  flag is workspace-scoped so it can't leak a hint over a sibling's good tree. It returns `{ failed, reload }`
  — the header's Refresh calls `reload` directly, so no refresh counter has to be held in panel state.
- `SpecsPanel` is the read-only spec-graph viewer — a pure reader of that snapshot. One fetch per
  workspace-activation, refetched on the fs tick, plus a header **Refresh** button re-fetching on demand (the
  manual escape hatch if the host's watcher degraded; the host side revalidates per read), rendered as
  the **`parent` tree** (roots = no/dangling parent; default-expanded). A fetch **failure renders a distinct error hint** (pointing at Refresh), never the
  "No specs" empty state — offline and empty are different answers. The tree build (`specTree.ts`)
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
  the panel converges on the broadcast `workspace.updated`, never optimistically). The menu's contents load
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
- **The diff is a center resource tab, not an inset inside the Changes tool.** Clicking a Changes row fetches `git.diffFile` (both sides of
  the row's scope) and opens a **`DiffTab`** (`${workspaceId}:diff:${scopeKey}:${path}` — one tab per *file and
  scope*, carrying its own `scope`: a re-click in the same scope focuses the existing tab, while the same file
  in another scope is a second tab, because a tab's content must never change meaning because the Changes scope
  flipped underneath it; non-default scopes tag the tab label via `diffTabName`) through `openTabs.ts`'s
  **`openDiffInTab`**, the diff twin of `openFileInTab`: a single click **previews**, a double click **keeps**,
  so scanning a change set reuses one tab. `DiffPane` renders a slim
  header — the **path chip** (muted directory prefix + bright basename, matching the flat list's rows), a
  **¶ hide-whitespace** toggle (Monaco's `ignoreTrimWhitespace`, per tab via
  `store.setDiffTabIgnoreWhitespace`), a **copy-contents** button (the modified side; no clipboard → no-op,
  the text stays selectable), and the per-tab
  **Split | Inline** toggle via `store.setDiffTabView`; split is the default — over the read-only lazy
  `MonacoDiff` (`@monaco-editor/react` `DiffEditor`, model paths derived from the file's path so both
  sides highlight alike; `useInlineViewWhenSpaceIsLimited: false` — the toggle must do what it says, so
  Split never silently renders as inline on a narrow pane; **`hideUnchangedRegions: { enabled: true }`** —
  Monaco's own collapsed context (“N hidden lines” with an expand control, in both layouts), never a
  hand-rolled folding of our own; the inline view's dual line-number gutter
  — base-branch no. left, worktree no. right — is Monaco's standard and stays; on unmount it sets
  **`keepCurrentOriginalModel`/`keepCurrentModifiedModel`** so `@monaco-editor/react` won't dispose the
  models early, and then disposes the **widget before its two models itself** — the only order that dodges
  Monaco 0.52+'s "TextModel got disposed before DiffEditorWidget model got reset" assertion (disposing a
  model while a live widget still references it), which the library otherwise trips by disposing models
  first; keeping them also avoids leaking a model pair per closed diff tab (regression-pinned in
  `e2e/changes.spec.ts`)). **A markdown diff has exactly two
  views** instead, via a **Source | Rendered** toggle (`diff-toggle-source`/`diff-toggle-rendered`,
  per-tab `DiffTab.rendered` via `store.setDiffTabRendered`, gated on `lib.isMarkdownPath`; Source is
  the default — no Split|Inline segment for markdown). **Source** = the basic Monaco split diff.
  **Rendered** is a **real rich diff**, not plain previews (see [[task-rendered-markdown-diff]]): the
  lazy `RenderedDiff` renders **both sides** through the same document pipeline as `MarkdownPreview`
  (the shared `MarkdownDocument` — prose skin, alerts, heading ids, frontmatter stripped) to static
  HTML (`renderToStaticMarkup`; effects don't run, so code blocks show the plain fallback and link
  handlers are inert — accepted for a diff view), then merges them with **`node-htmldiff`** into ONE
  document carrying `<ins>`/`<del>` markers (`del` red + strikethrough, `ins` green — token colors),
  injected via `dangerouslySetInnerHTML` (same accepted risk class as the shiki path in
  `chat/Markdown`). **The htmldiff merge runs in a Web Worker** (`htmldiff.worker.ts`, one worker per
  pending request — terminate = cancel): htmldiff's matcher is super-linear on repetitive content
  (seconds of synchronous blocking for a few hundred near-identical rows), so it must never run on the
  main thread; while it computes, `RenderedDiff` shows a `rendered-diff-loading` placeholder, and a
  worker failure (script asset failing to load, htmldiff throwing) shows a `rendered-diff-error`
  placeholder pointing at the Source view — never an eternal spinner. The
  static-markup render of both sides is linear and stays on the main thread. Pinned by e2e in
  `e2e/changes.spec.ts`: the long-task test (seeded `LARGE.md`, 800 identical rows), the
  worker-failure test (worker asset blocked → `rendered-diff-error`), and the live-edit test (fs
  tick re-reads both sides → stale merge cancelled, fresh one lands). This mirrors VS Code's opt-in "markdown preview in the diff view" — a feature of
  VS Code's webview layer, absent from standalone Monaco, hence built here. A row is shown selected when its
  diff resource is locally selected in a center group (or it is the deep-link highlight). A failed
  `git.diffFile` leaves placement unchanged (the row stays for a retry).
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
  `components/ui/dropdown-menu` (no new `context-menu` primitive); the right-click handler is handed back
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
- **Markdown file tabs render, don't read.** A `.md`/`.markdown` `FileTab` (from the file tree **or** the
  Specs panel — same `openTab` path) opens **rendered by default**: `FilePane` gates on `lib.isMarkdownPath`
  and shows a slim `Preview | Source` header (`markdown-view-toggle`), the rendered view being lazy
  `MarkdownPreview` (reuses `chat/Markdown` for GFM+shiki but owns the **document skin** — `tr-prose-doc`
  supplies every typography value (`typography.json` → `proseSystems.doc`: h1–h4 at 24/20/18/16 against
  14px body copy, so a rendered file reads as a document rather than a chat bubble), and the skin adds
  only what is *not* typography: h1/h2 section rules, a capped reading measure (~78ch) with wide
  tables/code scrolling inside it, zebra-striped bordered tables, muted accent blockquotes, crisp
  rules, and **GitHub-style alert callouts** (`> [!NOTE]`…`[!CAUTION]`, via the in-repo
  `markdownAlerts` remark transform + a Remix Icon/token `AlertCallout`, wired in only here — not chat), and
  **```mermaid fences render as themed diagrams** (the shared `Markdown` primitive's mermaid path —
  `chat/SPEC.md`; the rendered *diff* keeps the source-code degradation, like shiki) — in
  a centered reading column; strips a leading YAML frontmatter block via
  `lib.stripFrontmatter` so a spec's metadata doesn't render as a stray heading — source view still shows
  it) and source being the lazy read-only `MonacoEditor`. The choice
  is a per-tab `store.setFileTabView` (survives tab switches; not persisted across reload). Non-markdown
  files render Monaco directly with no header, exactly as before.
- **Rendered markdown navigates.** In the preview, links + images resolve against the file's own path
  (via `markdownLinks`, passed as the `a`/`img` renderers): a **relative link** opens the target file in
  the **preview** tab through the shared **`openFileInTab`** (the same flow `FileTree` uses) — following a
  link is browsing, so the slot is reused rather than promoting the source doc the way VS Code does; the
  slot is the slot, whatever the open came from — an **in-doc `#` link**
  scrolls the preview (headings carry slug ids from the in-repo `remarkHeadingIds` transform), an
  **external** link opens a new tab, and a **relative image** rewrites to the host **`/files/…`** route
  (built from `transport.httpBase()`). A cross-file link's `#fragment` is not yet followed (opens the
  file only).
- **Code surfaces re-theme from generic tokens, resiliently.** `MonacoEditor` defines the `thinkrail`
  theme from live surface + semantic syntax variables and chooses its normal/high-contrast base from
  manifest appearance/contrast metadata—never from a known id—then redefines it after the theme module's
  atomic `[data-theme]` signal. Reads are canonicalized to hex (`lib.cssColorToHex`; unparseable values
  are dropped), and a bad value degrades to Monaco's base palette rather than crashing the panel.
  `TerminalInstance` similarly rebuilds from the complete 16-slot ANSI variable set; both consume the
  nullable editor selection-foreground override when provided. `MonacoDiff` re-themes exactly like
  `MonacoEditor` — both consume `monacoSetup.ts`'s define + observer, so a palette swap lands in the
  diff tab too.
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
  state: successful bind filters it to the adopted PTY, while permanent creation failure
  clears it and stops accepting page-wide terminal frames. **Historical replay is input-inert:** the PTY id
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
