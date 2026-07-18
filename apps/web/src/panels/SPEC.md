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
  surfaces an error toast, leaving the row in place).
  **Opening a project** goes through the shared **`useOpenProject`** hook (reused by `ProjectTree` **and**
  `WelcomePanel`, so the flow is identical in the rail and the Welcome screen): `project.open`, and on
  failure `project.inspect` → either offers to bootstrap the folder into a repo — a modal **`ConfirmDialog`**
  (confirm → `project.init`) — when it's `initable`, or surfaces the error in a **`NoticeDialog`** — so a
  non-git folder is never a silent no-op. Both are modals on `components/ui/dialog` (the init offer has no
  on-screen anchor, unlike the Remove popover); `NoticeDialog` is a single-button info modal for failures
  with no yes/no follow-up. The hook returns a `dialogs` node each consumer renders. **Selecting a
  project** (clicking its row — the chevron expands/collapses separately) **deselects any active
  workspace**, so the shell returns to that project's Welcome — a deliberate "project home" gesture; the
  workspace's tabs survive in the store, so re-selecting it restores its view. Also
  `FileTree`, `SpecsPanel`, `RightPanel`,
  `ChangesPanel` + lazy `DiffViewer`, `CenterTabs` + `FilePane` (+ its lazy `MonacoEditor` /
  `MarkdownPreview`), `TerminalsPanel` + lazy `TerminalInstance`. **`WelcomePanel`** is the first-touch surface the shell mounts (centered, left-nav beside it) whenever no
