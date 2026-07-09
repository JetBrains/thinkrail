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

- **Owns:** `ProjectTree` (+ the `NewWorkspaceDialog` its "+" opens **and** the `ConfirmDialog` its archive
  button opens — a small reusable yes/no built on `components/ui/dialog` that **forces a deliberate choice**
  (no ✕ — `hideClose`; Cancel takes initial focus; a `destructive` confirm shows a warning glyph + red
  button); archive is **optimistic + non-blocking**: on confirm it drops the row via `store.removeWorkspace` + `clearWorkspaceTabs`
  and fires `workspace.remove` without awaiting, reconciling a failure by re-listing), `FileTree`, `SpecsPanel`, `RightPanel`,
  `ChangesPanel` + lazy `DiffViewer`, `CenterTabs` + `FilePane` (+ its lazy `MonacoEditor` /
  `MarkdownPreview`), `TerminalsPanel` + lazy `TerminalInstance`. **`NewWorkspaceDialog`** is the create-and-kick-off surface: a base-branch
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
  (e.g. `RightPanel`→`FileTree`/`ChangesPanel`, `CenterTabs`→`FilePane`→`MonacoEditor`) — an internal hierarchy.
  `CenterTabs` closing a chat tab routes to `store.closeChatToHistory` (keeps the session alive) and shows a
  **chat-history** dropdown (recently-closed + disk-only chats, shown only when non-empty). On
  workspace-activate it **hydrates**: `session.list` → **live** sessions auto-restore as tabs
  (`session.getMessages` → `messagesToRuntime` → `store.hydrateSession`); **disk-only** ones go to history
  via `store.noteClosedChats`. Reopening restores a live runtime's tab, or for a disk-only chat re-opens it
  on the host (`getMessages`) + hydrates — so a reload, a second tab, or a host restart all rebuild from the
  host.
- **Public surface:** the top-level panels the shell mounts (`ProjectTree`, `CenterTabs`, `RightPanel`,
  `TerminalsPanel`), imported **per-file** (no barrel — keeps the lazy chunks split).
- **Allowed deps:** `store`, `transport`, `components/ui` (incl. `popover`/`command`/`textarea` for the
  dialog), `chat` (`ModelSelector`/`ThinkingSelector`, reused by `NewWorkspaceDialog`; `Markdown`,
  reused by `MarkdownPreview`), `lib`,
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
- **Markdown file tabs render, don't read.** A `.md`/`.markdown` `FileTab` (from the file tree **or** the
  Specs panel — same `openTab` path) opens **rendered by default**: `FilePane` gates on `lib.isMarkdownPath`
  and shows a slim `Preview | Source` header (`markdown-view-toggle`), the rendered view being lazy
  `MarkdownPreview` (reuses `chat/Markdown` for GFM+shiki but owns the **document skin** — a
  reading-optimized token-utility prose treatment modeled on GitHub's markdown CSS: an em-relative
  heading scale (h1 2em…h6 .85em) with h1/h2 rules, a capped reading measure (~78ch) with wide
  tables/code scrolling inside it, zebra-striped bordered tables, muted accent blockquotes, and crisp
  rules — in a centered reading column; strips a leading YAML frontmatter block via
  `lib.stripFrontmatter` so a spec's metadata doesn't render as a stray heading — source view still shows
  it) and source being the lazy read-only `MonacoEditor`. The choice
  is a per-tab `store.setFileTabView` (survives tab switches; not persisted across reload). Non-markdown
  files render Monaco directly with no header, exactly as before.
- Heavy deps (Monaco / shiki / xterm) load via `React.lazy(() => import())` to stay out of the eager bundle.
- Streaming invariant (when chat lands): `text_delta`/`thinking_delta` **APPEND**;
  `tool_execution_update.partialResult` **REPLACE**.
