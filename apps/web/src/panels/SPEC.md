---
id: submodule-web-panels
type: submodule-design
status: active
title: panels — feature views
parent: module-web
depends-on: [module-contracts]
tags: [v1, ui]
---

## Responsibility

The layout-agnostic, store-driven feature views. A panel fills its container and never knows its
arrangement (so the mobile shell is an additive layer, not a rewrite).

## Boundary

- **Owns:** **`LeftPanel`** — the full-height left panel the shell mounts (`data-testid="left-nav"`,
  Conductor-style): a **top region** (`h-[48px]`, bottom hairline — the shared column-top height, level
  with the center header + right-rail tab strip) with a solid-accent square logo
  placeholder (`app-logo`, `bg-primary`) — a **button** that opens the **main/welcome screen**
  (`store.showWelcome()`, clearing the project/workspace selection) — at left and the **left-panel
  collapse toggle** (`PanelLeft` icon, `toggle-left-panel` → `store.togglePanel("left")`) at the right
  corner; the scrollable `ProjectTree` beneath; and a **footer** (top hairline) grouping, left-aligned,
  the **connection beacon** (`connection-status` + `data-status`, reused from `store.status` — not
  re-fetched; green dot when connected), and — right-aligned — a **help** button (`open-docs`, `?`
  icon → **`store.openOnboarding("review")`**, the manual re-open of the onboarding flow) and the
  **Settings gear** (`open-settings` → `store.openSettings()`). (First-run still auto-opens onboarding;
  only the manual re-open moved from the logo to this help button.) **Below that row, divided by a
  hairline, a **persistent application-level usage line** shows `SessionStatsBar` (tokens · cost · context
  bar · %, reused from `chat/` unchanged) — **always visible** regardless of navigation: the active chat
  session's stats when there is one (`store.selectActiveSessionStats`), else a **`MOCK_USAGE`** fallback,
  so the row never appears/disappears while moving between welcome/project/workspace.
  The **open-project menu now lives on `ProjectTree`'s PROJECTS row**, not here (see below).
  `LeftPanel` composes `ProjectTree` (parent→child, like `RightPanel`→its children).
