# ThinkRail UI Terminology Reference

A canonical vocabulary for the ThinkRail web UI (`apps/web`), for use by the designer, ChatGPT, and the
pi agent in design discussions.

**Scope & rules for this document:**

- **Frontend only.** Documents `apps/web` as it is implemented today — the single source of truth.
- **Descriptive, not prescriptive.** No redesign, no suggestions, no invented names. Where the codebase
  has no clear name or the naming is inconsistent, that is called out explicitly with a
  **⚠ Naming note**.
- Every region lists, where applicable: **canonical name** (the heading), **implementation name** (the
  React component / file), **`data-testid`** hook (the app's stable identity anchors), **parent**,
  **children**, **position**, and **responsibility**.
- The active-workspace layout projects this window's frontend-local frame and workspace view into a desktop workbench with recursive center groups and movable side groups. The mobile single-view shell is designed but not yet built.

The document proceeds top-down: Application Layout → each region → shared primitives → glossary.

---

# Application Layout

The whole app is composed by one root component and splits into a fixed top bar over a body that has two
mutually-exclusive states.

- **App Shell** — the root frame (`Shell`).
  - **Top Bar** (`<header>`) — always present.
  - **Body** — one of two states:
    - **Workspace Workbench** — the projection of this window's local frame and active workspace view.
    - **Welcome Layout** — the projects rail beside the Welcome screen when no workspace is active.
  - **Toaster** — app-wide notification host, mounted once over either state.

| Canonical name | Implementation | `data-testid` | Notes |
|---|---|---|---|
| App Shell | `shell/Shell.tsx` → `Shell` | `shell` | Composition root; owns the theme DOM side-effect + global hotkeys |
| Top Bar | `<header>` inside `Shell` | — | ⚠ Naming note below |
| Workspace Workbench | `shell/WorkspaceWorkbench.tsx` + `shell/layout/Workbench.tsx` | `workbench` | One window-local frame; workspace-specific resource projection |
| Welcome Layout | `ResizablePanelGroup` (`autoSaveId="thinkrail-shell-welcome"`) | — | Projects rail + Welcome |
| Toaster | `panels/Toaster.tsx` → `Toaster` | — | See Shared Primitives |

**⚠ Naming note (Top Bar):** the code has no component or named prop for the header — it is an inline
`<header>` element in `Shell.tsx`. This reference calls it the **Top Bar**. Do not confuse it with the
**Chat Header** (a per-chat-tab bar) or a **Group Header** (a workbench tab strip).

---

# Top Bar

The application-wide bar across the very top. It is layout-agnostic (present in both body states).

- **Parent:** App Shell.
- **Position:** Full width, top; fixed row above the body (`grid-rows-[auto_1fr]`).
- **Implementation:** inline `<header>` in `shell/Shell.tsx`.

Children (left → right):

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Logo | `<BrandLogo />` (the supplied full vector artwork) | `brand-logo` | The theme-aware ThinkRail brand mark |
| Scope Context | inline block in `Shell.tsx` | `scope-context` | Persistent location breadcrumb; two lines when a workspace is active |
| — Scope Project | inline `<span>` | `scope-project` | Owning project name |
| — Scope Name | inline `<span>` | `scope-name` | Active workspace display name, or `"Project home"` |
| — Scope Branch | inline `<span>` | `scope-branch` | Git branch of the active workspace |
| — Scope Base | inline `<span>` | `scope-base` | `· from <baseBranch>` (hidden for the Default workspace) |
| Connection Status | inline `<span>` | `connection-status` (`data-status`) | Connected / Connecting… / Disconnected pill with a color dot |
| Settings Button | inline `<button>` (gear, `@remixicon/react` `Settings`) | `open-settings` | Opens the Settings Dialog via `store.openSettings()` |

**⚠ Naming note (Scope Context):** the `data-testid` is `scope-context` and the spec text calls it the
"location context". This reference adopts **Scope Context** as canonical; "location context" is an
alternative used in prose.

---

# Projects Tool

The singleton Projects tool, initially in the left side. Its Projects Rail view lists projects and, expanded beneath each, their workspaces.

- **Canonical name:** Projects Tool; **Projects Rail** names its navigation view.
- **Implementation:** `panels/ProjectTree.tsx` → `ProjectTree`, rendered by the shell's Projects tool.
- **`data-testid`:** the tool body wrapper is `left-nav`.
- **Parent:** Workspace Workbench (a movable singleton side tool), or Welcome Layout.
- **Position:** Initially in the left side; its containing group can resize, fold, hide, or move.
- **Responsibility:** open a repo, select a project (a "project home" gesture that deselects any active
  workspace), close a project, expand/collapse to reveal workspaces, create/select/remove workspaces, and
  open a workspace in an external editor / file manager.

**⚠ Naming note (Projects Tool):** legacy names still coexist — the component is `ProjectTree`, its
navigation view is the **Projects Rail**, and the compatibility test id is `left-nav`. Neither “Left Nav”
nor “Left Sidebar” describes durable placement because the tool can move.

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Add-Project Button / Menu | `panels/AddProjectMenu.tsx` → `AddProjectMenu` (the rail "+") | `add-project-menu` | Open project / Open GitHub (soon) / Recents dropdown |
| Project Row | inline row in `ProjectTree` | `project-item` | A project (git repo); clicking selects it (project home) |
| — Project Expander | chevron control | `project-expand` | Expands/collapses the project's workspace list |
| — Project Name | inline `<button>` | `project-name` | Selects the project (project home) |
| — Workspace Count | inline `<span>` | `project-workspace-count` | Collapsed-row count of the project's worktree workspaces |
| — Add-Workspace Button | inline "+" | `add-workspace` | Opens the New Workspace Dialog |
| — Project Actions Menu | Context Menu on the row | `project-actions` | Create workspace (`project-menu-create-workspace`) / Close project (`project-menu-close`) |
| Workspace Row | inline row in `ProjectTree` | `workspace-item` | A workspace (git worktree); two-line: name + branch |
| — Workspace Name | inline `<span>` | `workspace-name` | Display name |
| — Workspace Branch | inline `<span>` | `workspace-branch` | Git branch (muted, proportional metadata; hidden if it equals the name) |
| — Workspace Actions Menu | `MoreVertical` Dropdown Menu | `workspace-menu` / `workspace-actions` | Open in (`workspace-open-in`) / Copy path / Reveal / Remove workspace |
| — Remove-Workspace Item | menu item in the actions menu | `workspace-remove` | Opens a Confirm Dialog; not shown on the Default workspace |

The **Default Workspace** row (`kind === "default"` — the project folder itself) is pinned first, uses a
`House` icon in place of the `GitBranch` glyph, and has no Remove item — but it gets the same Open in /
Copy path / Reveal menu as any worktree.

---

# Welcome Screen

Shown in the Welcome Layout's right column when no workspace is active (fresh install, or after archiving
the last workspace). Mutually exclusive with the Workspace Workbench.

