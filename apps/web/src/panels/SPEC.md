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

- **Owns:** `ProjectTree` (+ the `NewWorkspaceDialog` its "+" opens **and** the `ConfirmPopover` its per-row
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
  name is decoupled from the git branch (see [[submodule-server-workspaces]]). The **Default workspace**
  (`kind === "default"` — the project folder itself) renders **pinned first** (the server pins it in
  `workspace.list`; `addWorkspace` appends created worktree rows after it), with a **`House` icon** in
  place of the `GitBranch` glyph and **no Remove button** (non-removable — the server enforces it; the UI
  simply offers nothing). Its branch line shows the folder's real current branch. The active workspace must
  also stay visible: when `ProjectTree` mounts with an active workspace, or the active workspace's derived
  owning project changes or first becomes resolvable, it expands that parent project. A manual collapse
  remains respected while the owning project is unchanged; ordinary `workspace.updated` snapshots and
  same-project workspace switches do not force it open again. Workspace creation expands its project
  explicitly. Selecting or creating a workspace also selects its owning project, keeping project-home and
  active-workspace context coherent even when the create dialog's project picker targets another project.
  **Opening a project lands on that project's Welcome** — deliberately **no auto-enter** into any
  workspace: Welcome is the fork where the two working modes (isolated worktree vs the project folder's
  Default workspace) are presented as an explicit choice (see `WelcomePanel`), so opening and the
  "project home" gesture converge on the same surface. Opening goes through the shared
  **`useOpenProject`** hook (reused by `ProjectTree` **and**
  `WelcomePanel`, so the flow is identical in the rail and the Welcome screen): `project.open`, and on
  failure `project.inspect` → either offers to bootstrap the folder into a repo — a modal **`ConfirmDialog`**
  (confirm → `project.init`) — when it's `initable`, or surfaces the error in a **`NoticeDialog`** — so a
  non-git folder is never a silent no-op — and neither is a host that couldn't *show* a folder dialog (that
  throws; the notice carries the reason, and the request runs on a raised `timeoutMs` since the picker waits
  on a human). Both are modals on `components/ui/dialog` (the init offer has no
  on-screen anchor, unlike the Remove popover); `NoticeDialog` is a single-button info modal for failures
  with no yes/no follow-up. The hook returns a `dialogs` node each consumer renders. **Selecting a
  project** (clicking its row — the chevron expands/collapses separately) **deselects any active
  workspace**, so the shell returns to that project's Welcome — a deliberate "project home" gesture; the
  workspace's tabs survive in the store, so re-selecting it restores its view. Also
  `FileTree`, `SpecsPanel`, `RightPanel`,
  `ChangesPanel` (the changed files under a header that says **what** is being diffed — the
  **`ChangesScopeMenu`** scope pill + the shared **`BranchPicker`** target-branch pill — plus the
  **List | Tree** toggle (`store.changesView`, app-wide) switching a flat list and a folder
  **`ChangesTree`**; clicking a file in either opens/focuses its **center Monaco diff tab**, and every file
  row carries the shared **`ChangeRowActions`** menu),
  `CenterTabs` + `FilePane` (+ its lazy `MonacoEditor` / `MarkdownPreview`) + `DiffPane` (+ its lazy
  `MonacoDiff`), `TerminalsPanel` + lazy `TerminalInstance`. The Monaco plumbing both editors share —
  worker wiring, the local loader, the token-driven `thinkrail` theme + the `[data-theme]` re-theme
  observer — lives once in `monacoSetup.ts`; the slim header view-toggle segment (`Preview|Source`,
  `Split|Inline`, `List|Tree`) is the shared `ToggleSegment`. The **file-style tree row** (chevron/spacer
  lead, folder/file icon, truncated label, trailing slot; `min-w-0` so a row can shrink when it shares a
  flex line with a trailing control) is the shared **`TreeRow`**, used by both
  `FileTree` and `ChangesTree` so the two trees stay identical; the **`+N −M` diff-count badge** is the
  shared **`DiffStatBadge`**, used by the project-rail worktree stats and the Changes tree's per-file /
  per-folder counts. `ChangesTree`'s tree build + `+/−` aggregation + shared status glyphs live in the pure
  **`changesModel.ts`** (unit-tested; no store/transport — `ChangesTree` is presentational, fed `changes` +
  `onOpen`/`isActive` by `ChangesPanel`), together with the **diff-tab identity + scope vocabulary**:
  `scopeKey` / `diffTabId(workspaceId, scope, path)` / `diffTabName` / `scopeLabel` and the `splitPath`
  used by both the flat list's path rows and the diff header's path chip. The **branch combobox** is the
  shared **`BranchPicker`** (searchable, grouped Remote/Local, current pick check-marked, a Refresh that
  re-lists) — one component for the New-Workspace dialog's *base* branch and the Changes header's *target*
  branch; the whole state *around* it — the list, `refreshing`, `refresh()` — is the shared
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
label + explainer bottom-left; the primary is a filled-violet card carrying the stable `welcome-cta`
hook, others quiet `welcome-action`s). Welcome is **the mode fork**: with a project shown it always pairs
**"Start building"** (isolated worktree) with **"Work in project folder"** (the Default workspace) so the
two working modes are a visible choice, not a hidden default. The cards by state: **no projects** →
**"Open project"** (one card); **project + `hasSpecs`** → **"Start building"** (primary) + "Work in
project folder"; **project + no specs** → a spec-first **"Set up project"** (primary) + "Start building"
+ "Work in project folder". **"Open project" appears only in the no-projects state** — where it's the
only possible action; once a project is shown, opening another is the projects-rail **"+"** (the same
dropdown), so Welcome stays the *work-in-this-project* surface. That card hangs the shared
**`AddProjectMenu`** dropdown off it (same menu as the projects-rail "+": Open project / Open GitHub (soon)
/ Recents), so `Card` is a `forwardRef` usable as a Radix `asChild` trigger. **"Work in project folder"**
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
  provider-auth surface — Connected cards each with a **Sign-out only when `canLogout`** (env / central /
  models.json auth shows a "Managed" tag instead, since the host can't unset it); a **"Sign in with a
  subscription"** block of `canOAuth` providers; an **"Add an API key"** group of `canApiKey`-only
  providers (capped with a "Show N more" expander) — **both routes start `provider.loginStart`**
  (`type` `"oauth"` / `"api_key"`, issue #97) into the same store-driven `auth/LoginDialog` (open the
  URL / paste a code / answer the provider's own key prompts, `provider.loginReply` — no inline key
  field); a "configured outside the app" note for rows with neither flag; and
  the **`JetBrainsAiCard`** — route Claude+GPT through your JetBrains subscription (the jbcentral proxy) — a
  state machine over `jbcentralWired`/`jbcentralInstalled` + `jbcentralInstall` (all from the same status
  read) + `provider.jbcentral*`:
  Connected (Disconnect) / ready (Connect) / not signed in (in-app `central login` + Retry) / not installed
  (the host's per-OS copyable install command — from `jbcentralInstall`, for the *host's* OS, never the
  browser's — + Recheck); each mutation re-reads `provider.status`) **`GithubSettings`** (the "Local GitHub" block — `github.authStatus()`
  Connected + login / Not connected + Refresh); **`AppearanceSettings`** (the **theme picker** — the
  bundled catalog from `themes`, with the resolved active selection from `store.theme` marked; clicking
  one fires `settings.update` and the UI **converges on the `settings.changed` broadcast** (no optimistic
  apply), a rejected update raising a toast; the picker never owns a theme list — it renders the catalog
  the glob discovered at build time); and **`TemplatesSettings`** — two groups, **Global** and **This
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
  `panels/`). **Delete** is a `ConfirmPopover` on the row (the same anchored-confirm pattern
  `ProjectTree.tsx`'s workspace-remove uses) calling `template.delete` directly — the dialog itself is
  never involved in deletion. **R4 — starter-templates offer:** when the **Global** group's fetch has
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
  the boolean ever crosses the wire, see `submodule-server-analytics`. A single dimmed "General" nav item ("Soon") still signals the shell is
  built to grow. `ProvidersSettings`/`AppearanceSettings`/`TemplatesSettings`/`PrivacySettings` are the
  **integration pieces**
  (store + transport); the `LoginDialog` stays presentational (`auth` module).

  Panels compose their own sub-panels
  (e.g. `RightPanel`→`FileTree`/`ChangesPanel`, `CenterTabs`→`FilePane`→`MonacoEditor`) — an internal hierarchy.
  When the active workspace has no open center tab, `CenterTabs` uses the empty surface as a persistent
  creation/orientation receipt rather than a generic placeholder: **“Workspace ready”**, the display name,
  `branch · from baseBranch`, and **“Files, chats, changes, and terminals are scoped to this workspace,”**
  followed by the existing **New chat** action. For the **Default workspace** the receipt tells the truth
  instead of promising isolation: **“Default workspace”**, the project name, `on <branch>`, and “Chats,
  changes, and terminals run directly in your project folder.” It is neither one-time nor dismissible, so it also helps
  after the last tab closes without introducing onboarding state. `CenterTabs` also renders ephemeral
  **`doc`** tabs (`DocTab` — inline rendered markdown, no file on disk) via its own
  `DocPane`→`MarkdownPreview`; used for the plan-as-markdown snapshot (see the `chat` module). `CenterTabs`
  closing a chat tab routes to `store.closeChatToHistory` (keeps the session alive) and shows a
  **chat-history** dropdown (recently-closed + disk-only chats, shown only when non-empty). On
  workspace-activate it **hydrates**: `session.list` → **live** sessions auto-restore as tabs
  (`session.getMessages` → `messagesToRuntime` → `store.hydrateSession`), and so do **disk-only sessions
  carrying unfinished TODOs** (`SessionSummary.openTodos > 0` — work in progress survives a host restart
  as open tabs, hydrated with the disk-attach tick baseline), **capped at the newest `AUTO_OPEN_LIMIT`**:
  a long-lived workspace can hold a dozen half-finished chats, and opening every one would bury the tab
  strip and pull every transcript into memory, so past the cap they stay one click away in history. The
  remaining **disk-only** ones go to
  history via `store.noteClosedChats`. Two guarantees ride that pass: **never-empty** — when nothing
  opened (and no session in *this client's* store was closed to history, which is what vetoes the
  fallback; closes aren't persisted, so after a reload a closed chat is indistinguishable from any other
  disk chat and may reopen), the most recent disk chat
  auto-opens as a fallback; **most-recent focus** — the newest (`updatedAt` desc) hydrates first and alone,
  the rest then load in parallel, and
  `hydrateSession` only takes focus while the workspace has no active tab, so the latest auto-opened chat
  lands focused without ever stealing an existing selection (e2e: `auto-open-chats.spec.ts`). Reopening restores a live runtime's tab, or for a disk-only chat re-opens it
  on the host (`getMessages`) + hydrates — so a reload, a second tab, or a host restart all rebuild from the
  host. A rejected new-chat `session.create` or history-reopen `getMessages` raises a `store.toast.error`
  (the click would otherwise do nothing, silently; a failed reopen stays in history for a retry).
  `CenterTabs` also resolves the history-search **`chatLocationRequest`** deep link (see `store/SPEC.md`):
  once its workspace is active, it focuses an already-open tab, `reopenChat`s a live-but-closed one, or
  fetches + hydrates a disk-only one — the reopen flow's two cases above, plus a third case for an
  already-open tab — leaving `ChatView` to consume the request for the scroll + flash (`chat/SPEC.md`'s
  Jump-to-message bullet). **`Toaster`** is the app-wide toast host the shell mounts once: it subscribes to `store.toasts` and
  renders each via the `components/ui/toast` primitives, letting Radix own the auto-timeout + swipe/hover-pause
  and routing every close back through `store.dismissToast` (so the store stays the single source of truth).
  Errors persist until dismissed; success/info time out. The **integration piece** — the primitives stay
  presentational.
- **Public surface:** the top-level panels the shell mounts (`ProjectTree`, `WelcomePanel`, `CenterTabs`,
  `RightPanel`, `TerminalsPanel`, `Toaster`), imported **per-file** (no barrel — keeps the lazy chunks split).
  (`WelcomePanel` and `CenterTabs`/`RightPanel`/`TerminalsPanel` are mutually exclusive — the shell mounts
  one set or the other on the active-workspace branch.)
- **Allowed deps:** `store`, `transport`, `components/ui` (incl. `popover`/`command`/`textarea` for the
  dialog), `chat` (`ModelSelector`/`ThinkingSelector` + the `useModelCatalog` hook that feeds them,
  reused by `NewWorkspaceDialog`; `Markdown`,
  reused by `MarkdownPreview`; `TemplateEditorDialog`, reused by `TemplatesSettings`), `lib`, `themes` (catalog + generic application contract),
  `contracts`; `lucide-react`; and the heavy libs each lazy panel owns (`monaco-editor`, `shiki`,
  `@xterm/*`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

## Get right

- `RightPanel` tabs are **Specs | All files | Changes** (Specs leftmost and the **default** — specs are
  the project's ground truth, so the rail leads with them).
- **Live refresh (the worktree panels follow the disk).** Every workspace-scoped read goes through one
  hook — **`useWorkspaceRead(workspaceId, read, handlers, readKey?) → { reload }`** — which owns *when* to read
  (workspace change, that workspace's `fsChangesByWorkspace` tick, a **`readKey`** change, or `reload()` for a manual Refresh) while
  the caller owns *what to do* with the outcome (`onResult` / `onFailure` / `onSwitch`). Centralized because
  each site was otherwise re-implementing the **stale-response guard**: an answer in flight when the caller
  moves on must not land in the new workspace's view (reads are generation-stamped — latest wins, abandoned
  ones stay silent). A `null` workspaceId reads nothing, which is also how a *paused* read is expressed (a
  collapsed `FileTree` dir), so no tick has to be threaded down as a prop.
  Its users — `FileTree` (root + each expanded dir), `ChangesPanel` (`git.status`), `useWorkspaceSpecs`
  (`spec.graph`) — plus `FilePane`/`DiffPane`, which follow the same tick contract per open tab. Agent edits,
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
  vanished-commit rule below) must be able to tell it from a timeout or a dropped socket.
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
  being an object the key merely names — is expected. Refetches **preserve view state**: `FileTree` re-reads the root + every
  expanded dir (rows keyed by path; vanished dirs drop out via their parent), `ChangesPanel` re-reads
  `git.status` (list-only — the diff renders in the center tab, not under the list), `SpecsPanel`
  refetches without remounting (expansion survives), and `FilePane`/`DiffPane` re-read an
  open tab's content when the workspace ticked past the tab's loaded tick (live while visible;
  background tabs catch up on activation — only the active tab is mounted; a failed re-read — file
  deleted — keeps the last content, no auto-close; a diff tab whose file left the change set likewise
  keeps its last contents — the Changes list is where the disappearance shows). `FilePane` and `DiffPane`
  run the **one** tab-content live-refresh contract — the shared **`useLiveTabContent(tab, {read, applyFresh,
  keepCurrent}, reloadKey?)`** hook — differing only in the read method (`fs.readFile` vs `git.diffFile`) and the store
  write (`updateFileTabContent` vs `updateDiffTabContent`). Its one-batch skip ("this file isn't in it—just
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
  so scoping is natural; a degraded watcher just means back to read-on-demand. Deliberately **not**
  live (deferred): the project-rail workspace diffStats badges; editable-file conflict handling waits
  for `fs.writeFile` (the viewer is read-only today).
- **`useWorkspaceSpecs` owns the `spec.graph` read** (one fetcher, one definition of "this file is a spec"):
  the snapshot lands in the store (`specsByWorkspace`), not panel state, because the chat's turn divider
  needs the same answer to route its chips. It is called by **`RightPanel`**, not by `SpecsPanel` — the
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
  shape-coded role icon → truncated title → fixed trailing role (`ARCH` / `MODULE` / `SUBMODULE` / `TASK`;
  unknown types degrade compactly). The top-level `goal-and-requirements` row instead carries the exact
  **`Main spec`** label and distinct root icon; the active file tab's row has a persistent selected
  treatment. **Lifecycle status is not presented at all** — future lint health arrives with a real linter
  feature, not speculative dots or reused status chrome. This remains a restrained hierarchy — no hero,
  duplicate root, preview pane, or graph canvas. `FileTree` shares the same file gesture model
  (preview/keep) but keeps its own directory behaviour — a whole-row click toggles dirs, no collision
  there.
- **The chat deep-links mirror the tab split.** `RightPanel` decides *which view is showing* from exactly one
  store field — **`rightTabRequest`** (`requestRightTab`, which both path intents below set in the same
  action) — so the flip is one concept rather than something re-derived per request type, and a divider chip
  that only reveals a view (expanding its artifact list, no path picked) needs no path to do it.
  `ChangesPanel` watches `changesRequest` (set by a chat turn-divider's "files changed" chip),
  **highlights** the requested file's row (resolved with `matchesWorktreePath` against `git.status`) **and
  opens its diff tab** in the **preview slot** — the chip/list-row click *is* the user's explicit ask to see
  that change, so stopping at a highlight read as broken, and following a chip is browsing, same as clicking
  the row it points at, so it reuses the slot rather than accumulating a kept tab per chip. A path no longer
  in the current diff (a round from days ago) degrades to highlight-only: there is no diff to show. **So does
  a deep link the user has already navigated past** — this open is the one that *cannot* mark its own
  navigation when it happens, because the path is only resolvable once `git.status` lands and the chip is
  normally what reveals this view (a fresh mount, a full round trip). The count stamped on the request
  (`changesRequest.navTick`, taken at the click) is what it compares against, so a tab the user picked while
  the list was loading is the later navigation and keeps focus. The
  intent is **consumed** (`clearChangesRequest`) once handled — it opens a center tab, so a git-status
  re-read replaying it would yank the user's tab back. `SpecsPanel` watches **`specRequest`** (the "N specs"
  chip) and **opens the rendered spec**, likewise in the preview slot
  (`openFileInTab`, which canonicalizes the reported path — pi may report it absolute or `./`-prefixed — to
  the worktree-relative **tab identity**, so a deep link can never open a second tab for a file already open
  under its relative path; that lives in the choke point, not in each caller, and it means a spec created
  seconds ago and not yet in the graph opens just the same) — a spec has nothing to preview short of its
  content, and the tree row lights up on its own since rows key off the active tab id. That intent is
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
  Every other failure (timeout, dropped socket, git error) leaves the user's chosen scope alone, keeps the
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
- **The diff is a center tab, not a rail inset.** Clicking a Changes row fetches `git.diffFile` (both sides of
  the row's scope) and opens a **`DiffTab`** (`${workspaceId}:diff:${scopeKey}:${path}` — one tab per *file and
  scope*, carrying its own `scope`: a re-click in the same scope focuses the existing tab, while the same file
  in another scope is a second tab, because a tab's content must never change meaning because the rail's scope
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
  — base-branch no. left, worktree no. right — is Monaco's standard and stays). **A markdown diff has exactly two
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
  VS Code's webview layer, absent from standalone Monaco, hence built here. A row is shown selected when its diff tab is the active center tab (or it's
  the deep-link highlight). A failed `git.diffFile` leaves tabs unchanged (the row stays for a retry).
- **Changes: List | Tree.** A header toggle (`store.changesView`, app-wide — persisted in the store, not
  per workspace, so it survives workspace switches) switches the flat **List** and a folder **Tree**
  (`ChangesTree`), both built from the same `git.status` list. The Tree is styled exactly like the
  All-files tree (shared `TreeRow`); folders **default expanded** (change sets are small); **no single-child
  folder compaction** — one row per segment, matching `FileTree`. **Status is shown on the file name, not
  a letter glyph** (the git-decoration convention — `changesModel.statusNameClass`, shared by both views):
  added / untracked → green, deleted → red + strikethrough, renamed → blue, modified → plain. Each file
  and folder also shows a `+N −M` badge (shared `DiffStatBadge`) — per-file counts come from `git.status`
  (`GitFileChange.added/removed`, from `git diff --numstat`; untracked files count their whole content as
  added — but a binary or oversized untracked file gets no count, mirroring how tracked binaries drop out
  of `--numstat`), folder counts are summed client-side. Both views share `ChangesPanel`'s `openDiff` + `isActive`.
  The **List shows the full worktree-relative path** — muted directory prefix (which yields first when the
  row overflows) + the status-colored basename, so the name a user scans stays visible.
- **Browsing reuses one tab: preview vs keep.** Every workspace has at most one **preview tab** — the
  standard IDE slot a *light* open lands in (`store.previewTabByWorkspace`, see `store/SPEC.md` for the
  state rules). It renders with an **italic label** and `data-preview="true"` on its `editor-tab`; a
  `title` says "Preview — double-click to keep". A **preview** open replaces the slot's tab **at its
  index**, so browsing swaps one tab in place instead of reshuffling the strip under the cursor. The
  gesture map, uniform across every surface (all of them route through `openTabs.ts`, which is what keeps
  them uniform):

  | Surface | single click | double click |
  |---|---|---|
  | `FileTree` file row · `SpecsPanel` document row · `ChangesPanel` list row and `ChangesTree` file row | preview | keep |
  | rendered-markdown relative link · chat turn-divider spec chip | preview | — |
  | strip tab, inactive | activate | keep |
  | strip tab, **active and in preview** | **keep** | keep |
  | strip tab, active and kept | no-op | no-op |

  **A double click composes: it is a preview open plus a promote**, because the browser dispatches
  `click`, `click`, `dblclick`. So — exactly as in VS Code — double-clicking a row *claims the slot on the
  way through*: the tab that was previewing is replaced, and the new one ends up kept in its place. (The
  `openTab(tab, "keep")` primitive itself never touches the slot; that is what a lone `keep` caller like
  Settings' *Open as file* gets.) For that to hold at **any latency**, `openTabs.ts` collapses the three
  opens one gesture fires into a **single `fs.readFile`** (its `inFlight` map): three in-flight reads would
  otherwise be settled by whichever returned first — a leading `preview` replacing the slot's tab, or a
  `keep` landing first and sparing it — so the app would behave one way on localhost and another over
  Tailscale from a phone. The call that *started* the read owns the placement; a `keep` expressed while it
  was in flight promotes the result afterwards — through **`openTab`**, never `setActiveTab`, because only
  `openTab` keys off `tab.workspaceId`: a read the user switches workspaces during would otherwise strand
  this tab previewing and write its id into the workspace they moved to, whose center pane then resolves no
  active tab and drops to the workspace receipt. `e2e/preview-tabs.spec.ts` asserts the single read
  directly, because the outcome it protects is invisible at localhost latency.

  **A tab's freshness stamps are captured BEFORE its read leaves, never after the response lands.**
  `loadedTick` (both tab kinds) and `loadedTarget` (a diff tab's review target) are *claims about what the
  content was read against*, and the store keeps moving while the request is in flight: read back from the
  store on arrival, a `workspace.fsChanged` push or a `workspace.setDiffBase` broadcast that landed mid-read
  would be stamped as already reflected — the live-refresh contract, which re-reads on exactly that drift,
  would see none, and the tab would sit on stale content under a new claim indefinitely. Captured early the
  stamp is at worst pessimistic (one extra re-read on mount), which is the safe direction — the same rule the
  store's `markSkillsSynced` follows. `openTabs.test.ts` pins it by resolving a read by hand after moving the
  store underneath it.

  **A read is slow and a click is not, so a pending browse loses to whatever the user does next.** Each
  read records the workspace's **`store.navTickByWorkspace`** count on the way out, and a **`preview`**
  landing after that count has moved is **dropped** rather than committed. Without it, tapping an unopened
  file over a remote host and then tapping an already-open tab yanks focus back to the file when it arrives
  *and* claims the slot away from what the user landed on. A **`keep`** still commits — it was deliberate,
  and swallowing an explicitly opened tab is the worse surprise; re-clicking the *same* row moves the mark
  forward instead of superseding it, so a double click still promotes. The counter lives in the **store**,
  bumped inside each action that moves the active tab, specifically so **no focus transition can bypass
  it** — a first attempt kept it in this module and silently missed `closeTab`, `reopenChat`, `openDoc`, and
  a new chat, every one of which is a way for the user to move on mid-read. `store/SPEC.md` lists the
  bumping actions; `appStore.test.ts` asserts each one bumps, and `e2e/preview-tabs.spec.ts` dispatches both
  clicks in one JS tick so the interleaving is pinned without depending on real latency.

  The active-preview-tab click is the **touch** path: `apps/web/index.html` ships a plain
  `width=device-width` viewport, so a double tap is the browser's zoom gesture and `dblclick` is not
  something a phone user can rely on — this is the one promote gesture that works there, and it costs
  nothing on desktop (that click is otherwise a no-op). Promotion is **one-way**: nothing demotes a kept
  tab. Chat tabs and `doc` tabs never enter the slot (a chat is an explicit creation; a `DocTab`'s content
  exists only in the store, so a silent replace would destroy it). There is deliberately **no keyboard
  shortcut** — VS Code's `⌘K ↵` is the only convention worth copying and it would cost a two-key chord
  machine the app has no other use for; JetBrains and Zed ship no default binding either. VS Code's
  *pinned* tabs (sort-first, protected from Close Others) are a separate, unbuilt feature.
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
  `highlight="wrapper"`, its `"self"` default being what the All-files tree wants). Exactly one painter,
  always: two hide the case where the wrapper stopped painting, which is why the e2e pin compares the *wrapper's*
  computed band against the *inner button's* (transparent) one, not a wrapper against a wrapper;
  **(2) rows *without* a menu reserve the same gutter** (`ROW_MENU_SLOT`, exported from `ChangeRowActions`
  and worn by the tree's folder rows), or the `+N −M` column sits 24px further right on folders than on
  files; and **(3) a row shares its flex line with that slot, so it must be able to shrink below its label**
  — `TreeRow` carries `min-w-0`, and every path is rendered as *two truncatable halves* (dir + basename), so
  a long basename can never push the counts (or, in `DiffPane`'s twin chip, the ¶/copy/layout controls) out
  of the box. The halves are **not** equally truncatable: the dir prefix out-shrinks the basename 20:1
  (`shrink-[20]` vs `shrink` — a *ratio*, both ≥ 1, since a shrink sum below 1 makes CSS absorb only that
  fraction of the deficit and the row overflows instead), so it yields *first* and the name a user scans survives — equal shrink made
  both halves truncate at once, the opposite of the intent (and the e2e pin now measures the two spans
  separately, so "the dir yields first" is a claim a test can falsify). A `shrink-0` basename overflows its own chip **invisibly to the layout** while spilling over
  the buttons on screen — which is why the e2e pin measures the *chip's* `scrollWidth`, not the header's.
- **Markdown file tabs render, don't read.** A `.md`/`.markdown` `FileTab` (from the file tree **or** the
  Specs panel — same `openTab` path) opens **rendered by default**: `FilePane` gates on `lib.isMarkdownPath`
  and shows a slim `Preview | Source` header (`markdown-view-toggle`), the rendered view being lazy
  `MarkdownPreview` (reuses `chat/Markdown` for GFM+shiki but owns the **document skin** — `tr-prose-doc`
  supplies every typography value (`typography.json` → `proseSystems.doc`: h1–h4 at 24/20/18/16 against
  14px body copy, so a rendered file reads as a document rather than a chat bubble), and the skin adds
  only what is *not* typography: h1/h2 section rules, a capped reading measure (~78ch) with wide
  tables/code scrolling inside it, zebra-striped bordered tables, muted accent blockquotes, crisp
  rules, and **GitHub-style alert callouts** (`> [!NOTE]`…`[!CAUTION]`, via the in-repo
  `markdownAlerts` remark transform + a lucide/token `AlertCallout`, wired in only here — not chat) — in
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
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
  A lazy chunk that fails to load (or a render throw) is contained by the `components/ErrorBoundary` the
  **shell** wraps each region in (see `shell/SPEC.md`), so a single panel degrades instead of blanking the
  app; panels themselves don't own the boundary.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
