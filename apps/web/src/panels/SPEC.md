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
  button; Esc + outside-click cancel); removal is **optimistic + non-blocking**: on confirm it drops the row via `store.removeWorkspace` + `clearWorkspaceTabs`
  and fires `workspace.remove` without awaiting, reconciling a failure by re-listing).
  **Opening a project** goes through the shared **`useOpenProject`** hook (reused by `ProjectTree` **and**
  `WelcomePanel`, so the flow is identical in the rail and the Welcome screen): `project.open`, and on
  failure `project.inspect` → either offers to bootstrap the folder into a repo — a modal **`ConfirmDialog`**
  (confirm → `project.init`) — when it's `initable`, or surfaces the error in a **`NoticeDialog`** — so a
  non-git folder is never a silent no-op. Both are modals on `components/ui/dialog` (the init offer has no
  on-screen anchor, unlike the Remove popover); `NoticeDialog` is a single-button info modal for failures
  with no yes/no follow-up. The hook returns a `dialogs` node each consumer renders. Also
  `FileTree`, `SpecsPanel`, `RightPanel`,
  `ChangesPanel` + lazy `DiffViewer`, `CenterTabs` + lazy `MonacoEditor`, `TerminalsPanel` + lazy
  `TerminalInstance`. **`WelcomePanel`** is the first-touch surface the shell mounts (centered, left-nav beside it) whenever no
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
project"** opens the same dialog with an `initialPrompt` seed (nudging the `project-setup` skill). Which
project drives the has-specs states = `selectedProjectId ?? projects[0]`, read reactively (so the visible
nav's selection updates it). The open-project orchestration lives in the shared **`useOpenProject`** hook
(above), so the Welcome "Open project" card gets the same non-git init/notice handling as the rail.
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
  `transport`'s `errorText`) rather than vanishing. (`gh` status lives in `SettingsDialog`, not the
  create dialog.) **`SettingsDialog`** is the app-settings surface the shell's topbar gear opens — its
  "Local GitHub" block shows `github.authStatus()` (Connected + login / Not connected) with a Refresh.
  Panels compose their own sub-panels
  (e.g. `RightPanel`→`FileTree`/`ChangesPanel`, `CenterTabs`→`MonacoEditor`) — an internal hierarchy.
  `CenterTabs` closing a chat tab routes to `store.closeChatToHistory` (keeps the session alive) and shows a
  **chat-history** dropdown (recently-closed + disk-only chats, shown only when non-empty). On
  workspace-activate it **hydrates**: `session.list` → **live** sessions auto-restore as tabs
  (`session.getMessages` → `messagesToRuntime` → `store.hydrateSession`); **disk-only** ones go to history
  via `store.noteClosedChats`. Reopening restores a live runtime's tab, or for a disk-only chat re-opens it
  on the host (`getMessages`) + hydrates — so a reload, a second tab, or a host restart all rebuild from the
  host.
- **Public surface:** the top-level panels the shell mounts (`ProjectTree`, `WelcomePanel`, `CenterTabs`,
  `RightPanel`, `TerminalsPanel`), imported **per-file** (no barrel — keeps the lazy chunks split).
  (`WelcomePanel` and `CenterTabs`/`RightPanel`/`TerminalsPanel` are mutually exclusive — the shell mounts
  one set or the other on the active-workspace branch.)
- **Allowed deps:** `store`, `transport`, `components/ui` (incl. `popover`/`command`/`textarea` for the
  dialog), `chat` (`ModelSelector`/`ThinkingSelector`, reused by `NewWorkspaceDialog`), `lib`,
  `contracts`; `lucide-react`; and the heavy libs each lazy panel owns (`monaco-editor`, `shiki`,
  `@xterm/*`) loaded via `import()`.
- **Forbidden:** `server`/`shared`/`pi`; importing `shell`; reaching across unrelated panels.

## Get right

- `RightPanel` tabs are **Specs | All files | Changes** (Specs leftmost and the **default** — specs are
  the project's ground truth, so the rail leads with them).
- `SpecsPanel` is the read-only spec-graph viewer: one `spec.graph` fetch per workspace-activation /
  tab-visit, plus a header **Refresh** button re-fetching on demand (read-on-demand, no push — the host
  side revalidates per read), rendered as the **`parent` tree** (roots = no/dangling parent;
  default-expanded). A fetch **failure renders a distinct error hint** (pointing at Refresh), never the
  "No specs" empty state — offline and empty are different answers. The tree build (`specTree.ts`)
  assumes a well-formed graph — **parent cycles are `spec_validate`'s problem, not the viewer's** (cycle
  members are unreachable from any root and simply don't render) — but the walk is **visited-guarded**,
  so a malformed graph can never hang or loop the UI. Tree only in this slice — no cross-edge display,
  no editing, no validation badges, no graph canvas.
- `SpecsPanel` gestures + anatomy: spec nodes are container **and** file at once, so the gestures are
  disjoint — the **chevron alone** expands/collapses (padded hit target), **double-click** on the row
  opens the spec file as a Monaco tab via the same `fs.readFile` → `openTab` flow as `FileTree`, and row
  single-click stays **unclaimed** (reserved for the future selected-node detail strip). Visuals are
  consistency contracts, not novel design: row anatomy mirrors `FileTree`, the chevron's hover
  affordance follows `ProjectTree` (the exact classes live in the code). `FileTree` keeps its own
  gesture model (whole-row click toggles dirs — no collision there).
- `RightPanel`/`ChangesPanel` watch the store's `changesRequest` deep-link (set by a chat turn-divider's
  "files changed" chip): when it targets the active workspace, `RightPanel` flips to the Changes tab and
  `ChangesPanel` selects the requested file (matched by path suffix against `git.status`).
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