- **Canonical name:** Welcome Panel (a.k.a. Welcome Screen).
- **Implementation:** `panels/WelcomePanel.tsx` → `WelcomePanel`.
- **Parent:** App Shell (Welcome Layout, `id="welcome"` panel).
- **Position:** Centered content in the wide right column beside the Projects Rail.
- **Responsibility:** first-touch surface + the **mode fork** — pair "Start building" (isolated worktree)
  with "Work in project folder" (Default workspace).

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Welcome Heading | inline hero heading | `welcome-title` | Project name, or `PRODUCT_NAME` when no project |
| Provider Warning Banner | `panels/ProviderWarningBanner.tsx` → `ProviderWarningBanner` | — | Gold banner shown only when no provider is connected |
| Project Skills Notice | `panels/ProjectSkillsNotice.tsx` → `ProjectSkillsNotice` | — | Pre-workspace trust surface for committed skills |
| Primary Card (CTA) | `Card` in `WelcomePanel` | `welcome-cta` | Filled-primary action |
| Action Card | `Card` in `WelcomePanel` | `welcome-action` | Quiet secondary actions |

---

# Center Workbench

The central work area is a recursive tree of one to four tab groups. Each group has its own **Group
Header** (tab strip plus group controls), selection, preview slot, and body; horizontal or vertical
separators resize adjacent groups.

- **Canonical name:** Center Workbench (a.k.a. Center Tabbed Area / Editor Area).
- **Implementation:** `shell/layout/Workbench.tsx` (topology and container chrome), integrated by
  `shell/WorkspaceWorkbench.tsx` (feature bodies and local-state orchestration).