- **Owns:** `ProjectTree` (+ the `NewWorkspaceDialog` its per-row "+" opens **and** the `ConfirmPopover` its per-row
  **Remove** button (a `Trash2` glyph) opens — a small reusable yes/no built on `components/ui/popover`,
  **anchored to that Remove button** (`align="end"`, so its right border lines up with the button's) and
  opening just beneath it rather than as a centered modal; it **forces a
  deliberate choice** (Cancel takes initial focus; a `destructive` confirm shows a warning glyph + red
  button; Esc + outside-click cancel); removal is **event-driven** (no per-client optimism): on confirm it
  just fires `workspace.remove` and lets every client — including this one — react to the host's
  `workspace.removed` push via the store's `applyWorkspaceRemoved`; a rejected request (no event will come)
  surfaces an error toast, leaving the row in place). Each **workspace row** is **two-line**: the display
  `name` on top with the git **branch on a second line beneath it** (muted, monospace), rendered only when
  it differs from the name (so pristine/legacy `workspace-N` rows stay a single compact line) — the display
  name is decoupled from the git branch (see [[submodule-server-workspaces]]). The row carries **no
  change-size badge** — the branch's diff size lives in the header/Changes area (per-worktree git status
  is consolidated in the center header), not the sidebar row. The active workspace must
  also stay visible: when `ProjectTree` mounts with an active workspace, or the active workspace's derived
  owning project changes or first becomes resolvable, it expands that parent project. A manual collapse
  remains respected while the owning project is unchanged; ordinary `workspace.updated` snapshots and
  same-project workspace switches do not force it open again. Workspace creation expands its project
  explicitly. Selecting or creating a workspace also selects its owning project, keeping project-home and
  active-workspace context coherent even when the create dialog's project picker targets another project.
  **Opening a project** goes through the shared **`useOpenProject`** hook (reused by `ProjectTree` **and**
  `WelcomePanel`, so the flow is identical in the rail and the Welcome screen): `project.open`, and on
  failure `project.inspect` → either offers to bootstrap the folder into a repo — a modal **`ConfirmDialog`**
  (confirm → `project.init`) — when it's `initable`, or surfaces the error in a **`NoticeDialog`** — so a
  non-git folder is never a silent no-op. Both are modals on `components/ui/dialog` (the init offer has no
  on-screen anchor, unlike the Remove popover); `NoticeDialog` is a single-button info modal for failures
  with no yes/no follow-up. The hook returns a `dialogs` node each consumer renders (`LeftPanel` in the
  rail via `ProjectTree`, `WelcomePanel` on the Welcome screen). **`ProjectTree`** renders the **PROJECTS**
  label **row** — the label plus, right-aligned, the **add-project menu** (the `AddProjectMenu`
  **folder-open** trigger, `add-project-menu`; lists the three unified project actions — Create new
  project / Open local project / Clone from GitHub, `menu-project-{id}` — over Recents) and a
  **new-folder** button (`create-project-menu`, `FolderPlus`) as a compact shortcut to **Create new
  project**; both call `store.openProjectDialog(id)` (Recents re-open the real existing project). — then
  the list: each **project row** leads with a
  **colored rounded-square avatar placeholder** (`size-4`, `rounded-[var(--radius-sm)]`, a deterministic
  per-project fill from the existing color palette via `projectAvatarColor(project.id)` — a stand-in for a
  real project icon; distinct from the workspace rows' branch glyph, which keeps project vs worktree
  visually distinct). The avatar sits in **one fixed slot that swaps to the expand/collapse chevron on row
  hover** (avatar hides, chevron shows, same `size-4` slot — no reflow); there is no always-visible
  chevron. **Top-level projects are separated by an edge-to-edge hairline** (`-mx-md h-px bg-border2`,
  bleeding past the nav padding), between projects only — never between worktrees. **Two-level highlight:**
  an **open (expanded) project group** — the row + its worktrees — gets a subtle neutral tint
  (`bg-elevated`); within it the single **active item** (the active worktree, or the project row when the
  project is selected with no active workspace) gets the accent tint at `bg-[var(--primary-20)]` so it
  reads clearly brighter than the group. On row hover, a **“+” (create worktree)** and a **settings gear**
  (`project-settings`, opens the project's `ProjectView`) appear together on the right. Workspace rows
  nest one level under, `GitBranch` glyph, indented (active worktree also `bg-[var(--primary-20)]`).
  **Row spacing** (exact px, since the `--space-*` tokens are font-fluid): 24px below the PROJECTS header
  before the first item (`ul mt-[18px]` + each block's `py-[6px]` top); each project block pads 6px
  top/bottom (so across a divider it reads 6|divider|6); an open group adds 6px from the project row to
  the first worktree and between worktrees (`mt-[6px]` + `gap-[6px]` on the worktree list), and its 6px
  bottom pad sets the last worktree off from the divider. **Full-bleed tint:** the hover/active/gray
  backgrounds go edge-to-edge and up to the dividers — the tinted element is `-mx-md` (negating the nav's
  `p-md`) with the content re-inset via existing spacing tokens (`px-md` on the block + `calc(md+xs)` /
  `calc(md+xl)` paddings on the full-bleed project / worktree rows), so only the background bleeds; the
  avatar/text/buttons don't move. Collapsed → the block wrapper carries the hover/active tint (filling its
  full height to the dividers); open → the wrapper is the neutral group tint and the active row/worktree
  tints itself full-bleed on top.
  **Selecting a
  project** (clicking its row — the chevron expands/collapses separately) goes through the shared
  **`selectProjectWithWorkspaces(projectId)`** helper (`selectProject.ts`): it refreshes the project's
  `workspace.list` into the store (so the tree shows its worktrees), then calls `store.selectProject`,
  which **opens the read-only `ProjectView`** for it — it never auto-enters a workspace (entering a
  worktree is an explicit workspace-row click / create). Both open-project adopt steps (`ProjectTree`,
  `WelcomePanel`) use the same helper. The **project-row avatar** color helper `projectAvatarColor`
  lives in the shared `projectAvatar.ts` (used by the row **and** `ProjectView`). Also
  `FileTree`, `SpecsPanel`, `RightPanel`,
  `ChangesPanel`, `CenterTabs` + `FilePane` (+ its lazy `MonacoEditor` /
  `MarkdownPreview`) + lazy `DiffPane` (the Monaco **diff-editor** center pane for a Changes diff tab —
  side-by-side base|worktree, unchanged-region collapsing, `goToDiff` prev/next buttons; it fetches
  `git.diff` + `fs.readFile` and reconstructs the base side by **reverse-applying the unified patch**
  (`unifiedDiff.ts`, unit-tested) — the wire has no base-content method, deliberately kept that way).
  `ChangesPanel` renders **only the changed-file list** (the right panel stays two regions: panel
  content over terminals); a row click — and the `changesRequest` deep-link — opens the file's diff as
  a center tab via **`openDiffInTab`** (`openFile.ts`: focus-if-open by the `diff:`-prefixed id, tab
  name = file name), the same gesture spec files use. The **right rail (`RightPanel`) is contextual**: for
  a **worktree** its tabs are Specs / All files / Changes (as above); for a **project** (read-only main)
  they are Specs / All files / **Scripts** / **Hooks** — Changes is worktree-only, Scripts/Hooks are
  project-only (`ScriptsPanel` = mock run shortcuts; `HooksPanel` = mock on-create / on-archive worktree-
  lifecycle commands + a muted “merge hooks … later” note; both display-only — saving/running are a host
  follow-up). In project context Specs/All files show a muted placeholder (no project-fs wire). The
  project row's settings **gear** is a shortcut only — it opens the project and jumps the already-open
  rail to **Hooks** (`store.requestRailTab`; default tab is Specs). **`TerminalsPanel`** (worktree-only —
  the shell mounts it only for an active workspace) + lazy `TerminalInstance` (all instances — open **and**
  backgrounded — stay mounted, hidden unless active, so a detached PTY keeps running): a **reference-style
  tab bar** (no “TERMINAL” title) — a far-left **collapse control** (`toggle-terminal-panel` →
  `store.togglePanel("terminal")`, collapses the region downward; a `PanelBottom` icon matching the side
  panels' `PanelLeft`/`PanelRight` toggles — same size-4 / opacity family), then the tabs
  (full **“Terminal N”** name, `store` monotonic counter; the **active** tab marked with an **accent
  underline** `border-b-2 border-primary`, not a filled pill) with the **“+”** (tooltip “Add new
  terminal”) **immediately after the last tab**, and a **background/history** control (`History` icon)
  pinned **far right**: **disabled** while nothing is backgrounded, else a `DropdownMenu` (**“Running in
  background”**, a **mocked** active/idle status dot per row) that reattaches on click. Closing a tab
  **detaches** it (view action) to the backgrounded list — not a kill; the **last remaining tab isn't
  closable** (never down to zero). The body is **padded** (`px-sm pt-sm`, balanced left/right — the inner
  `relative` box insets the absolute terminal instances). A small muted **branch label** (`GitBranch` +
  `workspace.branch`) sits at the bottom, naming the worktree. When collapsed, the shell shows a thin
  re-expand bar (`terminal-collapsed`, `PanelBottom`) in its place. (Status dots + hook/script
  data are display-only mock — no process-state polling / persistence; see
  [[task-terminal-names-background]], [[task-contextual-rail]].) **`WelcomePanel`** is the first-touch surface the shell mounts (centered, left-nav beside it) whenever no
workspace is active. **Layout:** a single **left-aligned block** — `~60%` of the center area (wider,
`max-w-[90%]`, on mobile), centered by position with **no border/card/panel** — with the text flush-left
at the top and the action cards at the block's **bottom-right** (`justify-end`, shared bounds), so the eye
reads text (top-left) → action (bottom-right); shared with `Onboarding`. The `PRODUCT_NAME` wordmark as
the hero (the brand styling — accent font, `text-primary` — at the shared **moderate title size**
`--font-xl`, matching the onboarding title so the two screens read as one family; the pitch is `text-md
text-muted`), with the **active project's name as a small eyebrow** (folder icon) above it
once a project is selected, over a **constant** spec-first pitch (not spec-conditional) and
**one-to-three cards** (Conductor-inspired: icon top-left, label + explainer
bottom-left; the primary is a filled-accent card carrying the stable `welcome-cta` hook, others quiet
`welcome-action`s). It always shows the **three unified project-entry cards** (`PROJECT_ACTIONS`: Create
new project / Open local project / Clone from GitHub — same labels/descriptions/icons/order as the rail
menu; each `→ store.openProjectDialog(id)`). By state: **no projects** → just those three, "Create new
project" as the CTA; **project + `hasSpecs`** → **"Start building"** (primary) + the three; **project + no
specs** → a spec-first **"Set up project"** (primary) + "Start building" + the three. **"Start building"**
is the
intent-first framing of the create-and-kick-off flow — it opens `NewWorkspaceDialog` (which cuts a
worktree-isolated workspace + starts a chat); *workspace* is the mechanism, not the label. **"Set up
project"** opens the same dialog with an `initialPrompt` seed — the `/skill:setting-up-a-project` command,
which **forces** the setting-up-a-project dispatcher skill to load (pi's skill-command syntax; expanded on the
`session.prompt` path) rather than hoping the model auto-matches it; the dispatcher then detects
new-vs-existing and drafts the specs accordingly (see [[module-thinkrail-workflow]]). Which
project drives the has-specs states = `selectedProjectId ?? projects[0]`, read reactively (so the visible
nav's selection updates it). Its `hasSpecs` is **fetched lazily** via `project.hasSpecs` for that one
project (a full-tree walk, kept off the connect handshake) — pending until it resolves, so the cards wait
on it. (The real-open `useOpenProject` orchestration remains only for the rail's **Recents** re-open;
the three entry actions are the mocked `ProjectDialogs`.)
Above the cards, `WelcomePanel` composes **`ProviderWarningBanner`** — a slim gold banner shown **only when
no provider is connected** ("No model provider connected — the agent can't run") with a **Connect a provider**
CTA that opens Settings → Providers (`store.openSettings("providers")`). It reads `provider.status` (a
provider is "connected" iff any `configured`) on mount and re-checks whenever the settings dialog toggles, so
it disappears the moment the user connects one; a transport error degrades to *not* nagging (offline ≠ "no
provider"). All provider **management** lives in Settings, not here (the always-on strip is gone).
**`NewWorkspaceDialog`** is the create-and-kick-off surface. It names the operation visibly — title
**“Create new worktree”**, Create button **“Create worktree”** (text-only) — and states the model without
adding a step: **“A separate checkout on its own new branch. Files, chats, changes, and terminals stay
scoped to it.”** Its base-branch trigger reads **“From {base}”**, not an unexplained ref; alongside the
project + branch pickers a **read-only root-path chip** (`ws-root-path`, `~/.thinkrail/worktrees/…`, MOCK
value) shows where the worktree lands — display-only, not editable here. An optional **`initialPrompt`** seeds the prompt hero (still editable;
empty by default; placeholder **“Describe your task…”**); while the prompt is non-empty, a secondary hint
says ThinkRail will name the workspace and branch from the request. The rest stays compact: the base-branch combobox (`git.listBranches`,
degrading to local branches offline; a Refresh re-lists; `origin/HEAD` is filtered so no stray `origin`),
a project picker, the prompt hero, and the reused
  `chat/ModelSelector`+`ThinkingSelector` in **pre-session** mode — preselected to the host's resolved
  default via `model.default` so the exact model shows (values held in dialog state, applied at create
  time). The pickers' popovers portal into the dialog node (so their lists scroll under the Dialog scroll
  lock). In the prompt hero, **Enter creates** and **Shift+Enter** inserts a newline. Create = `workspace.create({ projectId, baseRef })` → set active → (with a prompt) open a chat +
  `session.create({ model, thinkingLevel })` + fire-and-forget `prompt`; with an empty prompt it just
  creates the workspace. A **rejected** kick-off `prompt` (a bad model / missing API key — e.g. picking a
  nonexistent model) surfaces as an `error` turn in the just-opened chat via `store.appendErrorTurn` (with
  `transport`'s `errorText`) rather than vanishing. The two rejections with **no chat to host a turn** raise a
  `store.toast.error` instead: a failed **`workspace.create`** (keeps the dialog open to retry) and a failed
  **`session.create`** (the dialog has already closed, the workspace exists — the toast is the only place left
  to report the dropped kick-off). (`gh` status lives in `SettingsDialog`, not the
  create dialog.) **`ProjectDialogs`** (shell-mounted, store-driven by `projectDialog`) hosts the three
  **unified, fully-mocked** project-entry flows — one source of truth in **`projectActions.tsx`**
  (`PROJECT_ACTIONS`: id/label/description/icon/order shared by the rail menu + Welcome cards;
  `createMockProject(name, path)` = the shared landing: append a `Project` + `selectProject`, no host
  call). Each is a distinct dialog styled like `NewWorkspaceDialog`: **Create new project** (name + live
  resulting-path preview `~/code/<slug>` + a mocked "Choose folder" cycling `MOCK_PARENTS`, brief loading
  then create); **Open local project** (a mocked selected-folder cycler with a **non-git init prompt** —
  “This folder is not a git repository.” → Cancel / Initialize and open); **Clone from GitHub** (repo URL
  + derived destination path, with mocked empty/valid/invalid/loading/exists/failure/success states + the
  specified validation copy). All land on the read-only `ProjectView` (no worktree). No wire calls — real
  `project.create`/`open`/`clone` is a follow-up. **`SettingsDialog`** is the app-settings surface the left-panel footer gear opens — a
  **store-driven two-pane shell** (left section rail + scrollable content pane; mobile collapses the rail to
  a horizontal segmented strip): `settingsOpen`/`settingsSection` live in the store so the gear AND the
  Welcome banner can open it deep-linked to a section. Live sections: **`ProvidersSettings`** (the in-app
  provider-auth surface — Connected cards each with a **Sign-out only when `canLogout`** (env / central /
  models.json auth shows a "Managed" tag instead, since the host can't unset it); a **"Sign in with a
  subscription"** block of `canOAuth` providers → `provider.loginStart` → the store-driven `auth/LoginDialog`
  (open the URL or paste the code, `provider.loginReply`); an **"Add an API key"** group of single-key
  providers (`provider.setApiKey`, capped with a "Show N more" expander); a multi-field "N more" note; and
  the **`JetBrainsAiCard`** — route Claude+GPT through your JetBrains subscription (the jbcentral proxy) — a
  state machine over `jbcentralWired`/`jbcentralInstalled` + `jbcentralInstall` (all from the same status
  read) + `provider.jbcentral*`:
  Connected (Disconnect) / ready (Connect) / not signed in (in-app `central login` + Retry) / not installed
  (the host's per-OS copyable install command — from `jbcentralInstall`, for the *host's* OS, never the
  browser's — + Recheck); each mutation re-reads `provider.status`) **`GithubSettings`** (the "Local GitHub" block — `github.authStatus()`
  Connected + login / Not connected + Refresh); and **`AppearanceSettings`** (the **theme picker** — a
  labelled list of `utils/theme`'s `THEMES`, the active one from `store.theme` marked; clicking one fires
  `settings.update` and the UI **converges on the `settings.changed` broadcast** (no optimistic apply), a
  rejected update raising a toast). A single dimmed "General" nav item ("Soon") still signals the shell is
  built to grow. `ProvidersSettings`/`AppearanceSettings` are the **integration pieces** (store + transport);
  the `LoginDialog` stays presentational (`auth` module).
  Panels compose their own sub-panels
  (e.g. `RightPanel`→`FileTree`/`ChangesPanel`, `CenterTabs`→`FilePane`→`MonacoEditor`) — an internal hierarchy.
  When the active workspace has no open center tab, `CenterTabs` uses the empty surface as a persistent
  creation/orientation receipt rather than a generic placeholder: **“Workspace ready”**, the display name,
  `branch · from baseBranch`, and **“Files, chats, changes, and terminals are scoped to this workspace,”**
  followed by a **New chat** action (`start-chat`) — the **single-chat bootstrap**: it appears only when
  the center is empty, so once the one chat exists it never returns. **Single chat (view-only):** there
  is **only ever one chat tab**; the parallel-chat creator (the tab-strip `+`) is removed and the chat
  tab is **non-closable** (no `X`; file/diff tabs still close). No session/runtime is ever disposed by
  the view. On workspace-activate `CenterTabs` **hydrates a single chat tab**: `session.list` → restore
  the **most-recently-updated** session (`session.getMessages` → `messagesToRuntime` →
  `store.hydrateSession`); if the workspace already has a chat tab it's a no-op, and any other host
  sessions stay live but untabbed. Beside the tabs, a **History** dropdown (`doc-history`, shown when
  non-empty) lists the workspace's **last 10 opened documents** — files + diffs, **not** chat, most-
  recent-first (`store.docHistoryByWorkspace`, view state in localStorage, recorded by `openFileInTab`
  /`openDiffInTab`); clicking a row re-opens it as a center tab. A rejected bootstrap `session.create`
  raises a `store.toast.error` (the click would otherwise do nothing, silently). **`Toaster`** is the app-wide toast host the shell mounts once: it subscribes to `store.toasts` and
  renders each via the `components/ui/toast` primitives, letting Radix own the auto-timeout + swipe/hover-pause
  and routing every close back through `store.dismissToast` (so the store stays the single source of truth).
  Errors persist until dismissed; success/info time out. The **integration piece** — the primitives stay
  presentational.
- **`ProjectView`** is the read-only **project** screen the shell mounts in the center when a project is
  selected (no active workspace): a header (the shared `projectAvatarColor` avatar + name + a
  **“Read-only · main”** `Lock` badge + a primary **Edit** `DropdownMenu`) over a **mocked** file list +
  a read-only `MonacoEditor`. The Edit dropdown has exactly **Edit in new worktree** (Recommended → the
  `NewWorkspaceDialog`, pre-scoped to the project) and **Edit inline here** (session-only `readOnly=false`).
  A keystroke while read-only surfaces a soft-edit hint (“Editing the main branch is off…” + a “New
  worktree” action) via `MonacoEditor`'s `onReadOnlyEdit` — never a silent swallow. File tree/contents
  are **mock** (clearly labelled; no host read/wire). The **contextual right rail** (Specs/All files/
  Scripts/Hooks) is mounted beside it by the shell; there's no terminal (worktree-scoped).
- **`Onboarding`** is the first-run overlay the shell mounts: a full-viewport `Dialog` (reused; overridden
  to full-screen) with a step indicator + sequential steps (Welcome + **mock** root-path approval, then
  feature explainers). On mount, if the **mocked** `onboardingStorage` seen-flag is unset it auto-opens
  **blocking** (`hideClose`, Esc/outside `preventDefault`); the left-panel footer **help (`?`) button**
  re-opens it **closable** (review). Finishing marks the flag seen. Title + description use the **shared
  scale** with `WelcomePanel` (title `--font-xl`, description `text-md`) and the **shared left-aligned
  block layout**: the block is `~60%` of the viewport (`max-w-[90%]` on mobile), centered by position
  (`m-auto`, no border/panel), with the step indicator top-left, flush-left title/description/fields, and
  the primary action (Continue/Get started) at the block's **bottom-right** (Back stays left). The welcome paragraph carries an inline **worktree help** control (the
  app's `HelpCircle` icon right after "worktree", wrapping with the text) that opens a small `Popover`
  explaining the concept (inline only — no docs route exists). The block is width-constrained by percent
  (`max-w-[90%] md:max-w-[60%]`, not the theme's customized named `max-w-*` scale) with block text so
  paragraphs wrap normally. No wire/contract (mock flag + path).
- **Public surface:** the top-level panels the shell mounts (`LeftPanel`, `WelcomePanel`, `ProjectView`, `Onboarding`, `ProjectDialogs`,
  `CenterTabs`, `RightPanel`, `TerminalsPanel`, `Toaster`), imported **per-file** (no barrel — keeps the
  lazy chunks split). (`WelcomePanel`, `ProjectView`, and `CenterTabs`/`RightPanel`/`TerminalsPanel` are
  mutually exclusive — the shell mounts one per the workspace/project selection.)
- **Allowed deps:** `store`, `transport`, `components/ui` (incl. `popover`/`command`/`textarea` for the
  dialog), `chat` (`ModelSelector`/`ThinkingSelector`, reused by `NewWorkspaceDialog`; `Markdown`,
  reused by `MarkdownPreview`), `lib`, `utils` (`theme`'s `THEMES`, for `AppearanceSettings`),
  `contracts`; `lucide-react`; and the heavy libs each lazy panel owns (`monaco-editor`, `shiki`,
  `@xterm/*`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

## Get right

- `RightPanel` tabs are **Specs | All files | Changes** (Specs leftmost and the **default** — specs are
  the project's ground truth, so the rail leads with them).
- **Live refresh (the worktree panels follow the disk).** `FileTree` / `ChangesPanel` / `SpecsPanel` /
  `FilePane` watch the store's `fsChangesByWorkspace` tick for their workspace (fed by the host's
  debounced `workspace.fsChanged` push — see [[submodule-server-watch]]) and silently refetch through
  the same read methods they mount with — agent edits, terminal commands, and Finder changes all land
  without a manual step. Refetches **preserve view state**: `FileTree` re-reads the root + every
  expanded dir (rows keyed by path; vanished dirs drop out via their parent), `ChangesPanel` re-reads
  `git.status` (the list is the whole panel — diffs live in center `DiffPane` tabs, which re-fetch
  their two sides on the same tick, skipping a single unrelated batch by path), `SpecsPanel` refetches without remounting (expansion survives), and `FilePane` re-reads an
  open tab's content when the workspace ticked past the tab's loaded tick (live while visible;
  background tabs catch up on activation — only the active tab is mounted; a failed re-read — file
  deleted — keeps the last content, no auto-close). Panels are mounted only for the active workspace,
  so scoping is natural; a degraded watcher just means back to read-on-demand. Deliberately **not**
  live (deferred): editable-file conflict handling waits for `fs.writeFile` (the viewer is read-only
  today). (The center header's git-status cluster is **mocked/display-only** in the current change —
  see `shell/SPEC.md` — not a live per-worktree feed yet.)
- `SpecsPanel` is the read-only spec-graph viewer: one `spec.graph` fetch per workspace-activation /
  tab-visit, refetched on the fs tick, plus a header **Refresh** button re-fetching on demand (the
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
  **single click** opens the rendered spec through the same `fs.readFile` → `openTab` flow as `FileTree`
  (there is no hidden double-click gesture). Every row stays on one line: indentation → chevron →
  shape-coded role icon → truncated title → fixed trailing role (`ARCH` / `MODULE` / `SUBMODULE` / `TASK`;
  unknown types degrade compactly). The top-level `goal-and-requirements` row instead carries the exact
  **`Main spec`** label and distinct root icon; the active file tab's row has a persistent selected
  treatment. **Lifecycle status is not presented at all** — future lint health arrives with a real linter
  feature, not speculative dots or reused status chrome. This remains a restrained hierarchy — no hero,
  duplicate root, preview, or graph canvas. `FileTree` keeps its own gesture model (whole-row click
  toggles dirs — no collision there).
- `RightPanel`/`ChangesPanel` watch the store's `changesRequest` deep-link (set by a chat turn-divider's
  files-changed chip; each request is a fresh object, and `ChangesPanel` marks the handled one in a ref
  so a later status refresh can't re-steal focus):
  "files changed" chip): when it targets the active workspace, `RightPanel` flips to the Changes tab and
  `ChangesPanel` opens the requested file's diff tab (matched by path suffix against `git.status`).
- **Markdown file tabs render, don't read.** A `.md`/`.markdown` `FileTab` (from the file tree **or** the
  Specs panel — same `openTab` path) opens **rendered by default**: `FilePane` gates on `lib.isMarkdownPath`
  and shows a slim `Preview | Source` header (`markdown-view-toggle`), the rendered view being lazy
  `MarkdownPreview` (reuses `chat/Markdown` for GFM+shiki but owns the **document skin** — a
  reading-optimized token-utility prose treatment modeled on GitHub's markdown CSS: an em-relative
  heading scale (h1 2em…h6 .85em) with h1/h2 rules, a capped reading measure (~78ch) with wide
  tables/code scrolling inside it, zebra-striped bordered tables, muted accent blockquotes, crisp
  rules, and **GitHub-style alert callouts** (`> [!NOTE]`…`[!CAUTION]`, via the in-repo
  `markdownAlerts` remark transform + a lucide/token `AlertCallout`, wired in only here — not chat) — in
  a centered reading column; strips a leading YAML frontmatter block via
  `lib.stripFrontmatter` so a spec's metadata doesn't render as a stray heading — source view still shows
  it) and source being the lazy read-only `MonacoEditor`. The choice
  is a per-tab `store.setFileTabView` (survives tab switches; not persisted across reload). Non-markdown
  files render Monaco directly with no header, exactly as before.
- **Rendered markdown navigates.** In the preview, links + images resolve against the file's own path
  (via `markdownLinks`, passed as the `a`/`img` renderers): a **relative link** opens the target file as
  a tab through the shared **`openFileInTab`** (the same flow `FileTree` uses), an **in-doc `#` link**
  scrolls the preview (headings carry slug ids from the in-repo `remarkHeadingIds` transform), an
  **external** link opens a new tab, and a **relative image** rewrites to the host **`/files/…`** route
  (built from `transport.httpBase()`). A cross-file link's `#fragment` is not yet followed (opens the
  file only).
- **`MonacoEditor`** is **read-only by default** (the transcript/file-tab viewer); it takes an optional
  `readOnly={false}` (inline editing) + `onReadOnlyEdit` (fires Monaco's `onDidAttemptReadOnlyEdit` when
  a keystroke lands while read-only — `ProjectView` uses it for the soft-edit hint).
- **Code surfaces re-theme from the tokens, resiliently.** `MonacoEditor` defines the `thinkrail` theme
  from the live tokens (chrome from the surface tokens, the `vs`/`vs-dark`/`hc-black` base from
  `[data-theme]` — high-contrast rides Monaco's real hc-black palette — syntax rules from whichever
  `--code-*` a theme sets, and the optional `--sel-fg` selected-text color, high-contrast's
  black-on-yellow) and redefines it via a `[data-theme]`
  MutationObserver; token reads are **canonicalized to hex** (`lib.cssColorToHex` — minified CSS serves
  equivalents like `#fff`/`gray`, which Monaco rejects; unparseable → dropped, never passed through) and
  the define **degrades to the base palette instead of throwing** (a bad
  token value must never crash the editor panel). `TerminalInstance` builds the xterm theme the same way,
  including the **16 `--ansi-*` slots** (so shell colors stay legible per theme) and the optional
  `--sel-fg` selection foreground, re-read on the same
  observer (`MonacoEditor.tsx` exports the theme id + define + observer helpers; `DiffPane` reuses them).
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
  A lazy chunk that fails to load (or a render throw) is contained by the `components/ErrorBoundary` the
  **shell** wraps each region in (see `shell/SPEC.md`), so a single panel degrades instead of blanking the
  app; panels themselves don't own the boundary.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