workspace is active. The `PRODUCT_NAME` wordmark as the hero (the topbar's brand styling — accent font,
`text-primary` — enlarged), with the **active project's name as a small eyebrow** (folder icon) above it
once a project is selected, over a **constant** spec-first pitch (not spec-conditional) and
**one-to-three cards** (Conductor-inspired: icon top-left, label + explainer
bottom-left; the primary is a filled-violet card carrying the stable `welcome-cta` hook, others quiet
`welcome-action`s). The cards by state: **no projects** → **"Open project"** (one card); **project +
`hasSpecs`** → **"Start building"** (primary) + "Open project"; **project + no specs** → a spec-first
**"Set up project"** (primary) + "Start building" + "Open project". The **"Open project"** card hangs the shared
**`AddProjectMenu`** dropdown off it (same menu as the projects-rail "+": Open project / Open GitHub (soon)
/ Recents), so `Card` is a `forwardRef` usable as a Radix `asChild` trigger. **"Start building"** is the
intent-first framing of the create-and-kick-off flow — it opens `NewWorkspaceDialog` (which cuts a
worktree-isolated workspace + starts a chat); *workspace* is the mechanism, not the label. **"Set up
project"** opens the same dialog with an `initialPrompt` seed — the `/skill:setting-up-a-project` command,
which **forces** the setting-up-a-project dispatcher skill to load (pi's skill-command syntax; expanded on the
`session.prompt` path) rather than hoping the model auto-matches it; the dispatcher then detects
new-vs-existing and drafts the specs accordingly (see [[module-thinkrail-workflow]]). Which
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
**`NewWorkspaceDialog`** is the create-and-kick-off surface: an optional **`initialPrompt`** seeds the
prompt hero (still editable; empty by default), a base-branch
  combobox (`git.listBranches`, degrading to local branches offline; a Refresh re-lists; `origin/HEAD` is
  filtered so no stray `origin`), a project picker, the prompt hero, and the reused
  `chat/ModelSelector`+`ThinkingSelector` in **pre-session** mode — preselected to the host's resolved
  default via `model.default` so the exact model shows (values held in dialog state, applied at create
  time). The pickers' popovers portal into the dialog node (so their lists scroll under the Dialog scroll
  lock). In the prompt hero, **Enter creates** (matching the Create button's `↵` affordance) and
  **Shift+Enter** inserts a newline. Create = `workspace.create({ projectId, baseRef })` → set active → (with a prompt) open a chat +
  `session.create({ model, thinkingLevel })` + fire-and-forget `prompt`; with an empty prompt it just
  creates the workspace. A **rejected** kick-off `prompt` (a bad model / missing API key — e.g. picking a
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
  `CenterTabs` closing a chat tab routes to `store.closeChatToHistory` (keeps the session alive) and shows a
  **chat-history** dropdown (recently-closed + disk-only chats, shown only when non-empty). On
  workspace-activate it **hydrates**: `session.list` → **live** sessions auto-restore as tabs
  (`session.getMessages` → `messagesToRuntime` → `store.hydrateSession`); **disk-only** ones go to history
  via `store.noteClosedChats`. Reopening restores a live runtime's tab, or for a disk-only chat re-opens it
  on the host (`getMessages`) + hydrates — so a reload, a second tab, or a host restart all rebuild from the
  host. A rejected new-chat `session.create` or history-reopen `getMessages` raises a `store.toast.error`
  (the click would otherwise do nothing, silently; a failed reopen stays in history for a retry). **`Toaster`** is the app-wide toast host the shell mounts once: it subscribes to `store.toasts` and
  renders each via the `components/ui/toast` primitives, letting Radix own the auto-timeout + swipe/hover-pause
  and routing every close back through `store.dismissToast` (so the store stays the single source of truth).
  Errors persist until dismissed; success/info time out. The **integration piece** — the primitives stay
  presentational.
- **Public surface:** the top-level panels the shell mounts (`ProjectTree`, `WelcomePanel`, `CenterTabs`,
  `RightPanel`, `TerminalsPanel`, `Toaster`), imported **per-file** (no barrel — keeps the lazy chunks split).
  (`WelcomePanel` and `CenterTabs`/`RightPanel`/`TerminalsPanel` are mutually exclusive — the shell mounts
  one set or the other on the active-workspace branch.)
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
  `git.status` keeping the selection while its path is still listed (re-fetching its diff, else
  clearing), `SpecsPanel` refetches without remounting (expansion survives), and `FilePane` re-reads an
  open tab's content when the workspace ticked past the tab's loaded tick (live while visible;
  background tabs catch up on activation — only the active tab is mounted; a failed re-read — file
  deleted — keeps the last content, no auto-close). Panels are mounted only for the active workspace,
  so scoping is natural; a degraded watcher just means back to read-on-demand. Deliberately **not**
  live (deferred): the project-rail workspace diffStats badges; editable-file conflict handling waits
  for `fs.writeFile` (the viewer is read-only today).
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
  "files changed" chip): when it targets the active workspace, `RightPanel` flips to the Changes tab and
  `ChangesPanel` selects the requested file (matched by path suffix against `git.status`).
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
- **Code surfaces re-theme from the tokens, resiliently.** `MonacoEditor` defines the `thinkrail` theme
  from the live tokens (chrome from the surface tokens, `vs`/`vs-dark` base from `[data-theme]`, syntax
  rules from whichever `--code-*` a theme sets — Darcula today) and redefines it via a `[data-theme]`
  MutationObserver; token reads are **canonicalized to hex** (`lib.cssColorToHex` — minified CSS serves
  equivalents like `#fff`/`gray`, which Monaco rejects; unparseable → dropped, never passed through) and
  the define **degrades to the base palette instead of throwing** (a bad
  token value must never crash the editor panel). `TerminalInstance` builds the xterm theme the same way,
  including the **16 `--ansi-*` slots** (so shell colors stay legible per theme), re-read on the same
  observer. `DiffViewer` renders shiki's tri palette (`lib/shikiTheme`) once; the swap is pure CSS.
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
  A lazy chunk that fails to load (or a render throw) is contained by the `components/ErrorBoundary` the
  **shell** wraps each region in (see `shell/SPEC.md`), so a single panel degrades instead of blanking the
  app; panels themselves don't own the boundary.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