- **`data-testid`:** compatibility wrapper `center-tabs`; leaves are `center-group`, Group Headers are
  `center-tab-strip` (a legacy name), and split separators are `center-split-resize`.
- **Parent:** Workspace Workbench.
- **Responsibility:** hosts **File**, **Chat**, **Diff**, rehydratable **Document**, and **Terminal** tabs;
  owns recursive placement, per-group preview/keep semantics, movement, overflow, and focus recovery.

**⚠ Naming note (tab element):** file/chat/diff/document tabs carry `data-testid="editor-tab"`; terminal
placements carry `terminal-tab`. The resource kind is also available through `data-kind`. "Editor tab" is
a compatibility test hook, not the kind.

Children:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Center Group | `CenterGroupView` in `Workbench` | `center-group` | One leaf: tab strip + locally selected body |
| Group Header | `TabStrip` plus injected group controls in `Workbench` | `center-tab-strip` | Fixed one-row chrome containing the ARIA tablist, scrolling, searchable overflow, and group actions |
| Tab | `WorkbenchTab` | `editor-tab` / `terminal-tab` | One canonical placement; `data-preview` marks a preview |
| — Tab Close | inline `X` action | `editor-tab-close` | Close the placement (not the underlying durable resource) |
| New-Chat Button | injected center action | `new-chat` | Open a fresh chat tab |
| Chat-History Menu | `shell/WorkspaceChatHistory.tsx` | `chat-history` | Reopen or delete closed/disk-only chats |
| Editor Pane | injected selected body | `editor-pane` | Locally selected center body |
| Workspace-Ready Receipt | injected empty state | `workspace-ready` | Orientation receipt when a final center leaf is empty |
| — Start-Chat Action | inline action | `start-chat` | New chat from the empty receipt |

Tab-body components:

| Canonical name | Implementation | Tab kind | Responsibility |
|---|---|---|---|
| File Pane | `panels/FilePane.tsx` → `FilePane` | `FileTab` | File viewer; markdown gets a Preview\|Source toggle |
| — Code Editor | `panels/MonacoEditor.tsx` → `MonacoEditor` (lazy) | — | Read-only Monaco source view |
| — Markdown Preview | `panels/MarkdownPreview.tsx` → `MarkdownPreview` (lazy) | — | Rendered markdown (document skin) |
| Diff Pane | `panels/DiffPane.tsx` → `DiffPane` | `DiffTab` | File diff; Split\|Inline or Source\|Rendered toggle |
| — Monaco Diff | `panels/MonacoDiff.tsx` → `MonacoDiff` (lazy) | — | Read-only two-side diff |
| — Rendered Diff | `panels/RenderedDiff.tsx` → `RenderedDiff` (lazy) | — | Rich markdown diff (`<ins>`/`<del>`) |
| Chat View | `chat/ChatView.tsx` → `ChatView` (lazy) | `chat` | The agent conversation (its own section below) |
| Document Pane | `WorkspaceWorkbench` reference renderer | `document` | Rehydratable virtual documents such as TODO plans |
| Terminal Body | `panels/TerminalWorkbench.tsx` → `TerminalWorkbenchBody` | `terminal` | Visibility-gated xterm surface |

---

# Chat View

The agent conversation, rendered inside a Chat tab in the Center Tabbed Area.

- **Canonical name:** Chat View.
- **Implementation:** `chat/ChatView.tsx` → `ChatView` (the only app-integration piece; wires store +
  transport). All the renderers below it are presentational/props-driven.
- **Parent:** Center Workbench (a selected `chat` tab body).
- **Position:** Fills the Editor Pane. Vertically: Chat Header (top) → Message List (middle, scrolls) →
  Composer (bottom).
- **Responsibility:** render pi's canonical message / content-block model as folded rows; own the
  composer, history overlay, plan popover, and dialogs.

## Chat Header

- **Canonical name:** Chat Header.
- **Implementation:** `chat/ChatHeader.tsx` → `ChatHeader`.
- **Parent:** Chat View.
- **Position:** Slim top bar of the Chat View.
- **Children / slots:**
  - **Plan Strip** — `ChatPlanStripContent` (from `chat/ChatPlan.tsx`), passed into the header's `left`
    slot; opens the **Plan Popover** (`ChatPlanContent`) over the chat.
  - **Status Entries** — inline muted `statusEntries` text (extension status).
  - **Session Stats Bar** — `chat/SessionStatsBar.tsx` → `SessionStatsBar` (token/cost stats).
  - **Skills Button** — `chat/SkillsButton.tsx` → `SkillsButton` (`data-testid="open-skills"`); opens the
    **Skills Dialog** (`chat/SkillsDialog.tsx` → `SkillsDialog`).

## Message List

- **Canonical name:** Message List (a.k.a. Transcript).
- **Implementation:** a `react-virtuoso` `Virtuoso` in `ChatView`, rendering **derived rows** via
  `chat/rows.ts` (`deriveRows`) dispatched by `chat/turns.tsx` → `ChatTurnView`.
- **Parent:** Chat View.
- **Position:** Scrolling middle region between header and composer.
- **Responsibility:** render pi turns as folded rows with progressive disclosure.

**⚠ Naming note (Message vs Turn vs Row):** the code distinguishes three levels. A **Turn** (`ChatTurn`)
is pi's message-level unit; a **Row** (`ChatRow`) is the derived render unit (folding spans turn
boundaries); every rendered message element carries `data-testid="chat-message"` with a `data-role`. Use
**Row** for render units and **Turn** for pi messages; "Message" is the generic surface term.

Row / message renderers (all in `chat/turns.tsx` unless noted):

| Canonical name | Implementation | `data-testid` | Row kind | Responsibility |
|---|---|---|---|---|
| Turn Dispatcher | `ChatTurnView` | — | — | Dispatches a derived row to its renderer |
| User Message | `UserTurn` | `chat-message` (`data-role="user"`) | `user` | A user prompt bubble |
| Assistant Markdown | `chat/Markdown.tsx` → `Markdown` | — | `markdown` | Assistant text (GFM + shiki) |
| System Notice | `SystemTurn` | `chat-message` | `system` | Web-local system notice |
| Error Turn | `ErrorTurn` | `chat-message` | `error` | Persistent tinted failure notice (never folded) |
| Retry Indicator | `RetryIndicator` | `retry-indicator` | `retry` | Retry countdown (turn / summarization) |
| Tool Card | `chat/ToolCard.tsx` → `ToolCard` | `tool-card` (`-toggle`) | `tool` | A primary tool call (collapsible frame) |
| Activity Group | `chat/ActivityGroup.tsx` → `ActivityGroup` | — | `activity` | Folded run of routine steps ("N steps · …") |
| Turn Divider | `TurnDivider` | `turn-divider` / `turn-divider-<id>` | `divider` | Round-end summary + artifact chips |
| — Artifact Chip | `ArtifactChip` | `turn-divider-<id>` | — | "N specs" / "N files changed" deep-link/disclosure |
| — Artifact List | `ArtifactList` | `<testid>-list` / `-list-item` | — | Expanded per-path list |
| Stream Indicator | `chat/StreamIndicator.tsx` → `StreamIndicator` | — | — | Live streaming status |

## Tool Call

- **Canonical name:** Tool Card (the frame); Tool Renderer (the body).
- **Implementation:** `chat/ToolCard.tsx` → `ToolCard` (the collapsible frame), bodies registered via
  `chat/toolRegistry.tsx` → `registerToolRenderer`. Unregistered tools fall back to
  `DefaultToolRenderer`.
- **Parent:** Message List (a `tool` row), or an Activity Group step row (routine tools).
- **Responsibility:** render one tool call; "card" chrome uses `ToolCard`, "bare" chrome owns its own
  frame.

Built-in tool renderers (in `chat/tools/`):

| Canonical name | Implementation | Prominence | Responsibility |
|---|---|---|---|
| Bash Card | `BashCard.tsx` → `BashCard` | routine | Terminal command block |
| Read Card | `ReadCard.tsx` → `ReadCard` | routine | File read (path + highlighted file) |
| Write Card | `ReadCard.tsx` → `WriteCard` | routine | File write |
| Edit Card | `EditCard.tsx` → `EditCard` | routine | Edit (removed/added line diff) |
| Ask-User-Question Card | `AskUserQuestionCard.tsx` → `AskUserQuestionCard` | primary, "bare" | Inline questionnaire |
| Visualization Card | `tools/visualize/` → `VisualizationCard` | primary, expanded | Mermaid diagram / comparison cards |
| Web Card(s) | `tools/web/` | routine | Search/fetch renderers |
| Default Tool Renderer | `DefaultToolRenderer` | routine | Fallback for unregistered tools |

## Composer

- **Canonical name:** Composer.
- **Implementation:** `chat/Composer.tsx` → `Composer`.
- **Parent:** Chat View.
- **Position:** Bottom of the Chat View.
- **Responsibility:** the prompt input + send/steer/followUp/abort, `@`-mentions, `/` slash commands,
  template slot sessions, image paste/drop, `↑` recall, and the history-open affordance.

Children / associated surfaces:

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Model Selector | `chat/ModelSelector.tsx` → `ModelSelector` | — | Model picker (+ Refresh catalog) |
| Thinking Selector | `chat/ThinkingSelector.tsx` → `ThinkingSelector` | — | Thinking/effort level picker |
| Slash-Command Menu | `chat/SlashCommandCompletion.tsx` → `SlashCommandMenu` | `slash-templates-empty` (footer) | `/` command + template completion |
| Send Button | inline (`ArrowUp` / `Square` abort) | — | Send / steer / follow-up / abort |
| History-Open Button | inline (`History` icon) | `history-open` | Opens the History Overlay |
| Slot Hint Chip | inline pill | `slot-hint` | Template slot session progress (`slot n/m · ⇥ next · esc done`) |
| Slot Highlight | inline backdrop span | `slot-highlight` (`data-slot-state`) | Tinted template-slot ranges |

## History Overlay

- **Canonical name:** History Overlay.
- **Implementation:** `chat/HistoryOverlay.tsx` → `HistoryOverlay`, driven by `chat/useHistorySearch.ts`.
- **Parent:** Chat View (opened by the Composer / `Ctrl+R`).
- **Responsibility:** history recall/search; compact single-column, `Tab` grows to a two-pane zoomed
  layout (results + preview).

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Results List | inside `HistoryOverlay` | `history-results` | Prompt / message hits |
| Preview Pane | inside `HistoryOverlay` | `history-preview` | Full text of the selected hit |
| Scope Picker | inside `HistoryOverlay` | `history-scope` / `-option` | This chat / Workspace / Project / Everywhere |
| Jump Action | inside `HistoryOverlay` | `history-jump` (`-shortcut`) | Go to chat |
| Save-as-Template Action | inside `HistoryOverlay` | `history-save-template` (`-shortcut`) | Opens the Template Editor Dialog |

## Chat Plan (TODO plan)

- **Canonical name:** Chat Plan.
- **Implementation:** `chat/ChatPlan.tsx` (`ChatPlanStripContent` = the Plan Strip in the Chat Header;
  `ChatPlanContent` = the Plan Popover body) + `chat/TodoList.tsx` → `TodoList`.
- **Parent:** Chat Header (strip) → Popover (body).
- **Responsibility:** surface the chat's `pi-todos` plan (group-first, status-ordered). There is no
  side-tool Todo tab — the plan lives in the conversation.

---

# Side Workbench

The left and right sides are independently resizable regions. Each side contains an ordered vertical
stack of tab groups; groups can resize, fold to a 27px row, move, and disappear when empty. Hiding a side
leaves a compact restore rail. Side arrangement is workspace-shared; selection and focus are browser-local.

- **Canonical names:** Left Side, Right Side, Side Group, Hidden-Side Rail.
- **Implementation:** `shell/layout/Workbench.tsx` (`SideStack`, `SideGroupView`).
- **`data-testid`:** `left-stack`, `right-stack`, `left-layout-rail`, `right-layout-rail`,
  `side-group-fold`, and side-specific group resize handles.
- **Parent:** Workspace Workbench.
- **Responsibility:** arrange singleton shell tools and terminals without coupling feature panels to
  their position. Files, diffs, chats, and documents remain center-only; terminals can cross domains.

Every Side Group has a **Group Header**; folding retains that header as a 27px row while its linked
body stays native-hidden and unmounted. Initial Balanced placement puts Projects on the left, Specs and
Files in the first right group, then Changes and Review in the second; the default terminal catalog
joins that last group. This is startup behavior, not a fixed hierarchy.

## Side Tools

| Canonical name | `data-testid` | Implementation / responsibility |
|---|---|---|
| Projects | `tab-projects`, body `left-nav` | `panels/ProjectTree.tsx`; projects and workspaces |
| Specs | `tab-specs` | `panels/SpecsPanel.tsx`; read-only spec graph, with `specs-refresh` |
| Files | `tab-files` | `panels/FileTree.tsx`; worktree file tree |
| Changes | `tab-changes` | `panels/ChangesPanel.tsx`; scoped git changes and diff opens |
| Review | `tab-review` | `panels/ReviewPanel.tsx`; review accordion and send actions |

`WorkspaceWorkbench` owns the long-lived Specs and Review reads so badges, review flags, and artifact
classification remain current even while those tool bodies are not selected.

## Changes Tool

The Changes body keeps its own feature toolbar: scope menu, target-branch picker, and List\|Tree toggle.
Rows open center diff tabs. `ChangesPanel` remains arrangement-agnostic; only its side placement changed.

| Canonical name | Implementation | `data-testid` | Responsibility |
|---|---|---|---|
| Changes View Toggle | `panels/ToggleSegment.tsx` | `changes-view-toggle` | List \| Tree |
| Changes List Row | inline in `ChangesPanel` | `change-item` | Flat changed-file row |
| Changes Tree | `panels/ChangesTree.tsx` | — | Folder tree of changed files |
| Diff-Stat Badge | `panels/DiffStatBadge.tsx` | — | Per-file / per-folder `+N −M` |
| Empty state | inline | `changes-empty` | No changes in this scope |
| Error state | inline | `changes-error` / `changes-retry` | Failed read + Retry |

---

# Terminal Placement

A terminal is a movable resource tab, not a permanently lower-right panel. It may occupy a center group
or any side group. The selected terminal in each visible, expanded group mounts; inactive, folded, or
hidden terminal placements do not attach. One terminal identity has at most one mounted body per browser.

- **Implementation:** `panels/TerminalWorkbench.tsx` integrates the host catalog and close flow;
  `panels/TerminalInstance.tsx` is the lazy xterm body.
- **`data-testid`:** placement `terminal-tab`, compatibility body wrapper `terminal-panel`, instance
  `terminal-instance`, and add action `terminal-add`.
- **Responsibility:** preserve host-owned shell identity while layout controls placement and visibility.
  Closing retains the explicit busy-process confirmation flow.

**⚠ Naming note (Status Bar):** ThinkRail has **no dedicated status bar component**. The closest surfaces
are the Top Bar's Connection Status and the Chat Header's Session Stats Bar.

---

# Settings Dialog

- **Canonical name:** Settings Dialog.
- **Implementation:** `panels/SettingsDialog.tsx` → `SettingsDialog` (store-driven; open state in the
  store so multiple surfaces can open it deep-linked).
- **Parent:** App Shell (mounted once inside the Top Bar's `<header>`).
- **Position:** Modal overlay; a two-pane shell (left section rail + scrollable content pane; mobile
  collapses the rail to a horizontal strip).
- **Sections (each its own component):**

| Canonical name | Implementation | Responsibility |
|---|---|---|
| Providers | `panels/ProvidersSettings.tsx` → `ProvidersSettings` | In-app provider auth (+ `panels/JetBrainsAiCard.tsx` → `JetBrainsAiCard`) |
| GitHub | `panels/GithubSettings.tsx` → `GithubSettings` | Local GitHub connection status |
| Appearance | `panels/AppearanceSettings.tsx` → `AppearanceSettings` | Theme picker |
| Layout | `shell/LayoutSettings.tsx` → `LayoutSettings` (injected into the dialog) | Default/apply/capture workbench presets and side-group limit |
| Terminal | `panels/TerminalSettings.tsx` → `TerminalSettings` | Terminal replay budget |
| Templates | `panels/TemplatesSettings.tsx` → `TemplatesSettings` | Global / project prompt templates (`template-row`, `template-starters`) |
| Privacy | `panels/PrivacySettings.tsx` → `PrivacySettings` | Anonymous-usage-analytics toggle |
| General | dimmed nav item | "Soon" placeholder |

---

# Shared UI Primitives

The reusable building blocks (shadcn/ui, Radix), owned under `apps/web/src/components/ui/` and themed with
ThinkRail tokens. Imported per-file (no barrel).

| Canonical name | Implementation | Notes |
|---|---|---|
| Button | `components/ui/button.tsx` | `default` / `destructive` / `outline` / `ghost` |
| Dialog (Modal) | `components/ui/dialog.tsx` | The **Modal** primitive; optional `hideClose` |
| Dropdown Menu | `components/ui/dropdown-menu.tsx` | Height-bounded, scrollable menu; submenu via `DropdownMenuSub*` |
| Context Menu | `components/ui/context-menu.tsx` | Right-click menu; shares `menu-styles.ts` with Dropdown Menu |
| Popover | `components/ui/popover.tsx` | Optional `container` portal target |
| Command | `components/ui/command.tsx` | cmdk combobox body |
| Textarea | `components/ui/textarea.tsx` | |
| Tooltip | `components/ui/tooltip.tsx` | |
| Resizable | `components/ui/resizable.tsx` | `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` |
| Toast | `components/ui/toast.tsx` | Presentational; the store owns the queue |
| Error Boundary | `components/ErrorBoundary.tsx` → `ErrorBoundary` | Per-region crash containment |

App-level dialog/popover instances built on those primitives:

| Canonical name | Implementation | Built on | Responsibility |
|---|---|---|---|
| New Workspace Dialog | `panels/NewWorkspaceDialog.tsx` → `NewWorkspaceDialog` | Dialog | Start-working surface (mode fork: isolated worktree / project folder) |
| Confirm Dialog | `panels/ConfirmDialog.tsx` → `ConfirmDialog` | Dialog | Modal yes/no with no stable anchor (init a repo, close project, remove workspace) |
| Notice Dialog | `panels/NoticeDialog.tsx` → `NoticeDialog` | Dialog | Single-button info modal for failures |
| Confirm Popover | `panels/ConfirmPopover.tsx` → `ConfirmPopover` | Popover | Anchored yes/no from a dedicated action control (template delete) |
| Template Editor Dialog | `chat/TemplateEditorDialog.tsx` → `TemplateEditorDialog` | Dialog | Create/edit a prompt template |
| Skills Dialog | `chat/SkillsDialog.tsx` → `SkillsDialog` | Dialog | Skills manager (chat + project modes) |
| Ext-UI Dialog | `chat/ExtUiDialog.tsx` → `ExtUiDialog` | Dialog | `pi.extensionUi` bridge dialog |
| Login Dialog | `auth/` → `LoginDialog` | Dialog | Provider OAuth / API-key login |

**⚠ Naming notes (primitives):**

- **Modal** = the **Dialog** primitive. There is no separate `Modal` component; "Modal" is the generic
  term, "Dialog" is the implementation.
- **Context Menu** — two shapes co-exist. The **Context Menu** primitive (`components/ui/context-menu.tsx`,
  Radix) backs the Project Row's right-click menu; older right-click surfaces (the Change-Row Actions menu)
  are still the **Dropdown Menu** primitive plus a shared right-click handler — call that one the
  "Row Actions Menu". Both wear the same look via `components/ui/menu-styles.ts`.
- **Drawer** — there is **no drawer** primitive or component. The mobile single-view shell is designed
  but not built; do not use "Drawer" for any current region.
- **Toolbar** — there is no `Toolbar` component; the slim per-panel control rows (Changes Header, the
  Diff Pane header, the view toggles) are inline. Use **Panel Header** / **Panel Toolbar** descriptively,
  not as component names.

---

# Glossary — Canonical Names

Use these terms in design discussions. Where multiple names exist, the **canonical** term is listed with
its alternatives in parentheses.

**Top-level layout**

- **App Shell** — the root frame (`Shell`).
- **Top Bar** — the app-wide header (no component name; inline `<header>`).
- **Workspace Workbench** / **Welcome Layout** — the two body states.
- **Toaster** — the app-wide toast host.

**Top Bar**

- **Wordmark** — the ThinkRail brand mark.
- **Scope Context** (alt: location context) — the persistent location breadcrumb.
- **Connection Status** — the connected/connecting/disconnected pill.
- **Settings Button** — opens the Settings Dialog.

**Projects**

- **Projects Tool** — the movable singleton; **Projects Rail** (alt: Project Tree; legacy test id: Left Nav) is its projects → workspaces view.
- **Project Row**, **Workspace Row**, **Default Workspace** — rail rows.
- **Add-Project Menu**, **Add-Workspace Button**, **Remove-Workspace Button**.
- **Diff-Stat Badge** — the `+N −M` badge.

**Welcome**

- **Welcome Panel** (alt: Welcome Screen) — the no-workspace surface.
- **Welcome Heading**, **Primary Card (CTA)**, **Action Card**.
- **Provider Warning Banner**, **Project Skills Notice**.

**Center**

- **Center Workbench** (alts: Center Tabbed Area, Editor Area).
- **Center Group**, **Group Header**, **Tab Strip**, **Tab**, **Tab Close**, **Split Separator**.
- Tab kinds: **File tab**, **Chat tab**, **Diff tab**, **Document tab**, **Terminal tab**.
- **Editor Pane**, **Workspace-Ready Receipt**.
- **File Pane** (**Code Editor** / **Markdown Preview**), **Diff Pane** (**Monaco Diff** /
  **Rendered Diff**), **Document Pane**, **Terminal Body**.
- **Chat-History Menu**, **New-Chat Button**.

**Chat**

- **Chat View** — the whole conversation surface.
- **Chat Header** — its top bar. **Plan Strip**, **Session Stats Bar**, **Skills Button**.
- **Message List** (alt: Transcript). Units: **Turn** (pi message), **Row** (derived render unit).
- Row renderers: **User Message**, **Assistant Markdown**, **System Notice**, **Error Turn**,
  **Retry Indicator**, **Tool Card**, **Activity Group**, **Turn Divider** (with **Artifact Chip** /
  **Artifact List**), **Stream Indicator**.
- **Tool Card** (frame) / **Tool Renderer** (body): **Bash Card**, **Read Card**, **Write Card**,
  **Edit Card**, **Ask-User-Question Card**, **Visualization Card**, **Web Card**, **Default Tool
  Renderer**.
- **Composer** — the prompt input. **Model Selector**, **Thinking Selector**, **Slash-Command Menu**,
  **Send Button**, **History-Open Button**, **Slot Hint Chip**.
- **History Overlay** — **Results List**, **Preview Pane**, **Scope Picker**, **Jump Action**,
  **Save-as-Template Action**.
- **Chat Plan** — **Plan Strip** + **Plan Popover** + **Todo List**.

**Sides**

- **Left Side**, **Right Side**, **Side Group**, **Hidden-Side Rail**.
- Singleton tools: **Projects**, **Specs**, **Files**, **Changes**, **Review**.
- **Specs Panel**, **Files Panel** (alt: File Tree), **Changes Panel**, **Review Panel**.
- **Changes Header** (no component): **Changes Scope Menu**, **Branch Picker**, **Changes View Toggle**.
- **Changes List** / **Changes Tree**, **Change-Row Actions**, **Tree Row**, **Diff-Stat Badge**.

**Terminal**

- **Terminal Placement**, **Terminal Tab**, **Terminal Instance**, **Add-Terminal Button**. A terminal
  may live in a center or side group; it is not a fixed lower-right region.

**Settings**

- **Settings Dialog** with sections: **Providers**, **GitHub**, **Appearance**, **Layout**,
  **Terminal**, **Templates**, **Privacy**.

**Shared primitives**

- **Modal** = the **Dialog** primitive. **Dropdown Menu**, **Context Menu**, **Popover**, **Command**,
  **Tooltip**, **Toast**, **Resizable**, **Error Boundary**.
- App dialogs: **New Workspace Dialog**, **Confirm Dialog**, **Notice Dialog**, **Confirm Popover**,
  **Template Editor Dialog**, **Skills Dialog**, **Ext-UI Dialog**, **Login Dialog**.

**Terms that do NOT map to a ThinkRail region (avoid or use only as noted)**

- **Status Bar** — none exists; the closest are the Connection Status pill and the Session Stats Bar.
- **Context Menu** — a real primitive now (Project Row right-click); the Changes rows' right-click is still
  the Dropdown Menu (the **Row Actions Menu**). Name the surface, not just "context menu".
- **Drawer** — none exists (mobile shell not yet built).
- **Toolbar** — no component; slim control rows are inline **Panel Headers**.
- **Bottom Terminal** — no fixed region exists; say **Terminal Placement** and name its group.
